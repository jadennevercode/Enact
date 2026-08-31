"""Data-quality scoring — ten deterministic subchecks over four dimensions.

The rubric is the 2.11/2.12 workbook (`2.11数据通用校验标准` · `2.11打分规则` ·
`2.12数据质量评分`), restated in `knowledge/methodology/validation-scoring.json`:

    consistency   — dimension · time · caliber
    accuracy      — numeric · business
    completeness  — field · data
    granularity   — time · model · drilldown

Every subcheck scores 0 / 0.5 / 1. A dimension score is the weakest of its
*blocking* subchecks; advisory ones are surfaced and cannot drag it down. Total is
the **product** of the four dimensions, so one failed dimension makes the series
unusable — a metric that is perfectly complete on the wrong caliber is not "75%
usable".

    Total = consistency × accuracy × completeness × granularity
    Total >= 0.5   → accept       (only 1.0 and 0.5 are reachable here)
    0 < Total < 0.5 → borderline  (0.25 / 0.125 / 0.0625 — a human decides)
    Total == 0     → unusable     (reject and escalate)

Three things in here are worth knowing before changing a threshold:

* **Nothing is aggregated first.** Scoring a national roll-up made four subchecks
  structurally unable to fail: `source` collapsed to one constant so a caliber
  change could not be seen, region and channel collapsed to one value each so
  granularity scored every indicator the same, and summing dropped NaNs so
  per-cell missingness never reached completeness. Score the published rows.
* **"Not checked" is not "checked and fine".** Dimension consistency needs a unit
  column and business accuracy needs an externally-attested total. When those are
  absent the subcheck returns `computed=False` and is advisory, and every view has
  to render it as UNVERIFIED. Supply the input and the same subcheck becomes real
  and blocking — it was advisory because it was unanswerable, not because it was
  unimportant.
* **Time-axis gaps and model-axis gaps are different questions.** `completeness.data`
  measures missing MONTHS inside the cells an indicator does report;
  `granularity.model` measures whether it reports the axes the contract asked for
  at all. Rolling both into one ratio double-counts a national indicator.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd

DIMENSIONS = ("consistency", "accuracy", "completeness", "granularity")

# ── bands, in one place (each cited to the rule it implements) ───────────────

#: Share of rows allowed to disagree — used by both dimension and time consistency.
#: Above it the subcheck scores 0, at or below it (but non-zero) 0.5.
_MIX_TOL = 0.10
#: A source change with a bigger year-over-year swing than this reads as a caliber
#: break rather than a re-tagging.
_YOY_CALIBER = 0.30
#: Numeric accuracy: invalid-value share.
_ERR_HIGH = 0.10
_ERR_MID = 0.05
#: Business accuracy: deviation from the externally-attested total.
_DEV_HIGH = 0.10
_DEV_MID = 0.05
#: Data completeness: share of the expected (cell × month) grid that is empty.
_MISSING_HIGH = 0.10
#: Drilldown depth: more than this many populated L5–L8 columns scores 1.
_DRILL_DEEP = 2

#: Total >= this accepts. The workbook's own acceptance table reads "0.5–1 验收通过 /
#: ≤0.5 需人工介入", with 0.5 in both rows; the client ruling is that 0.5 accepts.
#: Under a product of four {0, 0.5, 1} dimensions that means: all clean (1.0), or
#: exactly one dimension at 0.5.
ACCEPT_MIN = 0.5
UNUSABLE_MAX = 0.0

#: Metric roles that cannot legitimately be negative. For other drivers
#: (temperature, growth %, indices) a negative is valid data, not an error.
_NONNEG_TYPES = frozenset({"spending", "Y"})

#: A model-scope axis name → the long-table column that carries it. Matched on a
#: normalised substring because projects name their axes for their own business
#: ("Platform & Region", "产品线"), and the contract's axis names are the client's
#: words, not ours. A name that matches nothing is not a model axis — "Month" is a
#: time axis and must not be mistaken for one.
_AXIS_COLUMNS: tuple[tuple[str, str], ...] = (
    ("brand", "brand"), ("product", "brand"), ("品牌", "brand"), ("产品", "brand"),
    ("channel", "channel_type"), ("渠道", "channel_type"),
    ("geo", "province_group"), ("region", "province_group"),
    ("province", "province_group"), ("地区", "province_group"),
    ("区域", "province_group"), ("省", "province_group"),
)


def axis_column(name: object) -> Optional[str]:
    """The long-table column a model-scope axis name refers to, or None."""
    norm = str(name or "").strip().lower()
    if not norm:
        return None
    for key, column in _AXIS_COLUMNS:
        if key in norm:
            return column
    return None


# ── evidence ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SeriesEvidence:
    """What one (L1..L4 × indicator) series can be shown to be, from pandas alone."""

    n: int
    months: int                  # distinct yyyymm periods present
    span_months: int             # last − first + 1 in month index
    nonneg_ratio: float
    error_ratio: float           # (non-finite + illegal negatives) / n
    monthly_ratio: float         # share of rows carrying a month (vs year-only)
    monthly: bool                # month granularity is the dominant grid
    source_changed: bool         # the source SET changed across the timeline
    max_yoy: float               # largest |year-over-year| move of the annual mean
    unit_present: bool           # the long table carries a unit for this series
    unit_mismatch_ratio: float   # rows off the dominant unit / rows carrying one
    units: tuple[str, ...]       # the distinct units seen, dominant first
    cells: int                   # distinct model cells the series reports on
    cell_months: int             # distinct (cell, month) observations
    regions: int
    channels: int
    axes_present: frozenset[str]  # long-table columns that carry a value here
    drilldown_dims: int          # L5–L8 columns with values
    metric_type: str             # 'Y' | 'spending' | 'X'
    total_all: float
    total_by_year: dict[int, float] = field(default_factory=dict)
    total_by_month: dict[int, float] = field(default_factory=dict)


@dataclass(frozen=True)
class SeriesContext:
    """What the series has to be judged *against* — never derivable from itself."""

    #: Per parent L4: is spend paired with at least one performance metric?
    has_spend: bool = False
    has_performance: bool = True
    #: Does any indicator under this L4 have data at all? False zeroes field
    #: completeness (the 「metrics 中无范围内的字段」 band).
    factor_has_data: bool = True
    #: Long-table columns this indicator is required to report on: the contract's
    #: model scope, narrowed to what the factor tree says THIS indicator measures.
    axes_required: frozenset[str] = frozenset()
    #: The axes the factor tree declared, before narrowing — for the note.
    axes_declared: frozenset[str] = frozenset()
    #: Months in the project's modeling window (0 = the profile does not say).
    window_months: int = 0
    #: The unit the factor tree asked for ("" = none declared).
    declared_unit: str = ""
    #: An externally-attested total and the period it covers (None = none registered).
    reference_value: Optional[float] = None
    reference_period: str = ""
    reference_source: str = ""


@dataclass(frozen=True)
class FieldContext:
    """Legacy shape kept for callers that only need the spend/performance pair."""

    has_spend: bool
    has_performance: bool


def field_context(df) -> dict[tuple, FieldContext]:
    """Per-parent-L4 spend/performance presence — grounds field completeness.

    A factor is field-complete when a spend metric is paired with at least one
    non-spend performance metric (the 2.11 字段完整性 rule).
    """
    out: dict[tuple, FieldContext] = {}
    for key, grp in df.groupby(["l1", "l2", "l3", "l4"], dropna=False):
        types = set(grp["metric_type"].dropna().astype(str)) if "metric_type" in grp else set()
        out[key] = FieldContext(has_spend="spending" in types,
                                has_performance=bool(types - {"spending"}))
    return out


@dataclass(frozen=True)
class SubScore:
    key: str          # e.g. "consistency.time"
    dimension: str
    label: str        # display label
    score: float      # 0 / 0.5 / 1
    note: str         # evidence-grounded, one sentence
    computed: bool    # False = the input this needs is not in the workspace
    blocking: bool    # whether it can drag the dimension score down


@dataclass(frozen=True)
class QualityResult:
    subs: tuple[SubScore, ...]
    consistency: float
    accuracy: float
    completeness: float
    granularity: float
    total: float
    verdict: str      # "accept" | "borderline" | "unusable"

    def dimension_note(self, dimension: str) -> str:
        """The weakest blocking subcheck's note — the driver of the dimension score."""
        subs = [s for s in self.subs if s.dimension == dimension and s.blocking]
        if not subs:
            return ""
        return min(subs, key=lambda s: s.score).note


def compute_series_evidence(grp: pd.DataFrame, ctx: SeriesContext | None = None
                            ) -> SeriesEvidence:
    """Derive the computable evidence for one metric series."""
    ctx = ctx or SeriesContext()
    vals = grp["value"].to_numpy(dtype=float)
    finite = np.isfinite(vals)
    fvals = vals[finite]
    n_fin = int(finite.sum())
    n_all = max(len(vals), 1)
    nonneg = float(np.sum(fvals >= 0) / n_fin) if n_fin else 0.0

    mtype = ""
    if "metric_type" in grp:
        mt = grp["metric_type"].dropna()
        mtype = str(mt.iloc[0]) if not mt.empty else ""
    nonfinite = int((~finite).sum())
    illegal_neg = int(np.sum(fvals < 0)) if mtype in _NONNEG_TYPES else 0
    error_ratio = (nonfinite + illegal_neg) / n_all

    mser = grp["month"].dropna().astype("int64")
    months = int(mser.nunique())
    if months:
        lo, hi = int(mser.min()), int(mser.max())
        span = (hi // 100 - lo // 100) * 12 + (hi % 100 - lo % 100) + 1
        span = max(span, months)  # guard against malformed yyyymm
    else:
        span = 0
    monthly_ratio = float(grp["month"].notna().mean())

    units, unit_present, unit_mismatch = _unit_evidence(grp)
    cells, cell_months = _cell_evidence(grp, ctx.axes_required)
    axes_present = frozenset(
        column for column in ("brand", "channel_type", "province_group")
        if column in grp and grp[column].replace("", np.nan).notna().any())
    drilldown = sum(1 for c in ("l5", "l6", "l7", "l8")
                    if c in grp and grp[c].replace("", np.nan).nunique(dropna=True) >= 1)

    return SeriesEvidence(
        n=len(vals), months=months, span_months=span, nonneg_ratio=nonneg,
        error_ratio=error_ratio, monthly_ratio=monthly_ratio,
        monthly=monthly_ratio >= 0.5, source_changed=_source_changed(grp),
        max_yoy=_max_yoy(grp), unit_present=unit_present,
        unit_mismatch_ratio=unit_mismatch, units=units,
        cells=cells, cell_months=cell_months,
        regions=int(grp["province_group"].nunique(dropna=True)),
        channels=int(grp["channel"].nunique(dropna=True)),
        axes_present=axes_present, drilldown_dims=drilldown, metric_type=mtype,
        total_all=float(np.nansum(fvals)) if n_fin else 0.0,
        total_by_year=_totals_by(grp, "year"), total_by_month=_totals_by(grp, "month"),
    )


def _unit_evidence(grp: pd.DataFrame) -> tuple[tuple[str, ...], bool, float]:
    """Units seen in this series, dominant first, plus the share of rows off it.

    Absent column or all-blank values → `(())`, False, 0.0: nothing was declared, so
    nothing can be concluded. That is the case dimension consistency reports as
    unverified rather than scoring.
    """
    if "unit" not in grp:
        return (), False, 0.0
    seen = grp["unit"].astype(str).str.strip()
    seen = seen[(seen != "") & (seen.str.lower() != "nan")]
    if seen.empty:
        return (), False, 0.0
    counts = seen.value_counts()
    dominant = str(counts.index[0])
    off = int(len(seen) - counts.iloc[0])
    return tuple(str(u) for u in counts.index), True, off / len(seen)


def _cell_evidence(grp: pd.DataFrame, axes: frozenset[str]) -> tuple[int, int]:
    """How many model cells this series reports on, and how many (cell, month) it has.

    A "cell" is the series' own footprint on the axes the contract asks for. With no
    required axis the series is national and there is exactly one cell — which is
    the right denominator for it, and the reason data completeness does not punish a
    national media buy for lacking a channel split (`granularity.model` is where
    that question belongs).
    """
    sub = grp.dropna(subset=["month"])
    if sub.empty:
        return 0, 0
    columns = [c for c in sorted(axes) if c in sub.columns]
    if not columns:
        return 1, int(sub["month"].nunique())
    keyed = sub[columns].astype(str).agg("".join, axis=1)
    pairs = pd.DataFrame({"cell": keyed, "month": sub["month"].astype("int64")})
    return int(pairs["cell"].nunique()), int(len(pairs.drop_duplicates()))


def _totals_by(grp: pd.DataFrame, column: str) -> dict[int, float]:
    if column not in grp:
        return {}
    sub = grp.dropna(subset=[column])
    if sub.empty:
        return {}
    grouped = sub.groupby(sub[column].astype("int64"))["value"].sum()
    return {int(k): float(v) for k, v in grouped.items() if np.isfinite(v)}


def _source_changed(grp: pd.DataFrame) -> bool:
    """True when the data source SWITCHED over time (口径变化), not merely when the
    series aggregates several concurrent sources. Compares the source set in the
    early half of the timeline against the late half — a source appearing or
    dropping out signals a caliber change; a stable multi-source mix does not."""
    if "source" not in grp or "month" not in grp:
        return False
    sub = grp[["month", "source"]].dropna()
    if sub.empty:
        return False
    months = sub["month"].astype("int64")
    mid = months.median()
    early = set(sub.loc[months <= mid, "source"].astype(str))
    late = set(sub.loc[months > mid, "source"].astype(str))
    if not early or not late:
        return False
    return early != late


def _max_yoy(grp: pd.DataFrame) -> float:
    """Max |year-over-year| change of the annual *mean* level (caliber-shift proxy).

    Mean, not sum, so a partial leading/trailing year isn't mistaken for a level
    shift — a genuine source/definition change moves the average, not just the count.
    """
    if "year" not in grp:
        return 0.0
    ann = grp.dropna(subset=["year"]).groupby("year")["value"].mean().sort_index()
    if len(ann) < 2:
        return 0.0
    prev = ann.to_numpy(dtype=float)[:-1]
    cur = ann.to_numpy(dtype=float)[1:]
    with np.errstate(divide="ignore", invalid="ignore"):
        yoy = np.where(prev != 0, np.abs(cur - prev) / np.abs(prev), 0.0)
    finite = yoy[np.isfinite(yoy)]
    return float(finite.max()) if finite.size else 0.0


# ── subcheck scoring ────────────────────────────────────────────────────────


def _pct(x: float) -> str:
    return "%d%%" % round(x * 100)


def score_quality(ev: SeriesEvidence, ctx: SeriesContext | FieldContext) -> QualityResult:
    """Score one series on the ten subchecks → four dimensions → product Total."""
    ctx = _as_context(ctx)
    return roll_up_quality([
        *consistency_subs(ev, ctx),
        *accuracy_subs(ev, ctx),
        *completeness_subs(ev, ctx),
        *granularity_subs(ev, ctx),
    ])


def _as_context(ctx: SeriesContext | FieldContext | None) -> SeriesContext:
    """Accept the older `FieldContext` so vendored callers keep working."""
    if isinstance(ctx, SeriesContext):
        return ctx
    if isinstance(ctx, FieldContext):
        return SeriesContext(has_spend=ctx.has_spend, has_performance=ctx.has_performance)
    return SeriesContext()


def roll_up_quality(subs: list[SubScore]) -> QualityResult:
    """Roll the subchecks into four dimensions → product Total → verdict."""
    dims = {d: _roll_up(subs, d) for d in DIMENSIONS}
    total = round(dims["consistency"] * dims["accuracy"]
                  * dims["completeness"] * dims["granularity"], 4)
    return QualityResult(
        subs=tuple(subs), consistency=dims["consistency"], accuracy=dims["accuracy"],
        completeness=dims["completeness"], granularity=dims["granularity"],
        total=total, verdict=verdict_for(total),
    )


def verdict_for(total: float) -> str:
    """Total → `accept` | `borderline` | `unusable`. The only implementation."""
    value = float(total)
    if value <= UNUSABLE_MAX:
        return "unusable"
    if value >= ACCEPT_MIN:
        return "accept"
    return "borderline"


def dimension_score(subs: list[SubScore], dimension: str) -> float:
    """Dimension score = weakest blocking subcheck (advisory ones can't zero it).

    Both halves of that matter, and both were learned the hard way. Treating an
    advisory subcheck as blocking once zeroed every indicator in a project. And a
    blocking subcheck is a CAP, not an input to an average: once it is low nothing
    else in the dimension can lift it back.
    """
    blocking = [s.score for s in subs if s.dimension == dimension and s.blocking]
    return min(blocking) if blocking else 1.0


_roll_up = dimension_score  # legacy internal alias


def consistency_subs(ev: SeriesEvidence, ctx: SeriesContext) -> list[SubScore]:
    """维度一致性 · 时间一致性 · 口径一致性."""
    return [_dimension_sub(ev, ctx), _time_sub(ev), _caliber_sub(ev)]


def _dimension_sub(ev: SeriesEvidence, ctx: SeriesContext) -> SubScore:
    """Do all rows of this indicator measure the same thing in the same unit?"""
    if not ev.unit_present:
        return SubScore(
            "consistency.dimension", "consistency", "维度一致性", 1.0,
            "未校验：长表没有登记单位，跨渠道/产品的统计口径无从核对。",
            computed=False, blocking=False)
    ratio = ev.unit_mismatch_ratio
    declared = str(ctx.declared_unit or "").strip()
    dominant = ev.units[0] if ev.units else ""
    # A unit the tree asked for and did not get is a full mismatch, not a rounding
    # issue: every row is on the wrong caliber, they just agree with each other.
    if declared and dominant and declared != dominant:
        return SubScore(
            "consistency.dimension", "consistency", "维度一致性", 0.0,
            "单位与因子树声明的不一致：数据是「%s」，树上要的是「%s」。" % (dominant, declared),
            computed=True, blocking=True)
    if ratio > _MIX_TOL:
        return SubScore(
            "consistency.dimension", "consistency", "维度一致性", 0.0,
            "%s 的行不在主单位「%s」上，共 %d 种单位混用。" % (_pct(ratio), dominant, len(ev.units)),
            computed=True, blocking=True)
    if ratio > 0:
        return SubScore(
            "consistency.dimension", "consistency", "维度一致性", 0.5,
            "%s 的行不在主单位「%s」上（≤10%%，影响可控）。" % (_pct(ratio), dominant),
            computed=True, blocking=True)
    return SubScore(
        "consistency.dimension", "consistency", "维度一致性", 1.0,
        "全部行统一在「%s」，口径无歧义。" % dominant, computed=True, blocking=True)


def _time_sub(ev: SeriesEvidence) -> SubScore:
    """Is the time grid uniform, and is it monthly or finer?"""
    off = 1.0 - ev.monthly_ratio
    if not ev.monthly:
        return SubScore("consistency.time", "consistency", "时间一致性", 0.0,
                        "序列粗于月度，时间粒度达不到建模最低要求。", True, True)
    if off > _MIX_TOL:
        return SubScore("consistency.time", "consistency", "时间一致性", 0.0,
                        "%s 的行不在主导的月度网格上（>10%%）。" % _pct(off), True, True)
    if off > 0:
        return SubScore("consistency.time", "consistency", "时间一致性", 0.5,
                        "%s 的行不在主导的月度网格上（≤10%%，整体可控）。" % _pct(off), True, True)
    return SubScore("consistency.time", "consistency", "时间一致性", 1.0,
                    "全程统一的月度时间网格。", True, True)


def _caliber_sub(ev: SeriesEvidence) -> SubScore:
    """Did the source or the definition change under us?"""
    if not ev.source_changed:
        return SubScore("consistency.caliber", "consistency", "口径一致性", 1.0,
                        "全程单一数据源，计算口径未变更。", True, True)
    if ev.max_yoy > _YOY_CALIBER:
        return SubScore("consistency.caliber", "consistency", "口径一致性", 0.0,
                        "数据源发生变化，且前后同比变动 %s（>30%%）。" % _pct(ev.max_yoy),
                        True, True)
    return SubScore("consistency.caliber", "consistency", "口径一致性", 0.5,
                    "数据源发生变化，但前后同比变动 %s（≤30%%）。" % _pct(ev.max_yoy),
                    True, True)


def accuracy_subs(ev: SeriesEvidence, ctx: SeriesContext) -> list[SubScore]:
    """数值准确性 · 业务准确性."""
    return [_numeric_sub(ev), _business_sub(ev, ctx)]


def _numeric_sub(ev: SeriesEvidence) -> SubScore:
    err = ev.error_ratio
    if err > _ERR_HIGH:
        return SubScore("accuracy.numeric", "accuracy", "数值准确性", 0.0,
                        "%s 的值是录入或计算错误（非有限值 / 非法负数，>10%%）。" % _pct(err),
                        True, True)
    if err >= _ERR_MID:
        return SubScore("accuracy.numeric", "accuracy", "数值准确性", 0.5,
                        "%s 的值有误（5%%–10%%）。" % _pct(err), True, True)
    return SubScore("accuracy.numeric", "accuracy", "数值准确性", 1.0,
                    "数值干净，错误率 %s（<5%%）。" % _pct(err), True, True)


def _business_sub(ev: SeriesEvidence, ctx: SeriesContext) -> SubScore:
    """Does this reconcile against finance's own number?"""
    if ctx.reference_value is None:
        return SubScore(
            "accuracy.business", "accuracy", "业务准确性", 1.0,
            "未校验：没有登记可对照的财务/系统口径合计。", computed=False, blocking=False)
    ours = _total_for_period(ev, ctx.reference_period)
    theirs = float(ctx.reference_value)
    if theirs == 0:
        return SubScore(
            "accuracy.business", "accuracy", "业务准确性", 1.0,
            "未校验：登记的对照合计是 0，除不出偏差。", computed=False, blocking=False)
    dev = abs(ours - theirs) / abs(theirs)
    where = ctx.reference_period or "全窗口"
    source = ctx.reference_source or "外部登记"
    if dev > _DEV_HIGH:
        score, tail = 0.0, "（>10%）"
    elif dev >= _DEV_MID:
        score, tail = 0.5, "（5%–10%）"
    else:
        score, tail = 1.0, "（<5%）"
    return SubScore(
        "accuracy.business", "accuracy", "业务准确性", score,
        "与%s对照（%s）：本表 %.4g vs 登记 %.4g，偏差 %s%s。"
        % (source, where, ours, theirs, _pct(dev), tail), True, True)


def _total_for_period(ev: SeriesEvidence, period: str) -> float:
    """The series' own total over the period the reference covers."""
    text = str(period or "").strip()
    if not text:
        return ev.total_all
    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) == 6:
        return float(ev.total_by_month.get(int(digits), 0.0))
    if len(digits) == 4:
        return float(ev.total_by_year.get(int(digits), 0.0))
    return ev.total_all


def completeness_subs(ev: SeriesEvidence, ctx: SeriesContext) -> list[SubScore]:
    """字段完整性 · 数据完整性."""
    return [_field_sub(ev, ctx), _data_sub(ev, ctx)]


def _field_sub(ev: SeriesEvidence, ctx: SeriesContext) -> SubScore:
    if ev.metric_type == "Y":
        return SubScore("completeness.field", "completeness", "字段完整性", 1.0,
                        "响应指标，字段自成一套。", True, True)
    if not ctx.factor_has_data:
        # Unreachable for a row that HAS data — kept because it is the rule's own
        # zero band, and because the factor-level escalation reports the same event
        # from the other side (every indicator under this L4 arrived empty).
        return SubScore("completeness.field", "completeness", "字段完整性", 0.0,
                        "该因子名下没有任何范围内的指标字段。", True, True)
    if ctx.has_spend and not ctx.has_performance:
        return SubScore("completeness.field", "completeness", "字段完整性", 0.5,
                        "该因子只有花费，没有配套的表现指标。", True, True)
    return SubScore("completeness.field", "completeness", "字段完整性", 1.0,
                    "该因子的指标字段齐全。", True, True)


def _data_sub(ev: SeriesEvidence, ctx: SeriesContext) -> SubScore:
    """Missing months inside the cells this indicator reports on.

    Denominator = (cells the series reports on) × (months in the modeling window).
    Deliberately NOT the series' own row count — that makes every series 100%
    complete by construction — and deliberately not the full contract grid either,
    because "this indicator never reported channel X" is `granularity.model`'s
    question and charging it here would bill a national driver twice.
    """
    window = int(ctx.window_months or 0)
    if not window:
        window = ev.span_months
        provenance = "按序列自身跨度 %d 个月" % window
    else:
        provenance = "按档案时间窗 %d 个月" % window
    expected = max(ev.cells, 1) * max(window, 1)
    if not window or not ev.cell_months:
        return SubScore("completeness.data", "completeness", "数据完整性", 0.0,
                        "该序列在建模窗口内没有任何观测。", True, True)
    missing = max(0.0, 1.0 - ev.cell_months / expected)
    detail = "%s × %d 个格子，应有 %d 条，实到 %d 条" % (
        provenance, max(ev.cells, 1), expected, ev.cell_months)
    if missing >= _MISSING_HIGH:
        return SubScore("completeness.data", "completeness", "数据完整性", 0.0,
                        "缺失 %s（≥10%%）：%s。" % (_pct(missing), detail), True, True)
    if missing > 0:
        return SubScore("completeness.data", "completeness", "数据完整性", 0.5,
                        "缺失 %s（<10%%）：%s。" % (_pct(missing), detail), True, True)
    return SubScore("completeness.data", "completeness", "数据完整性", 1.0,
                    "无缺失：%s。" % detail, True, True)


def granularity_subs(ev: SeriesEvidence, ctx: SeriesContext) -> list[SubScore]:
    """时间颗粒度 · 模型颗粒度 · 下钻颗粒度."""
    return [_time_grain_sub(ev), _model_grain_sub(ev, ctx), _drilldown_sub(ev)]


def _time_grain_sub(ev: SeriesEvidence) -> SubScore:
    """Monthly or finer is the modeling minimum. No 0.5 band — the rule has none."""
    if ev.monthly:
        return SubScore("granularity.time", "granularity", "时间颗粒度", 1.0,
                        "月度或更细，满足建模最低颗粒度。", True, True)
    return SubScore("granularity.time", "granularity", "时间颗粒度", 0.0,
                    "粗于月度（季度/年度），低于建模最低颗粒度。", True, True)


def _model_grain_sub(ev: SeriesEvidence, ctx: SeriesContext) -> SubScore:
    """Does the series split the way the contract's model scope needs it to?

    Required = the contract's axes, narrowed to the ones the factor tree says THIS
    indicator is measured by. The narrowing is what keeps a national media buy from
    scoring 0 for having no channel split: the tree declared it national, the data
    delivered national, nothing is missing. An axis the tree promised and the data
    does not carry is a real gap, and that is what this reports.
    """
    required = frozenset(ctx.axes_required)
    if not required:
        declared = "、".join(sorted(ctx.axes_declared)) or "未声明"
        return SubScore(
            "granularity.model", "granularity", "模型颗粒度", 1.0,
            "全国口径：因子树声明的报出维度（%s）不含模型范围要求的拆分轴。" % declared,
            computed=True, blocking=True)
    have = required & ev.axes_present
    if have == required:
        return SubScore(
            "granularity.model", "granularity", "模型颗粒度", 1.0,
            "完全适配模型颗粒度（%s），可直接建模。" % "、".join(sorted(required)),
            True, True)
    if have:
        missing = "、".join(sorted(required - have))
        return SubScore(
            "granularity.model", "granularity", "模型颗粒度", 0.5,
            "基本适配，但缺 %s 轴，需要额外聚合或拆解。" % missing, True, True)
    return SubScore(
        "granularity.model", "granularity", "模型颗粒度", 0.0,
        "模型要求的 %s 轴数据整个缺失，无法满足基本建模需求。" % "、".join(sorted(required)),
        True, True)


def _drilldown_sub(ev: SeriesEvidence) -> SubScore:
    """L5–L8 deepdive depth. Advisory: it describes how far a deep dive can go, not
    whether the series can carry a model."""
    if ev.drilldown_dims > _DRILL_DEEP:
        return SubScore("granularity.drilldown", "granularity", "下钻颗粒度", 1.0,
                        "%d 个下钻维度（L5–L8），支持深度下钻分析。" % ev.drilldown_dims,
                        True, False)
    if ev.drilldown_dims >= 1:
        return SubScore("granularity.drilldown", "granularity", "下钻颗粒度", 0.5,
                        "只有 %d 个下钻维度，不足以支持深度分析。" % ev.drilldown_dims,
                        True, False)
    return SubScore("granularity.drilldown", "granularity", "下钻颗粒度", 0.0,
                    "没有任何 L5–L8 下钻维度。", True, False)


# ── factor-level escalation ─────────────────────────────────────────────────


def escalations(rows: list[dict], *, score_key: str = "total",
                reason: str = "该因子下全部 %d 个指标都不可用，本因子将没有任何可用数据。",
                route_to: str = "业务侧 + 客户（寻找替代数据）") -> list[dict]:
    """Factors whose every indicator scored zero — a different event from a list of
    unusable rows, and the only one that leaves the data owner's desk.

    Three indicators and one dies: that factor lost a viewpoint. Three die: the
    factor is not in the model at all, and the tree put it there for a business
    reason. The second case has to reach the business side and the client, so it is
    raised as its own record rather than being counted among the rejects.

    Written generically over `{l1..l4, indicator, <score_key>}` dicts because the
    statistical layer needs the identical rule.
    """
    return _group_escalations(
        rows, lambda row: float(row.get(score_key) or 0.0) <= 0.0,
        reason=reason, route_to=route_to, severity="high")


def no_data_escalations(rows: list[dict]) -> list[dict]:
    """Factors the tree asked for and no data arrived for, at all.

    Same shape as `escalations`, different event and a different desk: nothing was
    judged unusable here, nothing was judged at all. The fix is to chase the
    delivery, not to find a substitute source — so it routes back to the data
    request rather than to the business side.
    """
    return _group_escalations(
        rows, lambda row: str(row.get("dataStatus") or "") == "no-data",
        reason="该因子下全部 %d 个指标一条数据都没有收到，本因子无法进入模型。",
        route_to="数据需求与验收（追这次交付）", severity="high")


def _group_escalations(rows, predicate, *, reason: str, route_to: str,
                       severity: str) -> list[dict]:
    groups: dict[tuple, list[dict]] = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("dataStatus") or "") == "inherited-drop":
            continue  # an upstream rejection is not this layer's finding
        key = (str(row.get("l1", "")), str(row.get("l2", "")),
               str(row.get("l3", "")), str(row.get("l4", "")))
        if not key[3].strip():
            # An escalation says "this FACTOR will have nothing standing in for it".
            # A row that hangs off no factor — the response indicator sits outside
            # the L1–L4 tree by design — cannot make that claim, and grouping the
            # blanks together invents a factor named "".
            continue
        groups.setdefault(key, []).append(row)

    out = []
    for key, members in groups.items():
        if not members or not all(predicate(m) for m in members):
            continue
        out.append({
            "l1": key[0], "l2": key[1], "l3": key[2], "l4": key[3],
            "indicators": [str(m.get("indicator", "")) for m in members],
            "reason": reason % len(members),
            "severity": severity,
            "routeTo": route_to,
        })
    return sorted(out, key=lambda e: (e["l1"], e["l2"], e["l3"], e["l4"]))
