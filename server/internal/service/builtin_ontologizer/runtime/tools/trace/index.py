"""Build and query the trace index for a revision.

Every "why does this object exist" answer in this package comes from here. The
index is derived, never authored: if it disagrees with the artifacts, the index is
wrong and gets rebuilt — which is exactly what `trace_index_current` checks.
"""

from __future__ import annotations

import datetime as _dt
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
for _extra in (_ROOT, _ROOT / "shared" / "lib"):
    if str(_extra) not in sys.path:
        sys.path.insert(0, str(_extra))

import yamlio  # noqa: E402
from paths import Paths  # noqa: E402

FIELDS = [
    "object_id", "object_kind", "object_revision", "source_ids", "source_digests",
    "anchors", "support_types", "alignment_ids", "confidence_or_uncertainty",
    "validator_results", "change_history", "evaluation_links", "scope_membership",
    "orphaned",
]


def _as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _load(path: Path):
    if not Path(path).is_file():
        return None
    try:
        return yamlio.load_path(path)
    except Exception:
        return None


KIND_BY_COLLECTION = {
    "entities": "entity", "relationships": "relationship", "attributes": "attribute",
    "events": "event", "lifecycles": "lifecycle", "constraints": "constraint",
    "policies": "policy", "capabilities": "capability", "bindings": "binding",
    "metrics": "metric",
}


def _declarations(bundle: dict) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for collection, kind in KIND_BY_COLLECTION.items():
        for item in _as_list(bundle.get(collection)):
            if isinstance(item, dict) and item.get("id"):
                entry = dict(item)
                entry["_kind"] = kind
                result[item["id"]] = entry
    return result


def build(workspace: Path, revision_id: str, *, derived: bool = True) -> dict:
    """Build the trace records for a revision.

    `derived=False` leaves out the two fields that depend on files outside the
    revision — scope membership (owned by a later release) and orphan status
    (owned by the workspace comment log). That is the form `write()` stores
    inside a sealed revision, so the stored index stays true forever instead of
    going stale the moment a release assigns a scope.
    """
    paths = Paths(Path(workspace))
    revision_dir = paths.revision(revision_id)
    candidate = _load(revision_dir / "candidate.yaml") or {}
    bundle = candidate.get("bundle", candidate) or {}
    alignment = _load(revision_dir / "alignment.yaml") or {}
    evidential = _load(revision_dir / "evidential_ir.yaml") or {}
    meta = _load(revision_dir / "revision.yaml") or {}

    mappings = {
        item["id"]: item
        for item in _as_list(alignment.get("mappings"))
        if isinstance(item, dict) and item.get("id")
    }
    facts = {
        item["id"]: item
        for item in _as_list(evidential.get("facts"))
        if isinstance(item, dict) and item.get("id")
    }
    validator_results = _validator_results(revision_dir)
    parent_declarations = {}
    parent = meta.get("parent")
    if parent:
        parent_candidate = _load(paths.revision(parent) / "candidate.yaml") or {}
        parent_declarations = _declarations(parent_candidate.get("bundle", parent_candidate) or {})
    scopes = _scope_membership(paths) if derived else {}

    records = []
    for identifier, item in sorted(_declarations(bundle).items()):
        source_ids, digests, anchors, alignment_ids, support_types, confidence = [], [], [], [], [], []
        for support in _as_list(item.get("support")):
            if not isinstance(support, dict):
                continue
            support_types.append(support.get("type"))
            if support.get("type") == "evidence":
                alignment_id = support.get("alignment_id")
                if alignment_id:
                    alignment_ids.append(alignment_id)
                mapping = mappings.get(alignment_id) or {}
                if mapping.get("confidence") is not None:
                    confidence.append(str(mapping["confidence"]))
                fact = facts.get(mapping.get("source")) or {}
                for key in ("source_id", "source_ids"):
                    source_ids.extend(str(value) for value in _as_list(fact.get(key)))
                if fact.get("source_digest"):
                    digests.append(fact["source_digest"])
                anchor = fact.get("anchor")
                anchors.extend([anchor] if isinstance(anchor, dict) else _as_list(anchor))
            elif support.get("id"):
                source_ids.append(str(support["id"]))
        records.append(
            {
                "object_id": identifier,
                "object_kind": item["_kind"],
                "object_revision": revision_id,
                "source_ids": sorted(set(source_ids)),
                "source_digests": sorted(set(digests)),
                "anchors": [a for a in anchors if isinstance(a, dict)],
                "support_types": sorted({t for t in support_types if t}),
                "alignment_ids": sorted(set(alignment_ids)),
                "confidence_or_uncertainty": ", ".join(sorted(set(confidence))) or None,
                "validator_results": validator_results.get(identifier, []),
                "change_history": _change_history(identifier, item, parent_declarations, revision_id, parent),
                "evaluation_links": sorted(set(_as_list(item.get("cq_links")))),
                "scope_membership": sorted(scopes.get(identifier, [])),
                "orphaned": False,
            }
        )

    orphans = (
        _orphaned_locators(paths, revision_id, {r["object_id"] for r in records})
        if derived
        else {}
    )
    for locator in sorted(orphans):
        records.append(
            {
                "object_id": locator,
                "object_kind": "orphaned_locator",
                "object_revision": revision_id,
                "source_ids": [], "source_digests": [], "anchors": [],
                "support_types": [], "alignment_ids": [],
                "confidence_or_uncertainty": None,
                "validator_results": [], "change_history": orphans[locator],
                "evaluation_links": [], "scope_membership": [],
                "orphaned": True,
            }
        )

    return {
        "revision": revision_id,
        "built_at": _dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "includes_derived": derived,
        "record_count": len(records),
        "records": records,
    }


def _validator_results(revision_dir: Path) -> dict[str, list]:
    """Map object id to the validator findings that named it."""
    folder = revision_dir / "validation"
    result: dict[str, list] = {}
    if not folder.is_dir():
        return result
    for path in sorted(folder.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for item in payload.get("results", [payload]):
            check_id = item.get("check_id", path.stem)
            for finding in item.get("findings") or []:
                where = str(finding.get("where", "")).split()[0].split("/")[0]
                if where:
                    result.setdefault(where, []).append(
                        {"check_id": check_id, "outcome": item.get("outcome"), "detail": finding.get("detail")}
                    )
    return result


def _change_history(identifier, item, parent_declarations, revision_id, parent) -> list[dict]:
    if not parent:
        return [{"revision": revision_id, "action": "created"}]
    previous = parent_declarations.get(identifier)
    if previous is None:
        return [{"revision": revision_id, "action": "added", "parent": parent}]
    if _canonical(previous) != _canonical(item):
        return [{"revision": revision_id, "action": "changed", "parent": parent}]
    return [{"revision": revision_id, "action": "unchanged", "parent": parent}]


def _canonical(item: dict) -> str:
    return json.dumps({k: v for k, v in sorted(item.items()) if k != "_kind"}, ensure_ascii=False, sort_keys=True, default=str)


def _scope_membership(paths: Paths) -> dict[str, list[str]]:
    membership: dict[str, list[str]] = {}
    for release_id in paths.release_ids():
        scopes = _load(paths.release(release_id) / "access-scopes.yaml") or {}
        for scope in _as_list(scopes.get("scopes")):
            if not isinstance(scope, dict):
                continue
            key = scope.get("scope_key")
            for member in _as_list(scope.get("member_declaration_ids")):
                membership.setdefault(str(member), []).append(f"{release_id}/{key}")
    return membership


def _orphaned_locators(paths: Paths, revision_id: str, present: set[str]) -> dict[str, list]:
    """Comments and requested changes whose target no longer exists here."""
    comments = _load(paths.comments) or {}
    orphans: dict[str, list] = {}
    for item in _as_list(comments.get("comments")):
        if not isinstance(item, dict):
            continue
        target = item.get("target_object_id")
        if not target or target in present:
            continue
        orphans.setdefault(target, []).append(
            {
                "revision": revision_id,
                "action": "orphaned",
                "from_comment": item.get("change_id") or item.get("id"),
                "source_revision": item.get("source_revision"),
            }
        )
    return orphans


class SealedRevisionError(RuntimeError):
    """Raised rather than rewriting a sealed revision."""


def write(workspace: Path, revision_id: str, *, force: bool = False) -> Path:
    """Store the intrinsic index. Scope membership and orphan status are answered
    live by the `trace` skill, which calls `build(..., derived=True)`.

    Refuses to write into a sealed revision. Rewriting one changes its bytes and
    therefore its digest, which `revision_sealed_immutable` reports as tampering —
    and only sometimes, since a rewrite inside the same second is byte-identical.
    An immutability violation that depends on the clock is worse than one that
    always fires, so this closes the door instead.
    """
    paths = Paths(Path(workspace))
    meta = _load(paths.revision(revision_id) / "revision.yaml") or {}
    if meta.get("sealed") and not force:
        raise SealedRevisionError(
            f"{revision_id} 已封存，不写入索引。要看最新的追溯，"
            f"用 build(ws, '{revision_id}', derived=True) 实时构建。"
        )
    index = build(workspace, revision_id, derived=False)
    target = paths.revision(revision_id) / "trace-index.yaml"
    yamlio.dump_path(target, index)
    return target


def records_by_id(index: dict) -> dict[str, dict]:
    return {record["object_id"]: record for record in index.get("records") or []}
