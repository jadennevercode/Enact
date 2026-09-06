"""Checks on review, evaluation, submission, and the decision log.

These guard the places where a human's judgement is supposed to be recorded. A
missing owner on a deferred item or an unlogged approval does not break anything
today; it breaks the ability to answer "who decided this, and on what" later,
which is the only thing that makes the rest of the trace worth keeping.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from .base import Context, Finding, check, fail, ok, skip, as_list

DISPOSITIONS = {"accept", "comment", "direct_edit", "defer", "reject"}
REJECT_REASONS = {"unsupported", "duplicate", "out_of_scope", "semantically_wrong"}
CQ_STATUSES = {"passed", "failed", "unsupported"}
CQ_ORIGINS = {"human", "ai_proposed_human_approved"}

# Resources a scope can govern. Constraints and policies are rules about
# resources rather than resources themselves, so they are not scope members.
ACCESS_RELEVANT_KINDS = {"entity", "relationship", "attribute", "event", "lifecycle", "metric", "capability", "binding"}

PRINCIPAL_KEYS = {
    "users", "user", "groups", "group", "roles", "role", "entitlements", "entitlement",
    "assignments", "assignment", "grants", "grant", "principals", "principal",
    "members_users", "acl", "alice_roles",
}

EXCLUDED_FROM_PACKAGE = [
    "raw evidence", "inputs/evidence", "evidence-snapshots", "extractions",
    "transcripts", "interview-state", "samples", "history/runs.jsonl",
    "revisions/runs", "decisions.log", "principals", "entitlement",
]

SECRET_PATTERNS = [
    (re.compile(r"(?i)\b(api[_-]?key|secret|passwd|password|token)\b\s*[:=]\s*\S{6,}"), "疑似密钥或口令"),
    (re.compile(r"(?i)\b(postgres|mysql|mongodb|redis)://[^\s'\"]+:[^\s'\"]+@"), "疑似连接串含口令"),
    (re.compile(r"\bsk-[A-Za-z0-9]{16,}\b"), "疑似 API key"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "私钥"),
]


# --------------------------------------------------------------------------- #
# review
# --------------------------------------------------------------------------- #

def _review_items(ctx: Context) -> list[dict]:
    review = ctx.review()
    return [item for item in as_list(review.get("items")) if isinstance(item, dict)]


@check("review_binary")
def review_binary(ctx: Context):
    review = ctx.review()
    if not review:
        return fail(
            "review_binary",
            [Finding(ctx.rel(ctx.paths.review(ctx.revision)), "没有审阅记录")],
        )
    items = _review_items(ctx)
    if not items:
        return fail("review_binary", [Finding("items", "审阅记录里没有任何对象")])

    findings: list[Finding] = []
    for item in items:
        where = item.get("object_id", "<无 id>")
        disposition = item.get("disposition")
        if disposition not in DISPOSITIONS:
            findings.append(
                Finding(where, f"处置 {disposition!r} 不是 accept/comment/direct_edit/defer/reject 之一")
            )

    reviewed = {item.get("object_id") for item in items}
    missing = sorted(set(ctx.declarations()) - reviewed)
    if missing:
        shown = "、".join(missing[:8])
        more = f"（另有 {len(missing) - 8} 个）" if len(missing) > 8 else ""
        findings.append(Finding("items", f"这些对象还没有结论：{shown}{more}"))

    passes = review.get("passes") or {}
    for pass_name in ("evidence", "process", "mapping", "ontology"):
        entry = passes.get(pass_name)
        if not entry or (isinstance(entry, dict) and entry.get("status") != "done"):
            findings.append(Finding("passes", f"{pass_name} 轮还没有走完"))

    return fail("review_binary", findings, len(items)) if findings else ok("review_binary", len(items))


@check("defer_has_owner")
def defer_has_owner(ctx: Context):
    deferred = [item for item in _review_items(ctx) if item.get("disposition") == "defer"]
    if not deferred:
        return skip("defer_has_owner", "没有 defer")
    findings: list[Finding] = []
    for item in deferred:
        where = item.get("object_id", "<无 id>")
        for field in ("owner", "rationale", "target_revision"):
            if not item.get(field):
                findings.append(Finding(where, f"defer 缺少 {field}——没有主的延后会漂移成事实"))
    return fail("defer_has_owner", findings, len(deferred)) if findings else ok("defer_has_owner", len(deferred))


@check("reject_has_reason")
def reject_has_reason(ctx: Context):
    rejected = [item for item in _review_items(ctx) if item.get("disposition") == "reject"]
    if not rejected:
        return skip("reject_has_reason", "没有 reject")
    findings = [
        Finding(
            item.get("object_id", "<无 id>"),
            f"reject_reason {item.get('reject_reason')!r} 不是 "
            f"unsupported/duplicate/out_of_scope/semantically_wrong 之一",
        )
        for item in rejected
        if item.get("reject_reason") not in REJECT_REASONS
    ]
    return fail("reject_has_reason", findings, len(rejected)) if findings else ok("reject_has_reason", len(rejected))


# --------------------------------------------------------------------------- #
# evaluate
# --------------------------------------------------------------------------- #

@check("cq_human_owned")
def cq_human_owned(ctx: Context):
    register = ctx.load(ctx.paths.cq_register)
    if register is None:
        return fail("cq_human_owned", [Finding("evaluation/cq-register.yaml", "不存在或无法解析")])
    questions = [item for item in as_list(register.get("questions")) if isinstance(item, dict)]
    if not questions:
        return fail("cq_human_owned", [Finding("questions", "没有任何问题")])
    findings: list[Finding] = []
    for item in questions:
        where = item.get("cq_id", "<无 id>")
        if not item.get("owner"):
            findings.append(Finding(where, "缺少 owner"))
        origin = item.get("origin")
        if origin not in CQ_ORIGINS:
            findings.append(
                Finding(
                    where,
                    f"origin {origin!r} 不是 human 或 ai_proposed_human_approved——"
                    "系统可以提候选，但候选要经人批准才算数",
                )
            )
        for field in ("question", "business_persona", "decision_supported", "expected_answer_shape"):
            if not item.get(field):
                findings.append(Finding(where, f"缺少 {field}"))
    return fail("cq_human_owned", findings, len(questions)) if findings else ok("cq_human_owned", len(questions))


@check("cq_result_bound")
def cq_result_bound(ctx: Context):
    directory = ctx.paths.evaluation_runs
    if not directory.is_dir() or not list(directory.glob("*.yaml")):
        return skip("cq_result_bound", "还没有评估运行")
    register = ctx.load(ctx.paths.cq_register) or {}
    known = {
        item.get("cq_id")
        for item in as_list(register.get("questions"))
        if isinstance(item, dict)
    }
    revisions = set(ctx.paths.revision_ids())
    findings: list[Finding] = []
    counted = 0
    for path in sorted(directory.glob("*.yaml")):
        run = ctx.load(path) or {}
        revision = run.get("revision")
        if revision not in revisions:
            findings.append(Finding(path.name, f"绑定的 revision {revision!r} 不存在"))
        for item in as_list(run.get("results")):
            if not isinstance(item, dict):
                continue
            counted += 1
            where = f"{path.name}/{item.get('cq_id', '<无 id>')}"
            if known and item.get("cq_id") not in known:
                findings.append(Finding(where, "问题不在 cq-register 中"))
            status = item.get("status")
            if status not in CQ_STATUSES:
                findings.append(Finding(where, f"status {status!r} 不是 passed/failed/unsupported"))
            elif status == "passed" and not item.get("execution_evidence"):
                findings.append(
                    Finding(where, "passed 但没有 execution_evidence——查询返回了数据不等于语义正确")
                )
            elif status in ("failed", "unsupported") and not item.get("rationale"):
                findings.append(Finding(where, f"{status} 缺少 rationale"))
    return fail("cq_result_bound", findings, counted) if findings else ok("cq_result_bound", counted)


# --------------------------------------------------------------------------- #
# submit
# --------------------------------------------------------------------------- #

def membership_digest(pairs) -> str:
    """The canonical membership digest: one `scope_key<TAB>declaration_id` line per
    membership, sorted, hashed. Shared with `submit` so both sides compute it the
    same way."""
    import sys
    from pathlib import Path as _Path

    lib = _Path(__file__).resolve().parents[2] / "shared" / "lib"
    if str(lib) not in sys.path:
        sys.path.insert(0, str(lib))
    import digest as digest_lib

    return digest_lib.text_digest("\n".join(sorted(str(item) for item in pairs)))


def _scopes(ctx: Context) -> tuple[dict, list[dict]]:
    document = ctx.release_file("access-scopes.yaml") or {}
    scopes = [item for item in as_list(document.get("scopes")) if isinstance(item, dict)]
    return document, scopes


def _candidate_revision(ctx: Context) -> str | None:
    selection = ctx.release_file("selection.yaml") or {}
    return selection.get("candidate_revision") or (ctx.release_file("access-scopes.yaml") or {}).get(
        "bundle_revision"
    )


@check("scopes_cover_or_unscoped")
def scopes_cover_or_unscoped(ctx: Context):
    document, scopes = _scopes(ctx)
    if not document:
        return fail("scopes_cover_or_unscoped", [Finding("access-scopes.yaml", "不存在或无法解析")])
    findings: list[Finding] = []
    if len(scopes) < 2:
        findings.append(Finding("scopes", f"至少需要两个 scope，现在 {len(scopes)} 个"))
    for scope in scopes:
        where = scope.get("scope_key", "<无 key>")
        for field in ("scope_key", "display_name", "description", "accountable_owner", "lifecycle_status"):
            if not scope.get(field):
                findings.append(Finding(where, f"缺少 {field}"))

    revision = _candidate_revision(ctx)
    declarations = ctx.declarations(revision) if revision else {}
    relevant = {
        identifier
        for identifier, item in declarations.items()
        if item["_kind"] in ACCESS_RELEVANT_KINDS
    }
    covered: set[str] = set()
    for scope in scopes:
        covered |= {str(member) for member in as_list(scope.get("member_declaration_ids"))}
    unscoped = {str(item) for item in as_list(document.get("intentionally_unscoped"))}
    uncovered = sorted(relevant - covered - unscoped)
    if uncovered:
        shown = "、".join(uncovered[:8])
        more = f"（另有 {len(uncovered) - 8} 个）" if len(uncovered) > 8 else ""
        findings.append(
            Finding("coverage", f"这些声明既不属于任何 scope 也没有列入 intentionally_unscoped：{shown}{more}")
        )
    warning = str(document.get("warning") or "")
    if "do not grant access" not in warning.lower():
        findings.append(
            Finding(
                "warning",
                "缺少必须显示的提示：Access scopes define governed resource boundaries. "
                "They do not grant access to users or groups.",
            )
        )
    return (
        fail("scopes_cover_or_unscoped", findings, len(relevant))
        if findings
        else ok("scopes_cover_or_unscoped", len(relevant))
    )


def _walk_keys(node, trail=""):
    if isinstance(node, dict):
        for key, value in node.items():
            here = f"{trail}/{key}" if trail else str(key)
            yield str(key), here
            yield from _walk_keys(value, here)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from _walk_keys(value, f"{trail}[{index}]")


@check("scopes_no_principals")
def scopes_no_principals(ctx: Context):
    document, _ = _scopes(ctx)
    if not document:
        return fail("scopes_no_principals", [Finding("access-scopes.yaml", "不存在或无法解析")])
    findings = [
        Finding(trail, f"出现主体相关的键 {key}——scope 声明受治理资源边界，不授予任何人访问权")
        for key, trail in _walk_keys(document)
        if key.lower() in PRINCIPAL_KEYS
    ]
    return fail("scopes_no_principals", findings) if findings else ok("scopes_no_principals", 1)


@check("scope_refs_resolve")
def scope_refs_resolve(ctx: Context):
    document, scopes = _scopes(ctx)
    if not document:
        return fail("scope_refs_resolve", [Finding("access-scopes.yaml", "不存在或无法解析")])
    revision = _candidate_revision(ctx)
    if not revision:
        return fail("scope_refs_resolve", [Finding("selection.yaml", "没有记录 candidate_revision")])
    declarations = set(ctx.declarations(revision))
    findings: list[Finding] = []
    members: list[str] = []
    for scope in scopes:
        where = scope.get("scope_key", "<无 key>")
        for member in as_list(scope.get("member_declaration_ids")):
            # Keyed by scope, so the digest says which scope holds what. A flat
            # bag of ids cannot tell "moved from scope A to scope B" from
            # "unchanged", and that move is exactly the kind of change the
            # governance review exists to catch.
            members.append(f"{where}\t{member}")
            if str(member) not in declarations:
                findings.append(Finding(where, f"成员 {member} 不是 {revision} 中的稳定声明 id"))
        for reference in as_list(scope.get("cross_scope_references")):
            if isinstance(reference, dict) and reference.get("declaration_id"):
                if reference["declaration_id"] not in declarations:
                    findings.append(
                        Finding(where, f"跨 scope 引用 {reference['declaration_id']} 无法解析")
                    )
    recorded = document.get("membership_digest")
    if not recorded:
        findings.append(Finding("membership_digest", "缺少 membership digest"))
    else:
        computed = membership_digest(members)
        if computed != recorded:
            findings.append(
                Finding("membership_digest", "digest 与成员列表不一致——成员在批准之后变过")
            )
    return fail("scope_refs_resolve", findings, len(members)) if findings else ok("scope_refs_resolve", len(members))


@check("patch_version_human")
def patch_version_human(ctx: Context):
    document = ctx.release_file("patch-or-version.yaml")
    if document is None:
        return fail("patch_version_human", [Finding("patch-or-version.yaml", "不存在或无法解析")])
    findings: list[Finding] = []
    if document.get("selection") not in ("patch", "version"):
        findings.append(Finding("selection", f"{document.get('selection')!r} 不是 patch 或 version"))
    if document.get("decided_by") != "human":
        findings.append(
            Finding("decided_by", "必须是 human——系统不自动判断 semantic impact，也不自动选择")
        )
    for field in ("rationale", "target_version", "decided_at"):
        if not document.get(field):
            findings.append(Finding(field, "缺失"))
    return fail("patch_version_human", findings) if findings else ok("patch_version_human", 1)


@check("package_excludes_raw")
def package_excludes_raw(ctx: Context):
    if not ctx.release:
        return skip("package_excludes_raw", "没有指定 release")
    package = ctx.paths.release(ctx.release) / "package"
    if not package.is_dir():
        return fail("package_excludes_raw", [Finding("package/", "目录不存在")])
    findings: list[Finding] = []
    counted = 0
    for path in sorted(package.rglob("*")):
        if not path.is_file():
            continue
        counted += 1
        relative = path.relative_to(package).as_posix().lower()
        for pattern in EXCLUDED_FROM_PACKAGE:
            if pattern.lower() in relative:
                findings.append(Finding(relative, f"命中排除项 {pattern!r}"))
                break
    if not counted:
        findings.append(Finding("package/", "包是空的"))
    return fail("package_excludes_raw", findings, counted) if findings else ok("package_excludes_raw", counted)


@check("pr_matches_preview")
def pr_matches_preview(ctx: Context):
    pull_request = ctx.release_file("pr.yaml")
    if pull_request is None:
        return skip("pr_matches_preview", "还没有 PR 记录")
    manifest = ctx.release_file("submission-manifest.yaml") or {}
    findings: list[Finding] = []
    preview = manifest.get("preview_digest")
    if not preview:
        findings.append(Finding("submission-manifest.yaml", "没有记录 preview_digest"))
    elif pull_request.get("preview_digest") != preview:
        findings.append(
            Finding("pr.yaml", "PR 记录的 preview_digest 与提交清单不一致——人批的必须就是发出去的")
        )
    if not pull_request.get("body_digest"):
        findings.append(Finding("pr.yaml", "没有记录 body_digest"))
    manifest_files = sorted(str(item) for item in as_list(manifest.get("package_files")))
    pr_files = sorted(str(item) for item in as_list(pull_request.get("changed_files")))
    if pr_files and manifest_files and pr_files != manifest_files:
        findings.append(Finding("pr.yaml", "changed_files 与提交清单的 package_files 不一致"))
    return fail("pr_matches_preview", findings) if findings else ok("pr_matches_preview", 1)


@check("checkout_clean")
def checkout_clean(ctx: Context):
    manifest = ctx.release_file("submission-manifest.yaml") or {}
    target = manifest.get("target_repository") or (ctx.release_file("pr.yaml") or {}).get("repository")
    if not target:
        return skip("checkout_clean", "没有目标仓库")
    path = Path(str(target)).expanduser()
    if not (path.is_dir() and (path / ".git").exists()):
        recorded = (ctx.release_file("pr.yaml") or {}).get("checkout_status")
        if recorded == "clean":
            return ok("checkout_clean", 1)
        return fail(
            "checkout_clean",
            [Finding(str(target), f"本地不可检查，且记录的 checkout_status 是 {recorded!r}")],
        )
    findings: list[Finding] = []
    try:
        status = subprocess.run(
            ["git", "-C", str(path), "status", "--porcelain"],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if status.stdout.strip():
            findings.append(Finding(str(path), "工作区有未提交改动（dirty）"))
        ahead = subprocess.run(
            ["git", "-C", str(path), "rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if ahead.returncode == 0 and ahead.stdout.strip():
            left, _, right = ahead.stdout.split()[0], None, ahead.stdout.split()[-1]
            if left != "0" or right != "0":
                findings.append(Finding(str(path), f"与上游分叉：领先 {left}，落后 {right}"))
        if list(path.glob(".git/MERGE_HEAD")) or (path / ".git" / "MERGE_HEAD").exists():
            findings.append(Finding(str(path), "存在未完成的合并（conflicted）"))
    except (OSError, subprocess.SubprocessError) as exc:
        findings.append(Finding(str(path), f"无法检查 git 状态：{exc}"))
    if findings:
        findings.append(Finding(str(path), "停止提交，转 expert handoff——系统不会强制重置用户的工作"))
    return fail("checkout_clean", findings, 1) if findings else ok("checkout_clean", 1)


@check("handoff_redacted")
def handoff_redacted(ctx: Context):
    directory = ctx.paths.exports
    if not directory.is_dir():
        return skip("handoff_redacted", "还没有导出任何东西")
    findings: list[Finding] = []
    counted = 0
    for path in sorted(directory.rglob("*")):
        if not path.is_file() or path.suffix.lower() in (".zip", ".gz", ".png", ".jpg", ".pdf"):
            continue
        counted += 1
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for pattern, label in SECRET_PATTERNS:
            match = pattern.search(text)
            if match:
                line = text[: match.start()].count("\n") + 1
                findings.append(Finding(f"{ctx.rel(path)}:{line}", f"{label}——先脱敏再导出"))
                break
    return fail("handoff_redacted", findings, counted) if findings else ok("handoff_redacted", counted)


# --------------------------------------------------------------------------- #
# cross-cutting
# --------------------------------------------------------------------------- #

@check("decision_logged")
def decision_logged(ctx: Context):
    manifest = ctx.decision_points
    points = {item["id"]: item for item in as_list(manifest.get("points"))}
    entries = ctx.decisions()
    findings: list[Finding] = []

    for entry in entries:
        if not entry["wellformed"]:
            findings.append(Finding(f"decisions.log:{entry['line']}", "格式不合法，应为 时间|决策点|角色|裁决|对象|理由"))
            continue
        point = points.get(entry["point"])
        if point is None:
            findings.append(
                Finding(f"decisions.log:{entry['line']}", f"决策点 {entry['point']!r} 不在 decision-points.yaml 中")
            )
            continue
        if entry["verdict"] not in (point.get("verdicts") or []):
            findings.append(
                Finding(
                    f"decisions.log:{entry['line']}",
                    f"裁决 {entry['verdict']!r} 不是 {point['id']} 的合法取值：{point.get('verdicts')}",
                )
            )

    # Artifacts that imply a decision must have the line that recorded it.
    implied: list[tuple[str, str]] = []
    if ctx.load(ctx.paths.charter):
        implied.append(("scope_and_boundary", "define/project-charter.yaml"))
    if ctx.paths.snapshot_ids():
        implied.append(("evidence_sufficiency", "define/evidence-snapshots"))
    for release_id in ctx.paths.release_ids():
        base = ctx.paths.release(release_id)
        if (base / "patch-or-version.yaml").is_file():
            implied.append(("patch_or_version", f"releases/{release_id}"))
        if (base / "access-scopes.yaml").is_file():
            implied.append(("access_scope_review", f"releases/{release_id}"))
        if (base / "pr.yaml").is_file():
            implied.append(("create_pull_request", f"releases/{release_id}"))
    for point_id, where in implied:
        standing = ctx.standing_verdict(point_id)
        if standing is None:
            findings.append(
                Finding(where, f"产物已存在，但 decisions.log 里没有 {point_id} 的裁决——决策先写日志再改状态")
            )
        elif standing["verdict"] not in (points.get(point_id, {}).get("closing") or []):
            findings.append(
                Finding(where, f"{point_id} 最近一次裁决是 {standing['verdict']!r}，没有关上这个决策点")
            )
    return fail("decision_logged", findings, len(entries)) if findings else ok("decision_logged", len(entries))
