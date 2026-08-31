"""Across every adopted run, what each factor did — and whether it belongs.

The synthesis rule that shapes this whole module: **only dimensionless evidence
is aggregated across runs.** A factor contributing 8% in a national model, 15% in
EC and 2% in TT does not have an average — those three numbers answer three
different questions, and a mean of them answers none. So contribution and ROI are
reported as observations, grouped by run and object, never pooled; what does pool
is the shape of the evidence: how often the factor was in a model at all, how
often its sign agreed with itself, how often it was significant, and the worst
band verdict it drew anywhere.

The second rule is the split between **advice and verdict**. `recommendation` has
five states because the honest answer is often "it holds in these two channels and
not the third", and flattening that into accept/reject throws away the only useful
part. `disposition` stays binary because it is the last gate before the master
table, and a middle state there is a variable travelling into the model with
nobody having said yes. Advice is rich; the ruling is yes or no.
"""
from __future__ import annotations

# Five states of advice. `conditional` and `watch` are the two the old binary
# sheet could not say, and both were being silently rounded to "accept".
INCLUDE = "include"
CONDITIONAL = "conditional"
WATCH = "watch"
EXCLUDE = "exclude"
INSUFFICIENT = "insufficient"

#: A factor is steady enough to recommend outright when its sign agrees with
#: itself this often and it clears significance this often. Both are shares of the
#: (run × object) cells it actually entered, so a factor present in one cell is
#: judged on that cell rather than punished for the ones it never saw.
STEADY_SIGN = 0.8
STEADY_SIGNIFICANCE = 0.5

_SEVERITY_RANK = {"": 0, "none": 0, "green": 1, "yellow": 2, "red": 3}


def _norm(v) -> str:
    return str(v or "").strip().lower()


def _key(row: dict) -> tuple[str, str]:
    return (_norm(row.get("l4")), _norm(row.get("indicator") or row.get("metric")))


def observations(runs: list[dict]) -> dict[tuple[str, str], list[dict]]:
    """Every (run × object) cell each factor appeared in, keyed by (l4, indicator).

    A cell is one fitted coefficient — the atom everything below counts.
    """
    out: dict[tuple[str, str], list[dict]] = {}
    for run in runs:
        run_id = str(run.get("runId", ""))
        for model in (run.get("models") or []):
            if model.get("error"):
                continue
            obj = str(model.get("object", ""))
            for driver in (model.get("drivers") or []):
                out.setdefault(_key(driver), []).append({
                    "runId": run_id,
                    "object": obj,
                    "l4": driver.get("l4", ""),
                    "indicator": driver.get("metric", ""),
                    "treeRowId": driver.get("treeRowId", ""),
                    "coef": driver.get("coef"),
                    "pValue": driver.get("pvalue", driver.get("pValue")),
                    "contribution": driver.get("contribution"),
                    "roi": driver.get("roi"),
                    "vif": driver.get("vif"),
                })
    return out


def _sign(value) -> str:
    if value is None:
        return ""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return ""
    return "+" if v > 0 else "-" if v < 0 else ""


def _significant(cell: dict) -> bool:
    """`|t| >= 2` expressed through the p-value the payload actually carries."""
    p = cell.get("pValue")
    try:
        return p is not None and float(p) <= 0.05
    except (TypeError, ValueError):
        return False


def synthesise(cells: list[dict], severity_by_cell: dict | None = None) -> dict:
    """The dimensionless summary of one factor across every cell it entered."""
    severity_by_cell = severity_by_cell or {}
    n = len(cells)
    signs = [s for s in (_sign(c.get("coef")) for c in cells) if s]
    dominant = max(set(signs), key=signs.count) if signs else ""
    sign_consistency = (signs.count(dominant) / len(signs)) if signs else 0.0
    significance = (sum(1 for c in cells if _significant(c)) / n) if n else 0.0

    worst, worst_name = 0, "none"
    for cell in cells:
        name = _norm(severity_by_cell.get((cell["runId"], cell["object"], _key(cell))))
        rank = _SEVERITY_RANK.get(name, 0)
        if rank > worst:
            worst, worst_name = rank, name or "none"

    return {
        "cells": n,
        "dominantSign": dominant,
        "signConsistency": round(sign_consistency, 4),
        "significanceRate": round(significance, 4),
        # Grouped, never pooled — see the module note.
        "contributionObserved": [
            {"runId": c["runId"], "object": c["object"], "value": c.get("contribution")}
            for c in cells],
        "roiObserved": [
            {"runId": c["runId"], "object": c["object"], "value": c.get("roi")}
            for c in cells],
        "rangeSeverity": worst_name,
    }


def recommend(summary: dict, *, ai_verdict: str = "", has_band: bool = False) -> tuple[str, str]:
    """Five-state advice for one factor → (recommendation, reason).

    `implausible` without a band deliberately does **not** reach `exclude`. On real
    projects every row came back `noBenchmark` — the knowledge pack had no entry —
    so that path was the only one that ever rejected anything, which made a
    language model the sole author of every variable removal in a step whose stated
    premise is that it does not choose variables. With no band there is no computed
    state for the reading to sit beside, so it becomes `watch`: visible, carried
    into the review, and ruled on by a person.
    """
    n = int(summary.get("cells") or 0)
    if not n:
        return INSUFFICIENT, "从来没有进过任何一次被采纳的运行——通常是自由度不够或共线"

    severity = _norm(summary.get("rangeSeverity"))
    verdict = _norm(ai_verdict)
    sign_ok = float(summary.get("signConsistency") or 0) >= STEADY_SIGN
    sig_ok = float(summary.get("significanceRate") or 0) >= STEADY_SIGNIFICANCE

    if severity == "red":
        return EXCLUDE, "越界且偏离 ≥ 30%，建议回流业务校验重审假设"
    if verdict == "implausible":
        if has_band:
            return EXCLUDE, "判读为不可信，且有可比区间佐证"
        return WATCH, ("判读为不可信，但没有可比区间——没有算出来的状态可以与它并列，"
                       "所以这一条要人逐条过目，不由判读单独否决")
    if not sign_ok:
        return CONDITIONAL, "系数符号在不同对象之间不一致，只在符号稳定的那些对象上成立"
    if severity == "yellow":
        return WATCH, "越界但偏离不足 30%，这是复核不是剔除"
    if not sig_ok:
        return WATCH, "符号稳定但多数对象上不显著，进模型并在报告里标注"
    return INCLUDE, "符号一致、多数对象显著，且没有越界"
