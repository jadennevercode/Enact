#!/usr/bin/env python3
"""Summarise every Work Item: where it is, what blocks it, who owes a decision.

Answers the questions people actually ask -- "where are we", "what's stuck",
"who is waiting on me" -- without anyone having to open a board.

Usage:
    python3 wi_status.py [--root .] [--work-item WI-001] [--blocked-only]
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import yaml  # noqa: E402

from _common import emit, is_real_person, load_yaml, sdlc_root  # noqa: E402

# (next_skill, next_action, stage). The stage is the phase name people use --
# Intake / Explore / QA -- and it is deliberately not the same vocabulary as the
# state machine (Proposed / Exploring / Verifying). Two statuses can share one
# stage: Planned and Executing are both Build. Terminal statuses have no stage,
# because "已完成" is not a phase you are in.
#
# Operate and Learn are absent on purpose: they are event-driven (an incident, a
# retrospective) and attach to INC-* / LP-* objects, not to a work item's status.
PHASE_NEXT = {
    "Proposed": ("sdlc-explore", "澄清需求与边界", "Intake / Enact"),
    "Exploring": ("sdlc-contract", "把探索结论固化为 Execution Contract", "Explore"),
    "Contracted": ("sdlc-build", "声明变更范围并实施", "Design & Contract"),
    "Planned": ("sdlc-build", "开始实施", "Build"),
    "Executing": ("sdlc-qa", "独立验证", "Build"),
    "Verifying": ("sdlc-release", "组装 Evidence Case", "QA"),
    "Decision": ("sdlc-release", "等待 Release 决定", "Release"),
    "Completed": (None, "已完成", None),
    "Held": (None, "阻塞中", None),
    "Cancelled": (None, "已取消", None),
}

def load_phase_map(root):
    """Stage sequence, from .sdlc/family.yaml when declared.

    The built-in table is the AI-native delivery family. Declaring a second
    family should not require editing a skill, so the file wins when present --
    but a broken or missing file falls back silently rather than taking the
    whole status query down with it.
    """
    fam = Path(root) / "family.yaml"
    if not fam.exists():
        return dict(PHASE_NEXT), "builtin", None

    # Falling back is right -- a config typo should not take the status query
    # down. Falling back *quietly* is not: routing would silently revert to the
    # built-in sequence while still looking correct. So it degrades loudly.
    try:
        with fam.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
    except yaml.YAMLError as exc:
        return dict(PHASE_NEXT), "builtin", f"family.yaml 不是合法 YAML，已回退内置序列：{exc}"

    stages = data.get("stages") or []
    mapping = {}
    for s in stages:
        if not isinstance(s, dict):
            continue
        status = str(s.get("status", "")).strip()
        if status:
            mapping[status] = (s.get("next_skill"), s.get("next_action", ""),
                               str(s.get("stage") or "").strip() or None)
    if not mapping:
        return dict(PHASE_NEXT), "builtin", "family.yaml 里没有有效的 stages，已回退内置序列"

    unknown = sorted(set(mapping) - set(PHASE_NEXT))
    warn = (
        f"family.yaml 声明了状态机之外的状态：{', '.join(unknown)}——"
        "它们不会被任何环节置位，见 references/state-machine.md"
        if unknown else None
    )
    for terminal in ("Completed", "Held", "Cancelled"):
        mapping.setdefault(terminal, PHASE_NEXT[terminal])
    return mapping, data.get("family", "family.yaml"), warn


ARTIFACTS = [
    ("exploration.md", "Exploration Record"),
    ("contract.yaml", "Execution Contract"),
    ("change-scope.yaml", "Change Scope"),
    ("build-evidence.md", "Build Evidence"),
    ("test-plan.yaml", "Test Plan"),
    ("qa-report.md", "QA Report"),
    ("evidence-case.md", "Evidence Case"),
]


def gate_summary(wi_dir):
    gates = []
    gates_dir = wi_dir / "gates"
    if gates_dir.is_dir():
        for g in sorted(gates_dir.glob("*.yml")):
            data = load_yaml(g, required=False) or {}
            approver = data.get("approved_by")
            gates.append(
                {
                    "name": g.stem,
                    "gate": data.get("gate"),
                    "approved_by": approver,
                    "valid_approver": is_real_person(approver),
                }
            )
    return gates


def inspect(wi_dir, phase_map=None):
    wi = load_yaml(wi_dir / "work-item.yaml", required=False) or {}
    status = str(wi.get("status", "Proposed"))
    next_skill, next_action, stage = (phase_map or PHASE_NEXT).get(
        status, (None, "状态无法识别", None))

    gates = gate_summary(wi_dir)
    awaiting = [g["name"] for g in gates if not g["valid_approver"]]

    pending_amendments = []
    amd_dir = wi_dir / "amendments"
    if amd_dir.is_dir():
        for a in sorted(amd_dir.glob("AMD-*.md")):
            text = a.read_text(encoding="utf-8")
            decided = any(
                line.strip().startswith("- 决定：") and line.split("：", 1)[1].strip()
                and line.split("：", 1)[1].strip() not in {"accepted / rejected / deferred"}
                for line in text.splitlines()
            )
            if not decided:
                pending_amendments.append(a.name)

    blocked = wi.get("blocked_by")
    blocked_info = None
    if isinstance(blocked, dict):
        missing = [k for k in ("what", "who", "since") if not str(blocked.get(k, "")).strip()]
        blocked_info = {
            "what": blocked.get("what"),
            "who": blocked.get("who"),
            "since": blocked.get("since"),
            "unblocks_to": blocked.get("unblocks_to"),
            "incomplete_fields": missing,
        }

    return {
        "id": wi.get("id") or wi_dir.name,
        "dependencies": [str(d).strip() for d in (wi.get("dependencies") or []) if str(d).strip()],
        "trigger": wi.get("trigger"),
        "directory": wi_dir.name,
        "objective": wi.get("objective"),
        "owner": wi.get("owner"),
        "status": status,
        "stage": stage,
        "lane": wi.get("lane"),
        "updated": wi.get("updated"),
        "next_skill": next_skill,
        "next_action": next_action,
        "artifacts_present": [label for name, label in ARTIFACTS if (wi_dir / name).exists()],
        "gates": gates,
        "awaiting_human_approval": awaiting,
        "pending_amendments": pending_amendments,
        "blocked_by": blocked_info,
    }


TERMINAL = {"Completed", "Cancelled"}


def schedule(items):
    """Topological order over `dependencies`, plus cycles and inherited blockage.

    Without this the dependencies field is write-only: someone records that
    WI-005 needs WI-003 first, and nothing ever reads it back. The two answers
    it unlocks are "who should go first" and "this item looks fine but the thing
    it waits on has been stuck for nine days".
    """
    by_id = {i["id"]: i for i in items}
    deps = {
        i["id"]: [d for d in i["dependencies"] if d in by_id]
        for i in items
    }
    unknown = [
        {"work_item": i["id"], "missing": d}
        for i in items for d in i["dependencies"] if d not in by_id
    ]

    # Kahn's algorithm; whatever is left over sits on a cycle.
    indeg = {k: 0 for k in deps}
    for k, ds in deps.items():
        for d in ds:
            indeg[k] += 1
    ready = sorted(k for k, v in indeg.items() if v == 0)
    order, queue = [], list(ready)
    while queue:
        node = queue.pop(0)
        order.append(node)
        for k, ds in deps.items():
            if node in ds:
                indeg[k] -= 1
                if indeg[k] == 0:
                    queue.append(k)
                    queue.sort()
    cycles = sorted(set(deps) - set(order))

    # Blockage travels downstream: an item is inherited-blocked when anything it
    # depends on is Held or simply not finished yet.
    inherited = []
    for i in items:
        if i["status"] in TERMINAL:
            continue
        for d in deps[i["id"]]:
            up = by_id[d]
            if up["status"] == "Held":
                inherited.append(
                    {
                        "work_item": i["id"],
                        "waiting_on": d,
                        "reason": f"{d} 阻塞中：{(up.get('blocked_by') or {}).get('what')}",
                        "who": (up.get("blocked_by") or {}).get("who"),
                        "since": (up.get("blocked_by") or {}).get("since"),
                    }
                )
            elif up["status"] not in TERMINAL:
                inherited.append(
                    {
                        "work_item": i["id"],
                        "waiting_on": d,
                        "reason": f"{d} 尚未完成（当前 {up['status']}）",
                        "who": up.get("owner"),
                        "since": None,
                    }
                )

    actionable = [
        i["id"] for i in items
        if i["status"] not in TERMINAL
        and i["id"] not in cycles
        and not any(b["work_item"] == i["id"] for b in inherited)
    ]

    return {
        "topological_order": [o for o in order if by_id[o]["status"] not in TERMINAL],
        "actionable_now": sorted(actionable),
        "inherited_blockage": inherited,
        "dependency_cycles": cycles,
        "unknown_dependencies": unknown,
    }



# The three unconditional human gates, in the order a work item meets them.
# scope-expansion is deliberately absent: it only exists when something went out
# of bounds, so calling it "the next gate" would be wrong most of the time.
# Each entry is (gate name, the status by which that gate must already exist).
GATE_PATH = [
    ("contract-approval", "Contracted"),
    ("build-review", "Verifying"),
    ("release", "Completed"),
]

STATUS_ORDER = ["Proposed", "Exploring", "Contracted", "Planned",
                "Executing", "Verifying", "Decision", "Completed"]


def next_gate(item):
    """The next unconditional human gate this work item owes, and whether it is due.

    Returns (name, state) where state is 待批 / 未到, or (None, reason) when there
    is nothing left to pass. Derived from the gate records on disk rather than from
    the status alone: a status can be moved by hand, a signed gate file cannot.
    """
    passed = {g["name"] for g in item.get("gates", [])
              if str(g.get("gate")) in {"PASS", "CONCERNS"} and g.get("valid_approver")}
    status = item.get("status", "")
    if status in {"Cancelled"}:
        return None, "已取消"
    for name, due_by in GATE_PATH:
        if name in passed:
            continue
        try:
            due = STATUS_ORDER.index(status) >= STATUS_ORDER.index(due_by)
        except ValueError:
            due = False          # Held or an unrecognised status: cannot say it is due
        return name, ("待批" if due else "未到")
    return None, "三道 Gate 都已通过"


def header_lines(payload):
    """One short status block for the top of a reply. Plain text, no invention.

    Every value here comes from a file. That is the point: a status line a model
    composes from memory is worse than no status line, because it looks checked.
    """
    items = payload.get("work_items") or []
    if not items:
        return ["尚无 Work Item（`.sdlc/work-items/` 为空）"]

    cur_name = payload.get("current_work_item")
    focus = next((i for i in items if i["directory"] == cur_name or i["id"] == cur_name), None)
    if focus is None:
        # Picking one silently would present an arbitrary item as "the" work item.
        # With no pointer there is no such thing, and saying so is the useful answer.
        if len(items) == 1:
            focus = items[0]
        else:
            names = " / ".join(i["id"] for i in items[:5])
            more = f" 等 {len(items)} 个" if len(items) > 5 else ""
            return [f"`current.yaml` 没有指向任何 Work Item——在跑的有 {names}{more}",
                    "先把 `current.yaml` 指到一个，或在提问时点名是哪一单"]

    gate, gate_state = next_gate(focus)
    gate_txt = f"下一道 Gate **{gate}**（{gate_state}）" if gate else f"Gate：{gate_state}"

    # The stage is what a person tracks; the status is the machine's value for it.
    # Leading with the status was the original mistake here -- "Verifying" answers
    # a question nobody outside the state machine asked.
    stage = focus.get("stage")
    if stage:
        phase_txt = f"**{stage}** 阶段（{focus.get('status')}）"
    else:
        phase_txt = f"**{focus.get('status')}**"

    bits = [f"`{focus['id']}`", phase_txt]
    if focus.get("lane"):
        bits.append(f"lane {focus['lane']}")
    bits.append(gate_txt)

    # An owed gate outranks the phase map. The map answers "what comes after this
    # status", which is the wrong answer while a gate the status already passed is
    # still unsigned -- pointing at the next phase there would send the reader
    # forward past the very check that is missing.
    if gate and gate_state == "待批":
        bits.append(f"**下一步：补 {gate}**")
    elif focus.get("status") == "Held":
        pass                      # the blocker is the next step; it goes on line 2
    elif focus.get("next_skill"):
        bits.append(f"下一步 {focus['next_skill']}：{focus.get('next_action') or ''}".rstrip("："))
    lines = [" · ".join(bits)]

    tail = []
    others = len(items) - 1
    if others > 0:
        tail.append(f"另有 {others} 个 Work Item")
    if focus.get("status") == "Held":
        b = focus.get("blocked_by") or {}
        tail.append(f"阻塞中，等 {b.get('who') or '未指定'}：{b.get('what') or '未写明'}")
    attention = payload.get("needs_attention") or []
    if attention:
        tail.append(f"{len(attention)} 项待处理")
    if tail:
        lines.append(" · ".join(tail))
    return lines


def main():
    parser = argparse.ArgumentParser(description="Work Item status overview")
    parser.add_argument("--root", default=".")
    parser.add_argument("--work-item", default=None)
    parser.add_argument("--blocked-only", action="store_true")
    parser.add_argument("--header", action="store_true",
                        help="只输出一段供回复开头使用的状态行，纯文本")
    args = parser.parse_args()

    # --header output goes straight into a reply, so an uninitialised project is a
    # state to state plainly, not a script failure to hand back as JSON. Every other
    # mode keeps the usual exit-2 behaviour.
    if args.header and not any((c / ".sdlc").is_dir()
                               for c in [Path(args.root).resolve(), *Path(args.root).resolve().parents]):
        print("本项目还没有 `.sdlc/`——治理记录尚未初始化，没有可跟踪的阶段")
        print()
        print("---")
        return

    sdlc = sdlc_root(args.root)
    items_dir = sdlc / "work-items"
    dirs = sorted(d for d in items_dir.iterdir() if d.is_dir()) if items_dir.is_dir() else []

    if args.work_item:
        needle = args.work_item.lower()
        dirs = [d for d in dirs if d.name.lower().startswith(needle)]

    phase_map, family_source, family_warning = load_phase_map(sdlc)
    items = [inspect(d, phase_map) for d in dirs]
    sched = schedule(items)

    if args.blocked_only:
        items = [
            i for i in items
            if i["status"] == "Held" or i["awaiting_human_approval"] or i["pending_amendments"]
        ]

    needs_attention = []
    if family_warning:
        needs_attention.append(f"⚠️ {family_warning}")
    for i in items:
        if i["status"] == "Held":
            who = (i["blocked_by"] or {}).get("who") or "未指定"
            needs_attention.append(f"{i['id']} 阻塞中，等 {who}：{(i['blocked_by'] or {}).get('what')}")
        for g in i["awaiting_human_approval"]:
            needs_attention.append(f"{i['id']} 的 {g} 缺具名批准")
        for a in i["pending_amendments"]:
            needs_attention.append(f"{i['id']} 的 {a} 尚未处置")
        if not i["owner"]:
            needs_attention.append(f"{i['id']} 没有 owner，不能进入 Exploring")
    for b in sched["inherited_blockage"]:
        needs_attention.append(
            f"{b['work_item']} 自己没问题，但它依赖的 {b['waiting_on']} {b['reason']}"
        )
    for c in sched["dependency_cycles"]:
        needs_attention.append(f"{c} 处在依赖环里——没有任何一个能先开始，必须有人打破环")
    for u in sched["unknown_dependencies"]:
        needs_attention.append(f"{u['work_item']} 依赖的 {u['missing']} 不存在")

    current = load_yaml(sdlc / "current.yaml", required=False) or {}

    payload = {
        "ok": True,
        "current_work_item": current.get("work_item"),
        "family": family_source,
        "family_warning": family_warning,
        "schedule": sched,
        "total": len(items),
        "needs_attention": needs_attention,
        "work_items": items,
    }

    if args.header:
        # Plain text on purpose: this goes straight into a reply, so JSON here
        # would only invite hand-transcription, which is where invention starts.
        print("\n".join(header_lines(payload)))
        print()
        print("---")
        return

    emit(payload)


if __name__ == "__main__":
    main()
