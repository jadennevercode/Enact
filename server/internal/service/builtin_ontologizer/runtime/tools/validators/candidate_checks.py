"""Checks on the Ontology layer: identity, references, traceability, semantics.

These are the checks that keep a candidate from being an entity-relationship
picture with confident-sounding names. Each one exists because a specific failure
mode is cheap for a model to produce and expensive for a reviewer to notice.
"""

from __future__ import annotations

import re

from .base import KIND_BY_COLLECTION, Context, Finding, check, fail, ok, as_list

IS_A_MARKERS = ("是一种", "是一类", "属于", "is a ", "is-a", "subtype", "子类", "kind of")
INHERITANCE_SEMANTICS = {"inheritance", "subclass", "subclass_of", "is_a", "specialisation", "specialization"}
PUNCTUATION = re.compile(r"[\s\-_·,，。.:：;；\"'（）()\[\]]+")


def _normalise(text: str) -> str:
    return PUNCTUATION.sub("", str(text or "")).lower()


@check("ids_stable_unique")
def ids_stable_unique(ctx: Context):
    findings: list[Finding] = []
    bundle = ctx.candidate()
    seen: dict[str, str] = {}
    counted = 0

    for collection in KIND_BY_COLLECTION:
        for item in as_list(bundle.get(collection)):
            if not isinstance(item, dict):
                continue
            identifier = item.get("id")
            if not identifier:
                continue
            counted += 1
            if identifier in seen:
                findings.append(
                    Finding(identifier, f"id 重复，出现在 {seen[identifier]} 与 {collection}")
                )
            seen[identifier] = collection

    parent = (ctx.revision_meta() or {}).get("parent")
    if parent and ctx.paths.revision(parent).is_dir():
        parent_by_name: dict[tuple[str, str], str] = {}
        for identifier, item in ctx.declarations(parent).items():
            name = item.get("canonical_name") or item.get("view_label")
            if name:
                parent_by_name[(item["_kind"], _normalise(name))] = identifier
        for identifier, item in ctx.declarations().items():
            name = item.get("canonical_name") or item.get("view_label")
            if not name:
                continue
            key = (item["_kind"], _normalise(name))
            previous = parent_by_name.get(key)
            if previous and previous != identifier:
                findings.append(
                    Finding(
                        identifier,
                        f"与 {parent} 中同名对象 {previous} 的 id 不同——改名不应产生新对象",
                    )
                )

    return fail("ids_stable_unique", findings, counted) if findings else ok("ids_stable_unique", counted)


def _process_ids(ctx: Context) -> set[str]:
    process = ctx.artifact("process_ir.yaml") or {}
    found = set()
    for collection in ("steps", "events", "decisions", "handoffs", "exceptions", "records", "roles"):
        for item in as_list(process.get(collection)):
            if isinstance(item, dict) and item.get("id"):
                found.add(item["id"])
    return found


def _evidence_ids(ctx: Context) -> set[str]:
    evidential = ctx.artifact("evidential_ir.yaml") or {}
    return {
        item["id"]
        for item in as_list(evidential.get("facts"))
        if isinstance(item, dict) and item.get("id")
    }


def _alignment_map(ctx: Context) -> dict[str, dict]:
    alignment = ctx.artifact("alignment.yaml") or {}
    return {
        item["id"]: item
        for item in as_list(alignment.get("mappings"))
        if isinstance(item, dict) and item.get("id")
    }


def _assumption_ids(ctx: Context) -> set[str]:
    register = ctx.load(ctx.paths.fagc) or {}
    found = set()
    for item in as_list(register.get("statements")):
        if isinstance(item, dict) and item.get("statement_id"):
            found.add(item["statement_id"])
    return found


@check("refs_resolve")
def refs_resolve(ctx: Context):
    findings: list[Finding] = []
    declarations = ctx.declarations()
    entities = {i for i, d in declarations.items() if d["_kind"] == "entity"}
    events = {i for i, d in declarations.items() if d["_kind"] == "event"}
    process_ids = _process_ids(ctx)
    alignments = _alignment_map(ctx)
    assumptions = _assumption_ids(ctx)
    evidence_ids = _evidence_ids(ctx)
    counted = 0

    def require(target, where, universe, label):
        nonlocal counted
        for value in as_list(target):
            if value in (None, ""):
                continue
            counted += 1
            if value not in universe:
                findings.append(Finding(where, f"{label} 引用 {value} 无法解析"))

    bundle = ctx.candidate()
    for item in as_list(bundle.get("relationships")):
        if not isinstance(item, dict):
            continue
        where = item.get("id", "<关系>")
        require(item.get("source"), where, entities, "source")
        require(item.get("target"), where, entities, "target")
    for item in as_list(bundle.get("attributes")):
        if isinstance(item, dict):
            require(item.get("owner"), item.get("id", "<属性>"), entities, "owner")
    for item in as_list(bundle.get("events")):
        if not isinstance(item, dict):
            continue
        where = item.get("id", "<事件>")
        require(item.get("participants"), where, entities, "participants")
        require(item.get("changes_state_of"), where, entities, "changes_state_of")
        if item.get("process_ref"):
            require(item.get("process_ref"), where, process_ids, "process_ref")
    for item in as_list(bundle.get("lifecycles")):
        if not isinstance(item, dict):
            continue
        where = item.get("id", "<生命周期>")
        require(item.get("entity"), where, entities, "entity")
        states = {str(state) for state in as_list(item.get("states"))}
        for index, transition in enumerate(as_list(item.get("transitions"))):
            if not isinstance(transition, dict):
                continue
            counted += 1
            for end in ("from", "to"):
                value = transition.get(end)
                if value is not None and str(value) not in states:
                    findings.append(
                        Finding(f"{where}/transitions[{index}]", f"{end} 状态 {value} 不在 states 中")
                    )
            if transition.get("trigger"):
                require(transition["trigger"], f"{where}/transitions[{index}]", events | process_ids, "trigger")
    for item in as_list(bundle.get("constraints")):
        if isinstance(item, dict):
            require(item.get("scope"), item.get("id", "<约束>"), set(declarations), "scope")
    for collection, key in (("policies", "action"), ("capabilities", "target_entity"), ("bindings", "target")):
        for item in as_list(bundle.get(collection)):
            if isinstance(item, dict) and item.get(key):
                require(item[key], item.get("id", collection), set(declarations) | entities, key)

    # support links and CQ links
    cq_register = ctx.load(ctx.paths.cq_register) or {}
    cq_ids = {
        item["cq_id"]
        for item in as_list(cq_register.get("questions"))
        if isinstance(item, dict) and item.get("cq_id")
    }
    for identifier, item in declarations.items():
        for support in as_list(item.get("support")):
            if not isinstance(support, dict):
                findings.append(Finding(identifier, "support 条目不是映射"))
                continue
            counted += 1
            kind = support.get("type")
            if kind == "evidence":
                alignment_id = support.get("alignment_id")
                if not alignment_id:
                    findings.append(Finding(identifier, "evidence 型 support 缺少 alignment_id"))
                elif alignment_id not in alignments:
                    findings.append(Finding(identifier, f"alignment_id {alignment_id} 无法解析"))
            elif kind == "assumption":
                assumption_id = support.get("id")
                if assumption_id and assumptions and assumption_id not in assumptions:
                    findings.append(Finding(identifier, f"assumption {assumption_id} 不在 FAGC 登记中"))
            elif kind == "process_reference":
                require(support.get("id"), identifier, process_ids, "process_reference")
        if cq_ids:
            require(item.get("cq_links"), identifier, cq_ids, "cq_links")

    # alignment endpoints must land on things that exist
    for identifier, mapping in alignments.items():
        counted += 1
        source = mapping.get("source")
        target = mapping.get("target")
        if source not in evidence_ids | process_ids:
            findings.append(Finding(f"alignment/{identifier}", f"source {source} 不在 evidential_ir 或 process_ir 中"))
        if target not in declarations:
            findings.append(Finding(f"alignment/{identifier}", f"target {target} 不在 candidate 中"))

    return fail("refs_resolve", findings, counted) if findings else ok("refs_resolve", counted)


@check("trace_complete")
def trace_complete(ctx: Context):
    findings: list[Finding] = []
    declarations = ctx.declarations()
    alignments = _alignment_map(ctx)
    evidential = ctx.artifact("evidential_ir.yaml") or {}
    facts = {
        item["id"]: item
        for item in as_list(evidential.get("facts"))
        if isinstance(item, dict) and item.get("id")
    }

    for identifier, item in declarations.items():
        supports = as_list(item.get("support"))
        if not supports:
            findings.append(
                Finding(identifier, "没有任何 support——每个对象都要能解析到证据或显式假设")
            )
            continue
        for support in supports:
            if not isinstance(support, dict) or support.get("type") != "evidence":
                continue
            mapping = alignments.get(support.get("alignment_id"))
            if not mapping:
                continue
            fact = facts.get(mapping.get("source"))
            if fact is None:
                continue  # refs_resolve reports the dangling end
            anchors = fact.get("anchor")
            anchors = [anchors] if isinstance(anchors, dict) else as_list(anchors)
            usable = [
                anchor
                for anchor in anchors
                if isinstance(anchor, dict) and anchor.get("exact_snippet") and anchor.get("location")
            ]
            if not usable:
                findings.append(
                    Finding(
                        identifier,
                        f"经 {mapping['id']} 指向的事实 {fact['id']} 没有可用锚点（需要 location 与 exact_snippet）",
                    )
                )

    return (
        fail("trace_complete", findings, len(declarations))
        if findings
        else ok("trace_complete", len(declarations))
    )


@check("definition_present")
def definition_present(ctx: Context):
    findings: list[Finding] = []
    counted = 0
    for identifier, item in ctx.declarations().items():
        if item["_kind"] not in ("entity", "relationship", "event"):
            continue
        counted += 1
        definition = (item.get("definition") or "").strip()
        if not definition:
            findings.append(Finding(identifier, "definition 为空"))
            continue
        names = [item.get("canonical_name"), item.get("view_label")]
        normalised = _normalise(definition)
        for name in filter(None, names):
            stem = _normalise(name)
            if not stem:
                continue
            if normalised.startswith(stem):
                remainder = normalised[len(stem):]
                if len(remainder) < 8:
                    findings.append(
                        Finding(identifier, f"definition 只是名称的复述：{definition!r}")
                    )
                    break
    return fail("definition_present", findings, counted) if findings else ok("definition_present", counted)


@check("relationship_declared")
def relationship_declared(ctx: Context):
    findings: list[Finding] = []
    counted = 0
    for item in as_list(ctx.candidate().get("relationships")):
        if not isinstance(item, dict):
            continue
        counted += 1
        where = item.get("id", "<关系>")
        for field in ("direction", "source_role", "target_role", "semantics"):
            if not item.get(field):
                findings.append(Finding(where, f"缺少 {field}"))
        cardinality = item.get("cardinality")
        if not isinstance(cardinality, dict) or not cardinality.get("source") or not cardinality.get("target"):
            findings.append(Finding(where, "cardinality 需要同时声明 source 与 target 两端"))
    return fail("relationship_declared", findings, counted) if findings else ok("relationship_declared", counted)


@check("behaviour_present")
def behaviour_present(ctx: Context):
    bundle = ctx.candidate()
    events = as_list(bundle.get("events"))
    lifecycles = as_list(bundle.get("lifecycles"))
    findings: list[Finding] = []
    if not events:
        findings.append(Finding("candidate.yaml", "没有事件：世界如何变化没有被建模"))
    if not lifecycles:
        findings.append(Finding("candidate.yaml", "没有生命周期：允许怎样变化没有被建模"))
    result = fail("behaviour_present", findings) if findings else ok("behaviour_present", len(events) + len(lifecycles))
    result.level = "warning"
    return result


@check("inheritance_is_a")
def inheritance_is_a(ctx: Context):
    findings: list[Finding] = []
    counted = 0
    for item in as_list(ctx.candidate().get("relationships")):
        if not isinstance(item, dict):
            continue
        semantics = str(item.get("semantics") or "").lower()
        name = str(item.get("canonical_name") or item.get("id") or "").lower()
        looks_inherited = semantics in INHERITANCE_SEMANTICS or "subclass" in name or "is_a" in name
        if not looks_inherited:
            continue
        counted += 1
        definition = str(item.get("definition") or "")
        if not any(marker in definition.lower() for marker in IS_A_MARKERS):
            findings.append(
                Finding(
                    item.get("id", "<关系>"),
                    "声明为继承，但 definition 没有说明 is-a 判据——组成、拥有、参与不应写成继承",
                )
            )
    result = fail("inheritance_is_a", findings, counted) if findings else ok("inheritance_is_a", counted)
    result.level = "warning"
    return result
