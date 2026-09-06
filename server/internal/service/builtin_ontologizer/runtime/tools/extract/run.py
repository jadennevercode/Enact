"""CLI for native extraction.

    python3 -m tools.extract.run inputs/evidence/process-general-ledger-ch6.md
    python3 -m tools.extract.run inputs/evidence/journal-entries-sample.csv --max-rows 6
    python3 -m tools.extract.run --verify file.md "6.3" "经财务控制批准后仍可冲销"

Prints YAML you can paste into an evidence manifest. The anchors come from the
file, not from a summary of it, which is the only way `no_inference_as_fact` means
anything later.
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

from . import native  # noqa: E402


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="tools.extract.run")
    parser.add_argument("path")
    parser.add_argument("--max-rows", type=int, default=20)
    parser.add_argument("--verify", nargs=2, metavar=("LOCATION", "SNIPPET"),
                        help="确认某个锚点确实在文件里")
    args = parser.parse_args(argv)

    path = Path(args.path)
    if not path.is_file():
        print(f"没有这个文件：{path}", file=sys.stderr)
        return 2

    if args.verify:
        location, snippet = args.verify
        found = native.verify(path, location, snippet)
        print("在" if found else "不在")
        if not found:
            print("原文里找不到这段。不要把它登记成 fact——要么改成原文的说法，"
                  "要么把它记成 assumption 并写明理由。", file=sys.stderr)
        return 0 if found else 1

    payload = native.anchors_for(path, max_rows=args.max_rows)
    payload["source_path"] = str(path)
    print(yamlio.dump(payload))
    count = len(payload.get("anchors") or [])
    print(f"# {count} 个锚点，抽取路径 {payload['extraction_path']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
