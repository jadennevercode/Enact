#!/usr/bin/env python3
"""Cross-check what the records claim against what is actually on disk.

Every other script in this suite checks one work item against one rule. This one
answers a different question: does the bookkeeping still describe reality? A
status that says Verifying while no test plan exists, a gate that passed while
the work item never moved, a pointer aimed at finished work -- each is invisible
from inside the phase that caused it, and each quietly misleads whoever reads
the records next.

It reports; it does not repair. An inconsistency is evidence about how the work
actually went, and silently fixing it destroys that evidence.

Usage:
    python3 sdlc_audit.py [--root .] [--work-item WI-001]
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _common import (  # noqa: E402
    ROLES,
    emit,
    load_yaml,
    missing_approver_roles,
    path_matches,
    phase_reviewers,
    sdlc_root,
    unknown_roles,
)

# What must exist on disk once a work item claims to have reached a status.
# Reaching a status means the previous phase produced its exit artifact.
#
# Each entry is (relative path, severity). high = the phase cannot have finished
# without it. medium = the phase's own Done When asks for it, and its absence
# means a reviewer has nothing convenient to look at -- worth reporting, but it
# does not by itself prove the work is wrong.
#
# The review/*.html entries are here on purpose. They are generated, so they are
# the cheapest artifact in the suite to produce and the first one to get skipped
# when a phase is in a hurry; skipping them is invisible from anywhere else.
# Declared per status: what *that* phase newly put on disk. The cumulative
# requirement is computed below -- a later status owes everything an earlier one
# owed, plus its own. Hand-maintaining a full list per status is how Completed
# ended up not requiring exploration.md at all while three documents claimed it did.
#
# severity: high = the phase cannot have finished without it. medium = the phase's
# own Done When asks for it and a reviewer has nothing convenient to look at
# without it, but its absence does not by itself prove the work is wrong.
#
# The review/*.html entries are here on purpose. They are generated, so they are
# the cheapest artifact in the suite to produce and the first one skipped when a
# phase is in a hurry; skipping them is invisible from anywhere else.
PHASE_ORDER = ["Exploring", "Contracted", "Planned", "Executing",
               "Verifying", "Decision", "Completed"]

STATUS_ADDS = {
    "Exploring": [],
    "Contracted": [("exploration.md", "high"), ("contract.yaml", "high"),
                   ("gates/contract-approval.yml", "high"),
                   ("review/exploration.html", "medium"), ("review/contract.html", "medium")],
    "Planned": [("change-scope.yaml", "high")],
    "Executing": [],
    "Verifying": [("ledger.md", "high"), ("build-evidence.md", "high")],
    "Decision": [("test-plan.yaml", "high"), ("qa-report.md", "high"),
                 ("review/qa.html", "medium")],
    "Completed": [("evidence-case.md", "high"), ("gates/release.yml", "high"),
                  ("review/release.html", "medium")],
}


def _cumulative():
    out, seen, acc = {}, set(), []
    for status in PHASE_ORDER:
        for item in STATUS_ADDS[status]:
            if item[0] not in seen:
                seen.add(item[0])
                acc.append(item)
        out[status] = list(acc)
    return out


STATUS_REQUIRES = _cumulative()

# Statuses that a passed gate is always compatible with. Held and Cancelled are
# orthogonal to phase progress -- work can be paused or dropped at any point
# without invalidating a decision someone already made.
GATE_ALWAYS_OK = {"Held", "Cancelled"}

# A gate that passed implies the work item moved past a certain point.
GATE_IMPLIES = {
    "contract-approval": ["Contracted", "Planned", "Executing", "Verifying", "Decision", "Completed"],
    "build-review": ["Verifying", "Decision", "Completed"],
    "release": ["Completed"],
}

TERMINAL = {"Completed", "Cancelled"}

STATUS_ORDER_INDEX = {s: i for i, s in enumerate(PHASE_ORDER)}

# Statuses by which build-review must already have happened.
BUILD_REVIEW_DUE = {"Verifying", "Decision", "Completed"}


def build_review_required(wi, cfg):
    """Whether this work item owes a signed build-review gate.

    full lane always owes one. quick lane owes one unless the project said
    otherwise *and* put a name on saying so -- an unsigned opt-out is how a
    human review quietly stops happening.
    """
    if str(wi.get("lane", "full")).strip() != "quick":
        return True
    gates = cfg.get("gates")
    gates = gates if isinstance(gates, dict) else {}
    conf = gates.get("build_review")
    conf = conf if isinstance(conf, dict) else {}
    if str(conf.get("quick_lane", "required")).strip() != "self-check":
        return True
    return not str(conf.get("self_check_decided_by") or "").strip()


def finding(wi, kind, problem, fix, severity="high"):
    return {"work_item": wi, "kind": kind, "severity": severity, "problem": problem, "fix": fix}


def audit_work_item(wi_dir, cfg):
    out = []
    wid = wi_dir.name.split("-")[0] + "-" + wi_dir.name.split("-")[1] if "-" in wi_dir.name else wi_dir.name
    wi = load_yaml(wi_dir / "work-item.yaml", required=False)
    if wi is None:
        return [finding(wi_dir.name, "missing-record", "目录存在但没有 work-item.yaml",
                        "这个目录不是一个 Work Item。补建记录，或把它移出 work-items/")]
    if not isinstance(wi, dict):
        return [finding(wi_dir.name, "malformed-record",
                        f"work-item.yaml 解析出来是 {type(wi).__name__}，不是字段表",
                        "文件被写坏了。对照 templates/work-item.yaml 重建")]
    wid = wi.get("id") or wi_dir.name
    status = str(wi.get("status", "")).strip()

    if status not in {*STATUS_REQUIRES, "Proposed", "Held", "Cancelled"}:
        out.append(finding(wid, "bad-status", f"status='{status}' 不在状态机词表中",
                           "见 ../references/state-machine.md 的十个合法状态"))

    # 1. Status claims a phase finished; its exit artifact must be there.
    for name, sev in STATUS_REQUIRES.get(status, []):
        if not (wi_dir / name).exists():
            fix = (f"要么状态提前置位了（退回上一个状态），要么 {name} 没写。"
                   "两种都要有人处理，不要靠下一个环节撞上它")
            if name.startswith("review/"):
                fix = (f"跑一次 render_review.py 生成 {name}。"
                       "它是给人看的那一层——没有它，评审的人只能去读 YAML")
            out.append(finding(
                wid, "status-artifact-mismatch",
                f"status={status} 意味着前面的环节已出口，但 {name} 不存在", fix, sev,
            ))

    # 1b. build-review is the only gate a phase can owe without any other trace.
    if status in BUILD_REVIEW_DUE and build_review_required(wi, cfg):
        if not (wi_dir / "gates" / "build-review.yml").exists():
            out.append(finding(
                wid, "missing-build-review",
                f"status={status}，但没有 gates/build-review.yml——实现没有经过人看过就进了 QA",
                "补一次 build-review（见 ../references/gates.md）；quick lane 确实不需要的话，"
                "在 config.yaml 的 gates.build_review 里具名声明",
            ))

    # 1c. An empty evidence.jsonl past the first phase means nothing was recorded.
    ev = wi_dir / "evidence.jsonl"
    if status in STATUS_REQUIRES and status != "Exploring":
        if not ev.exists() or not ev.read_text(encoding="utf-8").strip():
            out.append(finding(
                wid, "empty-evidence",
                f"status={status}，但 evidence.jsonl 是空的——没有任何环节记下自己做过什么",
                "证据流是审计时唯一能重建过程的东西。补记来不及了的话，至少从现在开始记",
            ))

    out.extend(audit_phase_reviews(wi_dir, wi, cfg))

    # 2. A passed gate implies the state machine moved.
    gates_dir = wi_dir / "gates"
    if gates_dir.is_dir():
        for g in sorted(gates_dir.glob("*.yml")):
            data = load_yaml(g, required=False) or {}
            if str(data.get("gate")) not in {"PASS", "CONCERNS"}:
                continue
            expected = GATE_IMPLIES.get(g.stem)
            if expected and status not in expected and status not in GATE_ALWAYS_OK:
                out.append(finding(
                    wid, "gate-status-mismatch",
                    f"{g.name} 已通过，但 status 还停在 {status}",
                    f"通过这个 Gate 之后状态应进入 {' / '.join(expected)} 之一。"
                    "Gate 记录是别人判断工作到哪了的依据，状态没跟上就等于这次批准没生效",
                ))

    # 3. Held must carry the three fields that make it actionable.
    if status == "Held":
        b = wi.get("blocked_by")
        if not isinstance(b, dict) or any(not str(b.get(k, "")).strip() for k in ("what", "who", "since")):
            out.append(finding(
                wid, "incomplete-hold",
                "status=Held 但 blocked_by 的 what/who/since 没填全",
                "缺任何一项的 Held 等于'卡住了但没人知道该干什么'，工作会就此消失",
            ))

    # 4. Owner is the first link of the accountability chain.
    if not str(wi.get("owner", "") or "").strip() and status != "Proposed":
        out.append(finding(wid, "no-owner", f"status={status} 但没有 owner",
                           "没有 owner 的工作最终没有人验收"))

    # 5. Unresolved amendments block nothing today but change everything downstream.
    amd_dir = wi_dir / "amendments"
    if amd_dir.is_dir() and status in TERMINAL:
        for a in sorted(amd_dir.glob("AMD-*.md")):
            text = a.read_text(encoding="utf-8")
            decided = any(
                line.strip().startswith("- 决定：")
                and line.split("：", 1)[1].strip() not in {"", "accepted / rejected / deferred"}
                for line in text.splitlines()
            )
            if not decided:
                out.append(finding(
                    wid, "closed-with-open-amendment",
                    f"WI 已进入 {status}，但 {a.name} 还没有处置结论",
                    "被搁置的 Amendment 会在下一个类似需求出现时重新被发现一遍。现在补一个结论，"
                    "哪怕结论是 rejected", "medium",
                ))
    return out



# Phases whose exit has no gate. Their review leaves an evidence event instead of
# a signed file, and the status by which that event must exist.
# operate is absent because an incident is its own object: its review belongs to
# the INC record, not to a work item's status. Saying so here beats leaving a
# reader to wonder whether the fourth ungated phase was forgotten.
UNGATED_PHASE_DUE = {
    "intake": "Exploring",
    "explore": "Contracted",
    "qa": "Decision",
}


def audit_phase_reviews(wi_dir, wi, cfg):
    """Phases that finished without anyone reviewing them.

    The four ungated phases are the ones where, before this check, the agent's own
    self-check was the only thing standing between its output and the next phase.
    Reported at medium rather than high on purpose: a missing review means nobody
    looked, which is worth knowing, but it does not break the authorization chain
    the way a missing gate does.
    """
    status = str(wi.get("status", "")).strip()
    if status not in STATUS_ORDER_INDEX:
        return []

    actions = set()
    notes = []
    ev = wi_dir / "evidence.jsonl"
    if ev.exists():
        for line in ev.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("action") == "phase_reviewed":
                actions.add(str(rec.get("notes", "")))
                notes.append(str(rec.get("notes", "")))

    out = []
    for phase, due_status in UNGATED_PHASE_DUE.items():
        if STATUS_ORDER_INDEX[status] < STATUS_ORDER_INDEX[due_status]:
            continue
        roles = phase_reviewers(cfg, phase)
        if not roles:
            continue
        # Match on the phase name, not the role: several phases share a reviewer,
        # and matching by role alone would let one review stand in for all of them.
        if any(n.strip().lstrip("`").startswith(phase) for n in notes):
            continue
        out.append(finding(
            wi.get("id") or wi_dir.name, "phase-not-reviewed",
            f"已过 {phase} 阶段，但 evidence 里没有它的 phase_reviewed——"
            f"这个阶段的产出没有人看过（该看的是 {' / '.join(roles)}）",
            f"补一次评审并追加 phase_reviewed，notes 以 `{phase}` 开头；"
            "确实不需要人评审就在 config 的 "
            f"phase_review.{phase} 里改窄，让这个决定有据可查", "medium"))
    return out


def audit_scope_overlap(active):
    """Two live work items writing to the same paths will silently fight."""
    out = []
    for i in range(len(active)):
        for j in range(i + 1, len(active)):
            a, b = active[i], active[j]
            hits = [p for p in a["write"] if any(path_matches_pattern(p, q) for q in b["write"])]
            if hits:
                out.append(finding(
                    f"{a['id']} × {b['id']}", "write-scope-overlap",
                    f"两个活跃 WI 的可写范围重叠：{', '.join(sorted(set(hits))[:4])}",
                    "先后做，或合并成一个 WI。同时改同一批文件时，两边的 check_scope 都会看到对方的改动，"
                    "越界检查因此失去意义", "medium",
                ))
    return out


def path_matches_pattern(a, b):
    """Rough overlap test between two globs -- exact match or one covering the other."""
    if a == b:
        return True
    return bool(path_matches(a.replace("*", "x"), [b]) or path_matches(b.replace("*", "x"), [a]))


def audit_intelligence_sync(dirs, cfg):
    """Completed work that never reached the Intelligence Space.

    Syncing is the one step with no artifact of its own inside .sdlc/, so nothing
    else would notice it silently never happening. The evidence event is the only
    trace, which is exactly why it is worth auditing: a space that quietly stops
    being updated still looks authoritative to everyone reading it.
    """
    conf = cfg.get("intelligence_space") or {}
    if not conf.get("enabled"):
        return []

    out = []
    if not str(conf.get("repo_path") or "").strip() or not str(conf.get("space") or "").strip():
        out.append(finding("config.yaml", "sync-misconfigured",
                           "intelligence_space.enabled 为 true，但 repo_path 或 space 是空的",
                           "补齐两个字段，或把 enabled 改回 false。开着却填不全，同步每次都会停在第一道门"))
        return out

    if "wi-completed" not in (conf.get("sync_on") or []):
        return out

    for d in dirs:
        wi = load_yaml(d / "work-item.yaml", required=False) or {}
        if str(wi.get("status")) != "Completed":
            continue
        synced = False
        ev = d / "evidence.jsonl"
        if ev.exists():
            for line in ev.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    if json.loads(line).get("action") == "intelligence_synced":
                        synced = True
                        break
                except json.JSONDecodeError:
                    continue
        if not synced:
            out.append(finding(wi.get("id") or d.name, "not-synced",
                               f"已 Completed，但 evidence 里没有 intelligence_synced——"
                               f"'{conf['space']}' 空间可能还不知道这次交付",
                               "走 sdlc-learn 的同步一节提 proposal；确实不该同步就在 config 里收窄 sync_on",
                               "medium"))
    return out


def main():
    parser = argparse.ArgumentParser(description="Consistency audit of .sdlc/ records vs disk")
    parser.add_argument("--root", default=".")
    parser.add_argument("--work-item", default=None)
    args = parser.parse_args()

    sdlc = sdlc_root(args.root)
    items_dir = sdlc / "work-items"
    dirs = sorted(d for d in items_dir.iterdir() if d.is_dir()) if items_dir.is_dir() else []
    if args.work_item:
        needle = args.work_item.lower()
        dirs = [d for d in dirs if d.name.lower().startswith(needle)]

    cfg = load_yaml(sdlc / "config.yaml", required=False) or {}

    findings = []
    active = []
    for d in dirs:
        findings.extend(audit_work_item(d, cfg))
        wi = load_yaml(d / "work-item.yaml", required=False)
        wi = wi if isinstance(wi, dict) else {}
        if str(wi.get("status")) not in TERMINAL:
            scope = load_yaml(d / "change-scope.yaml", required=False)
            scope = scope if isinstance(scope, dict) else {}
            if scope.get("write"):
                active.append({"id": wi.get("id") or d.name, "write": scope["write"]})
    findings.extend(audit_scope_overlap(active))

    # 6. The current pointer should aim at work that is still open.
    if not args.work_item:
        current = load_yaml(sdlc / "current.yaml", required=False) or {}
        name = current.get("work_item")
        if name:
            match = [d for d in dirs if d.name == name or d.name.startswith(str(name) + "-")]
            if not match:
                findings.append(finding("current.yaml", "dangling-pointer",
                                        f"current.yaml 指向 '{name}'，但这个目录不存在",
                                        "指向一个真实的 Work Item，或置为 null"))
            else:
                wi = load_yaml(match[0] / "work-item.yaml", required=False) or {}
                if str(wi.get("status")) in TERMINAL:
                    findings.append(finding("current.yaml", "stale-pointer",
                                            f"current.yaml 还指着已{wi.get('status')}的 {name}",
                                            "切到下一个活跃 WI，否则不带 --work-item 的脚本都会作用到已完成的工作上",
                                            "medium"))

        # 7. Approvers are what makes the five human gates possible at all.
        empty = missing_approver_roles(cfg)
        if empty:
            findings.append(finding("config.yaml", "unstaffed-role",
                                    f"这几个角色还没有人：{', '.join(empty)}",
                                    "有 Gate 要求这些角色签署，现在签不下去。"
                                    "一个人可以担多个角色——如实写进多个角色即可，此刻补比 Release 前夜补便宜得多"))

        # 7b. A role nobody defined is a role no gate can require.
        for r in unknown_roles(cfg):
            findings.append(finding("config.yaml", "unknown-role",
                                    f"config.yaml 里的角色「{r}」不在受控词表中",
                                    f"只能是 {' / '.join(ROLES)}。"
                                    "词表固定是为了让 Gate 的角色要求可以机械核对；"
                                    "确实需要新角色就改 sdlc-core 的 ROLES，不要就地发明",
                                    "medium"))

    # 8. Delivery that finished but never reached the Intelligence Space.
    findings.extend(audit_intelligence_sync(dirs, cfg))

    high = [f for f in findings if f["severity"] == "high"]
    emit({
        "ok": not high,
        "work_items_audited": len(dirs),
        "findings": findings,
        "high": len(high),
        "medium": len(findings) - len(high),
        "note": "本脚本只报告，不修复。不一致本身是关于工作实际怎么走的证据，静默修掉就把证据也修掉了。",
    })


if __name__ == "__main__":
    main()
