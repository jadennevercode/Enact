"""Render a candidate bundle as an idempotent openCypher script.

The script is a portable projection of the bundle, not a second source of truth:
every node and relationship carries the stable declaration id, so re-running it
converges rather than duplicating, and a graph built from it can be diffed back
against candidate.yaml.
"""

from __future__ import annotations

import re

LABELS = {
    "entity": "OntEntity",
    "relationship": "OntRelationship",
    "attribute": "OntAttribute",
    "event": "OntEvent",
    "lifecycle": "OntLifecycle",
    "constraint": "OntConstraint",
    "policy": "OntPolicy",
    "capability": "OntCapability",
    "binding": "OntBinding",
    "metric": "OntMetric",
}
IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
SCALAR_PROPERTIES = {
    "view_label", "canonical_name", "definition", "semantics", "direction",
    "datatype", "unit_or_format", "classification", "kind", "statement",
    "modality", "intent", "binding_kind", "source_system", "business_purpose",
    "temporality", "nullable", "multi_valued", "is_identity", "is_derived",
}


def quote(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    return "'" + text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n") + "'"


def rel_type(item: dict) -> str:
    raw = item.get("canonical_name") or item.get("id", "RELATED")
    cleaned = re.sub(r"[^A-Za-z0-9_]", "_", str(raw).split(".")[-1]).upper().strip("_")
    if not cleaned or not IDENTIFIER.match(cleaned):
        cleaned = "RELATED_TO"
    return cleaned


def _properties(item: dict, extra: dict | None = None) -> str:
    pairs = []
    for key in sorted(SCALAR_PROPERTIES & set(item)):
        value = item[key]
        if isinstance(value, (dict, list)):
            continue
        if value in (None, ""):
            continue
        pairs.append(f"n.{key} = {quote(value)}")
    for key, value in (extra or {}).items():
        if value not in (None, ""):
            pairs.append(f"n.{key} = {quote(value)}")
    return ", ".join(pairs)


def render(bundle: dict, revision_id: str = "", digest: str = "") -> str:
    lines: list[str] = []
    add = lines.append
    add(f"// ontologizer candidate  revision={revision_id or bundle.get('id', '')}")
    if digest:
        add(f"// inputs_digest={digest}")
    add("// Generated from candidate.yaml. Idempotent: every MERGE keys on the stable declaration id.")
    add("")
    add("CREATE CONSTRAINT ont_declaration_id IF NOT EXISTS")
    add("FOR (n:OntDeclaration) REQUIRE n.id IS UNIQUE;")
    add("")

    domain = bundle.get("domain") or {}
    if domain.get("id"):
        add(
            f"MERGE (n:OntDomain:OntDeclaration {{id: {quote(domain['id'])}}}) "
            f"SET n.name = {quote(domain.get('name', domain['id']))};"
        )
        add("")

    def declaration_lines(collection: str, kind: str, extra_fn=None):
        items = bundle.get(collection) or []
        if not items:
            return
        add(f"// ---- {collection} ----")
        for item in items:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            label = LABELS[kind]
            props = _properties(item, extra_fn(item) if extra_fn else None)
            statement = f"MERGE (n:{label}:OntDeclaration {{id: {quote(item['id'])}}})"
            if props:
                statement += f"\nSET {props}"
            add(statement + ";")
        add("")

    declaration_lines("entities", "entity")
    declaration_lines(
        "attributes",
        "attribute",
        lambda item: {"owner": item.get("owner")},
    )
    declaration_lines("events", "event")
    declaration_lines(
        "lifecycles",
        "lifecycle",
        lambda item: {"entity": item.get("entity"), "states": ",".join(str(s) for s in item.get("states") or [])},
    )
    declaration_lines("constraints", "constraint")
    for collection, kind in (
        ("policies", "policy"), ("capabilities", "capability"),
        ("bindings", "binding"), ("metrics", "metric"),
    ):
        declaration_lines(collection, kind)

    relationships = bundle.get("relationships") or []
    if relationships:
        add("// ---- relationships ----")
        for item in relationships:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            cardinality = item.get("cardinality") or {}
            props = [f"r.id = {quote(item['id'])}"]
            for key, value in (
                ("semantics", item.get("semantics")),
                ("direction", item.get("direction")),
                ("source_role", item.get("source_role")),
                ("target_role", item.get("target_role")),
                ("cardinality_source", cardinality.get("source")),
                ("cardinality_target", cardinality.get("target")),
                ("definition", item.get("definition")),
            ):
                if value not in (None, ""):
                    props.append(f"r.{key} = {quote(value)}")
            add(
                f"MATCH (s:OntDeclaration {{id: {quote(item.get('source'))}}}), "
                f"(t:OntDeclaration {{id: {quote(item.get('target'))}}})\n"
                f"MERGE (s)-[r:{rel_type(item)}]->(t)\n"
                f"SET {', '.join(props)};"
            )
        add("")

    # attribute ownership and lifecycle ownership as edges, so a graph query can
    # walk from an entity to what it has without re-reading the YAML.
    edges = []
    for item in bundle.get("attributes") or []:
        if isinstance(item, dict) and item.get("owner") and item.get("id"):
            edges.append((item["owner"], "HAS_ATTRIBUTE", item["id"]))
    for item in bundle.get("lifecycles") or []:
        if isinstance(item, dict) and item.get("entity") and item.get("id"):
            edges.append((item["entity"], "HAS_LIFECYCLE", item["id"]))
    for item in bundle.get("events") or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        for participant in item.get("participants") or []:
            edges.append((participant, "PARTICIPATES_IN", item["id"]))
    if edges:
        add("// ---- structural edges ----")
        for source, kind, target in edges:
            add(
                f"MATCH (s:OntDeclaration {{id: {quote(source)}}}), "
                f"(t:OntDeclaration {{id: {quote(target)}}})\n"
                f"MERGE (s)-[:{kind}]->(t);"
            )
        add("")

    return "\n".join(lines).rstrip() + "\n"
