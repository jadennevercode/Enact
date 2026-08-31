#!/usr/bin/env python3
"""Create the .sdlc/ skeleton in a project. Idempotent.

Usage:
    python3 sdlc_init.py [project_root]
"""

import argparse
import datetime
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _common import emit, load_yaml, missing_approver_roles  # noqa: E402

TEMPLATES = Path(__file__).resolve().parent.parent / "templates"


def main():
    parser = argparse.ArgumentParser(description="Initialize .sdlc/ in a project")
    parser.add_argument("root", nargs="?", default=".", help="项目根目录（默认当前目录）")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        emit({"ok": False, "error": f"目录不存在：{root}"}, exit_code=2)

    sdlc = root / ".sdlc"
    created, existing = [], []

    for sub in ("", "work-items", "incidents", "lessons"):
        d = sdlc / sub if sub else sdlc
        if d.exists():
            existing.append(str(d.relative_to(root)))
        else:
            d.mkdir(parents=True)
            created.append(str(d.relative_to(root)))

    config = sdlc / "config.yaml"
    if config.exists():
        existing.append(".sdlc/config.yaml")
    else:
        shutil.copy(TEMPLATES / "config.yaml", config)
        created.append(".sdlc/config.yaml")

    current = sdlc / "current.yaml"
    if current.exists():
        existing.append(".sdlc/current.yaml")
    else:
        today = datetime.date.today().isoformat()
        current.write_text(
            "# 当前活跃的 Work Item。与 git 分支解耦——切分支不改变这里指向什么。\n"
            f"work_item: null\nupdated: {today}\n",
            encoding="utf-8",
        )
        created.append(".sdlc/current.yaml")

    cfg = load_yaml(config, required=False) or {}
    empty_roles = missing_approver_roles(cfg)

    next_steps = []
    if empty_roles:
        next_steps.append(
            f"在 .sdlc/config.yaml 的 roles 下填入真实的人（还空着：{', '.join(empty_roles)}）。"
            "Gate 按角色要求签署，没有人担这个角色就签不下去。一个人可以担多个角色。"
        )
    next_steps.append("填写 .sdlc/config.yaml 的 commands（lint/test/build），避免每次重新探测。")
    next_steps.append("用 new_work_item.py 建第一个 Work Item。")

    emit(
        {
            "ok": True,
            "sdlc_root": str(sdlc),
            "created": created,
            "already_present": existing,
            "next_steps": next_steps,
        }
    )


if __name__ == "__main__":
    main()
