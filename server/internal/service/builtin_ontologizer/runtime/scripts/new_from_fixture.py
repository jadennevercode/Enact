#!/usr/bin/env python3
"""Create a workspace pre-loaded with a fixture's input material.

Used by the eval loop: every test prompt needs the same starting point, and
building it by hand each time is both slow and a source of quiet differences
between runs.

    python3 scripts/new_from_fixture.py /tmp/jr-run-1
    python3 scripts/new_from_fixture.py /tmp/jr-run-1 --fixture journal-reversal

It stops at the input material on purpose. Nothing in `define/`, `revisions/` or
`releases/` is created — producing those is the work being evaluated.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import state as state_mod  # noqa: E402

FIXTURES = ROOT / "evals" / "fixtures"
DEFAULTS = {
    "journal-reversal": {
        "slug": "journal-reversal",
        "domain": "总账 · 日记账冲销",
        "goal": "支持财务助手回答一条分录能不能冲销、该谁批、按什么顺序做",
    }
}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("directory")
    parser.add_argument("--fixture", default="journal-reversal")
    parser.add_argument("--slug")
    args = parser.parse_args(argv)

    source = FIXTURES / args.fixture
    if not source.is_dir():
        available = ", ".join(sorted(p.name for p in FIXTURES.iterdir() if p.is_dir()))
        print(f"没有这个 fixture：{args.fixture}。现有：{available}", file=sys.stderr)
        return 2

    defaults = DEFAULTS.get(args.fixture, {"slug": args.fixture, "domain": args.fixture, "goal": args.fixture})
    target = Path(args.directory).expanduser().resolve()
    code = state_mod.main(
        [
            "init", str(target),
            "--slug", args.slug or defaults["slug"],
            "--goal", defaults["goal"],
            "--domain", defaults["domain"],
            "--model", "eval-run",
        ]
    )
    if code != 0:
        return code

    copied = 0
    for kind in ("charter", "evidence", "competency-questions"):
        origin = source / kind
        if not origin.is_dir():
            continue
        for path in sorted(origin.rglob("*")):
            if path.is_file():
                destination = target / "inputs" / kind / path.relative_to(origin)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, destination)
                copied += 1

    print(f"\n复制了 {copied} 份材料到 inputs/。")
    readme = source / "README.md"
    if readme.is_file():
        print(f"这份 fixture 里有故意留下的缺陷，见 {readme.relative_to(ROOT)}。")
    print("下一步：initiate 写项目章程。define/ 和 revisions/ 是空的，那正是要被评测的部分。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
