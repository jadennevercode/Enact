"""Checks on the revision itself: reproducibility, immutability, diff honesty.

流程 §3 calls this "linear history over hidden mutation". These checks are what
turns that from a promise into something the audit can catch you breaking.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .base import Context, Finding, check, fail, ok, skip, as_list

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
_LIB = _ROOT / "shared" / "lib"
if str(_LIB) not in sys.path:
    sys.path.insert(0, str(_LIB))

import digest as digest_lib  # noqa: E402
from tools.cypher.static_check import check as cypher_static_check  # noqa: E402
from tools.trace import index as trace_index  # noqa: E402

# revision.yaml records these digests; they are excluded from the tree digest they
# describe, since a file cannot contain its own hash.
SELF_EXCLUDED = {"revision.yaml"}


def content_digests(ctx: Context, revision: str | None = None) -> dict[str, str]:
    directory = ctx.revision_dir(revision)
    if not directory.is_dir():
        return {}
    return digest_lib.tree_digest(directory, exclude=SELF_EXCLUDED)


@check("reproducible")
def reproducible(ctx: Context):
    meta = ctx.revision_meta()
    if not meta:
        return fail("reproducible", [Finding("revision.yaml", "不存在或无法解析")])
    findings: list[Finding] = []

    recorded = meta.get("artifact_digests") or {}
    if not recorded and meta.get("sealed"):
        findings.append(Finding("revision.yaml", "已封存却没有记录 artifact_digests"))
    elif recorded:
        # Before sealing there is nothing to compare against: the digests are
        # written by `seal` itself, so demanding them earlier would make the gate
        # unopenable by construction.
        actual = content_digests(ctx)
        for name, value in sorted(recorded.items()):
            if name not in actual:
                findings.append(Finding(name, "记录在 artifact_digests 中，但磁盘上没有"))
            elif actual[name] != value:
                findings.append(Finding(name, "内容与记录的 digest 不一致"))
        for name in sorted(set(actual) - set(recorded)):
            findings.append(Finding(name, "磁盘上存在但没有记录 digest"))

    inputs = meta.get("inputs") or {}
    # What a revision owes is a record of what it read, plus the guarantee that the
    # versioned snapshot it names has not been altered underneath it. It does NOT
    # owe agreement with the current interview state or FAGC register: those are
    # living files, and requiring them to match forever would make every earlier
    # revision fail the moment evidence is corrected — which is the normal case,
    # not a fault.
    for key in ("evidence_snapshot", "interview_state", "fagc_register"):
        if inputs.get(key) in (None, ""):
            findings.append(Finding("revision.yaml/inputs", f"缺少 {key} 的 digest"))

    snapshot_id = inputs.get("evidence_snapshot_id")
    if not snapshot_id:
        findings.append(Finding("revision.yaml/inputs", "缺少 evidence_snapshot_id"))
    else:
        directory = ctx.paths.snapshot(snapshot_id)
        if not directory.is_dir():
            findings.append(Finding("revision.yaml/inputs", f"证据快照 {snapshot_id} 不存在"))
        elif inputs.get("evidence_snapshot"):
            current = digest_lib.combined(digest_lib.tree_digest(directory))
            if current != inputs["evidence_snapshot"]:
                findings.append(
                    Finding(
                        "revision.yaml/inputs",
                        f"证据快照 {snapshot_id} 的内容与本 revision 记录的 digest 不符——"
                        "快照是版本化的，改它等于改历史。新证据开一个新快照。",
                    )
                )

    return fail("reproducible", findings) if findings else ok("reproducible", len(recorded))


@check("revision_sealed_immutable")
def revision_sealed_immutable(ctx: Context):
    findings: list[Finding] = []
    counted = 0
    targets = [ctx.revision] if ctx.revision else ctx.paths.revision_ids()
    for revision in targets:
        meta = ctx.revision_meta(revision)
        if not meta or not meta.get("sealed"):
            continue
        counted += 1
        recorded = meta.get("content_digest")
        actual = digest_lib.combined(content_digests(ctx, revision))
        if not recorded:
            findings.append(Finding(revision, "标记为 sealed 但没有 content_digest"))
        elif recorded != actual:
            changed = _changed_files(meta.get("artifact_digests") or {}, content_digests(ctx, revision))
            detail = "、".join(changed[:6]) if changed else "内容"
            findings.append(
                Finding(revision, f"封存后被改动：{detail}——历史被覆盖之后，任何追溯都不再可信")
            )
    if not counted:
        return skip("revision_sealed_immutable", "没有已封存的 revision")
    return (
        fail("revision_sealed_immutable", findings, counted)
        if findings
        else ok("revision_sealed_immutable", counted)
    )


def _changed_files(recorded: dict, actual: dict) -> list[str]:
    names = []
    for name in sorted(set(recorded) | set(actual)):
        if recorded.get(name) != actual.get(name):
            if name not in recorded:
                names.append(f"{name}（新增）")
            elif name not in actual:
                names.append(f"{name}（删除）")
            else:
                names.append(name)
    return names


@check("parent_unchanged")
def parent_unchanged(ctx: Context):
    meta = ctx.revision_meta()
    parent = meta.get("parent")
    if not parent:
        return skip("parent_unchanged", "这是第一个 revision，没有父")
    findings: list[Finding] = []
    parent_meta = ctx.revision_meta(parent)
    if not parent_meta:
        return fail("parent_unchanged", [Finding(parent, "父 revision 不存在或无法解析")])
    if not parent_meta.get("sealed"):
        findings.append(Finding(parent, "父 revision 尚未封存"))
    recorded = meta.get("parent_digest")
    actual = digest_lib.combined(content_digests(ctx, parent))
    if not recorded:
        findings.append(Finding("revision.yaml", "没有记录 parent_digest"))
    elif recorded != actual:
        findings.append(Finding(parent, "父 revision 的内容与本 revision 记录的 digest 不符"))
    if parent_meta.get("content_digest") and parent_meta["content_digest"] != actual:
        findings.append(Finding(parent, "父 revision 自身的 content_digest 也对不上——历史被改过"))
    return fail("parent_unchanged", findings) if findings else ok("parent_unchanged", 1)


@check("cypher_generated_and_parses")
def cypher_generated_and_parses(ctx: Context):
    path = ctx.revision_dir() / "candidate.cypher"
    if not path.is_file():
        return fail("cypher_generated_and_parses", [Finding("candidate.cypher", "不存在")])
    script = path.read_text(encoding="utf-8")
    declaration_ids = set(ctx.declarations())
    domain = (ctx.candidate().get("domain") or {})
    if isinstance(domain, dict) and domain.get("id"):
        declaration_ids.add(domain["id"])
    problems = cypher_static_check(script, declaration_ids)
    findings = [Finding("candidate.cypher", problem) for problem in problems]
    return (
        fail("cypher_generated_and_parses", findings, len(declaration_ids))
        if findings
        else ok("cypher_generated_and_parses", len(declaration_ids))
    )


@check("diff_removals_explained")
def diff_removals_explained(ctx: Context):
    diff = ctx.artifact("semantic-diff.yaml")
    if diff is None:
        meta = ctx.revision_meta()
        if not meta.get("parent"):
            return skip("diff_removals_explained", "第一个 revision 没有 diff")
        return fail("diff_removals_explained", [Finding("semantic-diff.yaml", "不存在")])
    removed = [item for item in as_list(diff.get("removed")) if isinstance(item, dict)]
    findings = [
        Finding(item.get("object_id", "<未命名>"), "删除既没有 replaced_by 也没有 removal_rationale")
        for item in removed
        if not item.get("replaced_by") and not item.get("removal_rationale")
    ]
    return (
        fail("diff_removals_explained", findings, len(removed))
        if findings
        else ok("diff_removals_explained", len(removed))
    )


@check("unaffected_unchanged")
def unaffected_unchanged(ctx: Context):
    meta = ctx.revision_meta()
    parent = meta.get("parent")
    if not parent:
        return skip("unaffected_unchanged", "第一个 revision 没有可比对象")
    diff = ctx.artifact("semantic-diff.yaml") or {}
    unaffected = [str(item) for item in as_list(diff.get("unaffected"))]
    if not unaffected:
        return skip("unaffected_unchanged", "semantic-diff 未声明 unaffected 集合")
    current = ctx.declarations()
    previous = ctx.declarations(parent)
    findings: list[Finding] = []
    for identifier in unaffected:
        before, after = previous.get(identifier), current.get(identifier)
        if before is None:
            findings.append(Finding(identifier, f"声明为未受影响，但在 {parent} 中不存在"))
        elif after is None:
            findings.append(Finding(identifier, "声明为未受影响，但在本 revision 中已消失"))
        elif trace_index._canonical(before) != trace_index._canonical(after):
            findings.append(
                Finding(identifier, "声明为未受影响，内容却变了——顺手的改动会把 diff 淹没在噪声里")
            )
    return (
        fail("unaffected_unchanged", findings, len(unaffected))
        if findings
        else ok("unaffected_unchanged", len(unaffected))
    )


@check("changes_closed")
def changes_closed(ctx: Context):
    comments = ctx.load(ctx.paths.comments) or {}
    entries = [item for item in as_list(comments.get("comments")) if isinstance(item, dict)]
    if not entries:
        return skip("changes_closed", "没有变更请求")
    relevant = [
        item
        for item in entries
        if item.get("target_revision") in (None, ctx.revision) or item.get("status") not in ("resolved",)
    ]
    findings: list[Finding] = []
    for item in relevant:
        where = item.get("change_id") or item.get("id") or "<变更>"
        status = item.get("status")
        if status == "resolved":
            continue
        if status == "deferred":
            if not item.get("owner"):
                findings.append(Finding(where, "deferred 但没有 owner"))
            if not item.get("target_revision"):
                findings.append(Finding(where, "deferred 但没有 target_revision"))
            continue
        findings.append(Finding(where, f"状态 {status!r} 既不是 resolved 也不是 deferred"))
    return fail("changes_closed", findings, len(relevant)) if findings else ok("changes_closed", len(relevant))


@check("locators_resolve_or_orphaned")
def locators_resolve_or_orphaned(ctx: Context):
    comments = ctx.load(ctx.paths.comments) or {}
    entries = [item for item in as_list(comments.get("comments")) if isinstance(item, dict)]
    if not entries:
        return skip("locators_resolve_or_orphaned", "没有需要解析的 locator")
    present = set(ctx.declarations())
    findings: list[Finding] = []
    counted = 0
    for item in entries:
        target = item.get("target_object_id")
        if not target:
            continue
        counted += 1
        if target in present:
            continue
        # The mark has to live in comments.yaml, where a person reads it — not in
        # the derived index, which nobody opens and which a rebuild would recreate
        # without anyone noticing the link had broken.
        #
        # It is a flag, not a status, because a change request whose target has
        # vanished still needs a status of its own: `changes_closed` wants
        # resolved or deferred, and "orphaned" answers a different question.
        if item.get("orphaned") is True:
            continue
        findings.append(
            Finding(
                item.get("change_id") or target,
                f"指向 {target}，在本 revision 中既不存在，也没有在变更记录里标成 orphaned"
                "——静默断链比 orphaned 更糟",
            )
        )
    return (
        fail("locators_resolve_or_orphaned", findings, counted)
        if findings
        else ok("locators_resolve_or_orphaned", counted)
    )


@check("trace_index_current")
def trace_index_current(ctx: Context):
    findings: list[Finding] = []
    counted = 0
    targets = [ctx.revision] if ctx.revision else ctx.paths.revision_ids()
    for revision in targets:
        path = ctx.paths.revision(revision) / "trace-index.yaml"
        if not path.is_file():
            findings.append(Finding(revision, "没有 trace-index.yaml"))
            continue
        stored = ctx.load(path) or {}
        rebuilt = trace_index.build(ctx.root, revision, derived=False)
        counted += len(rebuilt.get("records") or [])
        stored_records = trace_index.records_by_id(stored)
        rebuilt_records = trace_index.records_by_id(rebuilt)
        for identifier in sorted(set(rebuilt_records) - set(stored_records)):
            findings.append(Finding(f"{revision}/{identifier}", "产物中有，索引里没有"))
        for identifier in sorted(set(stored_records) - set(rebuilt_records)):
            findings.append(Finding(f"{revision}/{identifier}", "索引里有，产物中没有"))
        for identifier in sorted(set(stored_records) & set(rebuilt_records)):
            before, after = stored_records[identifier], rebuilt_records[identifier]
            # Only fields the revision itself determines are compared. Scope
            # membership belongs to a later release and orphan status to the
            # workspace's comment log; a sealed revision cannot be rewritten when
            # either of those changes, so comparing them would make this check
            # fail for doing the right thing.
            for field in ("support_types", "alignment_ids", "source_ids", "object_kind"):
                if before.get(field) != after.get(field):
                    findings.append(
                        Finding(f"{revision}/{identifier}", f"索引的 {field} 与产物不一致")
                    )
                    break
    return (
        fail("trace_index_current", findings, counted)
        if findings
        else ok("trace_index_current", counted)
    )
