#!/usr/bin/env python3
"""Static checks on this package itself.

Everything here is about internal agreement: the manifests, the validator
registry, and the ten SKILL.md files all describe the same process, and a link
from one to another points at something that exists. A package whose own
cross-references rot will quietly teach a skill to look for a file that is not
there, and the skill will improvise instead.

    python3 scripts/check_suite.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "shared" / "lib"))

import yamlio  # noqa: E402

SKILL_LINE_LIMIT = 200
PROBLEMS: list[str] = []
CHECKED = 0

LINK_PATTERN = re.compile(r"`([A-Za-z0-9_./-]+\.(?:md|yaml|py|cypher))`")
FRONTMATTER = re.compile(r"^---\n(.*?)\n---\n", re.S)


def problem(text: str) -> None:
    PROBLEMS.append(text)


def note(condition: bool, text: str) -> None:
    global CHECKED
    CHECKED += 1
    if not condition:
        problem(text)


def check_manifests() -> None:
    checks = yamlio.load_path(ROOT / "shared/manifests/checks.yaml")["checks"]
    stages = yamlio.load_path(ROOT / "shared/manifests/stages.yaml")
    points = yamlio.load_path(ROOT / "shared/manifests/decision-points.yaml")

    ids = [item["id"] for item in checks]
    note(len(ids) == len(set(ids)), "checks.yaml 里有重复的 check id")
    for item in checks:
        for field in ("level", "scope", "title", "asserts", "on_failure", "source"):
            note(bool(item.get(field)), f"check {item['id']} 缺少 {field}")
        note(item["level"] in ("blocking", "warning"), f"check {item['id']} 的 level 非法")

    from tools import validators

    implemented = set(validators.REGISTRY)
    declared = set(ids)
    for missing in sorted(declared - implemented):
        problem(f"checks.yaml 声明了 {missing}，但 tools/validators 没有实现")
    for extra in sorted(implemented - declared):
        problem(f"tools/validators 实现了 {extra}，但 checks.yaml 没有声明")

    stage_ids = {item["id"] for item in stages["stages"]}
    note(stages["pipeline"] == [item["id"] for item in stages["stages"]],
         "stages.yaml 的 pipeline 与 stages 顺序不一致")
    for stage in stages["stages"] + stages["cross_cutting"]:
        for check_id in stage.get("checks") or []:
            note(check_id in declared, f"stage {stage['id']} 引用了不存在的检查 {check_id}")
        for point_id in stage.get("decision_points") or []:
            note(
                point_id in {item["id"] for item in points["points"]},
                f"stage {stage['id']} 引用了不存在的决策点 {point_id}",
            )
        gate = stage.get("machine_gate")
        note(gate is None or gate in stages["gates"], f"stage {stage['id']} 引用了不存在的门 {gate}")

    for gate_id, gate in stages["gates"].items():
        for check_id in gate.get("requires_checks") or []:
            note(check_id in declared, f"门 {gate_id} 引用了不存在的检查 {check_id}")
        for point_id in gate.get("requires_decisions") or []:
            note(
                point_id in {item["id"] for item in points["points"]},
                f"门 {gate_id} 引用了不存在的决策点 {point_id}",
            )

    mandatory = [item for item in points["points"] if item.get("mandatory")]
    note(len(mandatory) == 1 and mandatory[0]["id"] == "create_pull_request",
         "唯一的强制人工批准点应当是 create_pull_request")
    for point in points["points"]:
        for verdict in point.get("closing") or []:
            note(verdict in point["verdicts"], f"决策点 {point['id']} 的 closing 不在 verdicts 中")
        for check_id in point.get("requires_checks") or []:
            note(check_id in declared, f"决策点 {point['id']} 引用了不存在的检查 {check_id}")
        for gate_id in point.get("requires_gates") or []:
            note(gate_id in stages["gates"], f"决策点 {point['id']} 引用了不存在的门 {gate_id}")

    # every stage names a skill, and every skill directory answers to a stage
    named = {stage.get("skill") for stage in stages["stages"] + stages["cross_cutting"]}
    on_disk = {path.name for path in (ROOT / "skills").iterdir() if path.is_dir()}
    for missing in sorted(named - on_disk):
        problem(f"stages.yaml 指名 skill {missing}，但 skills/{missing} 不存在")
    for extra in sorted(on_disk - named):
        problem(f"skills/{extra} 存在，但没有任何 stage 指名它")


def check_skills() -> None:
    for directory in sorted((ROOT / "skills").iterdir()):
        if not directory.is_dir():
            continue
        skill_file = directory / "SKILL.md"
        if not skill_file.is_file():
            problem(f"skills/{directory.name} 没有 SKILL.md")
            continue
        text = skill_file.read_text(encoding="utf-8")
        lines = text.splitlines()
        note(len(lines) <= SKILL_LINE_LIMIT,
             f"{directory.name}/SKILL.md 有 {len(lines)} 行，超过 {SKILL_LINE_LIMIT} 行上限——细节应下沉到 references/")

        match = FRONTMATTER.match(text)
        if not match:
            problem(f"{directory.name}/SKILL.md 没有 YAML frontmatter")
            continue
        meta = yamlio.load(match.group(1)) or {}
        note(meta.get("name") == directory.name,
             f"{directory.name}/SKILL.md 的 name 是 {meta.get('name')!r}，与目录名不一致")
        description = meta.get("description") or ""
        note(len(description) >= 60, f"{directory.name} 的 description 太短，触发会不准")
        note("\n" not in description.strip(), f"{directory.name} 的 description 应是一段连续文字")

        for link in set(LINK_PATTERN.findall(text)):
            if link.startswith(("references/", "templates/", "scripts/")):
                target = directory / link
            elif link.startswith(("shared/", "knowledge/", "tools/", "evals/")):
                target = ROOT / link
            else:
                continue
            note(target.exists(), f"{directory.name}/SKILL.md 指向不存在的 {link}")

        evals = directory / "evals" / "evals.json"
        note(evals.is_file(), f"{directory.name} 缺少 evals/evals.json")


YAML_FENCE = re.compile(r"```ya?ml\n(.*?)```", re.S)


def check_examples() -> None:
    """Every YAML example must parse.

    A skill that copies a snippet out of the knowledge base or a template gets
    exactly what is written there. A fence that only looks like YAML is a trap
    laid for whoever trusts it.
    """
    for path in sorted(ROOT.glob("knowledge/**/*.md")) + sorted(ROOT.glob("shared/**/*.md")) + \
            sorted(ROOT.glob("skills/*/SKILL.md")) + sorted(ROOT.glob("skills/*/references/*.md")):
        for index, block in enumerate(YAML_FENCE.findall(path.read_text(encoding="utf-8"))):
            global CHECKED
            CHECKED += 1
            try:
                yamlio.load(block)
            except Exception as exc:
                problem(
                    f"{path.relative_to(ROOT)} 第 {index + 1} 个 yaml 代码块无法解析："
                    f"{str(exc).splitlines()[0]}"
                )

    for path in sorted(ROOT.glob("skills/*/templates/*.yaml")):
        CHECKED += 1
        try:
            yamlio.load_path(path)
        except Exception as exc:
            problem(f"{path.relative_to(ROOT)} 无法解析：{str(exc).splitlines()[0]}")


SUBCOMMANDS = {
    "scripts/state.py": {"init", "status", "list", "decide", "audit", "problems", "points"},
    "scripts/revision.py": {"new", "seal", "head", "restore", "diff"},
    "scripts/validate.py": set(),
    "scripts/selftest.py": set(),
    "scripts/check_suite.py": set(),
    "scripts/doctor.py": set(),
    "scripts/build_trigger_set.py": set(),
    "scripts/new_from_fixture.py": set(),
    "scripts/package.py": set(),
    "-m tools.extract.run": set(),
    "tools/cypher/run.py": set(),
    "tools/extract/run.py": set(),
}
COMMAND = re.compile(
    r"python3\s+(?:<pkg>/|\$\{?PKG\}?/)?"
    r"(scripts/\w+\.py|tools/\w+/run\.py|-m tools\.\w+\.\w+)\s*([a-z][a-z\-]*)?"
)


def check_commands() -> None:
    """Every command a skill prints must exist.

    A skill that documents a subcommand the script does not have will improvise
    when it fails — and improvising around a missing gate is exactly what the
    gates are there to prevent.
    """
    for path in sorted(ROOT.glob("skills/**/*.md")) + sorted(ROOT.glob("shared/**/*.md")) + [ROOT / "README.md"]:
        if not path.is_file():
            continue
        for script, sub in COMMAND.findall(path.read_text(encoding="utf-8")):
            note(script in SUBCOMMANDS, f"{path.relative_to(ROOT)} 引用了未知脚本 {script}")
            allowed = SUBCOMMANDS.get(script)
            if allowed and sub and not sub.startswith("-"):
                note(
                    sub in allowed,
                    f"{path.relative_to(ROOT)}：{script} 没有 {sub} 这个子命令"
                    f"（合法：{', '.join(sorted(allowed))}）",
                )


def check_docs() -> None:
    for name in (
        "conventions.md", "decision-points.md", "four-layers.md",
        "traceability.md", "revision-model.md", "roles.md",
    ):
        note((ROOT / "shared" / name).is_file(), f"shared/{name} 缺失")
    for name in (
        "discovery-heuristics.md", "modeling-rules.md", "ontology-components.md",
        "anti-patterns.md", "boundaries.md", "quality-dimensions.md",
        "cq-writing-rules.md", "glossary.md",
    ):
        note((ROOT / "knowledge" / name).is_file(), f"knowledge/{name} 缺失")
    note((ROOT / ".claude-plugin" / "plugin.json").is_file(), "缺少 .claude-plugin/plugin.json")
    note((ROOT / "README.md").is_file(), "缺少 README.md")


def main() -> int:
    check_manifests()
    check_skills()
    check_examples()
    check_commands()
    check_docs()
    if PROBLEMS:
        print(f"check_suite: {len(PROBLEMS)} 项问题 / {CHECKED} 项断言")
        for item in PROBLEMS:
            print(f"  !! {item}")
        return 1
    print(f"check_suite: {CHECKED} 项断言全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
