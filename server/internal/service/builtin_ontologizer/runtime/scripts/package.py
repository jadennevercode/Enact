#!/usr/bin/env python3
"""Render a candidate release into an installable Skill package.

    package.py <ws>                       # render the candidate release
    package.py <ws> --revision r0003      # render a specific revision (preview)
    package.py <ws> --plugin              # also emit plugin/marketplace manifests
    package.py <ws> --check               # is what is on disk still what renders?

The output lands in `exports/skill-package/<slug>/`. Copy that directory into
`~/.claude/skills/` to use it, or install it as a plugin when rendered with
`--plugin`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
for _extra in (_ROOT, _ROOT / "shared" / "lib"):
    if str(_extra) not in sys.path:
        sys.path.insert(0, str(_extra))

import yamlio  # noqa: E402
from paths import Paths, resolve  # noqa: E402

from tools.package import render as renderer  # noqa: E402


def candidate_revision(paths: Paths) -> str | None:
    for revision in reversed(paths.revision_ids()):
        meta = renderer._load(paths.revision(revision) / "revision.yaml") or {}
        if meta.get("candidate_release"):
            return revision
    return None


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="package.py")
    parser.add_argument("workspace")
    parser.add_argument("--revision", help="默认用被选为 candidate release 的那一版")
    parser.add_argument("--plugin", action="store_true", help="额外写 plugin/marketplace 清单")
    parser.add_argument("--check", action="store_true", help="只比对，不写")
    args = parser.parse_args(argv)

    workspace = resolve(args.workspace)
    paths = Paths(workspace)
    revision = args.revision or candidate_revision(paths)
    if not revision:
        print(
            "没有被选为 candidate release 的版本。先用 revise 的 candidate_selection 选一个，"
            "或者用 --revision 指定一版做预览。",
            file=sys.stderr,
        )
        return 2
    if not paths.revision(revision).is_dir():
        print(f"没有 revision {revision}", file=sys.stderr)
        return 2

    meta = renderer._load(paths.revision(revision) / "revision.yaml") or {}
    if not meta.get("sealed"):
        print(f"{revision} 还没封存。没封存的版本会变，打出来的包会跟它对不上。", file=sys.stderr)
        return 2

    data = renderer.gather(workspace, revision)
    slug = renderer.slug_of(data)
    rendered = renderer.files(data)
    directory = renderer.target_dir(workspace, slug)

    if args.check:
        if not directory.is_dir():
            print(f"{directory.relative_to(workspace)} 还没生成", file=sys.stderr)
            return 1
        drift = []
        for relative, content in sorted(rendered.items()):
            path = directory / relative
            if not path.is_file():
                drift.append(f"{relative} 缺失")
            elif path.read_text(encoding="utf-8") != content:
                drift.append(f"{relative} 与 {revision} 重新渲染的结果不一致")
        for path in sorted(directory.rglob("*")):
            if path.is_file():
                relative = path.relative_to(directory).as_posix()
                if relative not in rendered and not relative.startswith(".claude-plugin/"):
                    drift.append(f"{relative} 是渲染不出来的，手改过？")
        for item in drift:
            print(f"!! {item}", file=sys.stderr)
        if drift:
            print("重新跑一次 package.py 覆盖它。包是渲染出来的，不是手写的。", file=sys.stderr)
            return 1
        print(f"{directory.relative_to(workspace)} 与 {revision} 一致")
        return 0

    directory, rendered = renderer.write(workspace, revision, plugin=args.plugin)
    unknowns = renderer.open_questions(data)
    print(f"{directory.relative_to(workspace)}")
    print(f"  来自 {revision}" + (f" · release {data['release']}" if data["release"] else ""))
    print(f"  {len(rendered)} 个文件 · 摘要 {renderer.package_digest(rendered)[:19]}…")
    counts = yamlio.load(rendered["package.yaml"])["counts"]
    print("  " + " · ".join(f"{renderer.KIND_TITLES.get(k, k)} {v}" for k, v in sorted(counts.items())))
    print(f"  声明了 {len(unknowns)} 处未决，写在 references/boundaries.md")
    print()
    print("装它：")
    print(f"  cp -r {directory} ~/.claude/skills/")
    if args.plugin:
        print(f"  或 claude plugin marketplace add {directory} && claude plugin install {directory.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
