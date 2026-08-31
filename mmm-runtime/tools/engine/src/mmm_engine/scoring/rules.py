"""Data-agent scoring rules, sourced from the knowledge base.

The authoritative rubric lives in ``Assets/数据智能体知识库/机器可读/*.json``
(validation-scoring · statistical-scoring · factor-ranges). This module:

* loads the JSON so the *displayed* rule sheets come straight from the KB, and
* encodes the numeric bands as typed Python so scoring is deterministic and
  testable. The constants mirror the JSON exactly (cited per band); if you
  change a threshold, change it in both places.

2.11 data validation — four dimensions, each 0 / 0.5 / 1:
    consistency (continuity) · accuracy · completeness · granularity
2.33 statistical screening — three tests, each 0 / 0.5 / 1:
    CV (volatility) · Pearson (vs KPI) · VIF (collinearity); Total = product.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from mmm_engine import knowledge

#: Where the machine-readable rubrics live: the repo's `knowledge/methodology/`.
#: Resolved through :mod:`mmm_engine.knowledge` rather than an env setting,
#: because the engine owns no configuration — see that module for the search
#: order and for how a workspace overrides it.
KB_DIR = knowledge.methodology_dir()

# Data-quality verdicts live in `scoring.quality.verdict_for` and nowhere else.
# There were three scorers here once — an additive one with a [0,4] total, a
# min-of-four one, and the product rollup — and the additive constants were still
# being compared against a product Total in the CLI. The Excel 2.12 sheet, the
# platform code and this engine all multiply; the additive pair was a transcription
# error that outlived its author.

# Statistical verdict thresholds — Total = CV x Pearson x VIF in [0, 1].
#
# The acceptance table reads "0.5–1 验收通过 / ≤0.5 人工介入 / =0 完全不能用", with 0.5
# sitting in both of the first two rows; the client ruled that 0.5 accepts — the same
# ruling that settled the identical ambiguity in the data-quality table. Under a
# product of three {0, 0.5, 1} bands the reachable totals are 1 · 0.5 · 0.25 · 0.125 · 0,
# so accepting at >= 0.5 means: all three clean, or exactly one test at half marks.
#
# This moved on 2026-08-11. It used to be `total > STAT_GOOD`, which put Total == 0.5
# — a strong indicator with one middling test — in front of a human. It now passes.
STAT_ACCEPT = 0.5
STAT_GOOD = STAT_ACCEPT  # legacy name, same number


@lru_cache(maxsize=8)
def load_rule(name: str) -> dict[str, Any]:
    """Load a knowledge-base rule JSON (cached). Returns {} if unavailable."""
    path = KB_DIR / f"{name}.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


# ── 2.11 validation ─────────────────────────────────────────────────────────


def validation_rule_rows() -> list[list[str]]:
    """Flatten validation-scoring.json into ['维度', '子项', '0', '0.5', '1'] rows."""
    data = load_rule("validation-scoring")
    rows: list[list[str]] = []
    for dim in (data.get("dimensions") or {}).values():
        label = str(dim.get("label", ""))
        for sub, bands in (dim.get("subchecks") or {}).items():
            rows.append([
                label, str(sub),
                str(bands.get("0", ""))[:60],
                str(bands.get("0.5", ""))[:60],
                str(bands.get("1", ""))[:60],
            ])
    return rows


# ── 2.33 statistical screening ──────────────────────────────────────────────


@dataclass(frozen=True)
class StatScore:
    cv_score: float
    pearson_score: float
    vif_score: float
    total: float
    verdict: str       # "Good" | "Acceptable" | "unconsiderable"
    drop: bool


def _cv_band(cv: float) -> float:
    """2.33 volatility band. A near-flat series cannot explain KPI movement."""
    if cv <= 0.05:
        return 0.0
    if cv < 0.1:
        return 0.5
    return 1.0


def _pearson_band(r: float) -> float:
    """2.33 correlation band on |r| against the KPI."""
    a = abs(r)
    if a < 0.1:
        return 0.0
    if a < 0.3:
        return 0.5
    return 1.0


def _vif_band(vif: float) -> float:
    """2.33 collinearity band. Note the direction: VIF = 1 (no collinearity) is
    the GOOD end and scores 1; VIF >= 5 is 明显共线性 and scores 0.

    The workbook writes the top band as "VIF = 1"; since ``vif_all`` floors its
    output at 1.0, this is implemented as ``vif <= 1.0`` — the same set of
    values, without a float-equality trap.
    """
    if vif >= 5.0:
        return 0.0
    if vif > 1.0:
        return 0.5
    return 1.0


def reference_cv(x: "np.ndarray") -> float:
    """CV per the 2.33 rule: min-max scale the series to [0, 1], then variance/mean.

    This is the workbook's explicit definition ("波动系数CV = 方差/均值，数据先缩放到0-1"),
    not the textbook CV=std/mean. Returns 0.0 for empty/constant/degenerate series.
    """
    import numpy as np

    v = x[~np.isnan(x)].astype(float) if x.size else x
    if v.size == 0:
        return 0.0
    lo, hi = float(np.min(v)), float(np.max(v))
    if hi <= lo:  # constant series → no volatility
        return 0.0
    scaled = (v - lo) / (hi - lo)
    mean = float(np.mean(scaled))
    if mean <= 0:
        return 0.0
    return float(np.var(scaled) / mean)


VIF_MAX = 1000.0  # display/scoring cap — a VIF this high is already "severe"


def vif_all(matrix: "np.ndarray") -> "np.ndarray":
    """Per-column VIF for a (n_obs × n_cols) matrix, at column (indicator) granularity.

    Two regimes, both returning one VIF per column (never a grouped/shared score):

    * **Identified (n > p + 1):** the exact VIF_i = [inv(R)]_ii, where R is the
      column correlation matrix — equivalent to 1/(1-R²) from regressing column i
      on all the others. This is the case for real per-object modeling frames.
    * **Under-determined (p ≥ n):** a full multivariate VIF is unidentifiable
      (more indicators than observations), so we fall back to the pairwise-max
      collinearity proxy VIF_i = 1/(1 - max_{j≠i} r_ij²) — still one value per
      indicator, defined for any p, and interpretable as "how well the single most
      collinear peer explains this indicator". This is the normal regime when
      screening every FactorTree indicator before modeling.

    Values are floored at 1.0 and capped at ``VIF_MAX``.

    Gaps are handled **pairwise-complete**: each pair of columns is correlated on
    the months both actually cover. ``np.corrcoef`` propagates a single NaN across
    the whole matrix, which — once the NaNs were zeroed — read as "nothing is
    collinear with anything" and handed every indicator a perfect VIF of 1.0.
    """
    import numpy as np
    import pandas as pd

    n, p = matrix.shape
    if p < 2:
        return np.ones(p)
    corr = pd.DataFrame(matrix).corr(min_periods=3).to_numpy(dtype=float)
    corr = np.nan_to_num(corr, nan=0.0)  # constant / non-overlapping → uncorrelated
    np.fill_diagonal(corr, 1.0)

    if n > p + 1:
        try:
            inv = np.linalg.inv(corr + 1e-8 * np.eye(p))
            diag = np.diag(inv)
        except np.linalg.LinAlgError:
            diag = np.diag(np.linalg.pinv(corr))
    else:
        # pairwise-max proxy: strongest |correlation| to any other column.
        c2 = np.clip(corr ** 2, 0.0, 0.999999)
        np.fill_diagonal(c2, 0.0)
        r2_max = c2.max(axis=1)
        diag = 1.0 / (1.0 - r2_max)
    return np.clip(diag, 1.0, VIF_MAX).astype(float)


def score_statistical(cv: float, pearson: float, vif: float) -> StatScore:
    """Score one variable on CV / Pearson / VIF per the 2.33 bands.

    Total is the **product** of the three bands, matching the workbook's
    ``Final score = 完整性*颗粒度*真实性*一致性`` form applied to the three
    statistical tests. A single failing test therefore zeroes the total, and a
    zero total is the drop condition — no separate severe-collinearity override
    is needed, because VIF >= 5 already scores 0 on its own.
    """
    return compose_statistical(_cv_band(cv), _pearson_band(pearson), _vif_band(vif))


def compose_statistical(cv_score: float, pearson_score: float,
                        vif_score: float) -> StatScore:
    """The three band scores → Total → verdict. The only implementation.

    Split out from `score_statistical` so the rollup can compose bands that were
    computed by three separate tool runs and land on the identical result — the
    composition lives in one place either way.
    """
    total = round(cv_score * pearson_score * vif_score, 4)
    if total >= STAT_ACCEPT:
        verdict = "Good"
    elif total > 0.0:
        verdict = "Acceptable"
    else:
        verdict = "unconsiderable"
    return StatScore(cv_score, pearson_score, vif_score, total, verdict,
                     drop=total == 0.0)


def statistical_rule_rows() -> list[list[str]]:
    """Flatten statistical-scoring.json into ['检验', '分', '条件', '含义'] rows."""
    data = load_rule("statistical-scoring")
    rows: list[list[str]] = []
    for test in (data.get("tests") or {}).values():
        label = str(test.get("label", ""))
        for band in test.get("bands") or []:
            rows.append([
                label, str(band.get("score", "")),
                str(band.get("cond", "")), str(band.get("meaning", ""))[:50],
            ])
    return rows


# ── 2.34 metric selection — factor ROI / Contribution ranges ────────────────


@dataclass(frozen=True)
class FactorRange:
    """Expected ranges for one L4 factor (from factor-ranges.json)."""
    l4: str
    contribution: tuple[float, float] | None  # yearly contribution %, (lo, hi)
    roi: tuple[float, float] | None           # ROI range, (lo, hi)


def _parse_range(raw: object) -> tuple[float, float] | None:
    """Parse '0%~1.5%' / '-5%~5%' / '0.8~1.3' → (lo, hi); '/' or None → None."""
    if raw is None:
        return None
    txt = str(raw).replace("%", "").replace("％", "").strip()
    if "~" not in txt:
        return None
    lo, _, hi = txt.partition("~")
    try:
        return (float(lo), float(hi))
    except ValueError:
        return None


@lru_cache(maxsize=1)
def factor_ranges() -> dict[str, FactorRange]:
    """Map L4 factor name → its expected contribution / ROI ranges."""
    out: dict[str, FactorRange] = {}
    for f in load_rule("factor-ranges").get("factors") or []:
        l4 = str(f.get("L4", "")).strip()
        if not l4:
            continue
        out[l4] = FactorRange(l4, _parse_range(f.get("contributionYearly")),
                              _parse_range(f.get("roiRange")))
    return out


# The reference range library is one client's case, by its own declaration: the
# workbook's `purpose` field reads "区间为Danone Mizone案例示例，新项目须替换"
# (ranges are Danone Mizone case examples; new projects must replace them). It is a
# usable prior for the industry it came from and misinformation for any other, so
# `RangeIndex` applies it only to that industry — see `REFERENCE_INDUSTRY`.
REFERENCE_INDUSTRY = ("food-bev", "beverage")


def match_factor_range(l4_name: str) -> FactorRange | None:
    """Find the expected ranges for an L4 factor — exact name match only.

    Substring matching used to stand in for a real lookup and manufactured
    benchmarks that were never in the library: `Connected TV` matched `TV`,
    `OOH Billboards` matched `OOH`, `Digital Display Ads` matched `Digital Display`,
    `价格变动率` matched `价格变动`. Each of those produced an ROI band a factor was
    then judged against, flagged for, and could be dropped at the d-2.5 gate over —
    all from a name that merely contained another name. A benchmark has to be a
    benchmark for *this* factor or it is worse than none.
    """
    if not l4_name:
        return None
    ranges = factor_ranges()
    if l4_name in ranges:
        return ranges[l4_name]
    norm = l4_name.strip().lower()
    for key, val in ranges.items():
        if key.strip().lower() == norm:
            return val
    return None


def in_range(value: float, rng: tuple[float, float] | None) -> bool:
    return rng is not None and rng[0] <= value <= rng[1]


# ── Knowledge-first ROI / Contribution range resolver ───────────────────────
#
# The authoritative ranges are meant to be maintained in the Knowledge module as
# the industry ``factor_tree`` template (per-indicator L1–L4 + roiRange +
# contributionRange). This resolver prefers those, keyed at (L4, indicator)
# granularity, and falls back to the reference ``factor-ranges.json`` library.


def _norm(s: object) -> str:
    return str(s).strip().lower() if s is not None else ""


@dataclass(frozen=True)
class RangeBenchmark:
    """Expected ROI / Contribution bands for one indicator, with provenance."""
    roi: tuple[float, float] | None
    contribution: tuple[float, float] | None
    roi_text: str            # original display string, e.g. "0.8~1.3" or "/"
    contribution_text: str   # e.g. "0%~1.5%"
    source: str              # "knowledge" | "reference"


class RangeIndex:
    """(L4, indicator)-keyed benchmark lookup.

    Precedence: exact (L4, indicator) knowledge pair → L4-only knowledge (exact
    then normalised substring) → reference ``factor-ranges.json`` via
    :func:`match_factor_range`. Returns ``None`` when nothing matches.
    """

    def __init__(
        self,
        pair_index: dict[tuple[str, str], RangeBenchmark],
        l4_index: dict[str, RangeBenchmark],
        allow_reference: bool = False,
    ) -> None:
        self._pairs = pair_index
        self._l4 = l4_index
        self._allow_reference = allow_reference

    def match(self, l4: str, indicator: str) -> RangeBenchmark | None:
        l4n, indn = _norm(l4), _norm(indicator)
        # 1) exact (L4, indicator) knowledge pair.
        hit = self._pairs.get((l4n, indn))
        if hit is not None:
            return hit
        # 2) L4-only knowledge — exact then normalised substring.
        if l4n and l4n in self._l4:
            return self._l4[l4n]
        for key, val in self._l4.items():
            if key and (key in l4n or l4n in key):
                return val
        # 3) reference fallback — only for the industry the reference case IS.
        #    Judging a pharma or auto factor against a beverage ROI band and then
        #    offering to drop it at the d-2.5 gate is not a lenient default, it is a
        #    wrong answer delivered with the same confidence as a right one.
        if not self._allow_reference:
            return None
        ref = match_factor_range(l4)
        if ref is not None:
            return RangeBenchmark(
                roi=ref.roi,
                contribution=ref.contribution,
                roi_text=_fmt_range(ref.roi, is_pct=False),
                contribution_text=_fmt_range(ref.contribution, is_pct=True),
                source="reference",
            )
        return None


def _fmt_range(rng: tuple[float, float] | None, *, is_pct: bool) -> str:
    """Reconstruct a display string for a parsed reference range (best effort)."""
    if rng is None:
        return "/"
    if is_pct:
        return f"{rng[0]:g}%~{rng[1]:g}%"
    return f"{rng[0]:g}~{rng[1]:g}"


def build_range_index(industry_l1: str | None, industry_l2: str | None) -> RangeIndex:
    """Build a :class:`RangeIndex` from the industry Knowledge factor-tree template.

    Reads the ``factor_tree`` template for the project industry (l2 beats l1),
    indexing every row that carries a parseable ROI or Contribution band.

    The reference library is a per-lookup fallback in :meth:`RangeIndex.match`, but
    **only when the project's industry is the one the reference case belongs to**
    (:data:`REFERENCE_INDUSTRY`). Everyone else gets no benchmark rather than a
    beverage benchmark — 2.5 renders those rows as ``noBenchmark``, which is the
    honest state, and the way to give a project real bands is to maintain them in
    the industry Knowledge pack.
    """
    allow_ref = _norm(industry_l1) == REFERENCE_INDUSTRY[0] and (
        not industry_l2 or _norm(industry_l2) == REFERENCE_INDUSTRY[1])
    pair_index: dict[tuple[str, str], RangeBenchmark] = {}
    l4_index: dict[str, RangeBenchmark] = {}
    # Lazy import to avoid an import cycle (templates → domain.models → agents).
    try:
        from mmm_engine.knowledge import get_templates
    except Exception:
        return RangeIndex(pair_index, l4_index, allow_ref)

    tpl = None
    if industry_l1:
        try:
            tpl = get_templates().best_match("factor_tree", industry_l1, industry_l2)
        except Exception:
            tpl = None
    if tpl is None:
        return RangeIndex(pair_index, l4_index, allow_ref)

    for row in tpl.factor_rows:
        roi_txt = str(getattr(row, "roi_range", "") or "")
        con_txt = str(getattr(row, "contribution_range", "") or "")
        roi = _parse_range(roi_txt)
        con = _parse_range(con_txt)
        if roi is None and con is None:
            continue
        bench = RangeBenchmark(
            roi=roi, contribution=con,
            roi_text=roi_txt or "/", contribution_text=con_txt or "/",
            source="knowledge",
        )
        l4n, indn = _norm(row.l4), _norm(row.indicator)
        if l4n and indn:
            pair_index.setdefault((l4n, indn), bench)
        if l4n:
            l4_index.setdefault(l4n, bench)  # first-wins
    return RangeIndex(pair_index, l4_index, allow_ref)
