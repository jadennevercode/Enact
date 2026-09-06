#!/usr/bin/env python3
"""Project state: init, status, list, decide, audit, problems, points.

Revision history lives in `revision.py` (new / seal / diff / restore / head).

State is derived, not stored. `status` recomputes the phase from what is on disk
every time it runs, so the record cannot drift from the artifacts — the failure
mode where a progress file claims "done" and the deliverable was never written.

    state.py init <dir> --slug finance --goal "..." --domain "..."
    state.py status <ws>
    state.py decide <ws> --point patch_or_version --verdict patch --role OO --rationale "..."
    state.py audit <ws>
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
for _extra in (_ROOT, _ROOT / "shared" / "lib"):
    if str(_extra) not in sys.path:
        sys.path.insert(0, str(_extra))

import yamlio  # noqa: E402
from paths import MARKER, Paths, WorkspaceError, resolve  # noqa: E402

MANIFESTS = _ROOT / "shared" / "manifests"
REGISTRY_FILE = Path(os.environ.get("ONTOLOGIZER_HOME", Path.home() / ".ontologizer")) / "projects.txt"
SPEC_VERSION = "0.2"
PACK_VERSION = "0.1.0"


def now() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def _load(path: Path):
    if not Path(path).is_file():
        return None
    try:
        return yamlio.load_path(path)
    except Exception:
        return None


def _manifest(name: str):
    return yamlio.load_path(MANIFESTS / name)


# --------------------------------------------------------------------------- #
# init / list
# --------------------------------------------------------------------------- #

def cmd_init(args) -> int:
    root = Path(args.directory).expanduser().resolve()
    if (root / MARKER).is_file():
        print(f"{root} 已经是一个项目。", file=sys.stderr)
        return 2
    for folder in (
        "history", "inputs/charter", "inputs/evidence", "inputs/competency-questions",
        "define/evidence-snapshots", "revisions/runs", "reviews",
        "evaluation/runs", "releases", "exports",
    ):
        (root / folder).mkdir(parents=True, exist_ok=True)

    project = {
        "slug": args.slug,
        "created_at": now(),
        "goal": args.goal,
        "domain": args.domain,
        "language": args.language,
        "owners": {"domain": args.domain_owner, "ontology": args.ontology_owner, "process": args.process_owner},
        "pins": {
            "spec_version": SPEC_VERSION,
            "skill_pack_version": PACK_VERSION,
            "model": args.model or os.environ.get("ONTOLOGIZER_MODEL", "unrecorded"),
        },
        "workspace_version": 1,
    }
    yamlio.dump_path(root / MARKER, project)
    (root / "history" / "decisions.log").write_text(
        "# ISO8601|point_id|role|verdict|object|rationale  (append only)\n", encoding="utf-8"
    )
    (root / "history" / "runs.jsonl").touch()
    yamlio.dump_path(root / "history" / "comments.yaml", {"comments": []})
    _register(root)
    print(f"{root}")
    print("下一步：把 SOW 或立项说明放进 inputs/charter/，材料放进 inputs/evidence/。")
    return 0


def _register(root: Path) -> None:
    REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)
    known = set()
    if REGISTRY_FILE.is_file():
        known = {line.strip() for line in REGISTRY_FILE.read_text(encoding="utf-8").splitlines() if line.strip()}
    known.add(str(root))
    REGISTRY_FILE.write_text("\n".join(sorted(known)) + "\n", encoding="utf-8")


def cmd_list(args) -> int:
    rows: list[tuple[str, str]] = []
    if REGISTRY_FILE.is_file():
        for line in REGISTRY_FILE.read_text(encoding="utf-8").splitlines():
            path = Path(line.strip())
            if not line.strip():
                continue
            rows.append((str(path), "ok" if (path / MARKER).is_file() else "GONE"))
    if args.scan:
        base = Path(args.scan).expanduser()
        for marker in sorted(base.rglob(MARKER)):
            entry = str(marker.parent)
            if entry not in {row[0] for row in rows}:
                rows.append((entry, "found"))
    if not rows:
        print("这台机器上还没有已知的项目。用 state.py init 建一个。")
        return 0
    for path, status in rows:
        project = _load(Path(path) / MARKER) or {}
        label = project.get("slug", "?")
        print(f"{status:6} {label:20} {path}")
    print()
    print("别的机器上建的项目不会出现在这里；cd 进去照样能用，--scan 能找到它们。")
    print("从清单里删一行不删除任何东西，删目录才是。")
    return 0


# --------------------------------------------------------------------------- #
# status
# --------------------------------------------------------------------------- #

def derive_phase(paths: Paths) -> tuple[str, str]:
    if not paths.project.is_file():
        return "uninitialised", "没有 ontologizer.yaml"
    revisions = paths.revision_ids()
    head = _head(paths)

    for release_id in paths.release_ids():
        if (paths.release(release_id) / "pr.yaml").is_file():
            return "submitted", f"{release_id} 已创建 PR"
    for revision in revisions:
        meta = _load(paths.revision(revision) / "revision.yaml") or {}
        if meta.get("candidate_release"):
            return "candidate_selected", f"{revision} 已选为 candidate release"
    running = [
        revision for revision in revisions
        if (_load(paths.revision(revision) / "revision.yaml") or {}).get("status") == "running"
    ]
    if running:
        return "generating", f"{', '.join(running)} 正在生成"

    if head:
        meta = _load(paths.revision(head) / "revision.yaml") or {}
        review = _load(paths.review(head))
        if meta.get("status") == "ready_for_review" and review is None:
            return "ready_for_review", f"{head} 等待审阅"
        if review is not None:
            items = review.get("items") or []
            pending = [
                item for item in items
                if isinstance(item, dict)
                and item.get("disposition") not in ("accept", "comment", "direct_edit", "defer", "reject")
            ]
            if pending:
                return "in_review", f"{head} 还有 {len(pending)} 个对象没有结论"
            comments = _load(paths.comments) or {}
            open_changes = [
                item for item in (comments.get("comments") or [])
                if isinstance(item, dict) and item.get("status") not in ("resolved", "deferred")
            ]
            if open_changes:
                return "revision_pending", f"{len(open_changes)} 条变更请求还没落地"
            return "in_review", f"{head} 审阅已二值化"

    if paths.snapshot_ids():
        readiness = _load(paths.readiness) or {}
        unresolved = [
            item for item in (readiness.get("questions") or [])
            if isinstance(item, dict) and item.get("status") in (None, "inferred", "pending")
        ]
        if unresolved or not _standing(paths, "evidence_sufficiency"):
            return "defining", "证据充分性未决或 readiness 有未二值化项"
        return "defining", "证据已就绪，可以生成"
    return "initiated", "还没有证据快照"


def _head(paths: Paths) -> str | None:
    if not paths.head_file.is_file():
        return None
    return paths.head_file.read_text(encoding="utf-8").strip() or None


def _decisions(paths: Paths) -> list[dict]:
    if not paths.decisions.is_file():
        return []
    entries = []
    for number, line in enumerate(paths.decisions.read_text(encoding="utf-8").splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("|")
        entries.append(
            {
                "line": number, "at": parts[0] if parts else "",
                "point": parts[1] if len(parts) > 1 else "",
                "role": parts[2] if len(parts) > 2 else "",
                "verdict": parts[3] if len(parts) > 3 else "",
                "object": parts[4] if len(parts) > 4 else "",
                "rationale": "|".join(parts[5:]) if len(parts) > 5 else "",
            }
        )
    return entries


def _standing(paths: Paths, point_id: str) -> dict | None:
    matches = [entry for entry in _decisions(paths) if entry["point"] == point_id]
    return matches[-1] if matches else None


def cmd_status(args) -> int:
    workspace = resolve(args.workspace)
    paths = Paths(workspace)
    project = _load(paths.project) or {}
    phase, why = derive_phase(paths)
    stages = _manifest("stages.yaml")
    points = {item["id"]: item for item in _manifest("decision-points.yaml")["points"]}

    print(f"项目 {project.get('slug', '?')} · 阶段 {phase}")
    print(f"  {why}")
    print()

    revisions = paths.revision_ids()
    head = _head(paths)
    if revisions:
        print("revision:")
        for revision in revisions[-6:]:
            meta = _load(paths.revision(revision) / "revision.yaml") or {}
            marks = []
            if revision == head:
                marks.append("HEAD")
            if meta.get("candidate_release"):
                marks.append("candidate")
            if paths.review(revision).is_file():
                marks.append("reviewed")
            failed = [
                check for check, outcome in (meta.get("validator_results") or {}).items()
                if outcome == "fail"
            ]
            suffix = f"  未过：{', '.join(failed)}" if failed else ""
            print(
                f"  {revision}  {meta.get('status', '?'):16} {'·'.join(marks):24}"
                f" {meta.get('reason', '')}{suffix}"
            )
        print()

    waiting = _waiting_on_human(paths, phase, points)
    print("等你决定：")
    if waiting:
        for item in waiting:
            print(f"  · {item}")
    else:
        print("  （没有待决事项）")
    print()

    findings = problems(workspace)
    print("问题：")
    if findings:
        for item in findings:
            print(f"  !! {item}")
    else:
        print("  逐项查过了，没有发现问题。")
    next_stage = _next_stage(stages, phase, paths)
    if next_stage:
        print()
        print(f"下一步：{next_stage}")
    return 0


def _waiting_on_human(paths: Paths, phase: str, points: dict) -> list[str]:
    waiting = []
    if not paths.charter.is_file():
        waiting.append("项目章程还没写（initiate）")
    elif not _standing(paths, "scope_and_boundary"):
        waiting.append("目标与边界待确认（decision point scope_and_boundary，OO 拍板）")
    if paths.snapshot_ids() and not _standing(paths, "evidence_sufficiency"):
        waiting.append("证据是否足够待决（evidence_sufficiency，DE 拍板；系统不替你判断）")
    head = _head(paths)
    if phase == "ready_for_review" and head:
        waiting.append(f"{head} 等待四层审阅（review）")
    if phase == "in_review" and head and not _standing(paths, "semantic_review"):
        waiting.append(f"{head} 审阅已二值化，等 semantic_review 裁决")
    for release_id in paths.release_ids():
        base = paths.release(release_id)
        if (base / "access-scopes.yaml").is_file() and not _standing(paths, "access_scope_review"):
            waiting.append(f"{release_id} 的 Access Scope 覆盖待审（access_scope_review）")
        if (base / "patch-or-version.yaml").is_file() and not _standing(paths, "patch_or_version"):
            waiting.append(f"{release_id} 的 Patch/Version 待选择（patch_or_version，只能人选）")
        if (base / "submission-manifest.yaml").is_file() and not (base / "pr.yaml").is_file():
            waiting.append(f"{release_id} 等待唯一强制批准 create_pull_request（{points['create_pull_request']['accountable']}）")
    return waiting


def _next_stage(stages: dict, phase: str, paths: Paths | None = None) -> str | None:
    # A project with a directory but no charter has not been framed yet, whatever
    # else is sitting in inputs/. Sending someone to register evidence before the
    # boundary exists is how you end up modelling the wrong thing carefully.
    if paths is not None and phase in ("initiated", "defining") and not paths.charter.is_file():
        return "initiate —— 先写项目章程，把目标、边界和负责人定下来"
    mapping = {
        "uninitialised": "state.py init",
        "initiated": "evidence —— 登记材料，建立锚点",
        "defining": "evidence / interview —— 补齐证据与访谈，然后决定证据是否足够",
        "generating": "等待生成完成；失败时 diagnose 或 retry",
        "ready_for_review": "review —— 四层四轮逐项审阅",
        "in_review": "revise —— 把审阅结果落成新 revision",
        "revision_pending": "revise —— 还有变更请求没落地",
        "candidate_selected": "submit —— Access Scopes、Patch/Version、PR",
        "submitted": "evaluate 或收尾；PR 已在平台侧",
    }
    return mapping.get(phase)


# --------------------------------------------------------------------------- #
# problems / audit
# --------------------------------------------------------------------------- #

PROBLEM_CHECKS = [
    "revision_sealed_immutable",
    "decision_logged",
    "trace_index_current",
    "locators_resolve_or_orphaned",
    "trace_complete",
    "defer_has_owner",
]


def problems(workspace: Path) -> list[str]:
    """A mechanical scan. Every line here comes from a check, not from recall."""
    from tools import validators
    from tools.validators.base import Context

    paths = Paths(workspace)
    head = _head(paths)
    ctx = Context(workspace, revision=head)
    findings: list[str] = []

    runnable = [check for check in PROBLEM_CHECKS if head or check in ("decision_logged", "revision_sealed_immutable")]
    for result in validators.run_checks(ctx, runnable):
        if result.passed:
            continue
        for finding in result.findings[:4]:
            findings.append(f"{result.check_id}: {finding}")

    # A review recorded against a revision whose gate never closed.
    for revision in paths.revision_ids():
        meta = _load(paths.revision(revision) / "revision.yaml") or {}
        if paths.review(revision).is_file() and meta.get("status") != "ready_for_review":
            findings.append(
                f"{revision} 有审阅记录，但它的状态是 {meta.get('status')!r}——审的是一个没过门的版本"
            )

    # Evaluation results bound to a revision that has since been superseded.
    head_id = head
    if paths.evaluation_runs.is_dir():
        for path in sorted(paths.evaluation_runs.glob("*.yaml")):
            run = _load(path) or {}
            revision = run.get("revision")
            if revision and head_id and revision != head_id:
                meta = _load(paths.revision(revision) / "revision.yaml") or {}
                if not meta.get("candidate_release"):
                    findings.append(
                        f"{path.name} 的结论绑定在 {revision}，而 HEAD 是 {head_id}——结论可能已经过期"
                    )
    return findings


def cmd_problems(args) -> int:
    workspace = resolve(args.workspace)
    findings = problems(workspace)
    for item in findings:
        print(f"!! {item}")
    if not findings:
        print("逐项查过了，没有发现问题。")
    return 0


def _stages_reached(paths: Paths) -> set[str]:
    """Which stages have produced anything at all.

    A check belonging to a stage nobody has started is not a failure, it is a
    question that has not come up yet. Reporting the two as one list makes a
    healthy young project look broken, and teaches people to skim the audit —
    which is the one output that must never be skimmed.
    """
    stages = _manifest("stages.yaml")
    reached: set[str] = set()
    for stage in stages["stages"] + stages["cross_cutting"]:
        for pattern in stage.get("outputs") or []:
            probe = pattern.replace("rNNNN", "r*").replace("rMMMM", "r*")
            probe = probe.replace("es-NNNN", "es-*").replace("rel-NNNN", "rel-*")
            probe = probe.replace("ev-NNNN", "ev-*").replace("relNNNN", "rel-*")
            probe = probe.replace("<candidate>", "r*").replace("**", "*")
            if any(_has_content(path) for path in paths.root.glob(probe)):
                reached.add(stage["id"])
                break
    return reached


def _has_content(path: Path) -> bool:
    """Existence is not evidence of work.

    `history/comments.yaml` is created empty by `init`, so treating its presence
    as "the review stage has started" would report every fresh project as owing a
    review it has not reached.
    """
    if path.is_dir():
        return any(item.is_file() for item in path.rglob("*"))
    if not path.is_file():
        return False
    if path.suffix not in (".yaml", ".yml"):
        return path.stat().st_size > 0
    data = _load(path)
    if isinstance(data, dict):
        return any(value not in (None, [], {}, "") for value in data.values())
    return bool(data)


def _stage_of(ctx, check_id: str) -> list[str]:
    entry = ctx.manifest_checks.get(check_id) or {}
    stage = entry.get("stage")
    if stage is None:
        return []
    return stage if isinstance(stage, list) else [stage]


def cmd_audit(args) -> int:
    """Recompute every check against disk. The record is an index; the files are the fact."""
    workspace = resolve(args.workspace)
    from tools import validators
    from tools.validators.base import Context

    paths = Paths(workspace)
    reached = _stages_reached(paths)
    not_reached: list[str] = []
    failures = 0
    targets = paths.revision_ids() or [None]
    releases = paths.release_ids() or [None]
    seen: set[str] = set()

    for revision in targets:
        for release in releases:
            ctx = Context(workspace, revision=revision, release=release)
            for result in validators.run_checks(ctx, sorted(validators.REGISTRY)):
                key = f"{result.check_id}|{revision}|{release}"
                if key in seen or result.passed:
                    continue
                seen.add(key)
                stages = _stage_of(ctx, result.check_id)
                if stages and not (set(stages) & reached):
                    if result.check_id not in not_reached:
                        not_reached.append(f"{result.check_id}（{'/'.join(stages)} 还没开始）")
                    continue
                marker = "!!" if result.level == "blocking" else "!"
                scope = f"[{revision or '-'}/{release or '-'}]"
                print(f"{marker} {result.check_id} {scope}")
                for finding in result.findings[:6]:
                    print(f"     {finding}")
                if result.level == "blocking":
                    failures += 1

    if not_reached:
        print("\n尚未到达的阶段（不是问题）：")
        for item in sorted(not_reached):
            print(f"  · {item}")
    if not failures:
        print("\naudit: 已经走过的阶段，全部 blocking 检查通过。")
    else:
        print(f"\naudit: {failures} 项 blocking 检查未通过。不要自己悄悄修复记录——报告、给方案、让人选。")
    return 1 if failures else 0


# --------------------------------------------------------------------------- #
# decide
# --------------------------------------------------------------------------- #

def cmd_decide(args) -> int:
    workspace = resolve(args.workspace)
    paths = Paths(workspace)
    manifest = _manifest("decision-points.yaml")
    points = {item["id"]: item for item in manifest["points"]}
    excluded = {item["id"]: item for item in manifest.get("not_recorded_here") or []}

    if args.point in excluded:
        print(f"{args.point} 不由本包记录：{excluded[args.point]['why'].strip()}", file=sys.stderr)
        return 2
    point = points.get(args.point)
    if point is None:
        print(f"没有这个决策点：{args.point}", file=sys.stderr)
        print(f"合法取值：{', '.join(points)}", file=sys.stderr)
        return 2
    if args.verdict not in point["verdicts"]:
        print(
            f"{args.point} 的合法裁决是 {', '.join(point['verdicts'])}，不是 {args.verdict!r}",
            file=sys.stderr,
        )
        return 2
    if args.role and args.role not in (point.get("roles") or []) and not args.force_role:
        print(
            f"{args.point} 通常由 {', '.join(point.get('roles') or [])} 决定；"
            f"要用 {args.role} 记录请加 --force-role",
            file=sys.stderr,
        )
        return 2

    if args.verdict in (point.get("closing") or []) and not args.skip_checks:
        blocked = _blocking_for(workspace, point)
        if blocked:
            print(f"{args.point} 还不能关：", file=sys.stderr)
            for item in blocked:
                print(f"  !! {item}", file=sys.stderr)
            print("先修检查项，或者用 --skip-checks 记录一个明知有未决项的裁决。", file=sys.stderr)
            return 1

    line = "|".join(
        [
            now(), args.point, args.role or "?", args.verdict,
            args.object or "-", (args.rationale or "").replace("\n", " "),
        ]
    )
    paths.decisions.parent.mkdir(parents=True, exist_ok=True)
    with open(paths.decisions, "a", encoding="utf-8") as handle:
        handle.write(line + "\n")
    print(line)
    if point.get("mandatory"):
        print("（这是整条流程唯一的强制人工批准点。）")
    for path in point.get("freezes") or []:
        print(f"冻结：{path} 之后的改动要走一次显式的重开，不能悄悄改。")
    return 0


def _blocking_for(workspace: Path, point: dict) -> list[str]:
    from tools import validators
    from tools.validators.base import Context

    paths = Paths(workspace)
    releases = paths.release_ids()
    ctx = Context(workspace, revision=_head(paths), release=releases[-1] if releases else None)
    blocked: list[str] = []
    for gate_id in point.get("requires_gates") or []:
        closed, results = validators.run_gate(ctx, gate_id)
        if not closed:
            failed = [r.check_id for r in results if not r.passed and r.level == "blocking"]
            blocked.append(f"门 {gate_id} 未关：{', '.join(failed)}")
    for result in validators.run_checks(ctx, point.get("requires_checks") or []):
        if not result.passed and result.level == "blocking":
            detail = result.findings[0] if result.findings else ""
            blocked.append(f"{result.check_id} 未通过：{detail}")
    return blocked


def cmd_points(args) -> int:
    manifest = _manifest("decision-points.yaml")
    for point in manifest["points"]:
        mandatory = "  [强制]" if point.get("mandatory") else ""
        print(f"{point['id']}{mandatory}")
        print(f"  {point['question']}")
        print(f"  角色 {', '.join(point.get('roles') or [])} · 裁决 {', '.join(point['verdicts'])}")
    print()
    for item in manifest.get("not_recorded_here") or []:
        print(f"{item['id']}  —— 不由本包记录。{item['why'].strip()}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="state.py", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="新建一个项目目录")
    init.add_argument("directory")
    init.add_argument("--slug", required=True)
    init.add_argument("--goal", required=True)
    init.add_argument("--domain", required=True)
    init.add_argument("--language", default="zh")
    init.add_argument("--domain-owner", default=None)
    init.add_argument("--ontology-owner", default=None)
    init.add_argument("--process-owner", default=None)
    init.add_argument("--model", default=None)
    init.set_defaults(func=cmd_init)

    status = sub.add_parser("status", help="推导阶段、列 revision、等谁决定、有什么问题")
    status.add_argument("workspace", nargs="?")
    status.set_defaults(func=cmd_status)

    listing = sub.add_parser("list", help="这台机器知道的项目")
    listing.add_argument("--scan")
    listing.set_defaults(func=cmd_list)

    decide = sub.add_parser("decide", help="记录一个人的决策")
    decide.add_argument("workspace")
    decide.add_argument("--point", required=True)
    decide.add_argument("--verdict", required=True)
    decide.add_argument("--role")
    decide.add_argument("--object")
    decide.add_argument("--rationale")
    decide.add_argument("--skip-checks", action="store_true")
    decide.add_argument("--force-role", action="store_true")
    decide.set_defaults(func=cmd_decide)

    audit = sub.add_parser("audit", help="对着磁盘重算每一项检查")
    audit.add_argument("workspace", nargs="?")
    audit.set_defaults(func=cmd_audit)

    problems_cmd = sub.add_parser("problems", help="机械扫描：断链、orphaned、被改的历史、过期结论")
    problems_cmd.add_argument("workspace", nargs="?")
    problems_cmd.set_defaults(func=cmd_problems)

    points = sub.add_parser("points", help="列出所有人的决策点")
    points.set_defaults(func=cmd_points)

    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except WorkspaceError as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
