"""Checks on the rendered Skill package.

The package is what leaves the building — someone installs it and an agent then
answers questions out of it. So the checks here are about honesty in transit: it
still matches the version it claims to come from, it ships its own unknowns, and
it does not smuggle the raw evidence out with it.
"""

from __future__ import annotations

import sys
from pathlib import Path

from .base import Context, Finding, check, fail, ok, skip, as_list

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from tools.package import render as renderer  # noqa: E402

MIN_SNIPPET = 12


def _packages(ctx: Context) -> list[Path]:
    root = ctx.paths.exports / renderer.PACKAGE_ROOT
    if not root.is_dir():
        return []
    return [path for path in sorted(root.iterdir()) if (path / "package.yaml").is_file()]


def _manifest(ctx: Context, directory: Path) -> dict:
    return ctx.load(directory / "package.yaml") or {}


@check("package_from_candidate")
def package_from_candidate(ctx: Context):
    packages = _packages(ctx)
    if not packages:
        return skip("package_from_candidate", "还没有渲染任何本体包")
    findings: list[Finding] = []
    for directory in packages:
        manifest = _manifest(ctx, directory)
        revision = manifest.get("source_revision")
        where = directory.name
        if not revision:
            findings.append(Finding(where, "package.yaml 没有记录 source_revision"))
            continue
        meta = ctx.revision_meta(revision)
        if not meta:
            findings.append(Finding(where, f"它声称来自 {revision}，但这一版不存在"))
            continue
        if not meta.get("sealed"):
            findings.append(Finding(where, f"{revision} 还没封存——没封存的版本会变，包会跟它对不上"))
        if not meta.get("candidate_release"):
            findings.append(
                Finding(
                    where,
                    f"{revision} 不是被选定的候选发布。要发出去的包应当来自走过 "
                    "candidate_selection 的那一版，否则装它的人拿到的是一个没人选过的模型。",
                )
            )
        recorded = manifest.get("source_content_digest")
        if recorded and meta.get("content_digest") and recorded != meta["content_digest"]:
            findings.append(Finding(where, f"{revision} 的内容摘要与包里记的对不上"))
    return (
        fail("package_from_candidate", findings, len(packages))
        if findings
        else ok("package_from_candidate", len(packages))
    )


@check("skill_package_current")
def skill_package_current(ctx: Context):
    packages = _packages(ctx)
    if not packages:
        return skip("skill_package_current", "还没有渲染任何本体包")
    findings: list[Finding] = []
    counted = 0
    for directory in packages:
        manifest = _manifest(ctx, directory)
        revision = manifest.get("source_revision")
        if not revision or not ctx.paths.revision(revision).is_dir():
            continue
        rendered = renderer.render(ctx.root, revision)
        counted += len(rendered)
        for relative, content in sorted(rendered.items()):
            path = directory / relative
            if not path.is_file():
                findings.append(Finding(f"{directory.name}/{relative}", "缺失"))
            elif path.read_text(encoding="utf-8") != content:
                findings.append(
                    Finding(f"{directory.name}/{relative}", f"与 {revision} 重新渲染的结果不一致")
                )
        for path in sorted(directory.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(directory).as_posix()
            if relative not in rendered and not relative.startswith(".claude-plugin/"):
                findings.append(Finding(f"{directory.name}/{relative}", "渲染不出来的文件——手改过？"))
    if findings:
        findings.append(
            Finding(
                "包",
                "重新跑一次 package.py 覆盖它。包是渲染出来的，手改一处就再也说不清它对应哪一版。",
            )
        )
    return (
        fail("skill_package_current", findings, counted)
        if findings
        else ok("skill_package_current", counted)
    )


@check("skill_package_bounded")
def skill_package_bounded(ctx: Context):
    packages = _packages(ctx)
    if not packages:
        return skip("skill_package_bounded", "还没有渲染任何本体包")
    findings: list[Finding] = []
    counted = 0
    for directory in packages:
        manifest = _manifest(ctx, directory)
        revision = manifest.get("source_revision")
        if not revision or not ctx.paths.revision(revision).is_dir():
            continue
        boundaries = directory / "references" / "boundaries.md"
        if not boundaries.is_file():
            findings.append(Finding(directory.name, "没有 references/boundaries.md"))
            continue
        text = boundaries.read_text(encoding="utf-8")
        unknowns = renderer.open_questions(renderer.gather(ctx.root, revision))
        counted += len(unknowns)
        for item in unknowns:
            identifier = str(item.get("id") or "")
            if identifier and identifier not in text:
                findings.append(
                    Finding(
                        f"{directory.name}/boundaries.md",
                        f"没有列出 {identifier}（{item['kind']}）——"
                        "一个不声明自己边界的模型，会让人把它的沉默当成否定",
                    )
                )
        skill = directory / "SKILL.md"
        if skill.is_file() and "boundaries" not in skill.read_text(encoding="utf-8"):
            findings.append(Finding(f"{directory.name}/SKILL.md", "没有把 boundaries 指出来"))
    return (
        fail("skill_package_bounded", findings, counted)
        if findings
        else ok("skill_package_bounded", counted)
    )


@check("skill_package_no_snippets")
def skill_package_no_snippets(ctx: Context):
    """The package cites where evidence lives; it does not carry the evidence."""
    packages = _packages(ctx)
    if not packages:
        return skip("skill_package_no_snippets", "还没有渲染任何本体包")

    snippets: set[str] = set()
    register = ctx.load(ctx.paths.fagc) or {}
    for statement in as_list(register.get("statements")):
        if isinstance(statement, dict):
            for anchor in as_list(statement.get("anchors")):
                if isinstance(anchor, dict) and anchor.get("exact_snippet"):
                    snippets.add(str(anchor["exact_snippet"]))
    for snapshot in ctx.paths.snapshot_ids():
        manifest = ctx.load(ctx.paths.snapshot(snapshot) / "manifest.yaml") or {}
        for source in as_list(manifest.get("sources")):
            if isinstance(source, dict):
                for anchor in as_list(source.get("anchors")):
                    if isinstance(anchor, dict) and anchor.get("exact_snippet"):
                        snippets.add(str(anchor["exact_snippet"]))
    for revision in ctx.paths.revision_ids():
        evidential = ctx.load(ctx.paths.revision(revision) / "evidential_ir.yaml") or {}
        for fact in as_list(evidential.get("facts")):
            if not isinstance(fact, dict):
                continue
            anchor = fact.get("anchor")
            for item in ([anchor] if isinstance(anchor, dict) else as_list(anchor)):
                if isinstance(item, dict) and item.get("exact_snippet"):
                    snippets.add(str(item["exact_snippet"]))

    snippets = {text for text in snippets if len(text) >= MIN_SNIPPET}
    if not snippets:
        return skip("skill_package_no_snippets", "工作区里没有足够长的原文片段可供比对")

    findings: list[Finding] = []
    counted = 0
    for directory in packages:
        for path in sorted(directory.rglob("*")):
            if not path.is_file() or path.suffix not in (".md", ".yaml", ".cypher", ".json"):
                continue
            counted += 1
            text = path.read_text(encoding="utf-8", errors="ignore")
            for snippet in sorted(snippets):
                if snippet in text:
                    findings.append(
                        Finding(
                            f"{directory.name}/{path.relative_to(directory).as_posix()}",
                            f"带出了原文片段「{snippet[:24]}…」——包里只给来源编号和定位，不复制原文",
                        )
                    )
                    break
    return (
        fail("skill_package_no_snippets", findings, counted)
        if findings
        else ok("skill_package_no_snippets", counted)
    )
