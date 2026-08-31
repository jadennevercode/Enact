"""Candidate ways to split the data into models, and what each one costs.

This module **enumerates and measures; it never chooses**. The split decides how
many models get built and how many drivers each one can identify, and that is a
question about the client's business — whether two products behave alike, whether
a channel deserves its own read — not a question the arithmetic can settle. So
every candidate is reported with the facts a person needs, and the choice is a
human ruling recorded in `ols-plan.yaml`.

The one thing the arithmetic *can* settle is feasibility. Splitting finer buys
resolution and spends degrees of freedom, and past some point a cell has more
candidate drivers than its months can estimate — at which point the surplus is
held out and the model answers a narrower question than the reader thinks. That
trade is invisible until someone computes it per cell, which is what this does:

    affordable = max(1, months - controls - 1 - MIN_RESIDUAL_DF)

`heldOut = max(0, surviving - affordable)` is the number that actually decides the
split, and it is why `total` is not simply the safe choice: one model over
everything has the most months per cell and the least ability to say anything
about a single channel.
"""
from __future__ import annotations

import pandas as pd

from mmm_engine.selection.model_objects import (
    ANY,
    _clean_col,
    enumerate_objects,
    make_object,
    object_label,
    object_mask,
    skipped_objects,
)
from mmm_engine.selection.ols_review import affordable_drivers

# Ordered coarse → fine. The order is the order a reader should consider them in:
# start from the model with the most months and add splits only where the business
# needs the resolution.
SCHEMES = ("total", "by-brand", "by-channel", "channel-x-brand")

#: Feasibility bands. `tight` is not a failure — it is a model that will hold
#: variables out, which is a fact the chooser has to see before choosing.
FEASIBLE_OK = "ok"
FEASIBLE_TIGHT = "tight"
FEASIBLE_INFEASIBLE = "infeasible"


def _months(df: pd.DataFrame) -> int:
    """Distinct (year, month) periods — the observation count a fit would get.

    Counting `month` alone caps at 12 and would report a three-year panel as a
    one-year one, which is the input to every degrees-of-freedom number below.
    """
    if df is None or df.empty or "month" not in df.columns:
        return 0
    if "year" in df.columns:
        return int(df.dropna(subset=["month"]).drop_duplicates(["year", "month"]).shape[0])
    return int(df["month"].nunique())


def _surviving_drivers(df: pd.DataFrame, mask: pd.Series, vocab) -> int:
    """Distinct (l4, metric) driver pairs visible to one object's slice."""
    from mmm_engine.mmm.pivot import _is_y_row, is_driver_row

    try:
        drv = is_driver_row(df, vocab) & ~_is_y_row(df, vocab)
    except Exception:  # noqa: BLE001 — an untaggable table carries no drivers
        return 0
    slice_ = df[drv & mask]
    if slice_.empty:
        return 0
    cols = [c for c in ("l4", "metric") if c in slice_.columns]
    return int(slice_.drop_duplicates(cols).shape[0]) if cols else 0


def _objects_for(df: pd.DataFrame, scheme: str, st=None) -> list[str]:
    """The object ids a scheme produces, busiest first.

    Every scheme routes through `make_object`, so all four live in one id space and
    the ledger, the config and the frozen verdicts keep quoting the same strings.
    """
    if scheme == "channel-x-brand":
        return enumerate_objects(df, st)
    if scheme == "total":
        return [make_object(ANY, ANY)]
    if scheme == "by-channel":
        seen, out = set(), []
        for obj in enumerate_objects(df, st):
            ct = obj.split("::")[0]
            if ct and ct not in seen:
                seen.add(ct)
                out.append(make_object(ct, ANY))
        return out
    if scheme == "by-brand":
        from mmm_engine.selection.model_objects import response_brands
        brands = response_brands(df, st)
        if not brands:
            return []
        order = [b for b in _clean_col(df, "brand") if b.upper() in brands]
        seen, out = set(), []
        for b in order:
            if b.upper() not in seen:
                seen.add(b.upper())
                out.append(make_object(ANY, b))
        return out
    return []


def _response_total(df: pd.DataFrame, st=None) -> float:
    from mmm_engine.mmm.pivot import _is_y_row
    try:
        y = df[_is_y_row(df, _vocab(st))]
    except Exception:  # noqa: BLE001
        return 0.0
    if y.empty or "value" not in y.columns:
        return 0.0
    return float(pd.to_numeric(y["value"], errors="coerce").fillna(0).sum())


def _vocab(st=None):
    from mmm_engine.domain.vocabulary import DEFAULT_VOCAB, vocab_for
    if st is None:
        return DEFAULT_VOCAB
    try:
        return vocab_for(st)
    except Exception:  # noqa: BLE001
        return DEFAULT_VOCAB


def _object_response(df: pd.DataFrame, mask: pd.Series, st=None) -> float:
    from mmm_engine.mmm.pivot import _is_y_row
    try:
        y = df[_is_y_row(df, _vocab(st)) & mask]
    except Exception:  # noqa: BLE001
        return 0.0
    if y.empty or "value" not in y.columns:
        return 0.0
    return float(pd.to_numeric(y["value"], errors="coerce").fillna(0).sum())


def measure_scheme(df: pd.DataFrame, scheme: str, params, st=None) -> dict:
    """One scheme, with the facts a person needs to choose it or reject it."""
    from mmm_engine.mmm.pivot import MIN_MONTHS

    vocab = _vocab(st)
    total_y = _response_total(df, st)
    objects, infeasible = [], 0

    for obj in _objects_for(df, scheme, st):
        mask = object_mask(df, obj, st)
        sub = df[mask]
        months = _months(sub)
        surviving = _surviving_drivers(df, mask, vocab)
        affordable = affordable_drivers(months, params)
        held_out = max(0, surviving - affordable)
        y_share = (_object_response(df, mask, st) / total_y) if total_y else 0.0
        row = {
            "object": obj,
            "label": object_label(obj),
            "months": months,
            "survivingDrivers": surviving,
            "affordableDrivers": affordable,
            "heldOutCount": held_out,
            "responseCoverage": round(y_share, 4),
        }
        if months < MIN_MONTHS:
            # Below the floor the fit refuses outright, so this is not a tight
            # model — it is no model, and saying so here beats saying it later.
            row["blocked"] = "months<%d" % MIN_MONTHS
            infeasible += 1
        objects.append(row)

    if not objects:
        feasibility = FEASIBLE_INFEASIBLE
    elif infeasible:
        feasibility = FEASIBLE_INFEASIBLE
    elif any(o["heldOutCount"] > 0 for o in objects):
        feasibility = FEASIBLE_TIGHT
    else:
        feasibility = FEASIBLE_OK

    return {
        "scheme": scheme,
        "feasibility": feasibility,
        "objectCount": len(objects),
        "objects": objects,
        "totalHeldOut": sum(o["heldOutCount"] for o in objects),
        "minMonths": min((o["months"] for o in objects), default=0),
        "skippedObjects": [{"object": o, "label": object_label(o),
                            "reason": "no-driver"}
                           for o in (skipped_objects(df, st)
                                     if scheme == "channel-x-brand" else [])],
    }


def build_plan(st) -> dict:
    """Every candidate split, measured. Recommends, and does not decide.

    **The recommendation is the finest feasible scheme**, and tightness does not
    override that. The tempting rule — pick whichever scheme holds out fewest
    variables — is wrong, because `totalHeldOut` is not comparable across schemes:
    four models holding out two each (10) is not worse than one model holding out
    four (4), because the four models answer four questions and the one answers
    one. Applied to the real case that rule recommended `total`, which is the
    split that can say nothing about any channel — in a step whose entire purpose
    is per-channel read.

    So resolution wins by default and the cost is disclosed: `heldOutCount` per
    object and `allTight` are right there, and choosing to coarsen on that evidence
    is exactly the human ruling this step exists to capture.
    """
    from mmm_engine.dataset import model_df

    df = model_df(st)
    params = getattr(getattr(st, "ols_config", None), "params", None)
    if params is None:
        from mmm_engine.selection.ols_review import _propose_params
        params = _propose_params(df)

    candidates = [measure_scheme(df, s, params, st) for s in SCHEMES]
    usable = [c for c in candidates if c["feasibility"] != FEASIBLE_INFEASIBLE]
    pick = usable[-1] if usable else None          # SCHEMES is ordered coarse → fine
    for c in candidates:
        c["recommended"] = pick is not None and c["scheme"] == pick["scheme"]

    return {
        "candidates": candidates,
        "window": {"months": _months(df)},
        "allTight": bool(usable) and all(c["totalHeldOut"] > 0 for c in usable),
        "noneFeasible": not usable,
    }
