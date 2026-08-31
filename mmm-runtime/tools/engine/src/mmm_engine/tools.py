"""The tool catalog: 8 registered analysis tools wrapping the real implementations.

Each `run` is an identity wrapper over the function named in `detail.source` — the
tool layer adds visibility, never arithmetic. Granularity is one call per tool
per task run (batched over series/columns), not one per series, so a 2.2 run
records four invocations rather than several thousand.

Every tool also carries its own documentation — scenario, method, decision bands
and thresholds — kept next to the wrapper so the Tools page can never drift from
what actually runs. The source code itself is not duplicated here: `detail()`
reads it off the live function with `inspect.getsource`.
"""
from __future__ import annotations

import importlib
import inspect
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from mmm_engine.domain.models import ToolApiCall, ToolDetail, ToolSource, ToolSpec

# The package root, so a tool page shows `mmm_engine/scoring/quality.py`
# rather than an absolute path that differs on every machine.
_PKG_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Tool:
    detail: ToolDetail
    run: Callable[..., Any]
    module: str
    symbol: str

    @property
    def id(self) -> str:
        return self.detail.id

    @property
    def spec(self) -> ToolSpec:
        """The light catalog entry for the list view."""
        return ToolSpec(**{k: getattr(self.detail, k) for k in ToolSpec.model_fields})


# ── wrappers ────────────────────────────────────────────────────────────────


def _quality_batch(fn_name: str) -> Callable[..., list[list]]:
    """Batch one `scoring.quality.*_subs` over a list of (evidence, context) pairs.

    All four take a context now. Three of them used not to, which is why the tools
    that need cross-series or contract knowledge — the unit the tree asked for, the
    attested total, the modeling window, the required axes — had no way to receive
    it and scored on the series alone.
    """

    def run(evidences: list, contexts: list | None = None) -> list[list]:
        from mmm_engine.scoring import quality as quality_scoring

        fn = getattr(quality_scoring, fn_name)
        if contexts is None:
            contexts = [quality_scoring.SeriesContext()] * len(evidences)
        return [fn(ev, ctx) for ev, ctx in zip(evidences, contexts)]

    return run


def _run_cv(columns: list) -> list[float]:
    from mmm_engine.scoring.rules import reference_cv

    return [reference_cv(x) for x in columns]


def _run_pearson(xs: list, y) -> list[float]:
    from mmm_engine.scoring.statistical import pearson

    return [pearson(x, y) for x in xs]


def _run_vif(matrix: "np.ndarray") -> "np.ndarray":
    from mmm_engine.scoring.rules import vif_all

    return vif_all(matrix)


def _run_ols(df, obj: str, **kwargs):
    from mmm_engine.mmm import run_mmm

    return run_mmm(df, obj, **kwargs)


# ── shared API surface ──────────────────────────────────────────────────────


def _api(task_ids: list[str]) -> list[ToolApiCall]:
    """Tools are not individually addressable: they are called by the step that
    owns them. What IS addressable is the catalog and the resulting trace."""
    step = task_ids[0]
    return [
        ToolApiCall(method="GET", path="/api/tools",
                    note="The catalog — every registered tool.",
                    example="curl localhost:8000/api/tools"),
        ToolApiCall(method="GET", path="/api/tools/{toolId}",
                    note="This page's data, including the live source code.",
                    example="curl localhost:8000/api/tools/{id}"),
        ToolApiCall(method="POST", path="/api/projects/{projectId}/run",
                    note=f"Runs the workflow; step {step} calls this tool as it executes.",
                    example="curl -XPOST localhost:8000/api/projects/danone-mizone/run "
                            "-H 'content-type: application/json' -d '{\"autopilot\":true}'"),
        ToolApiCall(method="GET", path="/api/projects/{projectId}/tool-invocations",
                    note="The recorded calls — filter by step or by tool.",
                    example="curl 'localhost:8000/api/projects/danone-mizone/"
                            "tool-invocations?toolId={id}'"),
    ]


@dataclass(frozen=True)
class _Entry:
    detail: ToolDetail
    run: Callable[..., Any]
    module: str
    symbol: str


def _entry(detail: ToolDetail, run: Callable[..., Any], module: str, symbol: str) -> _Entry:
    detail.api = [
        ToolApiCall(method=c.method, path=c.path, note=c.note,
                    example=c.example.replace("{id}", detail.id))
        for c in _api(detail.used_by)
    ]
    return _Entry(detail=detail, run=run, module=module, symbol=symbol)


_ENTRIES: list[_Entry] = [
    _entry(ToolDetail(
        id="quality.consistency", name="Consistency Check", category="quality",
        description="Scores unit/caliber agreement, time-grid uniformity and whether the "
                    "data source changed under the series, on the 0 / 0.5 / 1 band.",
        inputSummary="Series evidence (units, time grid, source changes, YoY) + the unit "
                     "the factor tree declared",
        outputSummary="3 subcheck scores per series → the consistency dimension score",
        wraps="scoring.quality.consistency_subs", usedBy=["2.2"],
        scenario=(
            "Runs as its own step of 数据质量评分, batched over every factor \u00d7 indicator "
            "series in the published long table. Consistency asks whether the series "
            "contradicts itself \u2014 across sources, across time, across definitions. A 0 "
            "here zeroes the product Total and the human rules on it at the quality gate."),
        method=(
            "Three subchecks against evidence computed from the real rows (pandas, never "
            "the LLM). The dimension score is the WEAKEST blocking subcheck. Dimension "
            "consistency is blocking ONLY when the long table carries a unit column \u2014 "
            "without one it reports itself unverified rather than passing silently."),
        logic=[
            "Dimension consistency \u2014 share of rows off the dominant unit: >10% scores 0, "
            "any mismatch at or below 10% scores 0.5, none scores 1. A unit that "
            "disagrees with the factor tree's declared unit is a full mismatch: every "
            "row is on the wrong caliber, they merely agree with each other.",
            "Time consistency \u2014 1 on a uniform monthly grid; 0.5 when up to 10% of rows "
            "are off it; 0 above 10%, or whenever the series is coarser than monthly.",
            "Caliber consistency \u2014 1 for one source throughout; 0.5 when the source "
            "changed with a YoY swing at or below 30%; 0 when it changed with more.",
            "A source change is detected by comparing the source SET in the early half of "
            "the timeline against the late half \u2014 a stable multi-source mix is not a "
            "caliber change; a source appearing or dropping out is.",
        ],
        params=[
            ["_MIX_TOL", "0.10", "Share of rows allowed to disagree (unit or time grid)"],
            ["_YOY_CALIBER", "0.30", "YoY swing above which a source change scores 0"],
        ],
    ), _quality_batch("consistency_subs"), "mmm_engine.scoring.quality", "consistency_subs"),

    _entry(ToolDetail(
        id="quality.accuracy", name="Accuracy Check", category="quality",
        description="Scores numeric validity (non-finite values and illegal negatives) and "
                    "reconciliation against an externally-attested total.",
        inputSummary="Series evidence (error ratio, period totals) + any registered "
                     "reference total for this indicator",
        outputSummary="2 subcheck scores per series → the accuracy dimension score",
        wraps="scoring.quality.accuracy_subs", usedBy=["2.2"],
        scenario=(
            "Runs as its own step of 数据质量评分. It answers the one question no later "
            "layer can recover from: are the numbers themselves real? A series with more "
            "than 10% invalid values, or more than 10% away from finance's own total, "
            "scores 0 and cannot carry a model unless the human overrides it."),
        method=(
            "error_ratio = (non-finite values + illegal negatives) \u00f7 all values. "
            "Negatives only count as errors for metrics that cannot legitimately be "
            "negative (spend and the KPI) \u2014 for temperature, growth % or an index a "
            "negative is valid data. Business accuracy compares the series' own total "
            "over the reference's period against the number registered in "
            "metadata/reference-totals.yaml."),
        logic=[
            "Numeric accuracy \u2014 1 under 5% invalid; 0.5 from 5% to 10%; 0 above 10%.",
            "Business accuracy \u2014 1 under 5% deviation; 0.5 from 5% to 10%; 0 above 10%. "
            "With nothing registered it returns computed=False and is advisory: the "
            "deliverable must say UNVERIFIED, not 1.",
            "Natural variance is never an error. Spikes belong to the anomaly review in "
            "业务校验与签核, not here.",
        ],
        params=[
            ["_ERR_HIGH", "0.10", "Invalid-value share above which numeric accuracy is 0"],
            ["_ERR_MID", "0.05", "From here to _ERR_HIGH scores 0.5"],
            ["_DEV_HIGH / _DEV_MID", "0.10 / 0.05", "Deviation bands vs the attested total"],
            ["_NONNEG_TYPES", "{spending, Y}", "Roles where a negative counts as an error"],
        ],
    ), _quality_batch("accuracy_subs"), "mmm_engine.scoring.quality", "accuracy_subs"),

    _entry(ToolDetail(
        id="quality.completeness", name="Completeness Check", category="quality",
        description="Scores field completeness (spend paired with a performance metric) and "
                    "the share of the expected month grid that is missing.",
        inputSummary="Series evidence + the parent factor's spend/performance context and "
                     "the project's modeling window",
        outputSummary="2 subcheck scores per series → the completeness dimension score",
        wraps="scoring.quality.completeness_subs", usedBy=["2.2"],
        scenario=(
            "Runs as its own step of 数据质量评分. It is the one quality tool that reads "
            "CROSS-series context: whether the parent L4 pairs its spend with at least one "
            "performance metric, and how long the project said it would model for."),
        method=(
            "Missing share = 1 \u2212 observed (cell, month) pairs \u00f7 (cells the series "
            "reports on \u00d7 months in the modeling window). The denominator is the "
            "series' own footprint on the required axes, NOT its own row count \u2014 that "
            "would make every series complete by construction \u2014 and NOT the full "
            "contract grid, because \u2018this indicator never reported channel X\u2019 is "
            "the model-granularity question and billing it here charges a national "
            "driver twice."),
        logic=[
            "Field completeness \u2014 1 for a response series or a factor whose fields are "
            "complete; 0.5 when the factor has spend but no paired performance metric; "
            "0 when the factor has no in-scope metric field at all.",
            "Data completeness \u2014 1 with nothing missing; 0.5 below 10% missing; 0 at "
            "10% or more.",
            "With no modeling window in the profile the denominator falls back to the "
            "series' own span, and the note says which one it used.",
        ],
        params=[
            ["_MISSING_HIGH", "0.10", "Missing share at or above which data completeness is 0"],
        ],
    ), _quality_batch("completeness_subs"), "mmm_engine.scoring.quality", "completeness_subs"),

    _entry(ToolDetail(
        id="quality.granularity", name="Granularity Check", category="quality",
        description="Scores time granularity (monthly is the modeling minimum), fit to the "
                    "contract's model scope, and L5\u2013L8 drilldown depth.",
        inputSummary="Series evidence (time grid, populated axes, deepdive dims) + the "
                     "contract's model scope and the tree's declared axes",
        outputSummary="3 subcheck scores per series → the granularity dimension score",
        wraps="scoring.quality.granularity_subs", usedBy=["2.2"],
        scenario=(
            "Runs as its own step of 数据质量评分. Two of its three subchecks block: a "
            "series coarser than monthly cannot be modelled at all, and one that does not "
            "carry the axes the contract asked for cannot be fitted at the agreed "
            "granularity. Drilldown depth is advisory \u2014 it describes how far a deep "
            "dive can go, not whether the series can carry a model."),
        method=(
            "Model granularity compares the contract's scope axes, NARROWED to the axes "
            "the factor tree says this indicator is measured by, against the axes the "
            "long table actually populates. The narrowing is what keeps a national media "
            "buy from scoring 0 for having no channel split: the tree declared it "
            "national and the data delivered national, so nothing is missing. An axis the "
            "tree promised and the data does not carry is a real gap, and is what this "
            "reports."),
        logic=[
            "Time granularity (blocking) \u2014 1 monthly or finer, 0 otherwise. The rule "
            "has no 0.5 band.",
            "Model granularity (blocking) \u2014 1 when every required axis is populated; "
            "0.5 when some are and some are not (needs aggregation or a split); 0 when "
            "none of the required axes are there.",
            "Drilldown granularity (advisory) \u2014 1 above 2 deepdive dimensions; 0.5 for "
            "1\u20132; 0 when none are populated.",
        ],
        params=[
            ["monthly", "monthly_ratio \u2265 0.5", "The dominant time grid must be monthly or finer"],
            ["_DRILL_DEEP", "2", "More than this many L5\u2013L8 columns scores 1"],
        ],
    ), _quality_batch("granularity_subs"), "mmm_engine.scoring.quality", "granularity_subs"),

    _entry(ToolDetail(
        id="stat.cv", name="CV (Volatility)", category="statistical",
        description="Coefficient of variation per the 2.33 rule: min-max scale the series to "
                    "[0,1], then variance / mean. A flat indicator cannot explain movement.",
        inputSummary="One monthly value column per candidate indicator",
        outputSummary="CV per indicator → the 0 / 0.5 / 1 volatility band",
        wraps="agents.data_rules.reference_cv", usedBy=["2.4"],
        scenario=(
            "Runs inside step 2.4 Statistical Score, once per run, over every indicator still "
            "in play (indicators already rejected at 2.1 mapping, 2.2 quality or 2.3 sign-off "
            "are not re-scored). CV is the first of the three 2.33 screening tests; its band "
            "adds into the Total that produces the Good / Acceptable / Unconsiderable verdict."),
        method=(
            "This is the workbook's explicit definition — 波动系数CV = 方差/均值 with the data "
            "first scaled to 0–1 — NOT the textbook CV = std/mean. Min-max scaling makes the "
            "measure unit-free so spend in RMB and GRPs are comparable. Empty, constant or "
            "degenerate series return 0.0. Runs on the indicator's raw monthly levels — unlike "
            "Pearson and VIF, which run on year-over-year differenced series."),
        logic=[
            "Drop NaNs, then min-max scale the series to [0,1]. A constant series (max ≤ min) "
            "returns 0 — no volatility to explain anything with.",
            "CV = variance(scaled) ÷ mean(scaled); a non-positive mean returns 0.",
            "Band: CV ≤ 0.05 → 0 · CV < 0.1 → 0.5 · CV ≥ 0.1 → 1.",
        ],
        params=[
            ["band 0", "CV ≤ 0.05", "Effectively flat — cannot explain KPI movement"],
            ["band 0.5", "0.05 < CV < 0.1", "Low volatility"],
            ["band 1", "CV ≥ 0.1", "Adequate volatility"],
        ],
    ), _run_cv, "mmm_engine.scoring.rules", "reference_cv"),

    _entry(ToolDetail(
        id="stat.pearson", name="Pearson Correlation", category="statistical",
        description="Signed Pearson r between each indicator and the KPI (Y) on the shared "
                    "month index — the direction and strength of its relationship to sales.",
        inputSummary="Each indicator's monthly series + the aligned monthly KPI series",
        outputSummary="Signed r per indicator → the 0 / 0.5 / 1 correlation band",
        wraps="agents.stat_scoring.pearson", usedBy=["2.4"],
        scenario=(
            "Runs inside step 2.4 next to CV and VIF, over a PANEL: one row per (model object, "
            "month), so each indicator is correlated against the sales of the channel x product "
            "cell it could actually have driven, across every cell at once. It used to run on "
            "one national series per indicator — the same question asked of 34 points instead "
            "of 34 x the number of models. The SIGN is kept, not just the magnitude — a "
            "negative correlation on a media driver is exactly the kind of thing 2.4d must "
            "see. It is also reused downstream: the 2.5 proposal reports an X with |r| below "
            "0.1 as weakly correlated, though it still enters the fit."),
        method=(
            "Standard Pearson r over the months where BOTH series are present. Fewer than 3 "
            "overlapping points, or a zero-variance side, returns 0.0 rather than a spurious "
            "correlation. Runs on year-over-year differenced series, not raw levels — on raw "
            "levels every indicator correlates with the KPI, because they all ride the same "
            "seasonal trend. The difference is taken WITHIN each model object, never down the "
            "stacked panel, so it is never a difference between two different models."),
        logic=[
            "Align indicator and KPI on the shared month index; mask out months where either "
            "side is missing.",
            "Fewer than 3 usable months → 0.0. Zero standard deviation on either side → 0.0.",
            "r = corrcoef(x, y); NaN → 0.0.",
            "Band on |r|: < 0.1 → 0 · < 0.3 → 0.5 · ≥ 0.3 → 1.",
        ],
        params=[
            ["band 0", "|r| < 0.1", "No usable relationship with the KPI"],
            ["band 0.5", "0.1 ≤ |r| < 0.3", "Weak relationship"],
            ["band 1", "|r| ≥ 0.3", "Moderate or strong relationship"],
            ["MIN_ABS_PEARSON", "0.1", "Below this 2.5 flags the X as weakly correlated"],
        ],
    ), _run_pearson, "mmm_engine.scoring.statistical", "pearson"),

    _entry(ToolDetail(
        id="stat.vif", name="VIF (Collinearity)", category="statistical",
        description="Variance inflation factor per indicator, computed once across the whole "
                    "candidate set — collinear indicators destabilise the regression.",
        inputSummary="The (months × indicators) matrix of all candidates still in play, "
                    "year-over-year detrended",
        outputSummary="VIF per indicator → the 0 / 0.5 / 1 collinearity band",
        wraps="agents.data_rules.vif_all", usedBy=["2.4"],
        scenario=(
            "Runs inside step 2.4 ONCE across the whole candidate set — this is why rejected "
            "indicators must be filtered out before the call: a dead indicator's collinearity "
            "would inflate the VIF of the ones still in play. Note the band direction: VIF = 1 "
            "(no collinearity) is the GOOD end and scores 1, while VIF ≥ 5 scores 0 — and "
            "because the 2.4 Total is the product of the three bands, that zero drops the "
            "indicator no matter how well it scored on CV and Pearson."),
        method=(
            "Two regimes, both returning one VIF per column. Identified (n > p+1): the exact "
            "VIF_i = [inv(R)]_ii from the column correlation matrix R, equivalent to 1/(1−R²) "
            "of regressing column i on the rest. Under-determined (p ≥ n), the normal regime "
            "when screening every FactorTree indicator: the pairwise-max proxy "
            "VIF_i = 1/(1 − max_{j≠i} r_ij²) — defined for any p and readable as 'how well the "
            "single most collinear peer explains this indicator'. Like Pearson, runs on "
            "year-over-year differenced series, not raw levels."),
        logic=[
            "Fewer than 2 columns → all VIFs are 1.0 (nothing to be collinear with).",
            "Build the column correlation matrix; constant columns are treated as uncorrelated.",
            "n > p + 1 → exact VIF from the inverted correlation matrix (pseudo-inverse on a "
            "singular matrix).",
            "p ≥ n → pairwise-max proxy on the squared correlations.",
            "Floor at 1.0, cap at VIF_MAX. Band: VIF ≥ 5 → 0 · 1 < VIF < 5 → 0.5 · VIF ≤ 1 → 1.",
        ],
        params=[
            ["VIF_MAX", "1000.0", "Display/scoring cap"],
            ["band 0", "VIF ≥ 5", "Clear collinearity — zeroes the 2.4 Total"],
            ["band 0.5", "1 < VIF < 5", "Mild collinearity, generally acceptable"],
            ["band 1", "VIF ≤ 1", "No linear relationship with the other indicators"],
        ],
    ), _run_vif, "mmm_engine.scoring.rules", "vif_all"),

    _entry(ToolDetail(
        id="model.ols", name="OLS MMM Fit", category="model",
        description="Fits the marketing-mix regression for one model object: adstock + Hill "
                    "saturation on the drivers, then OLS against the chosen response.",
        inputSummary="Long table + model object, Y metric, selected X, transform/control params",
        outputSummary="R², adj. R², MAPE, Durbin-Watson, baseline %, per-driver contribution/ROI",
        wraps="mmm.engine.run_mmm", usedBy=["2.5"],
        scenario=(
            "Called once PER MODEL OBJECT — one (channel x product) cell each, so a project "
            "with N channels and M products records N x M invocations in a 2.5 run. Each fit "
            "takes that object's whole surviving driver universe at once: there is no per-L4 "
            "indicator search (寻优) any more, so a coefficient here is what that variable did "
            "alongside all the others rather than the best result some combination produced. "
            "The Y comes from the 2.1 Metrics Type; params scale to the series length. The "
            "selection drives 2.6 master data and S4 training, so what this tool fits is "
            "exactly what the model is trained on — never a separately re-derived set."),
        method=(
            "Each driver is transformed with geometric adstock (carry-over) then a Hill "
            "saturation curve (diminishing returns), optionally joined by trend and seasonality "
            "controls, and regressed on the response with ordinary least squares. Every number "
            "on the 2.5 tree — coefficient, t, p, contribution, ROI — comes from this fit; the "
            "narrative agents are explicitly told the computed results are authoritative."),
        logic=[
            "Build the model frame for the object: pivot the long table to a month × driver "
            "wide table, pick the response, and cap the drivers at MAX_DRIVERS (most "
            "Y-correlated) so the regression stays identified with p < n.",
            "Apply adstock, then Hill saturation, to each driver.",
            "Add the requested controls (trend, seasonality) as columns.",
            "Fit OLS; derive t and p per coefficient, decomposed contribution, and ROI where "
            "the response is revenue-like.",
            "Red-flag the result on low df, wrong-sign coefficients or an implausible baseline.",
            "|t| ≥ 2.0 marks a coefficient significant (≈5% two-sided at moderate dof).",
        ],
        params=[
            ["adstock", "0.5", "Default geometric carry-over rate"],
            ["hill_half", "1.0", "Default Hill half-saturation point"],
            ["MAX_DRIVERS", "12", "Cap on drivers per fit, keeping the OLS identified"],
            ["SIGNIFICANT_T", "2.0", "|t| at or above this is reported as significant"],
        ],
    ), _run_ols, "mmm_engine.mmm.engine", "run_mmm"),
]

TOOLS: dict[str, Tool] = {
    e.detail.id: Tool(detail=e.detail, run=e.run, module=e.module, symbol=e.symbol)
    for e in _ENTRIES
}


def list_specs() -> list[ToolSpec]:
    """The light catalog, in registration order."""
    return [t.spec for t in TOOLS.values()]


def get(tool_id: str) -> Tool:
    tool = TOOLS.get(tool_id)
    if tool is None:
        raise KeyError(f"unknown tool {tool_id}")
    return tool


def detail(tool_id: str) -> ToolDetail:
    """The full page for one tool, with the implementation's real source attached."""
    tool = get(tool_id)
    out = tool.detail.model_copy(deep=True)
    out.source = _read_source(tool.module, tool.symbol)
    return out


def _read_source(module: str, symbol: str) -> ToolSource:
    """Read the live implementation off disk — documentation that cannot drift."""
    src = ToolSource(module=module, path=module.replace(".", "/") + ".py", symbol=symbol)
    try:
        fn = getattr(importlib.import_module(module), symbol)
        code, line = inspect.getsourcelines(fn)
        file = Path(inspect.getsourcefile(fn) or "").resolve()
        src.code = "".join(code)
        src.line = line
        try:
            src.path = str(file.relative_to(_PKG_ROOT))
        except ValueError:
            src.path = str(file)
    except Exception as e:  # noqa: BLE001 — a missing symbol must not 500 the page
        src.code = f"# source unavailable: {e}"
    return src
