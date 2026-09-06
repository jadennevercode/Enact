#!/usr/bin/env python3
"""Assemble the team-level trigger eval sets.

Ten skill descriptions compete in one `available_skills` list, so the interesting
failure is not "did it fire" but "did the wrong sibling fire". The negatives that
matter are therefore the siblings' own positives: "审一下这版" must reach `review`
and not `revise`; "这个关系哪来的" must reach `trace` and not `review`.

This builds, for each skill, an eval set in the shape skill-creator's
`scripts/run_loop.py` expects:

    [{"query": "...", "should_trigger": true}, ...]

    python3 scripts/build_trigger_set.py                 # write evals/trigger/
    python3 scripts/build_trigger_set.py --skill review  # just one
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"
OUTPUT = ROOT / "evals" / "trigger"

# Prompts that should reach no skill in this package at all. Near-misses on
# purpose: each shares vocabulary with the pack but wants something else.
OUT_OF_PACK = [
    "帮我把这张 ER 图导成 PlantUML，我要贴进周报里",
    "Neo4j 里这条 Cypher 为什么慢，能不能加个索引",
    "写个 python 脚本把这个 csv 按 period 分组求和",
    "我们数据仓库的 dim_customer 表该加哪些字段",
    "解释一下 OWL 和 SHACL 的区别，我在准备一个内部分享",
    "把这份产品需求文档翻译成英文",
    "帮我 review 一下这个 PR 的代码质量，主要看有没有 SQL 注入",
    "给这个 FastAPI 服务加一个 /healthz 端点",
]


def load_prompts() -> dict[str, list[str]]:
    prompts: dict[str, list[str]] = {}
    for directory in sorted(SKILLS.iterdir()):
        evals = directory / "evals" / "evals.json"
        if not evals.is_file():
            continue
        try:
            payload = json.loads(evals.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"{evals} 不是合法 JSON：{exc}")
        prompts[directory.name] = [item["prompt"] for item in payload.get("evals", [])]
    return prompts


def build(skill: str, prompts: dict[str, list[str]], seed: int = 7) -> list[dict]:
    rng = random.Random(seed)
    positives = [{"query": text, "should_trigger": True} for text in prompts.get(skill, [])]

    siblings = [
        (name, text)
        for name, items in prompts.items()
        if name != skill
        for text in items
    ]
    rng.shuffle(siblings)
    wanted = max(len(positives), 8)
    negatives = [
        {"query": text, "should_trigger": False, "belongs_to": name}
        for name, text in siblings[:wanted]
    ]
    negatives += [
        {"query": text, "should_trigger": False, "belongs_to": "out_of_pack"}
        for text in OUT_OF_PACK[: max(0, wanted - len(negatives)) + 2]
    ]
    return positives + negatives


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skill", help="只生成这一个")
    parser.add_argument("--out", default=str(OUTPUT))
    args = parser.parse_args()

    prompts = load_prompts()
    if not prompts:
        raise SystemExit("skills/*/evals/evals.json 一个都没有")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    targets = [args.skill] if args.skill else sorted(prompts)
    for skill in targets:
        if skill not in prompts:
            raise SystemExit(f"没有 skills/{skill}/evals/evals.json")
        items = build(skill, prompts)
        path = out_dir / f"{skill}.json"
        path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        positives = sum(1 for item in items if item["should_trigger"])
        print(f"{path.relative_to(ROOT)}  应触发 {positives} · 不应触发 {len(items) - positives}")

    print()
    print("接下来（skill-creator 的触发优化，一个 skill 一次）：")
    print("  cd ~/.claude/skills/skill-creator && python -m scripts.run_loop \\")
    print(f"    --eval-set {out_dir}/<skill>.json \\")
    print(f"    --skill-path {SKILLS}/<skill> --model claude-opus-5 --max-iterations 5 --verbose")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
