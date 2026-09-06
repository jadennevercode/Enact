"""Structural shape of the four layers, and the two checks that guard it.

The field tables are the readable contract: a skill author reads this to know
what to write, and `schema_valid` reads the same table to decide whether it was
written. Keeping one table rather than a prose description and a separate
implementation is what stops the two drifting.
"""

from __future__ import annotations

from .base import Context, Finding, check, fail, ok, as_list

# --------------------------------------------------------------------------- #
# field tables
# --------------------------------------------------------------------------- #

# collection -> (required item fields, optional-but-typed fields)
CANDIDATE_FIELDS: dict[str, list[str]] = {
    "entities": ["id", "view_label", "canonical_name", "definition", "support"],
    "relationships": [
        "id", "source", "target", "source_role", "target_role",
        "direction", "cardinality", "semantics", "definition", "support",
    ],
    "attributes": ["id", "owner", "datatype", "nullable", "support"],
    "events": ["id", "participants", "definition", "support"],
    "lifecycles": ["id", "entity", "states", "transitions", "support"],
    "constraints": ["id", "kind", "statement", "support"],
    "policies": ["id", "modality", "subject", "action", "condition", "support"],
    "capabilities": ["id", "intent", "parameters", "preconditions", "effects", "support"],
    "bindings": ["id", "binding_kind", "target", "source_system", "support"],
    "metrics": ["id", "definition", "support"],
}

CORE_COLLECTIONS = ["entities", "relationships", "attributes", "events", "lifecycles", "constraints"]
EXTENDED_COLLECTIONS = ["policies", "capabilities", "bindings", "metrics"]

EVIDENTIAL_ITEM_FIELDS = ["id", "statement", "source_id", "anchor"]
ANCHOR_FIELDS = ["location", "exact_snippet"]
PROCESS_STEP_FIELDS = ["id", "name", "actors"]
ALIGNMENT_FIELDS = ["id", "source", "target", "confidence"]

# Keys that belong to the Ontology layer and nowhere else. Their presence in the
# Evidence or Process layer is the "隐性混入" 流程 §8.2 forbids.
#
# `events` and `lifecycles` are deliberately NOT here. 流程 §5.3 puts events and
# lifecycle in the Process layer's own content, so a `process_ir` that describes
# when things happen and how state moves is doing its job, not leaking. What
# distinguishes the two is the shape: a process event names actors and steps, an
# ontology event carries a definition and support links.
PROCESS_SHARED_KEYS = {"events", "lifecycles"}
TARGET_DESIGN_KEYS = (
    set(CANDIDATE_FIELDS) - PROCESS_SHARED_KEYS
) | {"bundle", "declarations", "domain"}

LAYER_FILES = {
    "evidential_ir.yaml": "evidence",
    "process_ir.yaml": "process",
    "alignment.yaml": "mapping",
    "candidate.yaml": "ontology",
}


def _missing(item: dict, required: list[str]) -> list[str]:
    return [key for key in required if key not in item or item[key] in (None, "", [], {})]


# --------------------------------------------------------------------------- #
# checks
# --------------------------------------------------------------------------- #

@check("schema_valid")
def schema_valid(ctx: Context):
    findings: list[Finding] = []
    counted = 0
    revision_dir = ctx.revision_dir()

    for filename in LAYER_FILES:
        path = revision_dir / filename
        if not path.is_file():
            findings.append(Finding(ctx.rel(path), "文件不存在"))
            continue
        if ctx.load(path) is None:
            reason = ctx.parse_error(path) or "解析结果为空"
            findings.append(Finding(ctx.rel(path), f"无法解析：{reason}"))

    if findings:
        return fail("schema_valid", findings)

    # ---- candidate --------------------------------------------------------
    bundle = ctx.candidate()
    if not bundle:
        findings.append(Finding("candidate.yaml", "缺少 bundle 根键"))
    else:
        for key in ("id", "domain"):
            if not bundle.get(key):
                findings.append(Finding("candidate.yaml/bundle", f"缺少 {key}"))
        domain = bundle.get("domain") or {}
        if isinstance(domain, dict) and not domain.get("id"):
            findings.append(Finding("candidate.yaml/bundle/domain", "缺少 id"))
        for collection, required in CANDIDATE_FIELDS.items():
            for index, item in enumerate(as_list(bundle.get(collection))):
                counted += 1
                where = f"candidate.yaml/{collection}[{index}]"
                if not isinstance(item, dict):
                    findings.append(Finding(where, "条目不是映射"))
                    continue
                gaps = _missing(item, required)
                if gaps:
                    label = item.get("id") or "<无 id>"
                    findings.append(Finding(f"{where} {label}", f"缺少字段：{', '.join(gaps)}"))
        for collection in CORE_COLLECTIONS[:3]:
            if not as_list(bundle.get(collection)):
                findings.append(
                    Finding("candidate.yaml", f"{collection} 为空——核心模块要求实体、关系、属性都有内容")
                )

    # ---- evidential_ir ----------------------------------------------------
    evidential = ctx.artifact("evidential_ir.yaml") or {}
    facts = as_list(evidential.get("facts"))
    if not facts:
        findings.append(Finding("evidential_ir.yaml", "facts 为空"))
    for index, item in enumerate(facts):
        counted += 1
        where = f"evidential_ir.yaml/facts[{index}]"
        if not isinstance(item, dict):
            findings.append(Finding(where, "条目不是映射"))
            continue
        gaps = _missing(item, EVIDENTIAL_ITEM_FIELDS)
        if gaps:
            findings.append(Finding(f"{where} {item.get('id', '<无 id>')}", f"缺少字段：{', '.join(gaps)}"))
        anchor = item.get("anchor")
        anchors = as_list(anchor) if not isinstance(anchor, dict) else [anchor]
        for anchor_item in anchors:
            if isinstance(anchor_item, dict):
                anchor_gaps = _missing(anchor_item, ANCHOR_FIELDS)
                if anchor_gaps:
                    findings.append(
                        Finding(f"{where}/anchor", f"缺少字段：{', '.join(anchor_gaps)}")
                    )

    # ---- process_ir -------------------------------------------------------
    process = ctx.artifact("process_ir.yaml") or {}
    steps = as_list(process.get("steps"))
    if not steps:
        findings.append(Finding("process_ir.yaml", "steps 为空"))
    for index, item in enumerate(steps):
        counted += 1
        where = f"process_ir.yaml/steps[{index}]"
        if not isinstance(item, dict):
            findings.append(Finding(where, "条目不是映射"))
            continue
        gaps = _missing(item, PROCESS_STEP_FIELDS)
        if gaps:
            findings.append(Finding(f"{where} {item.get('id', '<无 id>')}", f"缺少字段：{', '.join(gaps)}"))

    # ---- alignment --------------------------------------------------------
    alignment = ctx.artifact("alignment.yaml") or {}
    mappings = as_list(alignment.get("mappings"))
    if not mappings:
        findings.append(Finding("alignment.yaml", "mappings 为空"))
    for index, item in enumerate(mappings):
        counted += 1
        where = f"alignment.yaml/mappings[{index}]"
        if not isinstance(item, dict):
            findings.append(Finding(where, "条目不是映射"))
            continue
        gaps = _missing(item, ALIGNMENT_FIELDS)
        if gaps:
            findings.append(Finding(f"{where} {item.get('id', '<无 id>')}", f"缺少字段：{', '.join(gaps)}"))

    return fail("schema_valid", findings, counted) if findings else ok("schema_valid", counted)


@check("layer_separation")
def layer_separation(ctx: Context):
    findings: list[Finding] = []
    counted = 0

    for filename in ("process_ir.yaml", "evidential_ir.yaml"):
        data = ctx.artifact(filename)
        if not isinstance(data, dict):
            continue
        counted += 1
        leaked = sorted(TARGET_DESIGN_KEYS & set(data.keys()))
        if leaked:
            findings.append(
                Finding(
                    filename,
                    f"含目标设计字段 {', '.join(leaked)}——设计决定属于 candidate.yaml",
                )
            )
        # A step or fact carrying a finished design decision is the same leak
        # one level down, and the more common one in practice.
        for collection in ("steps", "facts"):
            for index, item in enumerate(as_list(data.get(collection))):
                if not isinstance(item, dict):
                    continue
                counted += 1
                inner = sorted(TARGET_DESIGN_KEYS & set(item.keys()))
                if inner:
                    findings.append(
                        Finding(
                            f"{filename}/{collection}[{index}]",
                            f"条目内含目标设计字段 {', '.join(inner)}",
                        )
                    )

    alignment = ctx.artifact("alignment.yaml") or {}
    for index, item in enumerate(as_list(alignment.get("mappings"))):
        if not isinstance(item, dict):
            continue
        counted += 1
        where = f"alignment.yaml/mappings[{index}] {item.get('id', '')}"
        if not item.get("source") or not item.get("target"):
            findings.append(Finding(where, "缺少 source 或 target——无端点的对齐没有依据"))
        if item.get("confidence") in (None, ""):
            findings.append(Finding(where, "缺少 confidence"))

    return fail("layer_separation", findings, counted) if findings else ok("layer_separation", counted)
