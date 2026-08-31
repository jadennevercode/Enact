#!/usr/bin/env python3
"""Mechanical updates to the progress record and the decision log.

    state.py init    <dir> --project P --brand B --industry l1/l2/l3 [--language en]
    state.py list    [--scan DIR]        every workspace this machine knows of
    state.py show    <dir>               where each deliverable stands
    state.py close   <dir> <deliverable/step> [--produced a,b]
    state.py decide  <dir> <deliverable/step> <verdict> [--evidence PATH] [--note TEXT]
                     verdict: approve | signoff | accept  (these close a gate)
                              rework | reject | reopen    (recorded, closes nothing)
    state.py reopen  <dir> <deliverable/step> [--note TEXT]
    state.py problems <dir>              everything worth flagging, computed
    state.py promote <dir>               what this project could teach the library
    state.py record-change <dir> --what add|remove|merge|redefine
                     --target factor|indicator|definition|enum|range
                     --subject TEXT --why TEXT --source SOURCE --who NAME
                     [--where PATH] [--evidence PATH] [--gate STEP]
    state.py record-feedback <dir> --skill NAME --kind correction|habit|missing|wording
                     --quote TEXT --expected TEXT [--step STEP] [--where PATH] [--note TEXT]

`close` runs the step's checks first and refuses when they fail — a step cannot
be completed by assertion.

This script belongs to the orchestration layer. A skill that produces a
deliverable hands it over for verification; it does not close its own steps.
See docs/specs/2026-08-08-architecture-and-methodology.md §3.
"""
from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "shared", "lib"))
sys.path.insert(0, HERE)

import changes as ledger  # noqa: E402
import engagement as eng  # noqa: E402
import feedback  # noqa: E402
import gate_check  # noqa: E402
import yamlio  # noqa: E402

INTAKE_DIRS = ["project-background", "industry-reference", "interview-minutes", "client-factor-tree"]


def cmd_init(args):
    """Create a v2 workspace. `shared/workspace-layout.md` is the tree it builds.

    Identity (`mmm.yaml`) and progress (`state/progress.yaml`) are separate files:
    who the project is does not change, where it has got to changes constantly, and
    one file meant every task completion rewrote the industry anchor.
    """
    root = os.path.abspath(args.dir)
    identity_path = os.path.join(root, "mmm.yaml")
    if os.path.isfile(identity_path) or os.path.isfile(os.path.join(root, "mmm-state.yaml")):
        print("workspace already exists: %s" % root)
        return 1
    levels = (args.industry or "").split("/")
    while len(levels) < 3:
        levels.append("")

    for folder in INTAKE_DIRS + ["data"]:
        os.makedirs(os.path.join(root, "inputs", folder), exist_ok=True)
    for folder in ("state", "metadata/schema/enums", "data/raw", "data/clean",
                   "data/published", "data/derived", "artifacts/s2", "artifacts/s3",
                   "exports"):
        os.makedirs(os.path.join(root, *folder.split("/")), exist_ok=True)
    os.makedirs(os.path.join(root, "artifacts", "s1", "interview"), exist_ok=True)
    os.makedirs(os.path.join(root, "artifacts", "s1", "data-request"), exist_ok=True)

    industry = {"l1": levels[0], "l2": levels[1], "l3": levels[2]}
    with open(identity_path, "w", encoding="utf-8") as handle:
        handle.write(yamlio.dump({
            "project": args.project,
            "brand": args.brand,
            "industry": industry,
            "outputLanguage": args.language,
            "workspaceVersion": 3,
            "createdAt": eng.now_iso(),
        }))
    with open(os.path.join(root, "state", "progress.yaml"), "w", encoding="utf-8") as handle:
        handle.write(yamlio.dump({"steps": {}}))
    open(os.path.join(root, "state", "decisions.log"), "a", encoding="utf-8").close()

    # Seed the target schema and enum starters now, so the Data Engine has a
    # contract to check against before any data arrives. That ordering is the
    # whole design — a schema declared after seeing the data proves nothing.
    try:
        import new_workspace
        new_workspace.seed_schema(root, industry["l1"], industry["l2"], industry["l3"])
    except Exception as error:  # noqa: BLE001 — S1 does not need it; say so and go on
        print("  note: schema not seeded (%s) — run scripts/new_workspace.py before S2"
              % error)

    remember(root)
    print("workspace created: %s" % root)
    print("  `~/.local/bin/mmm script state list` will show it from anywhere; `cd` into it to work on it." )
    return 0


#: Where the paths of created workspaces are remembered. An INDEX, not a registry:
#: every entry is verified against disk on read, and a path that has gone is
#: reported as gone rather than quietly dropped. Same rule as the state file —
#: the files are the truth, this only helps you find them.
def known_log():
    """Where remembered workspace paths live.

    Resolved at CALL time, not import time: `selftest` imports this module and
    only then points the path at its own temp dir, so a module-level constant is
    computed too early and every test run leaves a row of GONE entries in the list
    a human uses to find their actual clients.
    """
    return os.path.expanduser(
        os.environ.get("MMM_WORKSPACES_LOG") or "~/.mmm/workspaces.log")


def remember(root):
    """Append a workspace path. Append-only, deduped on read, never rewritten."""
    try:
        path = known_log()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as handle:
            handle.write("%s\t%s\n" % (eng.now_iso(), os.path.abspath(root)))
    except OSError:
        pass          # not being able to remember is not a reason to fail an init


def known_paths():
    """Every remembered path, newest first, deduped. Missing file → []."""
    path = known_log()
    if not os.path.isfile(path):
        return []
    seen, out = set(), []
    for line in reversed(eng.read_text(path).splitlines()):
        parts = line.strip().split("\t")
        if len(parts) != 2:
            continue
        path = parts[1]
        if path in seen:
            continue
        seen.add(path)
        out.append((parts[0], path))
    return out


def cmd_list(args):
    """Every workspace this machine has created, with where each one stands.

    There is no registry: one engagement is one directory and nothing indexes
    them, so two projects cannot interfere. This reads a remembered list of paths
    and checks each against disk — a workspace moved or deleted outside the suite
    shows as gone, because the directory is the truth and this is only an index
    into it. A workspace someone else created, or one made before this existed,
    simply is not listed; `cd` into it and it works exactly the same.
    """
    entries = known_paths()
    if args.scan:
        for base in args.scan:
            for current, dirs, files in os.walk(os.path.expanduser(base)):
                dirs[:] = [d for d in dirs if not d.startswith(".")]
                if "mmm.yaml" in files or "mmm-state.yaml" in files:
                    entries.append(("", current))
                    dirs[:] = []          # a workspace never contains another
    seen, rows = set(), []
    for _at, path in entries:
        if path in seen:
            continue
        seen.add(path)
        rows.append(path)

    if not rows:
        print("no workspace recorded on this machine.")
        print("`~/.local/bin/mmm script state init <dir> --project P --brand B --industry l1/l2/l3` makes one," )
        print("or `~/.local/bin/mmm script state list --scan ~/mmm-engagements` finds ones made elsewhere." )
        return 0

    print("%-52s %-10s %s" % ("工作区", "阶段", "进度"))
    missing = 0
    for path in rows:
        if not os.path.isfile(os.path.join(path, "mmm.yaml")) and \
           not os.path.isfile(os.path.join(path, "mmm-state.yaml")):
            print("%-52s %s" % (_short(path), "GONE — moved or deleted"))
            missing += 1
            continue
        try:
            identity = eng.read_yaml(os.path.join(path, "mmm.yaml")) or {}
            state = eng.State(path)
            items = eng.deliverables()
            confirmed = sum(1 for d in items
                            if state.deliverable_state(d["id"]) == "confirmed")
            waiting = state.waiting_on_you()
            print("%-52s %-10s %d/%d 已确认%s"
                  % (_short(path), _stage_of(state, items), confirmed, len(items),
                     "  等你：%s" % waiting[0][0] if waiting else "  — 无待办"))
            name = identity.get("project")
            if name:
                print("%-52s %s" % ("", name))
        except Exception as error:  # noqa: BLE001 — one bad workspace must not hide the rest
            print("%-52s unreadable: %s" % (_short(path), error))
    if missing:
        print("\n%d recorded path(s) no longer exist. Nothing was deleted from the log —"
              % missing)
        print("a workspace you moved is still fine; `cd` into it and it works.")
    return 0


def _short(path):
    home = os.path.expanduser("~")
    return ("~" + path[len(home):]) if path.startswith(home) else path


def _stage_of(state, items):
    """The stage still being worked — the first one holding an unconfirmed deliverable."""
    for deliverable in items:
        if state.deliverable_state(deliverable["id"]) != "confirmed":
            return deliverable.get("stage", "")
    return "完成"


#: What each derived state is called when a human reads it. The internal words are
#: engineering vocabulary (see the architecture doc §6); these are the ones that go
#: on screen.
STATE_LABEL = {
    "locked": "未开始",
    "queued": "可开工",
    "building": "进行中",
    "needs-you": "等你决定",
    "ready": "待确认",
    "confirmed": "已确认",
}


def cmd_show(args):
    """Where every deliverable stands, grouped by stage.

    Deliverables first and steps underneath, because that is the shape of the work:
    a consultant asks "is the factor tree done", never "is task 1.21d done".
    """
    root = eng.find_engagement(args.dir)
    state = eng.State(root)
    identity = eng.read_yaml(os.path.join(root, "mmm.yaml")) or {}
    print("%s · %s · %s" % (identity.get("project", "?"), identity.get("brand", "?"),
                            "/".join(filter(None, (identity.get("industry") or {}).values()))))

    stages = {s["id"]: s.get("name", s["id"]) for s in eng.manifest().get("stages", [])}
    current_stage = None
    for deliverable in eng.deliverables():
        if deliverable.get("stage") != current_stage:
            current_stage = deliverable.get("stage")
            print("\n── %s ──" % stages.get(current_stage, current_stage))
        derived = state.deliverable_state(deliverable["id"])
        print("\n%-22s %s" % (deliverable.get("name", deliverable["id"]),
                              STATE_LABEL.get(derived, derived)))
        for step in eng.deliverable_steps(deliverable["id"]):
            done = state.is_done(step["id"])
            blocking = state.blocking(step["id"])
            mark = "[x]" if done else ("[-]" if blocking else "[ ]")
            note = ""
            if not done and not blocking and step.get("klass") == "H":
                note = "  ← 需要你"
            elif blocking and not done:
                note = "  等 %s" % ", ".join(blocking)
            print("  %s %-34s %s%s" % (mark, step["id"].split("/", 1)[1],
                                       step.get("name", ""), note))

    waiting = state.waiting_on_you()
    print("")
    if waiting:
        deliverable, step = waiting[0]
        print("下一步：%s —— %s" % (eng.deliverable_def(deliverable).get("name", deliverable),
                                     step.get("name", "")))
        if len(waiting) > 1:
            print("另有 %d 项也在等你" % (len(waiting) - 1))
    else:
        nxt = state.actionable()
        print("下一步：%s" % (nxt[0] if nxt else "全部完成"))
    return 0


def cmd_close(args):
    """Verify a build step and record it complete. The only way a step completes."""
    root = eng.find_engagement(args.dir)
    step, results = gate_check.check_step(root, args.step)
    failures = [result for result in results if result.blocks]
    if failures:
        print("不能完成 %s —— %d 项检查未通过：" % (args.step, len(failures)))
        for result in failures:
            print("    未通过  %s" % result.title)
            print("            %s" % result.detail)
        return 1
    # Advisories never block, but closing a step while one is open, without it
    # having been said out loud, is exactly how a scope overrun reaches the
    # client's desk unannounced.
    for result in results:
        if not result.ok:
            print("提示  %s：%s" % (result.title, result.detail))
    state = eng.State(root)
    blocking = state.blocking(args.step)
    if blocking:
        print("不能完成：%s 依赖 %s，后者尚未完成" % (args.step, ", ".join(blocking)))
        return 1
    produced = [p.strip() for p in (args.produced or "").split(",") if p.strip()]
    fields = {"status": "done"}
    if produced:
        fields["produced"] = produced
    gate = step.get("gate") or {}
    if gate:
        entries = [d for d in eng.decisions(root) if d["gate"] == gate.get("id")]
        if gate.get("kind") in ("approval", "signoff") and not eng.gate_signed_off(root, gate["id"]):
            print("不能完成：%s 这道确认还没有生效判定，决策日志里查无此项" % gate.get("id"))
            return 1
        if entries:
            latest = entries[-1]
            fields["gate"] = {"verdict": latest["verdict"], "at": latest["at"]}
    state.set_step(args.step, **fields)
    state.save()

    owner = step["deliverable"]
    derived = state.deliverable_state(owner)
    print("%s 已完成 —— %s 现在是「%s」"
          % (args.step, eng.deliverable_def(owner).get("name", owner),
             STATE_LABEL.get(derived, derived)))
    waiting = state.waiting_on_you()
    if waiting:
        deliverable, nxt = waiting[0]
        print("下一步：%s —— %s"
              % (eng.deliverable_def(deliverable).get("name", deliverable), nxt.get("name", "")))
    else:
        remaining = state.actionable()
        print("下一步：%s" % (remaining[0] if remaining else "全部完成"))
    return 0


def cmd_decide(args):
    root = eng.find_engagement(args.dir)
    step, gate = eng.gate_def(args.gate)
    if step is None:
        print("流程里没有 %s 这道确认。日志只能追加不能删改，所以这里拒写而不是写进去。\n"
              "现有的确认点：\n  %s"
              % (args.gate, "\n  ".join(g["id"] for _s, g in eng.gates())))
        return 1
    if args.verdict not in eng.VERDICTS:
        print("判定 %r 不在允许的取值内：%s" % (args.verdict, "、".join(eng.VERDICTS)))
        print("只有 %s 能关闭一道确认；其余的只记录决定，不关闭任何东西。"
              % "、".join(eng.STANDING_VERDICTS))
        return 1
    evidence = args.evidence or gate.get("evidence", "")
    digest = _evidence_hash(root, evidence)
    line = eng.append_decision(root, args.gate, args.verdict, args.who, evidence,
                               args.note or "", digest)
    print(line)

    # A rejection has to send the work somewhere, or it is just a note. The gate
    # names where — usually the step that produced the evidence, sometimes another
    # deliverable entirely (an OLS result that defies business sense is a symptom;
    # the reading of the data is the cause, so it goes back to business validation).
    if args.verdict in ("rework", "reject"):
        target = gate.get("rework")
        if not target:
            print("这道确认没有写明退回到哪一步，只记录了判定。"
                  "流程定义里给它补一个 rework 目标。")
            return 0
        state = eng.State(root)
        reset = [s for s in downstream(target) if state.is_done(s)]
        for step_id in reset:
            state.set_step(step_id, status="pending")
        state.save()
        print("退回 %s%s" % (target, "，一并退回：%s" % "、".join(
            s for s in reset if s != target) if len(reset) > 1 else ""))
        print("原因已记录，重做时会带着它。")
    return 0


def _evidence_hash(root, evidence):
    """A YAML artifact's payload hash, so an audit can see edits made afterwards."""
    path = os.path.join(root, evidence or "")
    if evidence.endswith((".yaml", ".yml")) and os.path.isfile(path):
        return gate_check.source_hash(path)
    return ""


def cmd_reopen(args):
    root = eng.find_engagement(args.dir)
    state = eng.State(root)
    step, _gate = eng.gate_def(args.gate)
    if step is None:
        print("流程里没有 %s 这道确认" % args.gate)
        return 1
    eng.append_decision(root, args.gate, "reopen", args.who, "", args.note or "")
    reset = downstream(step["id"])
    for step_id in reset:
        state.set_step(step_id, status="pending")
    state.save()
    print("已撤回 %s · 退回未完成：%s" % (args.gate, "、".join(reset)))
    return 0


def downstream(step_id):
    """The step itself and everything that transitively depends on it."""
    all_steps = eng.steps()
    affected = {step_id}
    changed = True
    while changed:
        changed = False
        for step in all_steps:
            if step["id"] in affected:
                continue
            if affected.intersection(step.get("depends_on", []) or []):
                affected.add(step["id"])
                changed = True
    return [step["id"] for step in all_steps if step["id"] in affected]


def _wants_industry_prior(step):
    """True when this step is one an industry pack is supposed to inform.

    Narrow on purpose. `knowledgeRecall: none` is the CORRECT value on a project
    profile — the profile comes from the client's own contract, not from what the
    industry usually does — so flagging every artifact without a recall would bury
    the two cases that matter under a wall of false alarms.
    """
    paths = list(step.get("reads") or []) + list(step.get("produces") or [])
    return any("knowledge/industry" in p or "knowledge-package" in p for p in paths)


def problems(root):
    """The six mechanical findings, as a list of lines. One copy, two readers.

    `status` prints them and the daily report folds them into its risk section.
    Two copies of six checks drift, and the half that drifts is the half nobody
    is looking at — which is the failure this section exists to prevent.
    """
    state = eng.State(root)
    found = []

    # 1 · built on part of a document
    # 2 · no industry precedent behind it
    for step in eng.steps():
        for pattern in step.get("produces", []) or []:
            for path in eng.resolve(root, pattern):
                if not path.endswith((".md", ".yaml", ".yml")):
                    continue
                try:
                    meta = eng.artifact_meta(path)
                except Exception:                       # noqa: BLE001
                    continue
                rel = os.path.relpath(path, root)
                clipped = [str(g.get("path")) for g in (meta.get("grounding") or [])
                           if isinstance(g, dict) and g.get("truncated")]
                if clipped:
                    found.append("%s 只读了这些材料的一部分：%s" % (rel, "、".join(clipped[:2])))
                if meta.get("generatedFrom"):
                    continue           # a rendered view carries its source's meta
                if meta.get("knowledgeRecall") in (None, "", "none") and \
                        _wants_industry_prior(step):
                    found.append("%s 背后没有行业先例（召回为空）" % rel)

    # 3 · counts that should not be zero
    tree = os.path.join(root, "artifacts", "s1", "factor-tree.yaml")
    if os.path.isfile(tree) and state.is_done("factor-tree/confirm"):
        _meta, rows = eng.load_tree(root)
        if rows and not any(r.get("status") == "rejected" for r in rows):
            found.append("因子树 %d 行全部采纳、一行未剔除 —— 一次什么都没否掉的审查，"
                         "通常是没人真看" % len(rows))
    if state.is_done("interview/digest"):
        files = eng.resolve(root, "artifacts/s1/interview/proposals-*.yaml")
        total = sum(len((eng.read_yaml(f) or {}).get("proposals") or []) for f in files)
        if files and total == 0:
            found.append("访谈一条因子改动建议都没提出 —— 确认这是真结论，还是消化时漏了")

    # 4 · evidence edited after the verdict that approved it
    found.extend(gate_check.evidence_drift(root))

    # 5 · recorded complete while the checks now fail
    for step in eng.steps():
        if not state.is_done(step["id"]):
            continue
        _step, results = gate_check.check_step(root, step["id"])
        failures = [r for r in results if r.blocks]
        if failures:
            found.append("%s 记录为已完成，但 %d 项检查现在不过（%s）"
                         % (step["id"], len(failures), failures[0].title))

    # 6 · nothing to promote at the end
    if os.path.isfile(tree) and not ledger.read(root):
        found.append("变更账本是空的 —— 项目收尾时没有任何东西可以沉淀进知识库")

    return found


def cmd_problems(args):
    """The `status` problems section, computed rather than remembered.

    The orchestrator's own instructions say the silence in this section is the
    failure this mode exists to prevent — so leaving it to a model to remember
    six separate checks every time is leaving the failure in place. Each of the
    six is mechanical; this runs all of them and prints what it found.
    """
    found = problems(eng.find_engagement(args.dir))
    if not found:
        print("六项都查过了，没有发现问题。")
        return 0
    print("发现 %d 个问题：" % len(found))
    for line in found:
        print("  · %s" % line)
    return 0


def cmd_promote(args):
    """Gather what this project could teach — the library, and the skills.

    Gathering only. Nothing here writes to `knowledge/` or to a skill — a
    candidate becomes a library entry, or an edit, when a person says so, and the
    `retrospect` skill is where that conversation happens. The rule the library
    enforces on itself is that a number needs two independent projects behind it
    before it stops being one case.
    """
    root = eng.find_engagement(args.dir)
    identity = eng.read_yaml(os.path.join(root, "mmm.yaml")) or {}
    industry = identity.get("industry") or {}
    anchor = "/".join(filter(None, (industry.get("l1"), industry.get("l2"))))

    entries = ledger.read(root)
    counts = ledger.summary(root)
    print("%s · 行业锚点 %s" % (identity.get("project", "?"), anchor or "（未设置）"))
    print("")

    if not entries:
        print("变更账本是空的，没有可沉淀的候选。")
        print("变更是在人拍板时用 `~/.local/bin/mmm script state record-change` 记下的 —— 没记，")
        print("这个项目学到的东西就只留在这个目录里。")
    else:
        print("账本共 %d 条：%s" % (
            counts["total"],
            "、".join("%s %d" % (k, v) for k, v in sorted(counts["byAction"].items()))))
        print("按来源：%s" % "、".join("%s %d" % (k, v)
                                       for k, v in sorted(counts["bySource"].items())))
        print("")
        # Client-specific definitions stay with the client. Everything else is a
        # candidate, and the person decides.
        for entry in entries:
            keep = "留在项目里" if entry.get("source") == "client" else "候选"
            print("  [%s] %s %s「%s」" % (keep, entry.get("what"), entry.get("target"),
                                          entry.get("subject")))
            print("        因为：%s" % entry.get("why"))
            print("        来源：%s · 拍板：%s · 确认点：%s"
                  % (entry.get("source"), entry.get("decidedBy"), entry.get("gate") or "—"))

    # Two places that hold experience nobody thought to write into the ledger.
    tree = os.path.join(root, "artifacts", "s1", "factor-tree.yaml")
    if os.path.isfile(tree):
        _meta, rows = eng.load_tree(root)
        rejected = [r for r in rows if r.get("status") == "rejected"]
        if rejected:
            print("\n因子树里剔除了 %d 行，剔除理由也是经验：" % len(rejected))
            for row in rejected[:8]:
                print("  · %s :: %s —— %s" % (row.get("l4", ""), row.get("indicator", ""),
                                              row.get("rationale") or "（没写理由）"))

    # The other half: what the user corrected about the way we work. These become
    # edits to the skills, not entries in the library.
    groups = feedback.by_skill(root)
    if not groups:
        print("\nSkill 反馈是空的。用户纠正做法或说出习惯时，用 `~/.local/bin/mmm script state record-feedback`")
        print("当场记一条——没记下来的纠正，下一个项目会原样再犯一次。")
    else:
        counts = feedback.summary(root)
        print("\nSkill 反馈共 %d 条：%s" % (
            counts["total"],
            "、".join("%s %d" % (k, v) for k, v in sorted(counts["byKind"].items()))))
        for skill in sorted(groups):
            entries = groups[skill]
            strength = "反复出现" if len(entries) > 1 else "单条"
            print("  [%s] %s —— %d 条" % (strength, skill, len(entries)))
            for entry in entries:
                print("        %s：「%s」" % (entry.get("kind"), entry.get("quote")))
                print("        期望：%s%s" % (
                    entry.get("expected"),
                    "（%s）" % entry.get("step") if entry.get("step") else ""))

    print("\n下一步：逐条问人「收进知识库 / 留在项目里 / 不要」，")
    print("Skill 反馈逐条问人「改 Skill / 不改」。")
    print("AI 只能提名，入库和改插件都要人拍板，入库时带上来源：哪个项目、哪次确认、什么时候。")
    return 0


def cmd_record_change(args):
    """Append one line to the change ledger. See shared/change-ledger.md."""
    root = eng.find_engagement(args.dir)
    try:
        entry = ledger.record(root, what=args.what, target=args.target,
                              subject=args.subject, why=args.why, source=args.source,
                              where=args.where, evidence=args.evidence,
                              decided_by=args.who, gate=args.gate)
    except ValueError as error:
        print("拒绝写入：%s" % error)
        return 1
    print("已记录：%s %s「%s」—— %s（%s）"
          % (entry["what"], entry["target"], entry["subject"],
             entry["why"], entry["decidedBy"]))
    counts = ledger.summary(root)
    print("账本共 %d 条" % counts["total"])
    return 0


def cmd_record_feedback(args):
    """Append one piece of feedback. See shared/skill-feedback.md."""
    root = eng.find_engagement(args.dir)
    try:
        entry = feedback.record(root, skill=args.skill, kind=args.kind, quote=args.quote,
                                expected=args.expected, step=args.step, where=args.where,
                                note=args.note)
    except ValueError as error:
        print("拒绝写入：%s" % error)
        return 1
    print("已记录：%s 的 %s ——「%s」→ %s"
          % (entry["skill"], entry["kind"], entry["quote"], entry["expected"]))
    counts = feedback.summary(root)
    print("反馈共 %d 条" % counts["total"])
    return 0


def main(argv):
    parser = argparse.ArgumentParser(prog="state.py", add_help=True)
    sub = parser.add_subparsers(dest="command")

    p_init = sub.add_parser("init")
    p_init.add_argument("dir")
    p_init.add_argument("--project", required=True)
    p_init.add_argument("--brand", required=True)
    p_init.add_argument("--industry", required=True, help="l1/l2/l3")
    p_init.add_argument("--language", default="en")
    p_init.set_defaults(func=cmd_init)

    p_list = sub.add_parser("list")
    p_list.add_argument("--scan", action="append",
                        help="also search this directory tree for workspaces")
    p_list.set_defaults(func=cmd_list)

    p_show = sub.add_parser("show")
    p_show.add_argument("dir", nargs="?", default=".")
    p_show.set_defaults(func=cmd_show)

    p_close = sub.add_parser("close")
    p_close.add_argument("dir")
    p_close.add_argument("step", help="<deliverable>/<step>")
    p_close.add_argument("--produced", default="")
    p_close.set_defaults(func=cmd_close)

    p_decide = sub.add_parser("decide")
    p_decide.add_argument("dir")
    p_decide.add_argument("gate", help="<deliverable>/<step>")
    p_decide.add_argument("verdict")
    p_decide.add_argument("--evidence", default="")
    p_decide.add_argument("--note", default="")
    p_decide.add_argument("--who", default="human")
    p_decide.set_defaults(func=cmd_decide)

    p_reopen = sub.add_parser("reopen")
    p_reopen.add_argument("dir")
    p_reopen.add_argument("gate", help="<deliverable>/<step>")
    p_reopen.add_argument("--note", default="")
    p_reopen.add_argument("--who", default="human")
    p_reopen.set_defaults(func=cmd_reopen)

    p_problems = sub.add_parser("problems")
    p_problems.add_argument("dir", nargs="?", default=".")
    p_problems.set_defaults(func=cmd_problems)

    p_promote = sub.add_parser("promote")
    p_promote.add_argument("dir", nargs="?", default=".")
    p_promote.set_defaults(func=cmd_promote)

    p_change = sub.add_parser("record-change")
    p_change.add_argument("dir")
    p_change.add_argument("--what", required=True, choices=list(ledger.ACTIONS))
    p_change.add_argument("--target", required=True, choices=list(ledger.TARGETS))
    p_change.add_argument("--subject", required=True)
    p_change.add_argument("--why", required=True)
    p_change.add_argument("--source", required=True, choices=list(ledger.SOURCES))
    p_change.add_argument("--who", required=True)
    p_change.add_argument("--where", default="")
    p_change.add_argument("--evidence", default="")
    p_change.add_argument("--gate", default="")
    p_change.set_defaults(func=cmd_record_change)

    p_feedback = sub.add_parser("record-feedback")
    p_feedback.add_argument("dir")
    p_feedback.add_argument("--skill", required=True)
    p_feedback.add_argument("--kind", required=True, choices=list(feedback.KINDS))
    p_feedback.add_argument("--quote", required=True)
    p_feedback.add_argument("--expected", required=True)
    p_feedback.add_argument("--step", default="", help="<deliverable>/<step>")
    p_feedback.add_argument("--where", default="")
    p_feedback.add_argument("--note", default="")
    p_feedback.set_defaults(func=cmd_record_feedback)

    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 2
    gate_check.hand_over_to_engine_interpreter()  # `close` re-runs the checks, S2 ones included
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
