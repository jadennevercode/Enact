#!/usr/bin/env python3
"""Revision lifecycle: new, seal, diff, restore, head.

The revision is the unit of state in this package. Everything here exists to make
one sentence true: an old revision is never modified, and every claim about what
changed can be recomputed from disk.

    revision.py new <ws> --reason "first generation"
    revision.py seal <ws> r0001
    revision.py diff <ws> r0001 r0002
    revision.py restore <ws> r0002
    revision.py head <ws> [r0003]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
for _extra in (_ROOT, _ROOT / "shared" / "lib"):
    if str(_extra) not in sys.path:
        sys.path.insert(0, str(_extra))

import yamlio  # noqa: E402
import digest as digest_lib  # noqa: E402
from paths import Paths, resolve  # noqa: E402

from tools.trace import index as trace_index  # noqa: E402

SEALED_EXCLUDED = {"revision.yaml"}
ARTIFACT_ORDER = [
    "process_ir.yaml", "evidential_ir.yaml", "alignment.yaml",
    "candidate.yaml", "candidate.cypher", "generation-report.md",
]


def now() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def _load(path: Path):
    if not Path(path).is_file():
        return None
    try:
        return yamlio.load_path(path)
    except Exception:
        return None


def input_digests(paths: Paths) -> dict:
    """Freeze what the generation read. A revision that cannot name its inputs
    cannot claim to be reproducible."""
    snapshots = paths.snapshot_ids()
    latest = snapshots[-1] if snapshots else None
    result = {
        "evidence_snapshot_id": latest,
        "evidence_snapshot": digest_lib.combined(digest_lib.tree_digest(paths.snapshot(latest)))
        if latest and paths.snapshot(latest).is_dir()
        else None,
        "interview_state": digest_lib.file_digest(paths.interview_state)
        if paths.interview_state.is_file()
        else None,
        "fagc_register": digest_lib.file_digest(paths.fagc) if paths.fagc.is_file() else None,
        "model_cards": digest_lib.file_digest(paths.model_cards) if paths.model_cards.is_file() else None,
        "charter": digest_lib.file_digest(paths.charter) if paths.charter.is_file() else None,
    }
    return result


def declarations(bundle: dict) -> dict[str, dict]:
    return trace_index._declarations(bundle)


def candidate_of(paths: Paths, revision: str) -> dict:
    data = _load(paths.revision(revision) / "candidate.yaml") or {}
    return data.get("bundle", data) or {}


# --------------------------------------------------------------------------- #
# commands
# --------------------------------------------------------------------------- #

def cmd_new(args) -> int:
    workspace = resolve(args.workspace)
    paths = Paths(workspace)
    paths.revisions.mkdir(parents=True, exist_ok=True)
    existing = paths.revision_ids()
    parent = args.parent or (existing[-1] if existing and not args.no_parent else None)
    revision_id = paths.next_id("r", existing)
    directory = paths.revision(revision_id)
    directory.mkdir(parents=True)
    (directory / "validation").mkdir()

    project = _load(paths.project) or {}
    meta = {
        "id": revision_id,
        "parent": parent,
        "parent_digest": digest_lib.combined(
            digest_lib.tree_digest(paths.revision(parent), exclude=SEALED_EXCLUDED)
        )
        if parent and paths.revision(parent).is_dir()
        else None,
        "created_at": now(),
        "created_by": args.by or "unknown",
        "reason": args.reason,
        "change_request_ids": args.change or [],
        "status": "running",
        "sealed": False,
        "pins": project.get("pins") or {},
        "inputs": input_digests(paths),
        "artifact_digests": {},
        "content_digest": None,
        "validator_results": {},
        "unresolved": {"warnings": [], "assumptions": []},
        "candidate_release": False,
    }
    yamlio.dump_path(directory / "revision.yaml", meta)
    print(revision_id)
    return 0


def cmd_seal(args) -> int:
    workspace = resolve(args.workspace)
    paths = Paths(workspace)
    revision_id = args.revision or _head(paths)
    directory = paths.revision(revision_id)
    meta = _load(directory / "revision.yaml")
    if meta is None:
        print(f"revision {revision_id} 没有 revision.yaml", file=sys.stderr)
        return 2
    if meta.get("sealed"):
        print(f"{revision_id} 已封存，不再改动。要改就开新 revision。", file=sys.stderr)
        return 2

    missing = [name for name in ARTIFACT_ORDER if not (directory / name).is_file()]
    if missing and not args.force:
        print(f"缺少产物：{', '.join(missing)}", file=sys.stderr)
        return 2

    trace_index.write(workspace, revision_id)

    from tools import validators
    from tools.validators.base import Context

    ctx = Context(workspace, revision=revision_id)
    closed, results = validators.run_gate(ctx, "ready_for_review")
    folder = paths.validation_dir(revision_id)
    folder.mkdir(parents=True, exist_ok=True)
    for result in results:
        (folder / f"{result.check_id}.json").write_text(
            json.dumps(result.as_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
        )

    meta["inputs"] = input_digests(paths)
    meta["artifact_digests"] = digest_lib.tree_digest(directory, exclude=SEALED_EXCLUDED)
    meta["content_digest"] = digest_lib.combined(meta["artifact_digests"])
    meta["validator_results"] = {
        result.check_id: result.as_dict()["outcome"] for result in results
    }
    meta["status"] = "ready_for_review" if closed else "gate_failed"
    meta["sealed"] = True
    meta["sealed_at"] = now()
    yamlio.dump_path(directory / "revision.yaml", meta)

    # The digest map is written into revision.yaml, so it is recomputed after the
    # write to keep the file it describes out of its own hash.
    if closed:
        _set_head(paths, revision_id)
        print(f"{revision_id} sealed · ready_for_review · HEAD")
        return 0
    failures = [r.check_id for r in results if not r.passed and r.level == "blocking"]
    print(f"{revision_id} sealed · gate_failed · 未通过：{', '.join(failures)}", file=sys.stderr)
    return 1


def cmd_head(args) -> int:
    paths = Paths(resolve(args.workspace))
    if args.revision:
        if not paths.revision(args.revision).is_dir():
            print(f"没有 revision {args.revision}", file=sys.stderr)
            return 2
        _set_head(paths, args.revision)
    print(_head(paths) or "")
    return 0


def _head(paths: Paths) -> str | None:
    if not paths.head_file.is_file():
        return None
    return paths.head_file.read_text(encoding="utf-8").strip() or None


def _set_head(paths: Paths, revision_id: str) -> None:
    paths.head_file.parent.mkdir(parents=True, exist_ok=True)
    paths.head_file.write_text(revision_id + "\n", encoding="utf-8")


def cmd_restore(args) -> int:
    """Restore is a copy forward, never a rewind. 流程 §15.1."""
    workspace = resolve(args.workspace)
    paths = Paths(workspace)
    source = args.revision
    if not paths.revision(source).is_dir():
        print(f"没有 revision {source}", file=sys.stderr)
        return 2
    existing = paths.revision_ids()
    new_id = paths.next_id("r", existing)
    target = paths.revision(new_id)
    shutil.copytree(paths.revision(source), target)

    parent = _head(paths) or existing[-1]
    meta = _load(target / "revision.yaml") or {}
    meta.update(
        {
            "id": new_id,
            "parent": parent,
            "parent_digest": digest_lib.combined(
                digest_lib.tree_digest(paths.revision(parent), exclude=SEALED_EXCLUDED)
            )
            if paths.revision(parent).is_dir()
            else None,
            "created_at": now(),
            "created_by": args.by or "unknown",
            "reason": f"restore_from {source}",
            "restored_from": source,
            "status": "running",
            "sealed": False,
            "candidate_release": False,
            # The copy has produced nothing of its own yet. Carrying the source's
            # digests forward would have it vouch for content it has not sealed.
            "artifact_digests": {},
            "content_digest": None,
            "validator_results": {},
        }
    )
    yamlio.dump_path(target / "revision.yaml", meta)
    print(f"{new_id}  (copy of {source}, parent {parent}) — 运行 seal 让 validators 判定它")
    return 0


def semantic_diff(paths: Paths, before: str, after: str) -> dict:
    old = declarations(candidate_of(paths, before))
    new = declarations(candidate_of(paths, after))
    added, removed, changed, unaffected = [], [], [], []

    for identifier in sorted(set(new) - set(old)):
        item = new[identifier]
        added.append({"object_id": identifier, "kind": item["_kind"], "view_label": item.get("view_label")})
    for identifier in sorted(set(old) - set(new)):
        item = old[identifier]
        removed.append(
            {
                "object_id": identifier,
                "kind": item["_kind"],
                "view_label": item.get("view_label"),
                "replaced_by": None,
                "removal_rationale": None,
            }
        )
    for identifier in sorted(set(old) & set(new)):
        if trace_index._canonical(old[identifier]) == trace_index._canonical(new[identifier]):
            unaffected.append(identifier)
        else:
            changed.append(
                {
                    "object_id": identifier,
                    "kind": new[identifier]["_kind"],
                    "fields": _changed_fields(old[identifier], new[identifier]),
                    "authorization_impacting": _authorization_impacting(old[identifier], new[identifier]),
                }
            )

    return {
        "from_revision": before,
        "to_revision": after,
        "generated_at": now(),
        "summary": {
            "added": len(added), "removed": len(removed),
            "changed": len(changed), "unaffected": len(unaffected),
        },
        "added": added,
        "removed": removed,
        "changed": changed,
        "unaffected": unaffected,
    }


def _changed_fields(before: dict, after: dict) -> list[str]:
    keys = (set(before) | set(after)) - {"_kind"}
    return sorted(key for key in keys if before.get(key) != after.get(key))


def _authorization_impacting(before: dict, after: dict) -> bool:
    """Changes that can move what a scope exposes. 流程 §10.2, §12.3-5."""
    watched = ("classification", "owner", "source", "target", "cardinality", "datatype")
    return any(before.get(key) != after.get(key) for key in watched)


def cmd_diff(args) -> int:
    workspace = resolve(args.workspace)
    paths = Paths(workspace)
    before, after = args.before, args.after
    for revision in (before, after):
        if not paths.revision(revision).is_dir():
            print(f"没有 revision {revision}", file=sys.stderr)
            return 2
    result = semantic_diff(paths, before, after)
    target = paths.revision(after) / "semantic-diff.yaml"
    if (_load(paths.revision(after) / "revision.yaml") or {}).get("sealed") and not args.stdout:
        print(f"{after} 已封存，diff 只打印不写入。", file=sys.stderr)
        args.stdout = True
    if args.stdout:
        print(yamlio.dump(result))
    else:
        yamlio.dump_path(target, result)
        summary = result["summary"]
        print(
            f"{target.relative_to(workspace)}  新增 {summary['added']} · 删除 {summary['removed']} · "
            f"变更 {summary['changed']} · 未受影响 {summary['unaffected']}"
        )
        if summary["removed"]:
            print("删除项还需要填 replaced_by 或 removal_rationale，否则 diff_removals_explained 不通过。")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="revision.py", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)

    new = sub.add_parser("new", help="开一个新的 revision 目录")
    new.add_argument("workspace")
    new.add_argument("--reason", required=True)
    new.add_argument("--parent")
    new.add_argument("--no-parent", action="store_true")
    new.add_argument("--change", action="append")
    new.add_argument("--by")
    new.set_defaults(func=cmd_new)

    seal = sub.add_parser("seal", help="跑门检查并封存；通过才成为 HEAD")
    seal.add_argument("workspace")
    seal.add_argument("revision", nargs="?")
    seal.add_argument("--force", action="store_true", help="产物不全也封存（用于诊断失败的 run）")
    seal.set_defaults(func=cmd_seal)

    head = sub.add_parser("head", help="读或写 HEAD")
    head.add_argument("workspace")
    head.add_argument("revision", nargs="?")
    head.set_defaults(func=cmd_head)

    restore = sub.add_parser("restore", help="把某个 revision 复制成新的 HEAD 候选")
    restore.add_argument("workspace")
    restore.add_argument("revision")
    restore.add_argument("--by")
    restore.set_defaults(func=cmd_restore)

    diff = sub.add_parser("diff", help="两个 revision 之间的语义差异")
    diff.add_argument("workspace")
    diff.add_argument("before")
    diff.add_argument("after")
    diff.add_argument("--stdout", action="store_true")
    diff.set_defaults(func=cmd_diff)

    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
