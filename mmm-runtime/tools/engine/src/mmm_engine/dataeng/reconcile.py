"""Did the mapping keep what the source actually contained?

Conformance asks whether the output is *shaped* right. This asks whether it is the
*same data*. They are different questions and the second one has no other asker:
a `clean.sql` with a stray `WHERE` produces a perfectly conformant table missing
two thirds of its rows, and nothing about that table looks wrong.

Spike B is the reason this module exists. A deliberately lossy recipe passed every
schema check while dropping 25 of 37 rows and 58% of the value; only the
invariants below caught it.

Three invariants, deliberately blunt:

* **rows** — how many arrived, how many left.
* **value** — the numeric total, per source and overall. Drift beyond a hair means
  rows were dropped, duplicated, or rescaled.
* **span** — the first and last period. A mapping that silently truncates a year
  keeps every row it kept perfectly valid.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import pandas as pd

#: Value totals are floats summed in a different order by DuckDB and pandas, so an
#: exact comparison would fail on arithmetic rather than on data loss.
TOLERANCE = 1e-4


@dataclass
class Reconciliation:
    ok: bool = False
    value_checked: bool = False
    raw_rows: int = 0
    clean_rows: int = 0
    rows_dropped: int = 0
    raw_sum: float = 0.0
    clean_sum: float = 0.0
    value_drift_pct: float = 0.0
    month_min: Optional[int] = None
    month_max: Optional[int] = None
    notes: list[str] = field(default_factory=list)
    #: One entry per `<raw column>:<metric>` pair, only when reconciled that way.
    #: A wide table fanned into several metrics of different units (箱/个/%/元) has
    #: no single sum worth comparing — see `check()`.
    by_metric: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        out = {
            "ok": self.ok, "valueChecked": self.value_checked,
            "rawRows": self.raw_rows, "cleanRows": self.clean_rows,
            "rowsDropped": self.rows_dropped,
            "rawSum": round(self.raw_sum, 4), "cleanSum": round(self.clean_sum, 4),
            "valueDriftPct": round(self.value_drift_pct, 4),
            "monthMin": self.month_min, "monthMax": self.month_max,
            "notes": list(self.notes),
        }
        if self.by_metric:
            out["byMetric"] = list(self.by_metric)
        return out

    def summary(self) -> str:
        if self.ok:
            return "%d rows, value reconciles (%s–%s)" % (
                self.clean_rows, self.month_min, self.month_max)
        return " · ".join(self.notes) or "does not reconcile"


def _parse_pairs(raw_value: str) -> list[tuple[str, Optional[str], str]]:
    """`"colA:metricA,colB:l4B:metricB"` -> `[(colA, None, metricA), (colB, l4B, metricB)]`.

    A plain column name (no `:`) is the single-column path, not a one-item list of
    pairs — `_parse_pairs` returns `[]` for it so `check()` falls through to the
    original behaviour unchanged.

    The three-part `<raw column>:<l4>:<metric>` form exists because `metric` alone
    is not the row identity — `target_schema.DEFAULT_GRAIN_KEYS` makes L1-L4 part of
    it, and clean.sql legitimately reuses a bare indicator name like `花费` under
    more than one L4 (POSM spend and freezer spend are both just "花费" in the
    factor tree, disambiguated only by L4). Two pairs that both name `花费` with no
    L4 would each match the OTHER's rows too, silently summing them together.
    """
    if ":" not in raw_value:
        return []
    pairs = []
    for chunk in raw_value.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        parts = [p.strip() for p in chunk.split(":")]
        if len(parts) == 2 and parts[0] and parts[1]:
            pairs.append((parts[0], None, parts[1]))
        elif len(parts) == 3 and parts[0] and parts[2]:
            pairs.append((parts[0], parts[1] or None, parts[2]))
    return pairs


def _check_by_metric(report: "Reconciliation", raw: pd.DataFrame, clean: pd.DataFrame,
                     clean_value: str,
                     pairs: list[tuple[str, Optional[str], str]]) -> None:
    """Reconcile each `(raw column, l4, metric)` pair against its own rows.

    Sets `report.value_checked` as soon as any named column exists to compare,
    even if that pair's total does not reconcile — `value_checked` records that the
    comparison was attempted, `ok` records whether it passed.

    Before summing, checks whether `metric` alone is ambiguous in `clean` — spans
    more than one distinct L4 — and refuses that pair rather than silently mixing
    two unrelated series into one total; the caller has to say which L4 with the
    three-part syntax instead.
    """
    metric_col = clean.get("metric")
    l4_col = clean.get("l4")
    value_col = pd.to_numeric(clean.get(clean_value), errors="coerce")
    total_raw = total_clean = 0.0
    for raw_col, l4, metric in pairs:
        label = "%s（%s）" % (metric, l4) if l4 else metric
        entry = {"rawColumn": raw_col, "metric": metric, "l4": l4, "rawSum": 0.0,
                 "cleanSum": 0.0, "driftPct": 0.0, "ok": False}
        if raw_col not in getattr(raw, "columns", []):
            report.notes.append("原始表里没有 %r 这一列（对应指标 %r），数值合计没有比对"
                                % (raw_col, label))
            report.by_metric.append(entry)
            continue
        mask = metric_col == metric if metric_col is not None else None
        if mask is not None and l4:
            mask = mask & (l4_col == l4)
        elif mask is not None and l4_col is not None:
            distinct_l4 = sorted(set(l4_col[mask].dropna()) - {"", "NA"})
            if len(distinct_l4) > 1:
                report.notes.append(
                    "%r 这个指标名在清洗结果里对应不止一个 L4（%s）——用三段式 "
                    "<原始列>:<L4>:<指标名> 指明是哪一个，两个都叫 %r 不能被当成一个"
                    % (metric, "、".join(distinct_l4), metric))
                report.by_metric.append(entry)
                continue
        report.value_checked = True
        raw_sum = float(pd.to_numeric(raw[raw_col], errors="coerce").sum())
        clean_sum = float(value_col[mask].sum()) if mask is not None else 0.0
        entry["rawSum"], entry["cleanSum"] = round(raw_sum, 4), round(clean_sum, 4)
        total_raw += raw_sum
        total_clean += clean_sum
        if raw_sum:
            drift = abs(raw_sum - clean_sum) / abs(raw_sum)
            entry["driftPct"] = round(drift * 100.0, 4)
            entry["ok"] = drift <= TOLERANCE
            if drift > TOLERANCE:
                report.notes.append(
                    "%s：value total moved %.3f%% (%.2f → %.2f) — rows were dropped, "
                    "duplicated or rescaled" % (label, entry["driftPct"], raw_sum, clean_sum))
        else:
            entry["ok"] = clean_sum == 0
            if not entry["ok"]:
                report.notes.append("%s：raw total is zero but clean total is %.2f" % (label, clean_sum))
        report.by_metric.append(entry)
    report.raw_sum, report.clean_sum = total_raw, total_clean
    if total_raw:
        report.value_drift_pct = round(abs(total_raw - total_clean) / abs(total_raw) * 100.0, 4)


def check(raw: pd.DataFrame, clean: pd.DataFrame, *,
          raw_value: str = "", clean_value: str = "value",
          expect_rows: bool = True) -> Reconciliation:
    """Compare a cleaned frame against the raw it was built from.

    `raw_value` names the raw numeric column to compare totals against. It is the
    one invariant that catches a stray `WHERE` dropping a third of the data while
    every column stays perfectly valid — so **omitting it is a failure, not an
    exemption**. It used to skip the comparison and still report `ok: true`, which
    made the most important check in this module optional and silent. A source with
    no single numeric column has to say which columns sum to the baseline; that is
    a decision someone makes, not one the report makes for them.

    `raw_value` also accepts `<raw column>:<metric>` pairs, comma-separated, for a
    `clean.sql` that fans one wide table into several metrics — `本品ND`, `货架份额
    （SOS）`, `本品标价` do not share a unit, and summing them alongside the response
    into one grand total is not a weaker check, it is not a check: a total that mixes
    箱 and % and 元 can drift by any amount and the drift means nothing. Each pair
    is reconciled against its OWN clean rows (`WHERE metric = <metric>`), so the
    invariant stays what it was designed to catch — rows dropped, duplicated, or
    rescaled — one metric at a time instead of laundered through a meaningless sum.

    `metric` alone is not always enough to name a pair's rows: `target_schema.
    DEFAULT_GRAIN_KEYS` makes L1-L4 part of the row identity, and a factor tree
    legitimately reuses a bare indicator name like `花费` under more than one L4
    (POSM spend and freezer spend are both just "花费", disambiguated only by L4).
    When that happens, use the three-part `<raw column>:<l4>:<metric>` form to say
    which L4 — matching only on `metric` would silently sum two unrelated series
    into one, the same class of mistake this whole function exists to catch.
    """
    report = Reconciliation()
    report.raw_rows = int(len(raw)) if raw is not None else 0
    report.clean_rows = int(len(clean)) if clean is not None else 0
    report.rows_dropped = report.raw_rows - report.clean_rows

    if clean is None or clean.empty:
        report.notes.append("the mapping produced no rows — an empty result is a "
                            "finding, not an empty success")
        return report

    pairs = _parse_pairs(raw_value)
    if pairs:
        _check_by_metric(report, raw, clean, clean_value, pairs)
    elif raw_value and raw_value in getattr(raw, "columns", []):
        report.value_checked = True
        report.raw_sum = float(pd.to_numeric(raw[raw_value], errors="coerce").sum())
        report.clean_sum = float(pd.to_numeric(clean.get(clean_value), errors="coerce").sum())
        if report.raw_sum:
            drift = abs(report.raw_sum - report.clean_sum) / abs(report.raw_sum)
            report.value_drift_pct = drift * 100.0
            if drift > TOLERANCE:
                report.notes.append(
                    "value total moved %.3f%% (%.2f → %.2f) — rows were dropped, "
                    "duplicated or rescaled" % (report.value_drift_pct,
                                                report.raw_sum, report.clean_sum))

    months = pd.to_numeric(clean.get("month"), errors="coerce").dropna()
    if not months.empty:
        report.month_min = int(months.min())
        report.month_max = int(months.max())
    else:
        report.notes.append("no parseable month in the result — the time axis did "
                            "not survive the mapping")

    if expect_rows and report.raw_rows and report.clean_rows < report.raw_rows:
        # Only a finding when no value comparison already explained it: a melt
        # legitimately shrinks the row count while keeping every value.
        if not report.notes and not raw_value:
            report.notes.append("%d of %d source rows did not reach the result"
                                % (report.rows_dropped, report.raw_rows))

    if not report.value_checked:
        if raw_value:
            report.notes.append(
                "原始表里没有 %r 这一列，数值合计没有比对 —— 报不出结果不能算通过"
                % raw_value)
        else:
            report.notes.append(
                "没有指定原始数值列，数值合计没有比对 —— 这是唯一能抓住"
                "「每列都合法却少了三分之一数据」的检查，跳过它就不算对账过")

    report.ok = not report.notes
    return report


def by_source(clean: pd.DataFrame) -> list[dict]:
    """Per-source row and value totals — what `data/published/manifest.yaml` says
    each file actually contributed."""
    if clean is None or clean.empty or "source" not in clean.columns:
        return []
    out = []
    value = pd.to_numeric(clean.get("value"), errors="coerce")
    frame = clean.assign(_value=value)
    for source, group in frame.groupby("source", dropna=False):
        months = pd.to_numeric(group.get("month"), errors="coerce").dropna()
        # Not group["metric"].nunique() — L1-L4 is part of the row identity
        # (target_schema.DEFAULT_GRAIN_KEYS), and one source legitimately reuses a
        # bare metric name like 花费 under more than one L4 (see check()'s own
        # docstring); counting distinct names alone undercounts a source's series.
        l4_cols = [c for c in ("l1", "l2", "l3", "l4", "metric") if c in group.columns]
        out.append({
            "source": str(source),
            "rows": int(len(group)),
            "value": round(float(group["_value"].sum()), 4),
            "metrics": int(group.drop_duplicates(l4_cols).shape[0]) if l4_cols else 0,
            "monthMin": int(months.min()) if not months.empty else None,
            "monthMax": int(months.max()) if not months.empty else None,
        })
    return sorted(out, key=lambda r: r["source"])
