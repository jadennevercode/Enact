"""2.4 Statistical Score — score every FactorTree indicator on the 2.33 tests.

For each indicator (an L1–L4 factor + its metric, grouped straight from the
Data-Processing long table) we compute three statistics against the modeling
time axis and the KPI (Y):

* **CV** (volatility)   — reference formula: min-max scale to [0,1], variance/mean.
* **Pearson** (vs KPI)  — signed correlation of the indicator with Y.
* **VIF** (collinearity)— per-indicator variance inflation across ALL indicators.

Each maps to a 0/0.5/1 band (``data_rules``); Total = CV×Pearson×VIF (a single
failing test zeroes it) drives the Good / Acceptable / Unconsiderable verdict.
The result is a ``StatScorecard`` the human reviews on the Canvas (per-indicator
include / review / drop). Numbers are computed from the real long table via
pandas/numpy — never from the LLM.

**The tests run on a panel, not on an aggregate (2026-07-27).** They used to score
one national series per indicator — 34 points, produced by collapsing every
channel and product into a single total *before* any statistic was computed. The
panel is instead stacked over the model objects themselves: one row per
``(model object, month)``, so an indicator is measured across every channel ×
product the model will actually be fitted on. Two things follow, and both matter:

* there are now ``n_objects × n_months`` observations instead of ``n_months``, which
  moves VIF out of the under-determined regime (``vif_all``'s pairwise-max proxy)
  and into the exact ``inv(R)`` one for the first time;
* an indicator that is flat inside one channel but differs sharply between
  channels is no longer indistinguishable from a genuinely constant one.

Region and the L5–L8 residual still roll up inside each cell, with that
indicator's own 2.1 aggregation — they are *inside* a model object, and indicators
disagree about how deep they report, so a panel keyed on them would leave two
indicators sharing no rows at all and silently correlate them on nothing.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from mmm_engine.scoring import rules as data_rules
from mmm_engine.scoring.rules import reference_cv, score_statistical, vif_all
from mmm_engine.domain.models import StatScoreRow, StatScorecard
from mmm_engine.mmm.pivot import _is_y_row, _pick_y_metric
from mmm_engine.domain.models import ProjectState
from mmm_engine.trace import get as get_tool
from mmm_engine.trace import traced

# A disposition default per verdict: keep the good ones, send the middle band to
# the human, drop the unusable — the human can override any of these on the Canvas.
_DISPOSITION_DEFAULT: dict[str, str] = {
    "Good": "include",
    "Acceptable": "review",
    "unconsiderable": "drop",
}

# Monthly data: a year-over-year difference removes the level, the trend and the
# seasonality in one step. Both correlation-based tests need this — on raw levels
# every indicator correlates with the KPI and with every other indicator, because
# they all ride the same seasonal trend, and the tests measure that instead of the
# indicator. CV is deliberately NOT differenced: it asks whether the series moves
# at all, which is a property of the level series.
DETREND_PERIOD = 12

# Guard on the RESULT of differencing, not the input length: a 13-14 month
# project differences down to 1-2 rows, and Pearson's `mask.sum() < 3` guard
# then silently returns 0.0 for every indicator, dropping everything with no
# explanation. Below this many resulting rows, skip differencing altogether.
MIN_DETRENDED_POINTS = 6

# Minimum observed months for an indicator's statistics to mean anything —
# aligned with `pivot.MIN_MONTHS`, which is the bar for entering the model at all.
# A shorter indicator is still emitted (with a zero total and an explicit note)
# rather than dropped, so the funnel count stays honest about what was screened.
MIN_SCORED_MONTHS = 12
_SHORT_COVERAGE_VERDICT = "unconsiderable"

# 2.33's own words: "高VIF指标需降维/合并/剔除". The multiplicative Total cannot
# carry that — VIF 5 and VIF 50 both score 0 and a Total can only be zeroed once —
# so severe collinearity is flagged separately and recommended for removal
# whatever the rest of the row says.
SEVERE_VIF = 10.0

# The panel's row key: one observation per model object per month.
PANEL_LEVELS = ("object", "month")

# How many indicators a VIF is measured against — the width of a *realistic* model,
# mirroring `pivot.MAX_DRIVERS`. See `_design_vifs` for why this is not "all of them".
from mmm_engine.mmm.pivot import MAX_DRIVERS as SCREEN_DESIGN_COLS  # noqa: E402


def vif_regime(n_obs: int, n_design_cols: int) -> str:
    """Which of `vif_all`'s two branches the design matrix landed in.

    ``exact`` is the identified case (``n > p + 1``) where VIF_i = [inv(R)]_ii.
    ``pairwise-proxy`` is the under-determined case, where a full multivariate VIF
    does not exist and the number reported is "how well the single most collinear
    peer explains this indicator". The deliverable has to say which it is: a proxy
    presented as an exact VIF invites a decision the number cannot support.
    """
    return "exact" if int(n_obs) > int(n_design_cols) + 1 else "pairwise-proxy"


def zero_reason(cv_score: float, pearson_score: float, vif_score: float) -> str:
    """Which of the three tests zeroed the Total, named.

    A row reading only "unconsiderable" leaves the reviewer nothing to act on: a
    flat series wants re-collection, a collinear one wants a choice between
    siblings, and an uncorrelated one is usually just not a driver.
    """
    failed = []
    if not cv_score:
        failed.append("波动性")
    if not pearson_score:
        failed.append("相关性")
    if not vif_score:
        failed.append("共线性")
    return " + ".join(failed)


def factor_alerts(card: "StatScorecard") -> list[dict]:
    """L4 factors whose every candidate indicator failed — 2.33's escalation rule.

    "因子全失则预警" is a written platform rule, not an optional hint: the factor
    is not merely short an indicator, the model will have nothing standing in for
    that part of the business, and the fix lives back in business understanding
    (find a substitute indicator), not here.
    """
    by_l4: dict[str, list] = {}
    for row in (getattr(card, "rows", None) or []):
        by_l4.setdefault(str(row.l4), []).append(row)
    alerts = []
    for l4, rows in sorted(by_l4.items()):
        if not l4 or not rows:
            continue
        if any(r.auto_verdict != "unconsiderable" for r in rows):
            continue
        reasons = sorted({zero_reason(r.cv_score, r.pearson_score, r.vif_score)
                          for r in rows if zero_reason(r.cv_score, r.pearson_score,
                                                       r.vif_score)})
        alerts.append({
            "l4": l4,
            "indicators": [str(r.indicator) for r in rows],
            "allFailed": True,
            "reason": ("全部候选指标不达标（%s）" % "、".join(reasons)) if reasons
                      else "全部候选指标不达标",
            "action": "回流业务理解，寻找替代指标",
        })
    return alerts


def can_detrend(n_months: int, period: int = DETREND_PERIOD) -> bool:
    """Whether year-over-year differencing leaves enough points to be worth doing.

    A short project should still be screened, just without the seasonal
    correction, rather than being handed a handful of points too few for Pearson
    (or anything else) to say anything meaningful.
    """
    return n_months - period >= MIN_DETRENDED_POINTS


def _panel_yoy(frame, period: int = DETREND_PERIOD):
    """Year-over-year difference **within each model object**.

    A plain positional diff down the stacked panel would subtract one channel's
    first months from the next channel's last ones at every object boundary. The
    difference is taken inside each object's own contiguous month range, which
    ``_indicator_panel`` guarantees by reindexing every object onto the same
    complete calendar.
    """
    return frame.groupby(level="object").diff(period)


def _panel_within(frame):
    """Standardize each column **inside each model object** before pooling.

    The correlation tests ask a within-object question — "when this indicator moves
    in a channel × product cell, does that cell's response move with it" — but a
    pooled panel answers a mixed one, and the between-object part of it is noise for
    this purpose. It is also actively misleading: a national driver (TV, search) is
    the *same series* in every object while the response differs several-fold between
    them, so pooling raw year-over-year changes buries a real relationship under
    cross-sectional scale. On the synthetic case that attenuated every |r| to below
    0.25 — including drivers generated with a known 6–8% contribution — and 2.4 then
    scored 15 of 18 indicators unconsiderable, keeping the three that do least.

    Removing each object's own mean and scale (the standard within/fixed-effects
    transform) makes every object contribute its own co-movement on equal terms.
    Constant-within-object columns come back as zeros, which the tests already read
    as "no relationship" rather than dividing by zero.
    """
    def _z(g):
        sd = g.std()
        return (g - g.mean()) / sd.replace(0.0, np.nan) if hasattr(sd, "replace") else (
            (g - g.mean()) / (sd if sd else np.nan))

    return frame.groupby(level="object", group_keys=False).apply(_z)


def _complete_month_index(idx: "pd.Index") -> "pd.Index":
    """The full contiguous yyyymm month range spanning ``idx``'s min..max.

    Successive months are NOT successive integers (...202412, 202501...), so
    the range has to be built by calendar arithmetic, not ``range()``. Used to
    reindex the panel before year-over-year differencing: a month missing
    anywhere in the panel would otherwise silently turn ``a[12:] - a[:-12]``
    into a "12 rows ago" difference across the gap instead of a true YoY one.
    """
    if idx.empty:
        return idx
    lo, hi = int(idx.min()), int(idx.max())
    y, m = divmod(lo, 100)
    months: list[int] = []
    cur = lo
    while cur <= hi:
        months.append(cur)
        m += 1
        if m > 12:
            m = 1
            y += 1
        cur = y * 100 + m
    return pd.Index(months, name=idx.name)


def _roll_monthly(grp: pd.DataFrame, st, l4: object, metric: object) -> pd.Series:
    """One value per month, rolled up the way 2.1 says this indicator rolls up.

    A national row is still split across the L5–L8 residual, so within a single
    month there can be several rows for one indicator. Summing them is only right
    for an additive metric: a coverage rate or a price index summed across its
    sub-paths produces a number with no meaning, and it was that number the CV,
    Pearson and VIF tests were scoring.
    """
    from mmm_engine.domain.overrides import pandas_agg, resolve_aggregation

    return (grp.dropna(subset=["month"])
            .groupby("month")["value"]
            .agg(pandas_agg(resolve_aggregation(st, l4, metric)))
            .sort_index())


def _monthly_y(df: pd.DataFrame, st=None) -> pd.Series | None:
    """Monthly KPI (Y) series — the response the indicators are scored against.

    The response is whichever indicator the user tagged ``Y`` at 2.1, resolved
    through ``overrides.resolved_y_metric``. 2.4 used to auto-pick its own Y by
    month coverage, so it could correlate every indicator against a different
    response than 2.5 would go on to fit.
    """
    from mmm_engine.domain.overrides import resolved_y_metric

    y_rows = df[_is_y_row(df)]
    if y_rows.empty:
        return None
    y_metric = resolved_y_metric(st, df) or _pick_y_metric(y_rows)
    sel = y_rows[y_rows["metric"] == y_metric]
    if sel.empty:
        return None
    y_l4 = str(sel["l4"].iloc[0]) if "l4" in sel.columns else ""
    s = _roll_monthly(sel, st, y_l4, y_metric)
    return s if not s.empty else None


def _indicator_series(df: pd.DataFrame, st=None, *,
                      drop_constant: bool = True) -> tuple[list[dict], pd.DataFrame]:
    """Build one monthly series per (l1,l2,l3,l4,metric) indicator, for one slice.

    ``drop_constant=False`` keeps a series that never moves *inside this slice*.
    The panel builder needs that: an indicator can be flat in one channel and
    still carry all its information in how it differs between channels, and
    dropping it per slice would delete that before the panel is stacked.

    Returns (metas, wide) where ``wide`` is a month-indexed frame with one column
    per indicator and ``metas`` carries its L1–L4 path plus the number of months
    the indicator was actually observed. Constant / all-NaN indicators are dropped
    (no volatility, undefined VIF).

    **Gaps stay NaN.** They used to be zero-filled, which silently turned "this
    indicator did not exist before 2023" into "this indicator was zero for two
    years": CV then measured a step function instead of the series' own movement,
    Pearson correlated the zero block against the KPI's trend, and every short
    indicator shared that same zero block so VIF read them as collinear with each
    other. All three tests were scoring the padding.
    """
    metas: list[dict] = []
    series: dict[str, pd.Series] = {}
    grouped = df.groupby(["l1", "l2", "l3", "l4", "metric"], dropna=False)
    for i, ((l1, l2, l3, l4, metric), grp) in enumerate(grouped):
        name = str(metric)
        if not name.strip() or name == "<NA>":
            continue
        if _is_y_row(grp).all():  # the KPI itself is not a candidate driver
            continue
        s = _roll_monthly(grp, st, l4, metric)
        if s.empty:
            continue
        if drop_constant and float(np.nanstd(s.to_numpy(dtype=float))) == 0.0:
            continue
        col = f"i{i}"
        series[col] = s
        metas.append({"col": col, "l1": _s(l1), "l2": _s(l2), "l3": _s(l3),
                      "l4": _s(l4), "indicator": name,
                      "months": int(s.notna().sum())})
    if not series:
        return [], pd.DataFrame()
    wide = pd.concat(series, axis=1).sort_index()
    return metas, wide


def _s(v: object) -> str:
    return "" if (v is None or (isinstance(v, float) and pd.isna(v))) else str(v)


def _design_vifs(detr: np.ndarray, r_by_col: list[float]) -> tuple[np.ndarray, list[int]]:
    """Per-indicator VIF measured against a **realistic model**, not the whole
    candidate universe.

    VIF is a property of a design matrix: "how much is this column's variance
    inflated by the *other columns in the model*". Screening asked it of all ~93
    candidates at once, which fails in both of `vif_all`'s regimes and for the same
    underlying reason — there is no real design in which 93 co-seasonal marketing
    series sit together. On a short panel it lands in the under-determined
    pairwise-max proxy, where almost every series has some peer correlated above
    0.89; on a longer one it reaches the identified branch and inverts a
    pairwise-complete correlation matrix that is nowhere near positive-definite, so
    every VIF pins to ``VIF_MAX``. Either way nearly everything scored VIF >= 5, the
    2.33 band zeroed its total, and 2.4 dropped ~90% of the indicators it was asked
    to screen.

    So each indicator is measured against the model it could actually be in: the
    ``SCREEN_DESIGN_COLS`` most Y-correlated indicators. Members of that set get
    their VIF from that matrix; an indicator outside it is measured against the
    strongest ``SCREEN_DESIGN_COLS - 1`` peers plus itself — the same question,
    asked of a design it could plausibly join. Since 2.5 now fits every surviving
    candidate of a model object at once, and an object's universe is a dozen-odd
    indicators rather than the whole tree, that design is also close to the fit the
    indicator will really sit in.

    The 2.33 band is untouched (``VIF <= 1`` → 1, ``< 5`` → 0.5, ``>= 5`` → 0) and
    `vif_all` itself is untouched; only the matrix it is handed changes.

    Returns ``(vifs, base_idx)``.
    """
    n_cols = detr.shape[1]
    k = min(SCREEN_DESIGN_COLS, n_cols)
    base = sorted(range(n_cols), key=lambda i: -abs(r_by_col[i]))[:k]
    base_set = set(base)

    vifs = np.ones(n_cols, dtype=float)
    base_vifs = get_tool("stat.vif").run(detr[:, base])
    for pos, i in enumerate(base):
        vifs[i] = float(base_vifs[pos])

    # Secondary path — deliberately untraced, so screening still records exactly
    # one `stat.vif` invocation per task run (see CLAUDE.md's tracing granularity).
    peers = base[: max(k - 1, 1)]
    for i in range(n_cols):
        if i in base_set:
            continue
        cols = [j for j in peers if j != i] + [i]
        out = get_tool("stat.vif").run(detr[:, cols])
        vifs[i] = float(out[-1])
    return vifs, base


def _indicator_panel(st, df: pd.DataFrame,
                     objects: list[str]) -> tuple[list[dict], pd.DataFrame, pd.Series]:
    """Stack every model object's monthly series into one ``(object, month)`` panel.

    Returns ``(metas, wide, y)``. ``wide``'s columns are indicator ids that are
    **stable across objects** — the same ``(l1..l4, metric)`` indicator is one
    column no matter how many channels report it, which is what makes a single
    scorecard row per indicator meaningful. ``y`` is the response on the same
    index: each cell's own KPI, so an indicator is correlated against the sales it
    could actually have driven rather than against a national total.

    Each object's rows are reindexed onto the panel's complete calendar range
    before anything is differenced positionally. A month missing in one channel
    would otherwise turn that channel's ``a[12:] - a[:-12]`` into a "12 rows ago"
    difference across the gap instead of a true year-over-year one.
    """
    cols: dict[tuple, str] = {}
    metas_by_col: dict[str, dict] = {}
    frames: dict[str, pd.DataFrame] = {}
    y_parts: dict[str, pd.Series] = {}

    from mmm_engine.selection.model_objects import object_mask

    for obj in objects:
        sub = df[object_mask(df, obj)]
        if sub.empty:
            continue
        y = _monthly_y(sub, st)
        if y is None or y.empty:
            continue
        # Constant-inside-this-channel series are kept: the panel is where that
        # question is answered, once, over every channel at the same time.
        metas, wide = _indicator_series(sub, st, drop_constant=False)
        if not metas:
            continue
        rename: dict[str, str] = {}
        for m in metas:
            key = (m["l1"], m["l2"], m["l3"], m["l4"], m["indicator"])
            col = cols.get(key)
            if col is None:
                col = cols[key] = f"i{len(cols)}"
                metas_by_col[col] = {"col": col, **dict(zip(
                    ("l1", "l2", "l3", "l4", "indicator"), key)), "months": 0}
            rename[m["col"]] = col
        frames[obj] = wide.rename(columns=rename)
        y_parts[obj] = y

    if not frames:
        return [], pd.DataFrame(), pd.Series(dtype=float)

    all_months = pd.Index(sorted({int(m) for f in frames.values() for m in f.index}))
    full_months = _complete_month_index(all_months)
    aligned: dict[str, pd.DataFrame] = {}
    for obj, f in frames.items():
        g = f.reindex(full_months)
        g["__Y__"] = y_parts[obj].reindex(full_months)
        aligned[obj] = g
    panel = pd.concat(aligned, names=list(PANEL_LEVELS))

    y_panel = panel["__Y__"]
    wide = panel.drop(columns="__Y__")
    # Months an indicator was actually observed anywhere in the panel — the same
    # coverage question `MIN_SCORED_MONTHS` has always asked, now over every cell.
    months_level = wide.index.get_level_values("month")
    metas: list[dict] = []
    for col, meta in metas_by_col.items():
        seen = wide[col].notna()
        if not bool(seen.any()):
            continue
        # A constant-across-the-panel series is KEPT. It used to be dropped here as
        # "no volatility, no VIF" — but a series that never moves is precisely what
        # the volatility test exists to catch, and dropping it meant the one row a
        # reviewer most needed to see never reached the scorecard. It scores CV 0
        # (`reference_cv` returns 0 for a constant), r 0 (zero variance), VIF 1, so
        # the Total is 0 and `zeroReason` names 波动性 — which is the finding.
        metas.append({**meta, "months": int(months_level[seen].nunique())})
    return metas, wide, y_panel


@dataclass(frozen=True)
class Panel:
    """The shape all three tests run on, built once and handed to each.

    ``wide`` is a ``(object, month)``-indexed frame with one column per indicator;
    ``y`` is the response on the same index — each cell's own KPI, so an indicator
    is correlated against the sales it could actually have driven rather than
    against a national total. ``by_row`` maps a scorecard row id to its column, so
    a per-test payload can be joined back to the tree-driven row set.
    """

    metas: list[dict]
    wide: "pd.DataFrame"
    y: "pd.Series"
    months: int
    objects: int
    by_row: dict[str, str]

    @property
    def cols(self) -> list[str]:
        return [m["col"] for m in self.metas]

    @property
    def scope(self) -> str:
        return "%d indicators × %d model object(s)" % (len(self.metas), self.objects)

    def months_for(self, col: str) -> int:
        for meta in self.metas:
            if meta["col"] == col:
                return int(meta.get("months", 0))
        return 0

    def detrended(self):
        """(design matrix, response, label) for the two correlation-based tests.

        Year-over-year differencing removes level, trend and seasonality in one
        step, **within each object** — a diff down the stacked panel would subtract
        one channel's first months from the next channel's last. Then each column
        is standardised inside its object, so a national driver that is the same
        series everywhere is not buried under cross-sectional scale.

        CV never comes through here: it asks whether the series moves at all, and
        that is a property of the level series.
        """
        frame = self.wide[self.cols]
        if can_detrend(self.months):
            frame, y = _panel_yoy(frame), _panel_yoy(self.y)
            label = "%d year-over-year periods × %d object(s)" % (
                self.months - DETREND_PERIOD, self.objects)
        else:
            y = self.y
            label = "%d monthly points × %d object(s) (too short to detrend)" % (
                self.months, self.objects)
        if self.objects > 1:
            frame, y = _panel_within(frame), _panel_within(y)
        return frame.to_numpy(dtype=float), y.to_numpy(dtype=float), label


def build_panel(st: ProjectState, universe) -> Panel:
    """Stack the scored rows of ``universe`` into one ``(object, month)`` panel.

    Only rows the tree asked for and the data delivered take part. Rows an earlier
    layer rejected are not merely tidied away: VIF is computed across the whole set
    at once, so a dead indicator's collinearity would inflate the VIF of the ones
    still in play.
    """
    from mmm_engine.dataset import model_df, model_objects
    from mmm_engine.selection.ledger import _norm_pair

    df = model_df(st)
    metas, wide, y = _indicator_panel(st, df, model_objects(st))
    if not metas or wide.empty or y.empty:
        return Panel([], pd.DataFrame(), pd.Series(dtype=float), 0, 0, {})

    wanted = {_norm_pair(row.l4, row.indicator): row.id for row in universe.scored}
    kept, by_row = [], {}
    for meta in metas:
        row_id = wanted.get(_norm_pair(meta["l4"], meta["indicator"]))
        if row_id is None:
            continue
        kept.append(meta)
        by_row[row_id] = meta["col"]
    if not kept:
        return Panel([], pd.DataFrame(), pd.Series(dtype=float), 0, 0, {})

    cols = [m["col"] for m in kept]
    return Panel(metas=kept, wide=wide[cols], y=y,
                 months=int(wide.index.get_level_values("month").nunique()),
                 objects=int(wide.index.get_level_values("object").nunique()),
                 by_row=by_row)


def volatility(panel: Panel) -> dict[str, float]:
    """CV per indicator, on the raw levels. See `Panel.detrended` for why not there."""
    values = get_tool("stat.cv").run(
        [panel.wide[c].to_numpy(dtype=float) for c in panel.cols])
    return dict(zip(panel.cols, values))


def correlation(panel: Panel) -> tuple[dict[str, float], str]:
    """Signed Pearson r against the response, on the detrended panel."""
    detr, y_detr, label = panel.detrended()
    values = get_tool("stat.pearson").run(
        [pd.Series(detr[:, i]) for i in range(len(panel.cols))], pd.Series(y_detr))
    return dict(zip(panel.cols, values)), label


def collinearity(panel: Panel, r_by_col: dict[str, float]) -> dict:
    """VIF per indicator, measured against a realistic design — see `_design_vifs`.

    Takes the correlations rather than recomputing them: the design matrix is the
    most Y-correlated indicators, so this test genuinely depends on the previous
    one. Passing them in makes the dependency visible instead of hiding a second,
    possibly different, Pearson run inside the VIF step.
    """
    detr, _y, label = panel.detrended()
    k = min(SCREEN_DESIGN_COLS, len(panel.cols))
    vifs, _base = _design_vifs(detr, [r_by_col.get(c, 0.0) for c in panel.cols])
    return {"byCol": dict(zip(panel.cols, (float(v) for v in vifs))),
            "designCols": k, "regime": vif_regime(len(detr), k), "detrend": label}


def build_stat_scorecard(st: ProjectState, *, eng=None,
                         task_id: str | None = None) -> StatScorecard:
    """Score the indicators still in play on CV / Pearson / VIF, over the panel.

    Kept as one call for the OLS layer, which re-derives the card for lookup when
    the reviewed one is not on state. The CLI runs the three tests as separate
    tools instead — same numbers, one run record each.

    One row per indicator: an indicator is measured **once, across every channel ×
    product at the same time**, on ``n_objects × n_months`` observations. The
    verdict is global and every model object inherits it.
    """
    from mmm_engine.scoring import universe as U

    universe = U.build(st, "statistical", prefix="s")
    panel = build_panel(st, universe)
    if not panel.metas:
        return StatScorecard(rows=[])

    scope = panel.scope
    cvs = traced(eng, st, task_id, "stat.cv", "%s: pooled series" % scope,
                 volatility, panel,
                 summarize=lambda out: ("CV %.2f–%.2f" % (min(out.values()), max(out.values()))
                                        if out else "no indicators"))
    rs, period_label = traced(
        eng, st, task_id, "stat.pearson", "%s vs KPI" % scope, correlation, panel,
        summarize=lambda out: ("|r| up to %.2f · %d at or above 0.3"
                               % (max(abs(v) for v in out[0].values()),
                                  sum(1 for v in out[0].values() if abs(v) >= 0.3))
                               if out[0] else "no indicators"))
    vif_out = traced(
        eng, st, task_id, "stat.vif",
        "%s, each against a %d-driver design × %s"
        % (scope, min(SCREEN_DESIGN_COLS, len(panel.cols)), period_label),
        collinearity, panel, rs,
        summarize=lambda out: ("max VIF %.1f · %d at or above 5"
                               % (max(out["byCol"].values()),
                                  sum(1 for v in out["byCol"].values() if v >= 5))
                               if out["byCol"] else "no indicators"))

    rows = compose_rows(universe, panel, cvs, rs, vif_out["byCol"])
    # Only rows that actually carry statistics. The CLI payload keeps every row of
    # the universe — that is what makes the funnel legible — but this in-memory card
    # is consumed by the OLS layer as "the evidence for this variable", and a row
    # with null statistics is not evidence.
    return StatScorecard(rows=[r for r in rows if r.total is not None],
                         panel=panel_summary(panel, period_label, vif_out))


def panel_summary(panel: Panel, period_label: str, vif_out: dict) -> dict:
    """What shape this screening ran on — the block every deliverable must quote."""
    return {
        "panel": panel.scope,
        "months": panel.months,
        "detrend": period_label,
        "vifDesign": "each against a %d-driver design" % vif_out["designCols"],
        "vifRegime": vif_out["regime"],
        "formula": "Total = CV × Pearson × VIF",
        "severeVif": SEVERE_VIF,
        "bands": "Total >= 0.5 Good · 0 < Total < 0.5 Acceptable · Total = 0 unconsiderable",
    }


def compose_rows(universe, panel: Panel, cvs: dict, rs: dict,
                 vifs: dict) -> list[StatScoreRow]:
    """One `StatScoreRow` per row of the universe, scored or not.

    Rows the tree asked for that have no data, and rows an earlier layer already
    rejected, come back with **null statistics and a null Total** — never zeros. A
    zero here means "measured, and it fails"; these were not measured.
    """
    from mmm_engine.scoring.rules import compose_statistical

    out: list[StatScoreRow] = []
    for row in universe.rows:
        col = panel.by_row.get(row.id)
        if col is None:
            verdict, rationale, disposition = _unscreened(row)
            out.append(StatScoreRow(
                id=row.id, l1=row.l1, l2=row.l2, l3=row.l3, l4=row.l4,
                indicator=row.indicator, treeRowId=row.tree_row_id,
                dataStatus=row.data_status, cv=None, pearson=None, vif=None,
                cvScore=None, pearsonScore=None, vifScore=None, total=None,
                autoVerdict=verdict, disposition=disposition, rationale=rationale))
            continue
        cv = float(cvs.get(col, 0.0))
        corr = float(rs.get(col, 0.0))
        vif = float(vifs.get(col, 1.0))
        months = panel.months_for(col)
        sc = compose_statistical(data_rules._cv_band(cv), data_rules._pearson_band(corr),
                                 data_rules._vif_band(vif))
        short = months < MIN_SCORED_MONTHS
        out.append(StatScoreRow(
            id=row.id, l1=row.l1, l2=row.l2, l3=row.l3, l4=row.l4,
            indicator=row.indicator, treeRowId=row.tree_row_id,
            dataStatus=row.data_status,
            cv=round(cv, 4), pearson=round(corr, 4), vif=round(vif, 3),
            cvScore=sc.cv_score, pearsonScore=sc.pearson_score, vifScore=sc.vif_score,
            # Too little history for any of the three to mean anything. Scored and
            # shown WITH the reason rather than quietly omitted, so the funnel count
            # still matches the indicator count.
            total=0.0 if short else sc.total,
            autoVerdict=_SHORT_COVERAGE_VERDICT if short else sc.verdict,
            disposition=_DISPOSITION_DEFAULT[
                _SHORT_COVERAGE_VERDICT if short else sc.verdict],
            severeCollinearity=vif >= SEVERE_VIF,
            zeroReason=("观测月数 %d < %d" % (months, MIN_SCORED_MONTHS) if short
                        else zero_reason(sc.cv_score, sc.pearson_score, sc.vif_score)),
            rationale=("只有 %d 个观测月，低于统计筛选的 %d 个月下限。"
                       % (months, MIN_SCORED_MONTHS)) if short else "",
        ))
    # Worst first so the reviewer sees the risky indicators at the top; the rows
    # with no Total at all sort last — they are a different conversation.
    out.sort(key=lambda r: (r.total is None, r.total or 0.0, r.indicator))
    return out


def _unscreened(row) -> tuple[str, str, str]:
    """(verdict, rationale, disposition) for a row that has no panel column.

    Three ways that happens, and they are not the same event:

    * the tree asked and nothing arrived → `no-data`, and it goes back to the
      data request rather than being judged here;
    * an earlier layer already ruled it out → `inherited-drop`, inherited;
    * **it is the response.** Y is what the drivers are correlated *against*; it
      cannot be screened as a driver of itself, and it is never dropped — the model
      has nothing to explain without it. Left as a bare "scored" it produced a row
      whose verdict was the word "scored", which is not a verdict and would have
      stalled the review gate on a row nobody can rule on.
    """
    if row.data_status in ("no-data", "inherited-drop"):
        return (row.data_status,
                {"no-data": "因子树要了这个指标，一条数据都没到——没有可检验的序列。",
                 "inherited-drop": "上游已判不做，本层不重新检验。"}[row.data_status],
                "drop" if row.data_status == "inherited-drop" else "")
    if str(getattr(row.tree_row, "role", "")) == "response":
        return ("response",
                "响应指标：驱动因子是对着它做相关性检验的，它不检验自己，也不会被剔除。",
                "include")
    return ("not-screened",
            "这条序列进不了面板——通常是它在每个建模对象里都没有可用的月度取值。",
            "")


def pearson(x: pd.Series, y: pd.Series) -> float:
    """Signed Pearson r between two aligned month-indexed series (0.0 if undefined)."""
    xv = x.to_numpy(dtype=float)
    yv = y.to_numpy(dtype=float)
    mask = ~(np.isnan(xv) | np.isnan(yv))
    if mask.sum() < 3:
        return 0.0
    xv, yv = xv[mask], yv[mask]
    if np.std(xv) == 0.0 or np.std(yv) == 0.0:
        return 0.0
    r = float(np.corrcoef(xv, yv)[0, 1])
    return 0.0 if np.isnan(r) else r


_pearson = pearson  # legacy internal alias


def accepted_stat_labels(card: StatScorecard) -> list[str]:
    """Indicators the human kept (disposition != drop) — the 2.4 → 2.5 hand-off.

    The dedup by label is belt-and-braces: rows are one per indicator again since
    scoring moved to the panel, but a legacy scorecard on saved state can still
    carry the per-channel rows this used to produce.
    """
    seen: set[str] = set()
    out: list[str] = []
    for r in card.rows:
        if r.disposition == "drop":
            continue
        label = f"{r.l4 or r.l3} · {r.indicator}".strip(" ·")
        if label in seen:
            continue
        seen.add(label)
        out.append(label)
    return out


# Column layout for the Sheet2-style artifact body (mirrors the reference workbook).
STAT_COLUMNS = ["L1", "L2", "L3", "L4", "Indicator", "CV", "Pearson", "VIF",
                "CV score", "Corr score", "VIF score", "Total", "Verdict", "Disposition",
                "AI rationale"]

_VERDICT_EN = {"Good": "Good", "Acceptable": "Acceptable", "unconsiderable": "Unconsiderable"}
_DISPOSITION_EN = {"include": "Include", "review": "Review", "drop": "Drop"}


def stat_sheet(card: StatScorecard) -> dict:
    """Render the 2.4 artifact: the rule page (Sheet1) + the per-indicator results
    page (Sheet2), matching the reference ``Data statistical test`` workbook."""
    result_rows = [[
        r.l1, r.l2, r.l3, r.l4, r.indicator,
        f"{r.cv:.2f}", f"{r.pearson:+.2f}", f"{r.vif:.1f}",
        f"{r.cv_score:g}", f"{r.pearson_score:g}", f"{r.vif_score:g}",
        f"{r.total:g}", _VERDICT_EN.get(r.auto_verdict, r.auto_verdict),
        _DISPOSITION_EN.get(r.disposition, r.disposition), r.rationale,
    ] for r in card.rows]
    return {"sheets": [
        {"name": "Scoring rules", "columns": ["Test", "Score", "Condition", "Meaning"],
         "rows": data_rules.statistical_rule_rows()},
        {"name": "Statistical score", "columns": STAT_COLUMNS,
         "rows": result_rows or [["—"] + [""] * (len(STAT_COLUMNS) - 1)]},
    ]}
