"""Ledger tools — the resolved fate of every indicator, derived and never stored.

`ledger.derive` is called by almost every S2 task, because almost every S2 task
needs the answer to "what has already been rejected". The six layers rule in order
and a rejection at any one is inherited by every later one: the indicator is not
re-scored, not re-offered, and never reaches the model.

The ledger stores nothing. It resolves each fate from the layers' own records — the
scorecards, the sign-offs, the OLS config — so it cannot disagree with them. A
stored copy eventually disagrees with the thing it was copied from, which is the
drift this design exists to prevent.
"""
from __future__ import annotations

from mmm_engine import workspace as ws
from mmm_engine.cli.registry import Arg, Result, tool
from mmm_engine.dataeng import indicators, mapping
from mmm_engine.dataeng import mapping_suggest as suggest
from mmm_engine.cli.meta import artifact_meta
from mmm_engine.selection import factor_link, ledger as L


@tool("ledger.derive", "ledger",
      "Resolve every indicator's fate across the six S2 layers, and the one selection.",
      args=[Arg("--layer", "report what this layer inherits (default: all)")],
      out_default="data/derived/selection.json")
def ledger_derive(ctx) -> Result:
    result = Result()
    st = ctx.state
    try:
        rows = L.indicator_ledger(st)
    except Exception as error:  # noqa: BLE001
        result.ok = False
        return result.find("could not resolve the ledger: %s" % error)

    if not rows:
        result.ok = False
        result.payload = {"rows": [], "reason": "no indicator reached the ledger — "
                                                "the published table has no drivers"}
        return result.find("no indicator reached the ledger. Either nothing is "
                           "published, or every metric is tagged Y.")

    selection = L.model_selection(st)
    objects = sorted({r.object for r in rows})

    payload = {
        "objects": objects,
        "y": _plain(getattr(selection, "y", None)),
        "exclude": _keyset(getattr(selection, "exclude", None)),
        # `include` stays None per object until 2.5 has proposed a setup — that is
        # the legacy auto-select path, and null is a real answer, not an empty one.
        "include": _keyset(getattr(selection, "include", None)),
        "rows": [{
            "object": r.object, "l4": r.l4, "metric": r.metric,
            "treeRowId": getattr(r, "tree_row_id", ""),
            "rejectedAt": r.rejected_at, "reason": r.reason,
            "verdicts": [{"layer": v.layer, "task": v.task, "status": v.status,
                          "note": v.note} for v in r.verdicts],
        } for r in rows],
    }
    result.payload = payload

    # Bounded summary: the counts, and where things died — never 800 rows.
    by_layer: dict[str, int] = {}
    for row in rows:
        if row.rejected_at:
            by_layer[row.rejected_at] = by_layer.get(row.rejected_at, 0) + 1
    survivors = sum(1 for r in rows if not r.rejected_at)

    result.say("%d ledger row(s) across %d model object(s)" % (len(rows), len(objects)))
    result.say("%d survive every layer" % survivors)
    if by_layer:
        result.say("")
        result.say("rejected at:")
        for layer, _task, label in L.LAYERS:
            if by_layer.get(layer):
                result.say("  %-14s %-34s %d" % (layer, label, by_layer[layer]))

    if ctx.opt("layer"):
        layer = str(ctx.opt("layer"))
        inherited = L.drops_before(st, layer)
        result.say("")
        result.say("%s inherits %d rejection(s) from earlier layers" % (layer, len(inherited)))
        for key in sorted(inherited)[:8]:
            result.say("    %s :: %s" % key)
        result.say("  A layer must never re-score these — that inheritance is what")
        result.say("  stops a dropped indicator re-entering the model three steps later.")
    return result


def _plain(value):
    if isinstance(value, dict):
        return {str(k): str(v) for k, v in value.items()}
    return str(value) if value is not None else None


def _keyset(value):
    """`{object: {(l4, metric), …}}` → `{object: ["l4::metric", …]}`.

    `None` for an object is preserved as `None`: "no explicit selection yet" and
    "an empty selection" are different states, and flattening them is how a fit
    silently reverts to auto-selecting its own drivers.
    """
    if not isinstance(value, dict):
        return sorted(str(x) for x in (value or []))
    out = {}
    for key, pairs in value.items():
        if pairs is None:
            out[str(key)] = None
            continue
        out[str(key)] = sorted("%s::%s" % (a, b) if isinstance(a, str) else str(a)
                               for a, b in pairs)
    return out


@tool("data.factor-map", "data",
      "Resolve every active factor row to mapped, ignored or pending.",
      out_default="artifacts/s2/factor-map.yaml")
def data_factor_map(ctx) -> Result:
    """The FactorTree ↔ data join, as the 2.1 review sheet.

    Keyed through `factor_link`, never by name. The tree speaks `(l4, indicator)`
    and the data speaks `(l4, metric)`; before that bridge existed, 123 factor rows
    a human had ignored matched zero data keys, so `drops_before` was a filter that
    never filtered and a rejected factor went on being scored, screened and fitted.
    """
    result = Result()
    st = ctx.state
    fmap = mapping.resolve_factor_map(st)
    rows = list(getattr(fmap, "rows", []) or [])
    if not rows:
        result.ok = False
        return result.find("no factor rows — the tree is empty or absent")

    existing = {str(r.get("id")): r for r in
                (ws.read_yaml(ctx.path(ws.FACTOR_MAP)).get("rows") or [])
                if isinstance(r, dict)}

    # Published metrics no active row claims. They are the only honest candidate
    # pool for a pending row: anything else is already supplying something.
    try:
        orphans = list(indicators.orphan_indicators(st))
    except Exception:  # noqa: BLE001 — no coverage yet is not a failure
        orphans = []

    out = []
    for row in rows:
        rid = str(getattr(row, "row_id", "") or getattr(row, "id", ""))
        prior = existing.get(rid, {})
        entry = {
            "id": rid,
            "l1": getattr(row, "l1", ""), "l2": getattr(row, "l2", ""),
            "l3": getattr(row, "l3", ""), "l4": getattr(row, "l4", ""),
            "indicator": getattr(row, "indicator", ""),
            "status": getattr(row, "status", "pending"),
            "metricType": getattr(row, "metric_type", ""),
            "aggregation": getattr(row, "aggregation", ""),
            # Every source supplying this row. The attribute is `coverages`; reading
            # a `sources` that never existed made this the empty list on every row
            # for the whole life of the tool, so a `mapped` row said "there is data"
            # and never said which.
            "suppliedBy": [_supply(c) for c in (getattr(row, "coverages", None) or [])],
            # A human's ignore note is a decision — carried across a re-derivation
            # rather than recomputed away.
            "ignoreNote": (getattr(row, "ignore_note", "")
                           or prior.get("ignoreNote", "")),
            "decidedBy": prior.get("decidedBy", ""),
        }
        if entry["status"] == "pending" and orphans:
            entry["candidates"] = [c.as_dict() for c in suggest.suggest(row, orphans)]
        out.append(entry)

    ignores = {r["id"]: r["ignoreNote"] for r in out
               if r["status"] == "ignored" and r["ignoreNote"]}
    counts: dict[str, int] = {}
    for row in out:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    suggested = sum(1 for r in out if r.get("candidates"))
    result.payload = {
        "meta": artifact_meta(ctx, "factor-map/map", "factor-map",
                              ["data/published/coverage.yaml",
                               "artifacts/s1/factor-tree.yaml",
                               "data/published/manifest.yaml"]),
        "summary": {
            "total": len(out),
            "mapped": counts.get("mapped", 0),
            "ignored": counts.get("ignored", 0),
            "pending": counts.get("pending", 0),
            "complete": len(out) > 0 and counts.get("pending", 0) == 0,
            "orphans": len(orphans),
            "suggested": suggested,
        },
        "rows": out,
        "orphans": [_orphan(o) for o in orphans],
        "ignores": ignores,
    }

    result.say("%d factor row(s): %s" % (
        len(out), " · ".join("%d %s" % (v, k) for k, v in sorted(counts.items()))))

    pending = [r for r in out if r["status"] == "pending"]
    if pending:
        result.say("")
        result.say("needing a decision — supplied by nothing, not yet ignored:")
        for row in pending[:12]:
            best = (row.get("candidates") or [None])[0]
            hint = ("  ← %s (%.2f)" % (best["metric"], best["score"])) if best else ""
            result.say("    %-28s %s%s" % (row["l4"], row["indicator"], hint))
        result.say("")
        result.say("%d of them have a scored candidate. The score is arithmetic over"
                   % suggested)
        result.say("name, path, unit and coverage — it ranks, it does not decide.")
        result.say("Ignore one only if the project truly will not model it. The ignore")
        result.say("is inherited by every later layer — it is a decision, not a note.")
    if orphans:
        result.say("")
        result.say("%d published metric(s) no factor row asked for — listed, not ruled "
                   "on here." % len(orphans))

    try:
        orphan_keys = factor_link.build(st)
        del orphan_keys
    except Exception:  # noqa: BLE001 — the bridge is advisory here
        pass
    return result


def _supply(coverage) -> dict:
    return {
        "coverageId": getattr(coverage, "coverage_id", ""),
        "assetId": getattr(coverage, "asset_id", ""),
        "assetName": getattr(coverage, "asset_name", ""),
        "metric": getattr(coverage, "metric", ""),
        "coverageStart": getattr(coverage, "coverage_start", ""),
        "coverageEnd": getattr(coverage, "coverage_end", ""),
        "rows": int(getattr(coverage, "rows", 0) or 0),
        "boundBy": getattr(coverage, "bound_by", ""),
    }


def _orphan(indicator) -> dict:
    return {
        "coverageId": getattr(indicator, "id", ""),
        "metric": getattr(indicator, "metric", ""),
        "assetName": getattr(indicator, "assetName", ""),
        "l1": getattr(indicator, "l1", ""), "l4": getattr(indicator, "l4", ""),
        "rows": int(getattr(indicator, "rows", 0) or 0),
        "note": "由因子树的采纳/驳回处理，不在本交付物裁决",
    }
