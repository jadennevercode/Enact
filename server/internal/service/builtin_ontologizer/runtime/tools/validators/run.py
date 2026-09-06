"""CLI for the validators.

    python3 -m tools.validators.run <workspace> --stage generate --revision r0001
    python3 -m tools.validators.run <workspace> --gate ready_for_review --revision r0002 --write
    python3 -m tools.validators.run <workspace> --all

Exit code is 0 only when every blocking check passed. Warnings never change the
exit code — they are for a human to acknowledge, not for a script to swallow.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from tools import validators  # noqa: E402
from tools.validators.base import Context  # noqa: E402

SYMBOL = {"pass": "PASS", "fail": "FAIL", "skipped": "SKIP"}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="validators", description="Run deterministic checks.")
    parser.add_argument("workspace")
    parser.add_argument("--revision", help="revision id; defaults to HEAD when a revision check needs one")
    parser.add_argument("--release", help="release id, for submission checks")
    parser.add_argument("--stage", help="run the checks a stage declares")
    parser.add_argument("--gate", help="run the checks a gate requires")
    parser.add_argument("--check", action="append", dest="checks", help="run one named check (repeatable)")
    parser.add_argument("--all", action="store_true", help="run everything the registry knows")
    parser.add_argument("--json", help="write the full result payload here")
    parser.add_argument("--write", action="store_true", help="also write revisions/<rev>/validation/*.json")
    parser.add_argument("--quiet", action="store_true")
    return parser


def select(ctx: Context, args) -> list[str]:
    if args.checks:
        return args.checks
    if args.gate:
        return validators.gate_checks(ctx, args.gate)
    if args.stage:
        return validators.stage_checks(ctx, args.stage)
    if args.all:
        return sorted(validators.REGISTRY)
    return validators.gate_checks(ctx, "ready_for_review")


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    workspace = Path(args.workspace).expanduser().resolve()
    ctx = Context(workspace, revision=args.revision, release=args.release)
    if ctx.revision is None:
        ctx.revision = ctx.head()
    if ctx.release is None:
        releases = ctx.paths.release_ids()
        ctx.release = releases[-1] if releases else None

    check_ids = select(ctx, args)
    results = validators.run_checks(ctx, check_ids)

    blocking_failures = [r for r in results if not r.passed and r.level == "blocking"]
    warnings = [r for r in results if not r.passed and r.level == "warning"]

    if not args.quiet:
        for result in results:
            payload = result.as_dict()
            head = f"{SYMBOL[payload['outcome']]:4}  {result.check_id}"
            if payload["outcome"] == "skipped":
                print(f"{head}  ({result.skipped})")
                continue
            if result.passed:
                print(f"{head}  ({result.counted} 项)")
                continue
            marker = "!!" if result.level == "blocking" else "!"
            print(f"{head}  [{result.level}]")
            for finding in result.findings[:12]:
                print(f"      {marker} {finding}")
            if len(result.findings) > 12:
                print(f"      … 另有 {len(result.findings) - 12} 条")
        print()
        print(
            f"blocking 失败 {len(blocking_failures)} 项；warning {len(warnings)} 项；"
            f"共运行 {len(results)} 项检查"
            + (f"（revision {ctx.revision}）" if ctx.revision else "")
        )

    payload = {
        "workspace": str(workspace),
        "revision": ctx.revision,
        "release": ctx.release,
        "selected": check_ids,
        "blocking_failures": [r.check_id for r in blocking_failures],
        "warnings": [r.check_id for r in warnings],
        "results": [r.as_dict() for r in results],
    }
    if args.json:
        Path(args.json).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.write and ctx.revision:
        folder = ctx.paths.validation_dir(ctx.revision)
        folder.mkdir(parents=True, exist_ok=True)
        for result in results:
            (folder / f"{result.check_id}.json").write_text(
                json.dumps(result.as_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
            )

    return 1 if blocking_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
