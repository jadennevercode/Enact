"""The parity cases — computed once against each side, compared cell for cell.

`make_golden.py` runs these against the **platform** and freezes the results;
`test_golden.py` runs them against the **vendored engine** and must reproduce them
exactly. Both import this module and pass in their own set of functions, so
neither side can quietly compute something else.

Why cases live here rather than in either runner: a parity test whose two halves
are written separately checks that two pieces of test code agree, which is not the
question. Here there is one piece of test code and two engines.
"""
from __future__ import annotations

import math
from typing import Any, Callable

import golden_fixture as fx


def _round(value: Any, places: int = 6) -> Any:
    """Round for comparison, recursively. Floats summed in a different order differ
    in the last bits; a difference that matters is never in the 7th decimal."""
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Inf"
        return round(value, places)
    if isinstance(value, dict):
        return {str(k): _round(v, places) for k, v in sorted(value.items(), key=lambda kv: str(kv[0]))}
    if isinstance(value, (list, tuple)):
        return [_round(v, places) for v in value]
    if hasattr(value, "item"):          # numpy scalar
        try:
            return _round(value.item(), places)
        except Exception:  # noqa: BLE001
            pass
    if value is None or isinstance(value, (str, int, bool)):
        return value
    return str(value)


def compute(api: dict[str, Callable]) -> dict[str, Any]:
    """Run every case with one side's functions. Returns {case: result}.

    `api` maps a capability name to that side's implementation, so this module
    never imports either engine.
    """
    out: dict[str, Any] = {}
    df = api["frame"]()

    # ── quality: the four registered tools over every series, then the rollup ──
    # Called through the tool registry on purpose: the parity that matters is the
    # one an identity wrapper could break. `_test_tools` asserted wrapper ==
    # direct call; this asserts wrapper(vendored) == wrapper(platform).
    tool = api["tool"]
    evidence_of = api["compute_series_evidence"]
    field_ctx = api["field_context"](df)
    make_ctx = api["make_context"]

    evidences, contexts, labels = [], [], []
    for (l1, l2, l3, l4, metric), group in df.groupby(
            ["l1", "l2", "l3", "l4", "metric"], dropna=False):
        if not str(metric).strip() or str(metric) == "<NA>":
            continue
        pair = field_ctx.get((l1, l2, l3, l4))
        ctx = make_ctx(has_spend=bool(pair and pair.has_spend),
                       has_performance=not pair or pair.has_performance)
        evidences.append(evidence_of(group, ctx))
        contexts.append(ctx)
        labels.append("%s::%s" % (l4, metric))

    dims = {"consistency": "quality.consistency", "accuracy": "quality.accuracy",
            "completeness": "quality.completeness", "granularity": "quality.granularity"}
    quality: dict[str, Any] = {}
    batched: dict[str, list] = {}
    for dim, tool_id in dims.items():
        # Every dimension takes the context now — three of them used not to, which
        # is why the checks that need contract knowledge (the declared unit, the
        # attested total, the modeling window, the required axes) had no way to
        # receive it. `computed` is frozen too: it is the bit that separates
        # "checked and fine" from "could not check".
        got = tool(tool_id)(evidences, contexts)
        batched[dim] = got
        quality[dim] = {label: [[s.key, s.score, s.blocking, s.computed] for s in got[i]]
                        for i, label in enumerate(labels)}

    rolled = api["roll_up_quality"]
    quality["rollup"] = {}
    for i, label in enumerate(labels):
        flat = [s for dim in dims for s in batched[dim][i]]
        res = rolled(flat)
        quality["rollup"][label] = [res.consistency, res.accuracy,
                                    res.completeness, res.granularity, res.total]
    out["quality"] = _round(quality)

    # ── statistical: CV, Pearson, VIF over one object's wide frame ──
    mf = api["build_model_frame"](df, "MT::AURELIA")
    cols = sorted(mf.x_cols)
    y = mf.frame[mf.y_col]
    matrix = api["column_stack"]([mf.frame[c].to_numpy(dtype=float) for c in cols])
    out["stat"] = _round({
        "y_col": mf.y_col,
        "columns": cols,
        "cv": tool("stat.cv")([mf.frame[c].to_numpy(dtype=float) for c in cols]),
        "pearson": tool("stat.pearson")([mf.frame[c] for c in cols], y),
        "vif": list(tool("stat.vif")(matrix)),
    })

    # ── the fit ──
    fits = {}
    for obj in ("MT::AURELIA", "TT::AURELIA", "EC::AURELIA"):
        res = api["run_mmm"](df, obj, adstock=0.5, hill_half=1.0)
        fits[obj] = {
            "r2": res.r2, "adj_r2": getattr(res, "adj_r2", None), "mape": res.mape,
            "drivers": sorted(res.contribution.keys()),
            "contribution": res.contribution,
            "roi": res.roi,
        }
    out["fit"] = _round(fits)

    # ── the ledger: universe, objects, and inheritance of a 2.2 drop ──
    st = api["state"]()
    out["objects"] = list(api["model_objects"](st))
    rows = api["indicator_ledger"](st)
    out["ledger"] = _round(sorted(
        [{"object": r.object, "key": "%s::%s" % (r.l4, r.metric),
          "rejectedAt": r.rejected_at,
          "verdicts": {v.layer: v.status for v in r.verdicts}}
         for r in rows],
        key=lambda r: (r["object"], r["key"])))
    sel = api["model_selection"](st)
    out["selection"] = _round({
        "y": dict(sel.y) if isinstance(sel.y, dict) else sel.y,
        "exclude": {k: sorted("%s::%s" % p for p in v)
                    for k, v in (sel.exclude or {}).items()}
        if isinstance(sel.exclude, dict) else sorted(str(x) for x in (sel.exclude or [])),
    })

    return out


def compare(expected: dict, actual: dict) -> list[str]:
    """Every place the two disagree, as readable lines. Empty means identical."""
    problems: list[str] = []
    for case in sorted(set(expected) | set(actual)):
        if case not in expected:
            problems.append("%s: present in the engine, absent from the golden file" % case)
            continue
        if case not in actual:
            problems.append("%s: in the golden file, not produced by the engine" % case)
            continue
        problems.extend("%s%s" % (case, tail)
                        for tail in _diff(expected[case], actual[case], ""))
    return problems


def _diff(a: Any, b: Any, path: str, limit: int = 6) -> list[str]:
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for key in sorted(set(a) | set(b)):
            if key not in a:
                out.append("%s.%s: engine added it" % (path, key))
            elif key not in b:
                out.append("%s.%s: engine dropped it" % (path, key))
            else:
                out.extend(_diff(a[key], b[key], "%s.%s" % (path, key)))
            if len(out) >= limit:
                break
        return out[:limit]
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return ["%s: %d entries in golden, %d from the engine" % (path, len(a), len(b))]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out.extend(_diff(x, y, "%s[%d]" % (path, i)))
            if len(out) >= limit:
                break
        return out[:limit]
    if a != b:
        return ["%s: golden %r, engine %r" % (path, a, b)]
    return []
