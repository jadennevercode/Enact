"""Checks on stage 0 and stage 1 artifacts: charter, evidence, interview.

The one that matters most here is `no_inference_as_fact`. Everything downstream —
alignment, trace, review — assumes that a row labelled `fact` came from somewhere
you can point at. If that assumption is false the whole trace chain is decorative.
"""

from __future__ import annotations

from .base import Context, Finding, check, fail, ok, skip, as_list

READINESS_QUESTIONS = [
    "goal",
    "boundary",
    "users_and_decisions",
    "core_objects",
    "key_processes_and_events",
    "exceptions_and_lifecycle",
    "terminology_ambiguity",
    "data_granularity",
]
READINESS_RESOLVED = {"answered", "corrected", "skipped"}

MANIFEST_FIELDS = [
    "evidence_id", "origin", "source_version", "source_digest", "classification",
    "language", "format", "extraction_path", "anchors", "uncertainty",
    "known_limitations", "human_confirmation_status", "reuse_valid_for_current_source",
]
EXTRACTION_PATHS = {"native", "structured", "vision"}
SCALE_KEYS = [
    "collections", "documents", "sample_rows", "process_steps",
    "entity_types_estimate", "relationship_types_estimate",
]
SCALE_LIMITS = {
    "collections": 5, "documents": 10, "sample_rows": 10000,
    "process_steps": 100, "entity_types_estimate": 25, "relationship_types_estimate": 25,
}


@check("charter_complete")
def charter_complete(ctx: Context):
    charter = ctx.load(ctx.paths.charter)
    if charter is None:
        return fail("charter_complete", [Finding("define/project-charter.yaml", "不存在或无法解析")])
    findings: list[Finding] = []

    owners = charter.get("owners") or {}
    for role in ("domain", "ontology", "process"):
        if not owners.get(role):
            findings.append(Finding("owners", f"缺少 {role} 负责人"))

    scope = charter.get("scope") or {}
    if not as_list(scope.get("in_scope")):
        findings.append(Finding("scope", "in_scope 为空"))
    if not as_list(scope.get("out_of_scope")):
        findings.append(Finding("scope", "out_of_scope 为空——说不出不做什么，就没有边界"))
    for dimension in ("time_range", "organisational_range", "data_granularity"):
        if not scope.get(dimension):
            findings.append(Finding("scope", f"缺少 {dimension}"))

    if not charter.get("problem_statement"):
        findings.append(Finding("problem_statement", "缺少一句话问题陈述"))

    pins = charter.get("pins") or {}
    for pin in ("spec_version", "skill_pack_version", "model"):
        if not pins.get(pin):
            findings.append(Finding("pins", f"缺少 {pin}"))

    scale = charter.get("scale_check") or {}
    for key in SCALE_KEYS:
        if scale.get(key) is None:
            findings.append(Finding("scale_check", f"缺少 {key}"))
    if scale.get("verdict") not in ("within", "over"):
        findings.append(Finding("scale_check", "缺少 verdict（within 或 over）"))

    questions = as_list(charter.get("competency_questions_draft"))
    if not 3 <= len(questions) <= 10:
        findings.append(
            Finding("competency_questions_draft", f"应为 3–10 条，现在 {len(questions)} 条")
        )
    for index, question in enumerate(questions):
        if not isinstance(question, dict):
            findings.append(Finding(f"competency_questions_draft[{index}]", "条目不是映射"))
            continue
        for field in ("question", "persona", "decision"):
            if not question.get(field):
                findings.append(
                    Finding(f"competency_questions_draft[{index}]", f"缺少 {field}")
                )

    return fail("charter_complete", findings) if findings else ok("charter_complete", len(questions))


def _sources(ctx: Context) -> list[tuple[str, dict]]:
    found: list[tuple[str, dict]] = []
    for snapshot_id in ctx.paths.snapshot_ids():
        manifest = ctx.load(ctx.paths.snapshot(snapshot_id) / "manifest.yaml") or {}
        for item in as_list(manifest.get("sources")):
            if isinstance(item, dict):
                found.append((snapshot_id, item))
    return found


@check("evidence_manifest_complete")
def evidence_manifest_complete(ctx: Context):
    sources = _sources(ctx)
    if not sources:
        return fail(
            "evidence_manifest_complete",
            [Finding("define/evidence-snapshots", "没有任何 evidence snapshot")],
        )
    findings: list[Finding] = []
    for snapshot_id, item in sources:
        where = f"{snapshot_id}/{item.get('evidence_id', '<无 id>')}"
        for field in MANIFEST_FIELDS:
            if item.get(field) in (None, "", [], {}):
                findings.append(Finding(where, f"缺少 {field}"))
        path = item.get("extraction_path")
        if path and path not in EXTRACTION_PATHS:
            findings.append(
                Finding(where, f"extraction_path {path} 不是 native/structured/vision 之一")
            )
        if path in ("vision", "structured") and not item.get("model_version") and not item.get(
            "prompt_or_schema_version"
        ):
            findings.append(
                Finding(where, f"{path} 抽取需要记录 model_version 或 prompt_or_schema_version")
            )
    return (
        fail("evidence_manifest_complete", findings, len(sources))
        if findings
        else ok("evidence_manifest_complete", len(sources))
    )


def _statements(ctx: Context) -> list[dict]:
    register = ctx.load(ctx.paths.fagc) or {}
    return [item for item in as_list(register.get("statements")) if isinstance(item, dict)]


@check("no_inference_as_fact")
def no_inference_as_fact(ctx: Context):
    statements = _statements(ctx)
    if not statements:
        return fail("no_inference_as_fact", [Finding("define/fagc-register.yaml", "没有任何陈述")])
    findings: list[Finding] = []
    for item in statements:
        where = item.get("statement_id", "<无 id>")
        classification = item.get("classification")
        if classification == "fact":
            anchors = [
                anchor
                for anchor in as_list(item.get("anchors"))
                if isinstance(anchor, dict) and anchor.get("exact_snippet") and anchor.get("location")
            ]
            if not anchors:
                findings.append(
                    Finding(where, "标为 fact 但没有带 location 与 exact_snippet 的锚点")
                )
            if not as_list(item.get("source_ids")):
                findings.append(Finding(where, "标为 fact 但没有 source_ids"))
        elif classification == "assumption":
            if not item.get("rationale"):
                findings.append(Finding(where, "assumption 缺少 rationale"))
        elif classification in ("guidance", "constraint"):
            if not item.get("authority_or_owner"):
                findings.append(Finding(where, f"{classification} 缺少 authority_or_owner"))
        else:
            findings.append(
                Finding(where, f"classification {classification!r} 不是 fact/assumption/guidance/constraint")
            )
    return (
        fail("no_inference_as_fact", findings, len(statements))
        if findings
        else ok("no_inference_as_fact", len(statements))
    )


@check("conflicts_not_merged")
def conflicts_not_merged(ctx: Context):
    register = ctx.load(ctx.paths.fagc) or {}
    statements = _statements(ctx)
    disputed = [item for item in statements if item.get("status") == "disputed"]
    unresolved = [
        item for item in as_list(register.get("unresolved_decisions")) if isinstance(item, dict)
    ]
    if not disputed:
        return skip("conflicts_not_merged", "没有标记为 disputed 的陈述")

    findings: list[Finding] = []
    groups: dict[str, list[str]] = {}
    for item in disputed:
        where = item.get("statement_id", "<无 id>")
        group = item.get("conflict_group")
        if not group:
            findings.append(Finding(where, "disputed 陈述缺少 conflict_group"))
            continue
        groups.setdefault(group, []).append(where)
        for field in ("source_ids", "scope", "valid_time", "authority_or_owner"):
            if item.get(field) in (None, "", [], {}):
                findings.append(
                    Finding(where, f"冲突陈述需要保留 {field}，才能让人判断哪一条适用")
                )
    covered = {item.get("conflict_group") for item in unresolved}
    for group, members in groups.items():
        if len(members) < 2:
            findings.append(
                Finding(group, f"冲突组只有一条陈述（{members[0]}）——另一条被合并或删掉了吗")
            )
        if group not in covered:
            findings.append(Finding(group, "没有对应的 unresolved decision"))
    for item in unresolved:
        if not item.get("owner"):
            findings.append(Finding(item.get("id", "<决策>"), "unresolved decision 缺少 owner"))
    return (
        fail("conflicts_not_merged", findings, len(disputed))
        if findings
        else ok("conflicts_not_merged", len(disputed))
    )


@check("evidence_confirmed")
def evidence_confirmed(ctx: Context):
    sources = _sources(ctx)
    if not sources:
        return fail("evidence_confirmed", [Finding("define/evidence-snapshots", "没有任何来源")])
    findings = [
        Finding(f"{snapshot}/{item.get('evidence_id', '<无 id>')}", "human_confirmation_status 仍是 unreviewed")
        for snapshot, item in sources
        if item.get("human_confirmation_status") == "unreviewed"
    ]
    findings += [
        Finding(f"{snapshot}/{item.get('evidence_id', '<无 id>')}", "confirmed/corrected 但没有 confirmed_by")
        for snapshot, item in sources
        if item.get("human_confirmation_status") in ("confirmed", "corrected") and not item.get("confirmed_by")
    ]
    return (
        fail("evidence_confirmed", findings, len(sources))
        if findings
        else ok("evidence_confirmed", len(sources))
    )


@check("readiness_resolved")
def readiness_resolved(ctx: Context):
    readiness = ctx.load(ctx.paths.readiness)
    if readiness is None:
        return fail("readiness_resolved", [Finding("define/readiness.yaml", "不存在或无法解析")])
    entries = {
        item.get("id"): item
        for item in as_list(readiness.get("questions"))
        if isinstance(item, dict)
    }
    findings: list[Finding] = []
    for question in READINESS_QUESTIONS:
        item = entries.get(question)
        if item is None:
            findings.append(Finding(question, "八项 readiness 中缺这一项"))
            continue
        status = item.get("status")
        if status == "inferred":
            findings.append(
                Finding(question, "仍是 inferred——系统的猜测必须由人确认成 answered/corrected 或明确 skipped")
            )
        elif status not in READINESS_RESOLVED:
            findings.append(Finding(question, f"status {status!r} 不是 answered/corrected/skipped"))
        elif status in ("answered", "corrected") and not item.get("answer"):
            findings.append(Finding(question, f"{status} 但没有记录 answer"))
        elif status == "skipped" and not item.get("rationale"):
            findings.append(Finding(question, "skipped 需要写明理由"))
    return (
        fail("readiness_resolved", findings, len(READINESS_QUESTIONS))
        if findings
        else ok("readiness_resolved", len(READINESS_QUESTIONS))
    )


@check("model_cards_sourced")
def model_cards_sourced(ctx: Context):
    cards_file = ctx.load(ctx.paths.model_cards)
    if cards_file is None:
        return fail("model_cards_sourced", [Finding("define/model-cards.yaml", "不存在或无法解析")])
    cards = [item for item in as_list(cards_file.get("cards")) if isinstance(item, dict)]
    if not cards:
        return fail("model_cards_sourced", [Finding("define/model-cards.yaml", "cards 为空")])
    assumptions = {
        item.get("statement_id")
        for item in _statements(ctx)
        if item.get("classification") == "assumption"
    }
    findings: list[Finding] = []
    for card in cards:
        where = card.get("id", "<无 id>")
        if not card.get("kind"):
            findings.append(Finding(where, "缺少 kind"))
        if not card.get("name"):
            findings.append(Finding(where, "缺少 name"))
        source_phrase = card.get("source_phrase")
        assumption_ref = card.get("assumption_ref")
        if not source_phrase and not assumption_ref:
            findings.append(
                Finding(where, "既没有 source_phrase 也没有 assumption_ref——它是从哪里来的")
            )
        if assumption_ref and assumptions and assumption_ref not in assumptions:
            findings.append(Finding(where, f"assumption_ref {assumption_ref} 不在 FAGC 登记中"))
    return (
        fail("model_cards_sourced", findings, len(cards))
        if findings
        else ok("model_cards_sourced", len(cards))
    )
