#!/usr/bin/env python3
"""One day's reading of an engagement — what moved, who owes what, what is at risk.

    daily_report.py <dir> [--full] [--date YYYY-MM-DD] [--no-snapshot] [--json]

`state.py show` answers "what does it look like now". This answers "what changed
since yesterday, and what is waiting on a person" — the two questions a status
snapshot cannot answer and the only two that make a report worth reading daily.

Every number here is read off a file. This script computes; the skill that calls
it narrates. See shared/numbers-provenance.md — a model may not author a figure,
and that includes a count of open questions.

Stdlib only, on purpose: stage 1 runs on a machine with no engine installed, and
a daily report that starts working in stage 2 is a daily report nobody adopts.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "shared", "lib"))
sys.path.insert(0, HERE)

import changes as ledger  # noqa: E402
import engagement as eng  # noqa: E402
import gate_check  # noqa: E402
import state as orchestration  # noqa: E402
import yamlio  # noqa: E402

#: How many rows a section prints before it collapses into a count. The report is
#: read every morning; a wall is the same as a blank. `--full` lifts it.
CAP = 6

#: The predicates that answer "is this rendered view still current". A stale view
#: reads as correct, which is why it gets its own column rather than a footnote.
FRESHNESS = ("workbook_current", "view_derived_from", "doc_current", "view_current")

STATE_LABEL = {
    "locked": "未开始", "queued": "可开工", "building": "进行中",
    "needs-you": "等你决定", "ready": "待确认", "confirmed": "已确认",
}

KLASS_LABEL = {"M": "确定性计算", "A": "可自动生成", "C": "认知判断", "H": "人担责"}


# ── time ─────────────────────────────────────────────────────────────
# The logs disagree about timezone: progress.yaml carries -07:00 and
# tool-runs.jsonl carries +00:00 for the same afternoon. Comparing the date
# halves of two differently-offset strings puts a morning's work on yesterday.
# Everything is normalised to one local calendar day before anything is compared.

def local_date(stamp):
    """The local calendar day of an ISO-8601 stamp. None when it will not parse."""
    try:
        moment = datetime.datetime.fromisoformat(str(stamp).strip())
    except (TypeError, ValueError):
        return None
    if moment.tzinfo is not None:
        moment = moment.astimezone()
    return moment.date()


def file_date(path):
    return datetime.date.fromtimestamp(os.path.getmtime(path))


def days_between(earlier, later):
    return (later - earlier).days


# ── snapshots ────────────────────────────────────────────────────────
# `progress.yaml` records `{status: done}` and nothing else — no completion
# timestamp — so "which steps closed since yesterday" is not derivable from the
# workspace as it stands. The report leaves its own trail instead: today's
# payload is tomorrow's baseline. It lives under state/ because it is machine
# bookkeeping, not something anybody delivers.

def snapshot_dir(root):
    return os.path.join(root, "state", "daily")


def snapshot_path(root, day):
    return os.path.join(snapshot_dir(root), "%s.json" % day.isoformat())


def snapshots(root):
    """[(date, path)] oldest first."""
    folder = snapshot_dir(root)
    if not os.path.isdir(folder):
        return []
    out = []
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".json"):
            continue
        try:
            out.append((datetime.date.fromisoformat(name[:-5]), os.path.join(folder, name)))
        except ValueError:
            continue
    return out


def read_snapshot(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def previous_snapshot(root, today):
    """The most recent snapshot from before today, or None on the first run."""
    for day, path in reversed(snapshots(root)):
        if day < today:
            payload = read_snapshot(path)
            if payload is not None:
                return day, payload
    return None, None


def waiting_since(root, step_id, today):
    """The first day a snapshot saw this step waiting. Today when never seen."""
    for day, path in snapshots(root):
        if day >= today:
            break
        payload = read_snapshot(path) or {}
        if step_id in [item["step"] for item in payload.get("waiting", [])]:
            return day
    return today


def write_snapshot(root, payload):
    os.makedirs(snapshot_dir(root), exist_ok=True)
    path = snapshot_path(root, datetime.date.fromisoformat(payload["date"]))
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1, sort_keys=True)
    return path


# ── collection ───────────────────────────────────────────────────────

def collect_deliverables(state):
    out = []
    for deliverable in eng.deliverables():
        steps = eng.deliverable_steps(deliverable["id"])
        out.append({
            "id": deliverable["id"],
            "name": deliverable.get("name", deliverable["id"]),
            "stage": deliverable.get("stage", ""),
            "state": state.deliverable_state(deliverable["id"]),
            "done": sum(1 for s in steps if state.is_done(s["id"])),
            "total": len(steps),
        })
    return out


def collect_waiting(root, state, today):
    out = []
    for deliverable_id, step in state.waiting_on_you():
        gate = step.get("gate") or {}
        blocked = sorted({eng.step_def(s)["deliverable"]
                          for s in orchestration.downstream(step["id"])} - {deliverable_id})
        since = waiting_since(root, step["id"], today)
        out.append({
            "step": step["id"],
            "deliverable": eng.deliverable_def(deliverable_id).get("name", deliverable_id),
            "name": step.get("name", ""),
            "klass": step.get("klass", ""),
            "kind": gate.get("kind", ""),
            "question": " ".join(str(gate.get("question", "")).split()),
            "evidence": gate.get("evidence", ""),
            "blocks": [eng.deliverable_def(d).get("name", d) for d in blocked],
            "waitingSince": since.isoformat(),
            "waitingDays": days_between(since, today),
        })
    return out


def collect_metadata(root):
    """The locked calibre, the contract, and the two debts nobody reads."""
    meta = {}
    profile_path = os.path.join(root, "artifacts", "s1", "project-profile.yaml")
    if os.path.isfile(profile_path):
        profile = (eng.read_yaml(profile_path) or {}).get("profile") or {}
        window = profile.get("timeWindow") or {}
        assumptions = profile.get("assumptions") or []
        meta["profile"] = {
            "status": ((eng.read_yaml(profile_path) or {}).get("meta") or {}).get("status", ""),
            "responseMetric": profile.get("responseMetric", ""),
            "timeGranularity": profile.get("timeGranularity", ""),
            "timeWindow": "%s → %s" % (window.get("from", "?"), window.get("to", "?")),
            "modelScope": [{"name": axis.get("name", ""), "values": axis.get("values") or []}
                           for axis in profile.get("modelScope") or []],
            "scopeRows": len(profile.get("scopeRows") or []),
            "outOfScope": profile.get("outOfScope") or [],
            "productExclusions": profile.get("productExclusions") or [],
            # The two debts. Every `assumed: true` is a calibre the consultant
            # chose on the client's behalf; every open question is one nobody has
            # chosen yet. Both are cheap now and expensive after the model runs.
            "assumed": [a.get("question", "") for a in assumptions if a.get("assumed")],
            "openQuestions": profile.get("openQuestions") or [],
            "mtime": file_date(profile_path).isoformat(),
        }
        advisories = profile.get("scopeAdvisories") or {}
        exceeded = []
        for key, entry in advisories.items():
            if not isinstance(entry, dict):
                continue
            actual, suggested = entry.get("actual"), entry.get("suggested")
            if isinstance(actual, int) and isinstance(suggested, int) and actual > suggested:
                exceeded.append("%s %s（建议 %s）" % (key, actual, suggested))
        meta["scopeExceeded"] = exceeded

    granularity = os.path.join(root, "metadata", "granularity.yaml")
    meta["granularityPresent"] = os.path.isfile(granularity)

    schema_path = os.path.join(root, "metadata", "schema", "target-schema.yaml")
    if os.path.isfile(schema_path):
        schema = eng.read_yaml(schema_path) or {}
        enums = []
        for path in eng.resolve(root, "metadata/schema/enums/*.yaml"):
            data = eng.read_yaml(path) or {}
            values = data.get("values") or data.get("canonical") or []
            enums.append({"name": os.path.basename(path)[:-5],
                          "count": len(values) if isinstance(values, list) else 0,
                          "closed": bool(data.get("closed"))})
        meta["schema"] = {"columns": len(schema.get("columns") or []), "enums": enums}

    tree_path = os.path.join(root, "artifacts", "s1", "factor-tree.yaml")
    if os.path.isfile(tree_path):
        tree_meta, rows = eng.load_tree(root)
        counts = {}
        for row in rows:
            counts[str(row.get("status", "?"))] = counts.get(str(row.get("status", "?")), 0) + 1
        groups = {str(row.get("l4", "")) for row in rows if row.get("status") == "accepted"}
        primary = {str(row.get("l4", "")) for row in rows
                   if row.get("status") == "accepted" and row.get("primary")}
        meta["tree"] = {
            "rows": len(rows),
            "counts": counts,
            "l4Groups": len(groups),
            "l4WithPrimary": len(primary),
            "delta": tree_meta.get("delta") or {},
            "mtime": file_date(tree_path).isoformat(),
        }
    return meta


def collect_funnel(root):
    """The six-layer survivorship, or the data request that stands in for it."""
    path = os.path.join(root, "artifacts", "s2", "funnel.yaml")
    if os.path.isfile(path):
        data = eng.read_yaml(path) or {}
        layers, reasons = [], {}
        for layer in data.get("layers") or []:
            label = layer.get("label", layer.get("layer", ""))
            layers.append({"label": label,
                           "intake": layer.get("intake", 0),
                           "rejected": layer.get("rejected", 0),
                           "survivors": layer.get("survivors", 0)})
            # The per-factor `reason` on a drop is where the business explanation
            # lives ("媒介代理商本轮未拆分提供"). `missingFactors[].reason` is the
            # uniform "从未拿到数据", which clusters into one useless bucket — so
            # the clustering is done over the layer drops, tagged with the layer.
            for entry in layer.get("dropped") or []:
                key = (label, " ".join(str(entry.get("reason", "未说明")).split()))
                reasons[key] = reasons.get(key, 0) + 1
        stages = {}
        for entry in data.get("missingFactors") or []:
            key = str(entry.get("failedAt", "未说明"))
            stages[key] = stages.get(key, 0) + 1
        return {"kind": "funnel", "layers": layers,
                "dropReasons": [{"layer": layer, "reason": reason, "count": count}
                                for (layer, reason), count in
                                sorted(reasons.items(), key=lambda item: -item[1])],
                "missingByStage": stages,
                "missingTotal": len(data.get("missingFactors") or [])}

    coverage = os.path.join(root, "data", "published", "coverage.yaml")
    if os.path.isfile(coverage):
        records = (eng.read_yaml(coverage) or {}).get("records") or []
        orphans = [r for r in records if not str(r.get("treeRowId") or "").strip()]
        return {"kind": "coverage", "records": len(records), "orphans": len(orphans)}

    books = eng.resolve(root, "artifacts/s1/data-request/*.xlsx")
    if books:
        return {"kind": "request", "workbooks": len(books)}
    return {"kind": "none"}


def collect_artifacts(root, state, today):
    """Every produced file that exists, plus the views that have gone stale.

    Staleness is a property of the freshness predicate, not of a file — the
    predicate already names the view it is unhappy about in its own message, so
    it is reported once per step rather than stamped onto every file the step
    produced. Stamping it on all of them says the source YAML is stale when it is
    the workbook rendered from it that never got rebuilt.
    """
    out, stale = [], []
    for step in eng.steps():
        if state.is_done(step["id"]):
            for predicate in step.get("verify") or []:
                name, _, arg = str(predicate).partition(":")
                if name not in FRESHNESS:
                    continue
                handler = gate_check.PREDICATES.get(name)
                if handler is None:
                    continue
                try:
                    ok, detail = handler(root, arg)
                except Exception as error:              # noqa: BLE001
                    ok, detail = False, "检查本身出错（%s）" % error
                if not ok:
                    # `factor-tree/{derive,confirm,amend}` all verify the same
                    # workbook, so one un-rebuilt xlsx would be reported three
                    # times. Dedupe on the message: it names the file.
                    message = " ".join(str(detail).split())
                    if message not in [item["detail"] for item in stale]:
                        stale.append({"step": step["id"], "detail": message})
        for pattern in step.get("produces") or []:
            for path in eng.resolve(root, pattern):
                if os.path.isdir(path):
                    continue
                changed = file_date(path)
                out.append({
                    "path": os.path.relpath(path, root),
                    "deliverable": eng.deliverable_def(step["deliverable"]).get(
                        "name", step["deliverable"]),
                    "step": step["id"],
                    "mtime": changed.isoformat(),
                    "today": changed == today,
                })
    exports = [{"path": os.path.relpath(p, root), "mtime": file_date(p).isoformat()}
               for p in eng.resolve(root, "exports/*") if os.path.isfile(p)]
    return out, stale, exports


def collect_activity(root, today):
    """What actually happened today: verdicts, tool runs, touched files."""
    verdicts = [d for d in eng.decisions(root) if local_date(d.get("at")) == today]

    runs, failures = 0, []
    runs_path = os.path.join(root, "state", "tool-runs.jsonl")
    if os.path.isfile(runs_path):
        for line in eng.read_text(runs_path).splitlines():
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if local_date(entry.get("at")) != today:
                continue
            runs += 1
            if entry.get("status") != "ok":
                failures.append("%s → %s" % (entry.get("tool", "?"),
                                             entry.get("note") or entry.get("status") or "失败"))

    changes = [c for c in ledger.read(root) if local_date(c.get("at")) == today]
    return {
        "verdicts": [{"gate": d.get("gate", ""), "verdict": d.get("verdict", ""),
                      "who": d.get("who", ""), "note": d.get("note", "")}
                     for d in verdicts],
        "runs": runs,
        "failures": failures,
        "ledgerEntries": [c.get("subject", "") for c in changes],
    }


def collect_business_risks(root, state, metadata, funnel):
    """Risks that need judgement — each one pinned to the file that proves it."""
    risks = []

    if funnel.get("missingTotal"):
        risks.append({
            "what": "%d 个因子最终没有进模型" % funnel["missingTotal"],
            "why": "因子树当初把它们放进来是有业务理由的；建模阶段的结论不覆盖它们，"
                   "交付时要说出来",
            "where": "artifacts/s2/funnel.yaml · missingFactors",
        })
    for entry in funnel.get("dropReasons", [])[:3]:
        risks.append({
            "what": "%s 一次剔掉 %d 个 —— %s" % (entry["layer"], entry["count"],
                                                 entry["reason"][:60]),
            "why": "同一条原因剔掉一批，通常是一处供数缺口，不是一批独立判断",
            "where": "artifacts/s2/funnel.yaml · layers[].dropped",
        })

    profile = metadata.get("profile") or {}
    if profile.get("assumed"):
        risks.append({
            "what": "%d 条口径是顾问替客户预设的，尚未经客户确认" % len(profile["assumed"]),
            "why": "锁定的口径一旦被客户推翻，档案之后的每一层都要重做",
            "where": "artifacts/s1/project-profile.yaml · assumptions[].assumed",
        })
    if profile.get("openQuestions"):
        risks.append({
            "what": "%d 个口径问题还没有答案" % len(profile["openQuestions"]),
            "why": "悬着的问题会在下游变成返工，越晚答代价越大",
            "where": "artifacts/s1/project-profile.yaml · openQuestions",
        })
    if profile.get("modelScope") and not profile.get("scopeRows"):
        risks.append({
            "what": "档案声明了模型范围的各个轴，但没有逐条列出在范围内的组合",
            "why": "轴的叉乘和实际要建的格子不是一回事，不列清楚下游按哪个走全靠猜",
            "where": "artifacts/s1/project-profile.yaml · scopeRows",
        })
    if metadata.get("scopeExceeded"):
        risks.append({
            "what": "模型范围超出建议规模：%s" % "、".join(metadata["scopeExceeded"]),
            "why": "范围越大每个格子的样本越少，估计越不稳",
            "where": "artifacts/s1/project-profile.yaml · scopeAdvisories",
        })

    signoffs = os.path.join(root, "artifacts", "s2", "signoffs.yaml")
    if os.path.isfile(signoffs):
        data = eng.read_yaml(signoffs) or {}
        denied = [r for r in (data.get("rows") or data.get("signoffs") or [])
                  if isinstance(r, dict) and str(r.get("verdict", "")).lower() in ("no", "reject", "rejected")]
        if denied:
            risks.append({
                "what": "客户明确否掉了 %d 个指标" % len(denied),
                "why": "这些指标被后面每一层继承，永远不再进模型",
                "where": "artifacts/s2/signoffs.yaml",
            })

    card = os.path.join(root, "artifacts", "s2", "quality-scorecard.yaml")
    if os.path.isfile(card):
        rows = (eng.read_yaml(card) or {}).get("rows") or []
        borderline = []
        for row in rows:
            dims = [row.get(k) for k in ("consistency", "accuracy", "completeness", "granularity")]
            if any(d is None for d in dims):
                continue
            total = 1.0
            for value in dims:
                total *= float(value)
            if 0 < total < 0.5:
                borderline.append(row.get("indicator", "?"))
        if borderline:
            risks.append({
                "what": "%d 个指标落在边缘分值，等人处置" % len(borderline),
                "why": "边缘分值不自动放行也不自动弃用，卡在这里下游就开不了工",
                "where": "artifacts/s2/quality-scorecard.yaml",
            })

    # The engine is a hard blocker for stage 2, never a silent degrade.
    if state.is_done("data-request/signoff"):
        try:
            import mmm_engine  # noqa: F401
        except ImportError:
            risks.append({
                "what": "数据阶段的引擎没装在这台机器上",
                "why": "S2 的计算一步都跑不了；这是阻塞，不是降级",
                "where": "~/.local/bin/mmm doctor 会说清楚装什么",
            })
        deliveries = [p for p in eng.resolve(root, "inputs/data/*") if os.path.isdir(p)]
        if not deliveries:
            signed = [d for d in eng.decisions(root) if d.get("gate") == "data-request/signoff"]
            if signed:
                day = local_date(signed[-1].get("at"))
                if day:
                    risks.append({
                        "what": "数据需求已签收 %d 天，inputs/data/ 里还没有任何一批数据"
                                % days_between(day, datetime.date.today()),
                        "why": "整个数据阶段停在等客户，不是停在我们",
                        "where": "state/decisions.log · data-request/signoff",
                    })
    return risks


def divergence(root, state):
    """Progress record says nothing while the disk says otherwise, and vice versa.

    A workspace whose steps are all pending but whose artifacts are on disk is
    not a workspace that has not started — it is one whose record was never
    written, and reporting "未开始" on it is the one wrong answer.
    """
    notes = []
    undone_with_output = []
    for step in eng.steps():
        if state.is_done(step["id"]):
            continue
        produced = [p for pattern in step.get("produces") or []
                    for p in eng.resolve(root, pattern)]
        if produced:
            undone_with_output.append(step["id"])
    if undone_with_output:
        notes.append("%d 个步骤的产出物已经在磁盘上，但进度记录里还是未完成（%s）—— "
                     "进度记录和磁盘对不上，先让编排层核对一遍"
                     % (len(undone_with_output), "、".join(undone_with_output[:3])))
    return notes


def collect(root, today):
    state = eng.State(root)
    identity = eng.read_yaml(os.path.join(root, "mmm.yaml")) or {}
    metadata = collect_metadata(root)
    funnel = collect_funnel(root)
    artifacts, stale, exports = collect_artifacts(root, state, today)
    deliverables = collect_deliverables(state)

    stages = {s["id"]: s.get("name", s["id"]) for s in eng.manifest().get("stages", [])}
    open_now = [d for d in deliverables if d["state"] != "confirmed"]

    return {
        "date": today.isoformat(),
        "generated": eng.now_iso(),
        "workspace": os.path.abspath(root),
        "layoutVersion": eng.layout_version(root),
        "identity": {
            "project": identity.get("project", "?"),
            "brand": identity.get("brand", "?"),
            "industry": "/".join(filter(None, (identity.get("industry") or {}).values())),
        },
        "stage": stages.get(open_now[0]["stage"], "") if open_now else "已收尾",
        "deliverables": deliverables,
        "waiting": collect_waiting(root, state, today),
        "metadata": metadata,
        "funnel": funnel,
        "artifacts": artifacts,
        "staleViews": stale,
        "exports": exports,
        "activity": collect_activity(root, today),
        "mechanical": orchestration.problems(root),
        "business": collect_business_risks(root, state, metadata, funnel),
        "divergence": divergence(root, state),
        "actionable": [{"step": s, "klass": eng.step_def(s).get("klass", ""),
                        "name": eng.step_def(s).get("name", "")}
                       for s in state.actionable()],
    }


# ── diff ─────────────────────────────────────────────────────────────

def compare(payload, before):
    """What moved since the baseline snapshot. Empty dict when there is none."""
    if not before:
        return {}
    was = {d["id"]: d for d in before.get("deliverables", [])}
    moved = []
    for deliverable in payload["deliverables"]:
        old = was.get(deliverable["id"])
        if not old:
            continue
        if old.get("state") != deliverable["state"]:
            moved.append("%s：%s → %s" % (deliverable["name"],
                                          STATE_LABEL.get(old.get("state"), old.get("state")),
                                          STATE_LABEL.get(deliverable["state"], deliverable["state"])))
        elif old.get("done") != deliverable["done"]:
            moved.append("%s：完成 %d/%d → %d/%d"
                         % (deliverable["name"], old.get("done", 0), old.get("total", 0),
                            deliverable["done"], deliverable["total"]))

    old_waiting = {w["step"] for w in before.get("waiting", [])}
    new_waiting = {w["step"] for w in payload["waiting"]}

    counters = []
    old_tree = (before.get("metadata") or {}).get("tree") or {}
    new_tree = (payload.get("metadata") or {}).get("tree") or {}
    if old_tree.get("rows") != new_tree.get("rows") and new_tree:
        counters.append("因子树 %s → %s 行" % (old_tree.get("rows", "?"), new_tree.get("rows")))
    old_profile = (before.get("metadata") or {}).get("profile") or {}
    new_profile = (payload.get("metadata") or {}).get("profile") or {}
    for key, label in (("assumed", "未确认的预设口径"), ("openQuestions", "未答的口径问题")):
        old_n, new_n = len(old_profile.get(key) or []), len(new_profile.get(key) or [])
        if old_profile and old_n != new_n:
            counters.append("%s %d → %d 条" % (label, old_n, new_n))

    old_layers = {l["label"]: l for l in (before.get("funnel") or {}).get("layers", [])}
    for layer in (payload.get("funnel") or {}).get("layers", []):
        old = old_layers.get(layer["label"])
        if old and old.get("survivors") != layer.get("survivors"):
            counters.append("漏斗「%s」存活 %s → %s"
                            % (layer["label"], old.get("survivors"), layer.get("survivors")))

    old_problems = set(before.get("mechanical") or [])
    new_problems = set(payload.get("mechanical") or [])
    return {
        "since": before.get("date", ""),
        "moved": moved,
        "newWaiting": sorted(new_waiting - old_waiting),
        "clearedWaiting": sorted(old_waiting - new_waiting),
        "counters": counters,
        "newProblems": sorted(new_problems - old_problems),
        "fixedProblems": sorted(old_problems - new_problems),
    }


# ── rendering ────────────────────────────────────────────────────────

def bullets(lines, out, cap, indent="  · "):
    for line in lines[:cap]:
        out.append("%s%s" % (indent, line))
    if len(lines) > cap:
        out.append("%s另有 %d 条（--full 全看）" % (indent, len(lines) - cap))


def listing(values, limit=4):
    """A few values and an honest marker when there are more. Never a silent cut."""
    shown = "、".join(str(v) for v in values[:limit])
    return "%s…等 %d 个" % (shown, len(values)) if len(values) > limit else shown


def render(payload, delta, cap):
    out = []
    identity = payload["identity"]
    counts = {}
    for deliverable in payload["deliverables"]:
        counts[deliverable["state"]] = counts.get(deliverable["state"], 0) + 1
    confirmed = counts.get("confirmed", 0)
    total = len(payload["deliverables"])

    out.append("%s · %s · %s" % (identity["project"], identity["brand"], identity["industry"]))
    out.append("%s 日报 · %s · 工作区 %s"
               % (payload["date"], payload["stage"] or "—", payload["workspace"]))
    out.append("交付物 %d/%d 已确认；%s"
               % (confirmed, total,
                  "、".join("%s %d" % (STATE_LABEL.get(k, k), v)
                           for k, v in sorted(counts.items()) if k != "confirmed") or "其余无"))
    if payload["layoutVersion"] < 3:
        out.append("⚠ 这个工作区是 v%d，进度结构是旧版 —— 先跑 ~/.local/bin/mmm script migrate_workspace，"
                   "在那之前下面的进度可能不完整" % payload["layoutVersion"])
    for note in payload["divergence"]:
        out.append("⚠ %s" % note)

    out.append("")
    out.append("── 等你决定 ──")
    if not payload["waiting"]:
        out.append("  没有卡在人这边的事。")
    for item in payload["waiting"][:cap]:
        aging = "已等 %d 天" % item["waitingDays"] if item["waitingDays"] else "今天新出现"
        out.append("  %s —— %s（%s，%s）"
                   % (item["deliverable"], item["name"],
                      KLASS_LABEL.get(item["klass"], item["klass"]), aging))
        if item["question"]:
            out.append("      问的是：%s" % item["question"])
        if item["evidence"]:
            out.append("      要看的：%s" % item["evidence"])
        if item["blocks"]:
            out.append("      卡住了：%s" % "、".join(item["blocks"][:4]))
    if len(payload["waiting"]) > cap:
        out.append("  另有 %d 项也在等你" % (len(payload["waiting"]) - cap))

    out.append("")
    out.append("── 昨日 → 今日 ──")
    activity = payload["activity"]
    if not delta:
        out.append("  首日无对照，只报当日流水。明天起有昨日快照可比。")
    else:
        out.append("  对照 %s 的快照。" % delta["since"])
        for label, key in (("进展", "moved"), ("计数变化", "counters"),
                           ("新增问题", "newProblems"), ("已消除的问题", "fixedProblems")):
            if delta[key]:
                out.append("  %s：" % label)
                bullets(delta[key], out, cap, "      · ")
        if delta["newWaiting"]:
            out.append("  新卡到你这儿：%s" % "、".join(delta["newWaiting"]))
        if delta["clearedWaiting"]:
            out.append("  你已放行：%s" % "、".join(delta["clearedWaiting"]))
        if not any(delta[k] for k in ("moved", "counters", "newProblems", "fixedProblems",
                                      "newWaiting", "clearedWaiting")):
            out.append("  和昨天相比没有变化。")
    if activity["verdicts"]:
        out.append("  今天关的门：")
        bullets(["%s · %s · %s%s" % (v["gate"], v["verdict"], v["who"],
                                     "：%s" % v["note"][:60] if v["note"] else "")
                 for v in activity["verdicts"]], out, cap, "      · ")
    if activity["runs"]:
        out.append("  今天跑了 %d 次工具%s"
                   % (activity["runs"],
                      "，%d 次失败" % len(activity["failures"]) if activity["failures"] else "，全部成功"))
        bullets(activity["failures"], out, cap, "      失败 · ")
    if activity["ledgerEntries"]:
        out.append("  变更账本今天新增 %d 条：%s"
                   % (len(activity["ledgerEntries"]), "、".join(activity["ledgerEntries"][:3])))

    out.append("")
    out.append("── 元数据 ──")
    metadata = payload["metadata"]
    profile = metadata.get("profile")
    if not profile:
        out.append("  项目档案还没写出来 —— 口径尚未锁定。")
    else:
        out.append("  响应指标 %s · 时间颗粒度 %s · 时间窗 %s"
                   % (profile["responseMetric"] or "未定", profile["timeGranularity"] or "未定",
                      profile["timeWindow"]))
        scope = "；".join("%s %d（%s）" % (axis["name"], len(axis["values"]),
                                          listing(axis["values"]))
                          for axis in profile["modelScope"])
        # Zero rows next to declared axes is not "no combinations in scope" — it
        # is a profile that never enumerated them. Printing `0 个组合` reads as
        # the first and means the second.
        out.append("  模型范围 %s → %s"
                   % (scope or "未定",
                      "%d 个组合" % profile["scopeRows"] if profile["scopeRows"]
                      else "⚠ 组合未逐条声明"))
        if profile["outOfScope"] or profile["productExclusions"]:
            out.append("  范围外：%s"
                       % listing(profile["outOfScope"] + profile["productExclusions"], 3))
        out.append("  档案状态 %s，最后改动 %s%s"
                   % (profile["status"] or "?", profile["mtime"],
                      "" if metadata.get("granularityPresent")
                      else " · ⚠ metadata/granularity.yaml 缺失"))
        if profile["assumed"]:
            out.append("  ⚠ %d 条口径是替客户预设的，还没经客户确认：" % len(profile["assumed"]))
            bullets(profile["assumed"], out, cap, "      · ")
        if profile["openQuestions"]:
            out.append("  ⚠ %d 个口径问题还没答：" % len(profile["openQuestions"]))
            bullets([" ".join(str(q).split()) for q in profile["openQuestions"]], out, cap, "      · ")
    schema = metadata.get("schema")
    if schema:
        # An open enum with no values is the correct starting state, not a gap —
        # rendering it as "0 值" alongside the closed ones reads as a hole.
        out.append("  目标表 %d 列 · 枚举 %s"
                   % (schema["columns"],
                      "、".join("%s %s" % (e["name"], "封闭 %d 值" % e["count"] if e["closed"]
                                           else "开放（已种入 %d 值）" % e["count"])
                               for e in schema["enums"])))
    tree = metadata.get("tree")
    if tree:
        breakdown = "、".join("%s %d" % (k, v) for k, v in sorted(tree["counts"].items()))
        out.append("  因子树 %d 行（%s）· %d 个 L4 分组，其中 %d 个已定主指标"
                   % (tree["rows"], breakdown, tree["l4Groups"], tree["l4WithPrimary"]))
        if tree["delta"].get("exceeds"):
            out.append("  ⚠ 因子树增删幅度 %s 超过参考阈值 %s"
                       % (tree["delta"].get("ratio"), tree["delta"].get("threshold")))

    out.append("")
    out.append("── 因子漏斗 ──")
    funnel = payload["funnel"]
    if funnel["kind"] == "funnel":
        out.append("  " + " → ".join("%s %d" % (layer["label"], layer["survivors"])
                                     for layer in funnel["layers"]))
        for layer in funnel["layers"]:
            if layer["rejected"]:
                out.append("      %s：进 %d，剔 %d，留 %d"
                           % (layer["label"], layer["intake"], layer["rejected"], layer["survivors"]))
        if funnel["missingByStage"]:
            out.append("  未进模型的因子 %d 个，死在：%s"
                       % (funnel["missingTotal"],
                          "、".join("%s %d 个" % (stage, count)
                                   for stage, count in sorted(funnel["missingByStage"].items(),
                                                              key=lambda item: -item[1]))))
        if funnel["dropReasons"]:
            out.append("  剔除原因归并（同一条原因剔掉多少个）：")
            bullets(["%s · %d 个 —— %s" % (entry["layer"], entry["count"], entry["reason"][:70])
                     for entry in funnel["dropReasons"]], out, cap, "      · ")
    elif funnel["kind"] == "coverage":
        out.append("  已发布 %d 条指标记录，其中 %d 条没有对应的因子行（孤儿）"
                   % (funnel["records"], funnel["orphans"]))
    elif funnel["kind"] == "request":
        out.append("  漏斗还没有形成 —— 数据需求已出 %d 本工作簿，等数据回来。" % funnel["workbooks"])
    else:
        out.append("  漏斗还没有形成 —— 还在业务理解阶段。")

    out.append("")
    out.append("── 产物 ──")
    artifacts = payload["artifacts"]
    stale = payload["staleViews"]
    fresh = [a for a in artifacts if a["today"]]
    out.append("  磁盘上 %d 份产出物；今天改过 %d 份；过期视图 %d 处"
               % (len(artifacts), len(fresh), len(stale)))
    if fresh:
        out.append("  今天改过的：")
        bullets(["%s（%s）" % (a["path"], a["deliverable"]) for a in fresh], out, cap, "      · ")
    if stale:
        out.append("  ⚠ 过期视图 —— 源文件改了，这份没有重新生成，发出去就是错的：")
        bullets([item["detail"] for item in stale], out, cap, "      · ")
    if payload["exports"]:
        out.append("  可以送出门的（exports/）：")
        bullets(["%s（%s）" % (e["path"], e["mtime"]) for e in payload["exports"]],
                out, cap, "      · ")

    out.append("")
    out.append("── 风险 ──")
    out.append("  机制性 %d 条 · 业务性 %d 条"
               % (len(payload["mechanical"]), len(payload["business"])))
    if payload["business"]:
        out.append("  业务性：")
        for risk in payload["business"][:cap]:
            out.append("      · %s" % risk["what"])
            out.append("        %s —— 见 %s" % (risk["why"], risk["where"]))
        if len(payload["business"]) > cap:
            out.append("      另有 %d 条（--full 全看）" % (len(payload["business"]) - cap))
    if payload["mechanical"]:
        out.append("  机制性：")
        bullets(payload["mechanical"], out, cap, "      · ")
    else:
        out.append("  机制性：六项都查过了，没有发现问题。")

    out.append("")
    out.append("── 下一步 ──")
    # An intake gate is an H step, so the three columns overlap unless they are
    # made exclusive. Listing "提供访谈纪要" under both 你 and 客户 makes the split
    # useless: the point of the column is who to chase.
    intake = [w for w in payload["waiting"] if w["kind"] == "intake"]
    waiting_on_client = {w["step"] for w in intake}
    mine = [a for a in payload["actionable"] if a["klass"] in ("M", "A", "C")]
    yours = [a for a in payload["actionable"]
             if a["klass"] == "H" and a["step"] not in waiting_on_client]
    out.append("  系统能自己做的 %d 步 · 要你做的 %d 步 · 等客户交东西的 %d 项"
               % (len(mine), len(yours), len(intake)))
    if mine:
        bullets(["%s —— %s" % (a["step"], a["name"]) for a in mine], out, cap, "  系统 · ")
    if yours:
        bullets(["%s —— %s" % (a["step"], a["name"]) for a in yours], out, cap, "  你 · ")
    if intake:
        bullets(["%s —— %s" % (w["step"], w["name"]) for w in intake], out, cap, "  客户 · ")
    if not payload["actionable"]:
        out.append("  没有可做的步骤了 —— 全部完成，或者都卡在依赖上。")
    return out


# ── entry point ──────────────────────────────────────────────────────

def main(argv):
    parser = argparse.ArgumentParser(
        prog="daily_report.py",
        description="一个项目今天的日报：变化、待办、口径、产物、风险")
    parser.add_argument("dir", nargs="?", default=None, help="工作区目录，默认当前目录")
    parser.add_argument("--date", default="", help="报哪一天，默认今天（YYYY-MM-DD）")
    parser.add_argument("--full", action="store_true", help="每段全展开，不折叠")
    parser.add_argument("--no-snapshot", action="store_true",
                        help="不写今天的快照（明天就没有对照，只在试跑时用）")
    parser.add_argument("--json", action="store_true", help="输出原始 payload 而不是摘要")
    args = parser.parse_args(argv)

    gate_check.hand_over_to_engine_interpreter()   # S2 的新鲜度判据要引擎才跑得动
    root = eng.find_engagement(args.dir)
    today = datetime.date.fromisoformat(args.date) if args.date else datetime.date.today()

    payload = collect(root, today)
    _day, before = previous_snapshot(root, today)
    delta = compare(payload, before)

    if not args.no_snapshot:
        write_snapshot(root, payload)

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    print("\n".join(render(payload, delta, 10 ** 6 if args.full else CAP)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
