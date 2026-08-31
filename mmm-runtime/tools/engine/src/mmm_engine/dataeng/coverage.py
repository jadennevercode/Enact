"""Publish attaches coverage; the indicator catalog stays derived.

VENDORING NOTE — extracted from the platform's `app/dataeng/dbt/service.py`, which
also held the dbt build orchestration this project does not have. What came across
is the part that matters: which published metric supplies which factor-tree row.

`IndicatorCoverage` is the ONLY thing publish persists. An `Indicator` is derived
from the factor tree (`dataeng/indicators.py`) — a stored catalog eventually
disagrees with the tree it was copied from, which is exactly the drift this
replaces.

`tree_row_id == ""` marks an **orphan**: real data the tree never asked for. It is
listed apart and resolved by adoption into the tree or dismissal — never quietly
presented as a project indicator.

Row identity is **path + indicator**, never path alone. The tree routinely carries
several rows per L1–L4 (one factor declaring both 花费 and 执行门店数), so a
path-keyed lookup keeps one arbitrary sibling and hands every metric under that
path to it. On the reference tree that bound 温度 to the row declaring 降水量,
marked it `boundBy="auto"`, and left the row that actually declares 温度 looking
unsupplied.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any, Optional

import pandas as pd

from mmm_engine.assemble.indicator_metadata import (INDICATOR_META_RULE_VERSION,
                                                    classify_indicator)
from mmm_engine.dataeng import indicators
from mmm_engine.domain.models import FactorRow, IndicatorCoverage


def records_from_yaml(rows: list[dict]) -> list[IndicatorCoverage]:
    """Coverage records as stored in `data/published/coverage.yaml`."""
    out: list[IndicatorCoverage] = []
    fields = set(IndicatorCoverage.model_fields.keys())
    aliases = {f.alias for f in IndicatorCoverage.model_fields.values()
               if getattr(f, "alias", None)}
    for row in rows:
        clean = {k: v for k, v in row.items() if k in fields or k in aliases}
        if clean.get("id"):
            out.append(IndicatorCoverage(**clean))
    return out


def records_to_yaml(records: list[IndicatorCoverage]) -> list[dict]:
    return [r.model_dump(mode="json", by_alias=True) for r in records]


def _norm_path(*parts: str) -> str:
    return "|".join("".join(str(p).lower().split()) for p in parts)


def _indicator_id(asset_id: str, vals: dict) -> str:
    """A stable id for one (asset × metric × factor path).

    Derived from identity, not from position in the group-by. A positional id
    (``ind-<asset>-<n>``) was reshuffled by every re-publish, so a stored
    ``indicatorId`` could silently come to mean a different metric.
    """
    key = "|".join(str(vals.get(k, "")) for k in
                   ("metric", "metric_type", "l1", "l2", "l3", "l4"))
    return f"ind-{asset_id}-{hashlib.sha1(key.encode('utf-8')).hexdigest()[:10]}"



@dataclass(frozen=True)
class Asset:
    """A cleaned, publishable asset — `data/clean/<id>/`.

    The platform passed a `DataAsset` off the blackboard. Here an asset is a
    directory, so this carries the only two things claiming needs. `DataAsset`
    still satisfies it structurally, which keeps the vendored logic untouched.
    """
    id: str
    name: str = ""


def claim_published_metrics(st, asset: "Asset", df: pd.DataFrame) -> list[IndicatorCoverage]:
    """Attach this asset's metrics to the factor rows they supply.

    Publish no longer *creates* indicators — the factor tree already declared
    them (``app/dataeng/indicators.py``). Each (metric × factor path) in the mart
    claims the row it matches, recorded as an ``IndicatorCoverage``; anything
    that matches nothing is an orphan (``tree_row_id == ""``) and is offered back
    to the tree rather than presented as a project indicator.

    Replaces this asset's prior coverage — but a human's row binding is a
    decision, not derived state, so it is carried across by id rather than
    discarded on every publish.
    """
    pins = {c.id: c.tree_row_id for c in st.indicator_coverage
            if c.asset_id == asset.id and c.bound_by == "human" and c.tree_row_id}
    st.indicator_coverage = [c for c in st.indicator_coverage if c.asset_id != asset.id]
    if "metric" not in df.columns:
        return []

    # Factor-tree lookup, most specific first. A factor row is identified by its
    # path *and* its indicator — the tree routinely carries several rows per L1–L4
    # (旺点促销 declares both 花费 and 执行门店数), so a path-keyed lookup is not a
    # lookup at all: it silently keeps one arbitrary sibling and hands every metric
    # under that path to it. On the reference tree that bound 温度 to the row
    # declaring 降水量 and 竞品ND to the row declaring 竞品WD, marked them
    # `boundBy="auto"`, and left the rows that actually declare those metrics
    # looking unsupplied. Consult the indicator before falling back to the path.
    tree_rows = [r for r in (st.factor_tree.rows if getattr(st, "factor_tree", None) else [])
                 if r.status in indicators.ACTIVE_STATUSES]
    by_path_metric: dict[str, FactorRow] = {}
    by_path: dict[str, FactorRow] = {}
    by_l3_metric: dict[str, FactorRow] = {}
    by_l3: dict[str, FactorRow] = {}
    for r in tree_rows:
        path = _norm_path(r.l1, r.l2, r.l3, r.l4)
        by_path.setdefault(path, r)
        if r.indicator:
            by_path_metric.setdefault(_norm_path(path, r.indicator), r)
        if r.l3:
            by_l3.setdefault(_norm_path(r.l3), r)
            if r.indicator:
                by_l3_metric.setdefault(_norm_path(r.l3, r.indicator), r)

    key_cols = [c for c in ("metric", "metric_type", "l1", "l2", "l3", "l4") if c in df.columns]
    period = df["month"] if "month" in df.columns else (df["year"] if "year" in df.columns else None)
    # row id → the (normalised) metric that claimed it, so the coarse tiers cannot
    # collapse several metrics onto one row. Seeded from the *other* assets'
    # coverage, because publish runs per asset and a collision across two of them
    # is the documented case (one factor supplied by several sources) only when
    # they are the same metric.
    claimed_metric: dict[str, str] = {}
    for c in st.indicator_coverage:
        if c.asset_id != asset.id and c.tree_row_id:
            claimed_metric.setdefault(c.tree_row_id, _norm_path(c.metric))
    new: list[IndicatorCoverage] = []
    for keys, grp in df.groupby(key_cols, dropna=False):
        vals = dict(zip(key_cols, keys if isinstance(keys, tuple) else (keys,)))
        cov_start = cov_end = ""
        if period is not None:
            sub = period.loc[grp.index].dropna()
            if not sub.empty:
                cov_start, cov_end = str(sub.min()), str(sub.max())
        path = _norm_path(vals.get("l1", ""), vals.get("l2", ""),
                          vals.get("l3", ""), vals.get("l4", ""))
        metric = str(vals.get("metric", ""))
        l3 = _norm_path(vals.get("l3", ""))
        # Metric-aware tiers are one-to-one by construction. The coarse ones are
        # not: they know the path (or only the L3) and nothing about which metric
        # they are placing, so they will hand the same row to every metric under
        # it — 促销优惠's 花费 and PPI both landed on one row, which then read as
        # supplied while both metrics read as accounted for. A row already spoken
        # for by a *different* metric is therefore off limits to them, and a
        # metric they cannot place is an orphan, which 2.1 exists to resolve.
        norm_metric = _norm_path(metric)
        row = by_path_metric.get(_norm_path(path, metric))
        if row is None:
            for candidate in (by_path.get(path),
                              by_l3_metric.get(_norm_path(l3, metric)),
                              by_l3.get(l3)):
                if candidate is None:
                    continue
                if claimed_metric.get(candidate.id, norm_metric) == norm_metric:
                    row = candidate
                    break
        if row is not None:
            claimed_metric.setdefault(row.id, norm_metric)
        # FND-001: classify the metric's semantic profile (type/unit/aggregation/
        # format) from its name once, at publish, so downstream reads metadata
        # rather than re-guessing. The OLS role (`metricType`) is left as-is.
        meta = classify_indicator(str(vals.get("metric", "")))
        cov_id = _indicator_id(asset.id, vals)
        pinned = pins.get(cov_id, "")
        new.append(IndicatorCoverage(
            id=cov_id,
            treeRowId=pinned or (row.id if row is not None else ""),
            assetId=asset.id, assetName=asset.name,
            metric=str(vals.get("metric", "")),
            metricType=str(vals.get("metric_type", "")),
            l1=str(vals.get("l1", "")), l2=str(vals.get("l2", "")),
            l3=str(vals.get("l3", "")), l4=str(vals.get("l4", "")),
            semanticType=meta.metric_type, unit=meta.unit, currency=meta.currency,
            aggregation=meta.aggregation, numberFormat=meta.fmt,
            ruleVersion=INDICATOR_META_RULE_VERSION,
            coverageStart=cov_start, coverageEnd=cov_end, rows=int(len(grp)),
            boundBy="human" if pinned else ("auto" if row is not None else ""),
        ))
    st.indicator_coverage.extend(new)
    return new


# ── helpers ──────────────────────────────────────────────
