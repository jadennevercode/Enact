"""Does a cleaned frame match the declared contract?

A pure function of (frame, schema, enums) — no project state, no warehouse, no
dbt. The platform's `_check_conformance` read a materialised dbt mart out of a
Workspace; everything it *did* was a function of the frame and the schema, so this
is the same logic with the coupling removed.

Two checks the platform never had, both added because Spike B showed schema
validity is not enough:

* **declared type** — a column typed `number` that carries text is a mapping error
  the enum checks cannot see.
* **grain-key uniqueness** — a join gone wrong fans every row out, doubling values
  while every column remains perfectly valid.

And one distinction the platform could not make: an enum is **closed** or **open**.
A value outside a closed enum is a violation that blocks publish; outside an open
one it is an unmapped value awaiting review. The platform treated an empty standard
list as "unenforced", which made "we forgot to fill the list" and "anything goes"
indistinguishable.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

import pandas as pd

from mmm_engine.dataeng import target_schema as ts
from mmm_engine.domain.models import TargetColumn

#: A compiler-derived helper axis, not a contract column.
ALLOWED_EXTRA = {"period_date"}
VIOLATION_CAP = 20

# The four time/variance invariants the platform runs as dbt generic tests on
# every mart, and which this runtime had none of. All four are deterministic, all
# four are pure arithmetic over the cleaned frame, and each of them catches a
# defect no schema check can see.
MIN_SPAN_MONTHS = 24     # time_span_min_years = 2 — a model needs 24 months
MAX_GAP_MONTHS = 1.5     # time_granularity_allowed max_gap_days = 45
YOY_TOLERANCE = 0.5      # yoy_comparable — a year with under half the periods
#: How many failing series to name before the list stops being readable.
INVARIANT_CAP = 8
#: Series identity for the invariants: one factor path × one metric.
_SERIES_KEYS = ("l1", "l2", "l3", "l4", "metric")


@dataclass
class ColumnValues:
    column: str
    values: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"column": self.column, "values": list(self.values)}


@dataclass
class TypeError_:
    column: str
    declared: str
    rows: int

    def as_dict(self) -> dict:
        return {"column": self.column, "declared": self.declared, "rows": self.rows}


@dataclass
class Invariant:
    """One time/variance invariant and the series that failed it."""
    key: str
    label: str
    ok: bool
    failing: list[str] = field(default_factory=list)
    detail: str = ""

    def as_dict(self) -> dict:
        return {"key": self.key, "label": self.label, "ok": self.ok,
                "failing": list(self.failing), "detail": self.detail}


@dataclass
class Conformance:
    ok: bool = False
    checked: bool = True
    rows: int = 0
    invariants: list[Invariant] = field(default_factory=list)
    missing_required: list[str] = field(default_factory=list)
    extra: list[str] = field(default_factory=list)
    enum_violations: list[ColumnValues] = field(default_factory=list)
    unmapped_values: list[ColumnValues] = field(default_factory=list)
    type_errors: list[TypeError_] = field(default_factory=list)
    duplicate_grain_keys: int = 0
    grain_keys: list[str] = field(default_factory=list)
    unenforced_dimensions: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "ok": self.ok, "checked": self.checked, "rows": self.rows,
            "missingRequired": list(self.missing_required),
            "extra": list(self.extra),
            "enumViolations": [v.as_dict() for v in self.enum_violations],
            "unmappedValues": [v.as_dict() for v in self.unmapped_values],
            "typeErrors": [t.as_dict() for t in self.type_errors],
            "duplicateGrainKeys": self.duplicate_grain_keys,
            "grainKeys": list(self.grain_keys),
            "unenforcedDimensions": list(self.unenforced_dimensions),
            "invariants": [i.as_dict() for i in self.invariants],
        }

    def failed_invariants(self) -> list["Invariant"]:
        return [i for i in self.invariants if not i.ok]

    def summary(self) -> str:
        """One line a human can act on. Ordered by what blocks publish first."""
        if self.ok:
            note = "%d rows conform" % self.rows
            if self.unmapped_values:
                note += " · %d column(s) carry unmapped values to review" % len(self.unmapped_values)
            return note
        parts = []
        if self.missing_required:
            parts.append("missing required: %s" % ", ".join(self.missing_required))
        for v in self.enum_violations:
            parts.append("%s has undeclared value(s) %s" % (v.column, ", ".join(v.values[:5])))
        for t in self.type_errors:
            parts.append("%s is declared %s but %d row(s) are not" % (t.column, t.declared, t.rows))
        if self.duplicate_grain_keys:
            parts.append("%d row(s) repeat a grain key (%s) — the mapping fans out"
                         % (self.duplicate_grain_keys, ", ".join(self.grain_keys)))
        for inv in self.failed_invariants():
            parts.append("%s: %s" % (inv.label, inv.detail))
        return " · ".join(parts) or "does not conform"


def enum_values(spec: dict) -> set[str]:
    return {str(v.get("canonical", "")).strip()
            for v in (spec.get("values") or []) if str(v.get("canonical", "")).strip()}


def check(df: pd.DataFrame, columns: list[TargetColumn], enums: dict[str, dict],
          *, grain: Optional[list[str]] = None) -> Conformance:
    """Compare a cleaned frame to the declared schema."""
    if df is None:
        return Conformance(ok=False, checked=False)

    cols = set(df.columns)
    schema_names = {c.name for c in columns}
    required = [c.name for c in columns if c.required]

    report = Conformance(rows=int(len(df)))
    report.missing_required = [c for c in required if c not in cols]
    report.extra = [str(c) for c in df.columns
                    if c not in schema_names and c not in ALLOWED_EXTRA]

    for col in columns:
        name = col.name
        if name not in cols:
            continue
        series = df[name]

        declared = ts.type_of(col)
        if declared in ("integer", "number"):
            coerced = pd.to_numeric(series, errors="coerce")
            bad = int(coerced.isna().sum() - series.isna().sum())
            if bad > 0:
                report.type_errors.append(TypeError_(name, declared, bad))

        enum_name = ts.enum_of(col)
        if not enum_name:
            if col.kind in ("dimension", "factor") and not getattr(col, "system", False):
                report.unenforced_dimensions.append(name)
            continue
        spec = enums.get(enum_name) or {}
        allowed = enum_values(spec)
        if not allowed:
            report.unenforced_dimensions.append(name)
            continue
        seen = {str(v).strip() for v in series.dropna().unique() if str(v).strip()}
        bad_values = sorted(v for v in seen if v not in allowed)
        if not bad_values:
            continue
        bucket = (report.enum_violations if spec.get("closed")
                  else report.unmapped_values)
        bucket.append(ColumnValues(name, bad_values[:VIOLATION_CAP]))

    keys = [k for k in (grain or ts.DEFAULT_GRAIN_KEYS) if k in cols]
    report.grain_keys = keys
    if keys:
        report.duplicate_grain_keys = int(df.duplicated(subset=keys).sum())

    report.invariants = check_invariants(df)

    report.ok = (not report.missing_required and not report.enum_violations
                 and not report.type_errors and report.duplicate_grain_keys == 0
                 and not report.failed_invariants())
    return report


# ── the four time/variance invariants ────────────────────────────────


def check_invariants(df: pd.DataFrame) -> list[Invariant]:
    """Time span, grid spacing, variation and year-over-year comparability.

    Per series — one L1–L4 path × one metric — because that is the thing a model
    later fits. Checked here rather than three layers downstream: a constant
    series currently survives cleaning, publishing, quality scoring and business
    validation, and is finally stopped by the CV band at statistical screening,
    having been charted for a client on the way. It explains nothing at any of
    those layers; it may as well be stopped at the one that can prove it.
    """
    if df is None or df.empty or "month" not in df.columns:
        return []
    keys = [k for k in _SERIES_KEYS if k in df.columns]
    if not keys:
        return []

    short, coarse, flat, lopsided = [], [], [], []
    for name, group in df.groupby(keys, dropna=False):
        label = " :: ".join(str(x) for x in (name if isinstance(name, tuple) else (name,)))
        months = pd.to_numeric(group["month"], errors="coerce").dropna().astype("int64")
        periods = sorted({int(m) for m in months})
        if not periods:
            short.append(label)
            continue

        lo, hi = periods[0], periods[-1]
        span = (hi // 100 - lo // 100) * 12 + (hi % 100 - lo % 100) + 1
        if span < MIN_SPAN_MONTHS:
            short.append("%s (%d 个月)" % (label, span))

        if len(periods) > 1:
            gaps = sorted(_months_between(a, b) for a, b in zip(periods, periods[1:]))
            median = gaps[len(gaps) // 2] if len(gaps) % 2 else (
                (gaps[len(gaps) // 2 - 1] + gaps[len(gaps) // 2]) / 2.0)
            if median > MAX_GAP_MONTHS:
                coarse.append("%s (中位间隔 %.1f 个月)" % (label, median))
        else:
            coarse.append("%s (只有一个期数)" % label)

        values = pd.to_numeric(group.get("value"), errors="coerce").dropna()
        if values.empty or values.nunique() <= 1 or float(values.std(ddof=0)) == 0.0:
            flat.append(label)

        by_year: dict[int, int] = {}
        for period in periods:
            by_year[period // 100] = by_year.get(period // 100, 0) + 1
        if len(by_year) >= 2:
            counts = list(by_year.values())
            if min(counts) < YOY_TOLERANCE * max(counts):
                lopsided.append("%s (最少的一年只有 %d 期，最多的一年 %d 期)"
                                % (label, min(counts), max(counts)))

    return [
        _invariant("time_span_min_years", "建模时间跨度不足两年", short,
                   "建模最少要 24 个月"),
        _invariant("time_granularity_allowed", "颗粒度粗于月度", coarse,
                   "相邻期数的中位间隔必须在 45 天以内"),
        _invariant("has_variation", "序列没有变化", flat,
                   "一条常数序列解释不了任何波动"),
        _invariant("yoy_comparable", "年与年不可比", lopsided,
                   "某一年的期数不足最多那年的一半"),
    ]


def _months_between(earlier: int, later: int) -> int:
    return (later // 100 - earlier // 100) * 12 + (later % 100 - earlier % 100)


def _invariant(key: str, label: str, failing: list[str], why: str) -> Invariant:
    if not failing:
        return Invariant(key, label, True, [], "")
    detail = "%d 条序列 —— %s（%s%s）" % (
        len(failing), why, "、".join(failing[:INVARIANT_CAP]),
        " …" if len(failing) > INVARIANT_CAP else "")
    return Invariant(key, label, False, failing[:INVARIANT_CAP], detail)


def check_document(df: pd.DataFrame, document: dict, enums: dict[str, dict]) -> Conformance:
    """Check against a target-schema YAML document as loaded from the workspace."""
    columns = ts.columns_from_yaml(document.get("columns") or [])
    if not columns:
        columns = ts.default_columns()
    return check(df, columns, enums, grain=ts.grain_keys(document))
