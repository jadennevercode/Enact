#!/usr/bin/env python3
"""Allocate a Work Item id, create its directory, instantiate templates.

Numbering and directory layout are mechanical work -- doing them by hand is how
you end up with duplicate ids and half-populated directories.

Usage:
    python3 new_work_item.py <project_root> "<objective>" --owner 张三 [--lane full|quick]
"""

import argparse
import datetime
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _common import emit, sdlc_root  # noqa: E402

TEMPLATES = Path(__file__).resolve().parent.parent / "templates"

# Files every work item starts with. The rest (contract, test-plan, ...) are
# created by the phase that owns them, so an empty file never looks like a
# finished-but-blank deliverable.
INITIAL_FILES = [("work-item.yaml", "work-item.yaml")]


# A CJK sentence has no spaces, so max_words never bites and the whole objective
# ends up in the directory name. Budget in display columns instead. 40 is the same
# number the old character cap used, so ASCII slugs are unchanged; wide glyphs cost
# two columns each, which is what actually shortens a CJK name.
#
# This is a fallback, not the intended path -- intake passes --slug. Truncating a
# sentence always cuts mid-phrase; a human-chosen short name never does.
SLUG_COLUMNS = 40


def _columns(s):
    return sum(2 if ord(c) > 0x2E7F else 1 for c in s)


def slugify(text, max_words=5):
    cleaned = re.sub(r"[^\w一-鿿\s-]", " ", text.lower())
    words = [w for w in re.split(r"[\s_-]+", cleaned) if w][:max_words]
    slug = "-".join(words).strip("-")

    if _columns(slug) > SLUG_COLUMNS:
        out, used = [], 0
        for ch in slug:
            w = _columns(ch)
            if used + w > SLUG_COLUMNS:
                break
            out.append(ch)
            used += w
        slug = "".join(out).strip("-")
    return slug or "work-item"


def next_id(items_dir):
    highest = 0
    for d in items_dir.iterdir():
        if d.is_dir():
            m = re.match(r"WI-(\d+)", d.name)
            if m:
                highest = max(highest, int(m.group(1)))
    return highest + 1


def main():
    parser = argparse.ArgumentParser(description="Create a new Work Item")
    parser.add_argument("root", help="项目根目录")
    parser.add_argument("objective", help="要改变什么结果（一到两句）")
    parser.add_argument("--owner", required=True, help="具名责任人")
    parser.add_argument("--lane", default="full", choices=["full", "quick"])
    parser.add_argument("--slug", default=None, help="自定义目录短名")
    args = parser.parse_args()

    root = sdlc_root(args.root)
    items_dir = root / "work-items"
    items_dir.mkdir(exist_ok=True)

    number = next_id(items_dir)
    wid = f"WI-{number:03d}"
    slug = args.slug or slugify(args.objective)
    wi_dir = items_dir / f"{wid}-{slug}"

    if wi_dir.exists():
        emit({"ok": False, "error": f"目录已存在：{wi_dir}"}, exit_code=2)

    wi_dir.mkdir(parents=True)
    (wi_dir / "gates").mkdir()
    (wi_dir / "amendments").mkdir()
    (wi_dir / "evidence.jsonl").touch()

    for template_name, out_name in INITIAL_FILES:
        shutil.copy(TEMPLATES / template_name, wi_dir / out_name)

    today = datetime.date.today().isoformat()
    wi_path = wi_dir / "work-item.yaml"
    text = wi_path.read_text(encoding="utf-8")
    text = text.replace("id: WI-000", f"id: {wid}")
    text = text.replace("slug: short-kebab-name", f"slug: {slug}")
    text = text.replace("created: 2026-01-01", f"created: {today}")
    text = text.replace("updated: 2026-01-01", f"updated: {today}")
    text = text.replace('objective: ""', f'objective: "{args.objective}"')
    text = text.replace('owner: ""', f'owner: "{args.owner}"')
    text = text.replace("lane: full", f"lane: {args.lane}")
    wi_path.write_text(text, encoding="utf-8")

    (root / "current.yaml").write_text(
        "# 当前活跃的 Work Item。与 git 分支解耦。\n"
        f"work_item: {wi_dir.name}\nupdated: {today}\n",
        encoding="utf-8",
    )

    emit(
        {
            "ok": True,
            "work_item": wid,
            "directory": str(wi_dir),
            "lane": args.lane,
            "owner": args.owner,
            "status": "Proposed",
            "next_step": (
                "quick lane：直接进 sdlc-contract。"
                if args.lane == "quick"
                else "full lane：进 sdlc-explore 做维度覆盖。"
            ),
        }
    )


if __name__ == "__main__":
    main()
