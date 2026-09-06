"""CLI for Cypher generation and static checking.

    python3 <pkg>/tools/cypher/run.py <ws> r0002              # write candidate.cypher
    python3 <pkg>/tools/cypher/run.py <ws> r0002 --check      # check only, write nothing
    python3 <pkg>/tools/cypher/run.py <ws> r0002 --stdout

Exists so the generate pipeline has a command rather than a heredoc: a stage that
people retype by hand is a stage that drifts.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
for _extra in (_ROOT, _ROOT / "shared" / "lib"):
    if str(_extra) not in sys.path:
        sys.path.insert(0, str(_extra))

import yamlio  # noqa: E402
import digest as digest_lib  # noqa: E402
from paths import Paths, resolve  # noqa: E402

from tools.cypher.generate import render  # noqa: E402
from tools.cypher.static_check import check as static_check  # noqa: E402
from tools.trace.index import _declarations  # noqa: E402


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="cypher")
    parser.add_argument("workspace")
    parser.add_argument("revision", nargs="?")
    parser.add_argument("--check", action="store_true", help="只做静态检查，不写文件")
    parser.add_argument("--stdout", action="store_true", help="打印而不写文件")
    args = parser.parse_args(argv)

    workspace = resolve(args.workspace)
    paths = Paths(workspace)
    revision = args.revision or (
        paths.head_file.read_text(encoding="utf-8").strip() if paths.head_file.is_file() else None
    )
    if not revision or not paths.revision(revision).is_dir():
        print(f"没有 revision {revision!r}", file=sys.stderr)
        return 2

    directory = paths.revision(revision)
    candidate_path = directory / "candidate.yaml"
    if not candidate_path.is_file():
        print("candidate.yaml 不存在——先把候选设计写出来", file=sys.stderr)
        return 2
    document = yamlio.load_path(candidate_path)
    bundle = document.get("bundle", document) or {}

    meta = yamlio.load_path(directory / "revision.yaml") if (directory / "revision.yaml").is_file() else {}
    inputs_digest = (meta or {}).get("inputs", {}).get("evidence_snapshot") or ""

    target = directory / "candidate.cypher"
    if args.check:
        if not target.is_file():
            print("candidate.cypher 不存在", file=sys.stderr)
            return 1
        script = target.read_text(encoding="utf-8")
    else:
        script = render(bundle, revision, inputs_digest)

    known = set(_declarations(bundle))
    domain = bundle.get("domain") or {}
    if isinstance(domain, dict) and domain.get("id"):
        known.add(domain["id"])
    problems = static_check(script, known)

    if problems:
        for problem in problems:
            print(f"!! {problem}", file=sys.stderr)
        return 1

    if args.stdout:
        print(script)
    elif not args.check:
        if (meta or {}).get("sealed"):
            print(f"{revision} 已封存，不写入。要改就开新 revision。", file=sys.stderr)
            return 2
        target.write_text(script, encoding="utf-8")
        print(f"{target.relative_to(workspace)}  {len(known)} 个声明 · {digest_lib.text_digest(script)[:19]}…")
    else:
        print(f"静态检查通过，{len(known)} 个声明")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
