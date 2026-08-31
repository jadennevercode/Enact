#!/usr/bin/env python3
"""The data layer's contract checks — the six defects the contract cards named.

    .venv/bin/python tools/engine/tests/test_data_layer.py

Each test below exists because something shipped that looked like it worked:

* `suppliedBy` was always `[]` — the tool read an attribute name that does not
  exist, so every mapped row said "there is data" and never said which.
* candidates for a pending row were a model's opinion, with no score, no
  reproducibility and nothing to cite.
* the quality verdict had three implementations that disagreed, and the one
  filling the scorecard compared a product Total against additive constants.
* "every indicator under this factor is unusable" was documented in three places
  and implemented in none.
* the four dbt time/variance invariants were absent, so a constant series ran
  four layers before anything stopped it.
* reconciliation skipped the value comparison and still reported `ok: true`.

These are all assertions about behaviour, not about wording.
"""
from __future__ import annotations

import sys
from pathlib import Path

from pydantic import ValidationError

from mmm_engine.cli.tools.ledger import data_factor_map
from mmm_engine.dataeng import conformance, mapping_suggest as suggest, reconcile
from mmm_engine.domain.models import (
    FactorRow, FactorTree, IndicatorCoverage, ProjectState, QualityRow,
)
from mmm_engine.scoring import quality as q

FAILURES: list[str] = []
CHECKS = [0]


def expect(label: str, condition: bool, detail: str = "") -> None:
    CHECKS[0] += 1
    print("  %s %s%s" % ("ok  " if condition else "FAIL", label,
                         (" — " + detail) if detail and not condition else ""))
    if not condition:
        FAILURES.append(label)


# ── a context stub: enough for data.factor-map, and nothing more ─────

class _Ctx:
    def __init__(self, state: ProjectState) -> None:
        self.state = state
        self.task = "factor-map/map"

    def path(self, rel) -> Path:
        return Path("/nonexistent") / str(rel)

    def opt(self, _name):
        return None


def _state() -> ProjectState:
    """One supplied row, one pending row, and one published metric nobody claimed."""
    tree = FactorTree(rows=[
        FactorRow(id="f-0007", l1="消费者需求驱动", l2="品牌广告/内容种草",
                  l3="品牌传播", l4="Digital Display", indicator="曝光量",
                  status="accepted"),
        FactorRow(id="f-0052", l1="生意基本盘", l2="内部因素", l3="铺市",
                  l4="冰柜", indicator="投放台数", status="accepted"),
    ])
    coverages = [
        IndicatorCoverage(id="ind-media-spend-3f2a9c1b07", treeRowId="f-0007",
                          assetId="media-spend", assetName="Media 花费明细",
                          metric="曝光量", metricType="X",
                          l1="消费者需求驱动", l2="品牌广告/内容种草",
                          l3="品牌传播", l4="Digital Display",
                          coverageStart="202210", coverageEnd="202510",
                          rows=37, boundBy="auto"),
        # Same family, a different L4 and a different wording — so nothing binds
        # it automatically and it stays the orphan a human has to rule on.
        IndicatorCoverage(id="ind-trade-cooler-8b41d0e5a2", treeRowId="",
                          assetId="trade-cooler", assetName="ANP 冰柜",
                          metric="冰柜台数", metricType="X",
                          l1="生意基本盘", l2="内部因素", l3="铺市", l4="冰柜设备",
                          unit="Unit", coverageStart="202301", coverageEnd="202510",
                          rows=34),
    ]
    return ProjectState(factor_tree=tree, indicator_coverage=coverages)


# ── 1 · suppliedBy is the column this deliverable exists for ─────────

def test_supplied_by_is_not_empty() -> None:
    result = data_factor_map(_Ctx(_state()))
    rows = {r["id"]: r for r in result.payload["rows"]}
    supplied = rows["f-0007"]["suppliedBy"]
    expect("a mapped row names what supplies it", len(supplied) == 1,
           "suppliedBy=%r" % supplied)
    if not supplied:
        return
    entry = supplied[0]
    expect("the supply record carries the coverage id",
           entry["coverageId"] == "ind-media-spend-3f2a9c1b07", repr(entry))
    expect("the supply record carries the asset and metric",
           entry["assetName"] == "Media 花费明细" and entry["metric"] == "曝光量",
           repr(entry))
    expect("the supply record carries the coverage window",
           entry["coverageStart"] == "202210" and entry["coverageEnd"] == "202510",
           repr(entry))
    expect("an unsupplied row reports no supply",
           rows["f-0052"]["suppliedBy"] == [])


def test_summary_and_orphans_are_reported() -> None:
    result = data_factor_map(_Ctx(_state()))
    summary = result.payload["summary"]
    expect("the summary counts every state",
           (summary["total"], summary["mapped"], summary["pending"]) == (2, 1, 1),
           repr(summary))
    expect("an unclaimed published metric is listed as an orphan",
           [o["metric"] for o in result.payload["orphans"]] == ["冰柜台数"],
           repr(result.payload["orphans"]))
    expect("orphans are counted, not decided", summary["orphans"] == 1)


# ── 2 · candidates are scored, not guessed ───────────────────────────

def test_pending_rows_carry_scored_candidates() -> None:
    result = data_factor_map(_Ctx(_state()))
    rows = {r["id"]: r for r in result.payload["rows"]}
    candidates = rows["f-0052"].get("candidates") or []
    expect("a pending row is offered the orphan that matches it",
           len(candidates) == 1 and candidates[0]["metric"] == "冰柜台数",
           repr(candidates))
    if not candidates:
        return
    best = candidates[0]
    expect("the candidate carries a number, not an opinion",
           isinstance(best["score"], float) and best["score"] >= suggest.MIN_SCORE,
           repr(best))
    expect("the score breaks down into its four parts",
           set(best["parts"]) == {"name", "path", "unit", "covered"}, repr(best))
    expect("a mapped row is offered nothing", "candidates" not in rows["f-0007"])


def test_candidate_score_is_the_platform_formula() -> None:
    row = {"l1": "生意基本盘", "l2": "内部因素", "l3": "铺市", "l4": "冰柜",
           "indicator": "投放台数"}
    same = {"l1": "生意基本盘", "l2": "内部因素", "l3": "铺市", "l4": "冰柜",
            "metric": "投放台数", "unit": "Unit",
            "coverageStart": "202301", "coverageEnd": "202510"}
    score, parts = suggest.score_candidate(row, same)
    expect("an identical path and name score the name and path parts full",
           parts["name"] == 1.0 and parts["path"] == 1.0, repr(parts))
    expect("the weights are 0.45/0.35/0.12/0.08",
           abs(score - (0.45 * parts["name"] + 0.35 * parts["path"]
                        + 0.12 * parts["unit"] + 0.08 * parts["covered"])) < 1e-9,
           "score=%r parts=%r" % (score, parts))

    unrelated = {"l1": "促销优惠", "l2": "价格", "l3": "折扣", "l4": "O2O 补贴",
                 "metric": "外卖补贴金额", "unit": "RMB"}
    low, parts = suggest.score_candidate(row, unrelated)
    expect("nothing in common scores zero on the path", parts["path"] == 0.0)
    expect("an unrelated metric falls below the display threshold",
           low < suggest.MIN_SCORE, "score=%r" % low)

    expect("CJK 2-grams relate 冰柜台数 to 冰柜", suggest.name_score("冰柜台数", "冰柜") > 0)
    expect("the unit vocabulary separates money from counts",
           suggest.unit_score("RMB", "花费") == 1.0
           and suggest.unit_score("RMB", "门店数") == 0.0)


def test_candidates_are_capped_and_ordered() -> None:
    row = {"l1": "A", "l2": "B", "l3": "C", "l4": "冰柜", "indicator": "冰柜台数"}
    pool = [{"id": "c-%02d" % i, "l1": "A", "l2": "B", "l3": "C", "l4": "冰柜",
             "metric": "冰柜台数 %d" % i, "coverageStart": "202301",
             "coverageEnd": "202510"} for i in range(9)]
    picked = suggest.suggest(row, pool)
    expect("at most five candidates are shown", len(picked) == suggest.MAX_CANDIDATES,
           "got %d" % len(picked))
    expect("they are ordered best first",
           picked == sorted(picked, key=lambda c: (-c.score, c.coverage_id)))
    expect("the same inputs give the same list",
           [c.coverage_id for c in suggest.suggest(row, pool)]
           == [c.coverage_id for c in picked])
    expect("the wording bands follow the score",
           (suggest.phrasing(0.7), suggest.phrasing(0.5), suggest.phrasing(0.31))
           == ("很可能匹配", "可能匹配", "弱匹配"))


# ── 3 · one verdict, not three ───────────────────────────────────────

def test_quality_verdict_has_one_implementation() -> None:
    # The acceptance table reads "0.5–1 验收通过 / ≤0.5 需人工介入" — 0.5 sits in both
    # rows, and the client ruled it accepts. Under a product of four {0, 0.5, 1}
    # dimensions that makes exactly two Totals acceptable: all clean, or one
    # dimension at 0.5.
    expect("Total == 1 accepts", q.verdict_for(1.0) == "accept")
    expect("Total == 0.5 accepts too — the 0.5 boundary was ruled, not guessed",
           q.verdict_for(0.5) == "accept")
    expect("Total == 0.25 is the human's, not a silent drop",
           q.verdict_for(0.25) == "borderline")
    expect("Total == 0 is unusable", q.verdict_for(0.0) == "unusable")

    subs = [q.SubScore("consistency.time", "consistency", "", 0.5, "", True, True),
            q.SubScore("accuracy.numeric", "accuracy", "", 1.0, "", True, True),
            q.SubScore("completeness.data", "completeness", "", 1.0, "", True, True),
            q.SubScore("granularity.time", "granularity", "", 1.0, "", True, True)]
    rolled = q.roll_up_quality(subs)
    expect("the rollup uses that one implementation",
           rolled.total == 0.5 and rolled.verdict == "accept",
           "total=%r verdict=%r" % (rolled.total, rolled.verdict))

    two_dirty = subs + [q.SubScore("consistency.caliber", "consistency", "",
                                   0.5, "", True, True),
                        q.SubScore("granularity.model", "granularity", "",
                                   0.5, "", True, True)]
    expect("two dirty dimensions land at 0.25 and go to the human",
           q.roll_up_quality(two_dirty).verdict == "borderline")

    advisory = subs[:1] + [q.SubScore("granularity.drilldown", "granularity", "",
                                      0.0, "", True, False)]
    expect("an advisory subcheck cannot drag a dimension down",
           q.roll_up_quality(advisory).granularity == 1.0)

    import mmm_engine.scoring.rules as rules
    expect("the additive scorer is gone",
           not hasattr(rules, "score_validation") and not hasattr(rules, "final_verdict"))


# ── 5 · a factor with no usable indicator at all ─────────────────────

def test_all_zero_factor_escalates() -> None:
    rows = [
        {"l1": "生意基本盘", "l2": "内部因素", "l3": "铺市", "l4": "冰柜",
         "indicator": "投放台数", "total": 0.0},
        {"l1": "生意基本盘", "l2": "内部因素", "l3": "铺市", "l4": "冰柜",
         "indicator": "冰柜数量", "total": 0.0},
        {"l1": "消费者需求驱动", "l2": "品牌广告/内容种草", "l3": "品牌传播",
         "l4": "Digital Display", "indicator": "曝光量", "total": 0.0},
        {"l1": "消费者需求驱动", "l2": "品牌广告/内容种草", "l3": "品牌传播",
         "l4": "Digital Display", "indicator": "点击量", "total": 0.5},
    ]
    raised = q.escalations(rows)
    expect("a factor whose every indicator is 0 raises one escalation",
           len(raised) == 1 and raised[0]["l4"] == "冰柜", repr(raised))
    expect("a factor with one survivor does not",
           all(e["l4"] != "Digital Display" for e in raised))
    if raised:
        expect("the escalation names its indicators and its severity",
               raised[0]["indicators"] == ["投放台数", "冰柜数量"]
               and raised[0]["severity"] == "high", repr(raised[0]))
    expect("no zeroes, no escalation",
           q.escalations([dict(rows[3])]) == [])


# ── 7 · the four time/variance invariants ────────────────────────────

def _frame(months, values, *, l4="冰柜", metric="投放台数"):
    import pandas as pd
    return pd.DataFrame([{"l1": "A", "l2": "B", "l3": "C", "l4": l4,
                          "metric": metric, "month": m, "value": v}
                         for m, v in zip(months, values)])


def _by_key(invariants):
    return {i.key: i for i in invariants}


def test_time_and_variance_invariants() -> None:
    months = [202301 + i for i in range(12)] + [202401 + i for i in range(12)]
    healthy = _frame(months, [float(i + 1) for i in range(24)])
    ok = _by_key(conformance.check_invariants(healthy))
    expect("a healthy 24-month series passes all four",
           all(i.ok for i in ok.values()),
           "; ".join("%s:%s" % (k, v.detail) for k, v in ok.items()))

    short = _frame(months[:10], [float(i) for i in range(10)])
    expect("under 24 months fails the span invariant",
           not _by_key(conformance.check_invariants(short))["time_span_min_years"].ok)

    flat = _frame(months, [7.0] * 24)
    invariants = _by_key(conformance.check_invariants(flat))
    expect("a constant series fails has_variation",
           not invariants["has_variation"].ok)
    expect("the failure names the series it found",
           bool(invariants["has_variation"].failing))

    quarterly = _frame([202301, 202304, 202307, 202310,
                        202401, 202404, 202407, 202410],
                       [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0])
    expect("a quarterly series fails the granularity invariant",
           not _by_key(conformance.check_invariants(quarterly))
           ["time_granularity_allowed"].ok)

    lopsided = _frame([202301 + i for i in range(12)] + [202401, 202402],
                      [float(i) for i in range(14)])
    expect("a year with three months fails yoy_comparable",
           not _by_key(conformance.check_invariants(lopsided))["yoy_comparable"].ok)


# ── 8 · a check that can be skipped in silence is not a check ────────

def test_reconcile_will_not_pass_unchecked() -> None:
    import pandas as pd
    raw = pd.DataFrame({"金额": [10.0, 20.0, 30.0]})
    clean = pd.DataFrame({"value": [10.0, 20.0, 30.0], "month": [202301, 202302, 202303]})

    skipped = reconcile.check(raw, clean)
    expect("no value column named → not reported as reconciled", not skipped.ok)
    expect("and it says so in the report", skipped.value_checked is False)
    expect("the reason is in the notes", bool(skipped.notes))

    checked = reconcile.check(raw, clean, raw_value="金额")
    expect("a real comparison reconciles", checked.ok, "; ".join(checked.notes))
    expect("and records that it happened", checked.value_checked is True)
    expect("valueChecked reaches the payload",
           checked.as_dict()["valueChecked"] is True)

    lossy = reconcile.check(raw, pd.DataFrame(
        {"value": [10.0], "month": [202301]}), raw_value="金额")
    expect("a dropped two thirds of the value does not reconcile", not lossy.ok)


def test_reconcile_by_metric_isolates_mixed_units() -> None:
    """One wide table fanned into metrics of different units (箱/%/元) must reconcile
    each metric against its own rows — summing them into one total is meaningless
    (mixing units means a passing total proves nothing, and a failing one means
    nothing either), which is exactly the false 10.272% drift a single-column
    --raw-value produced on the sales-distribution asset before this fix."""
    import pandas as pd
    raw = pd.DataFrame({
        "销量": [100.0, 200.0, 300.0],
        "铺货率": [50.0, 60.0, 70.0],
        "标价": [12.5, 12.5, 13.0],
    })
    clean = pd.DataFrame({
        "metric": ["销量", "销量", "销量", "铺货率", "铺货率", "铺货率",
                   "标价", "标价", "标价"],
        "value": [100.0, 200.0, 300.0, 50.0, 60.0, 70.0, 12.5, 12.5, 13.0],
        "month": [202301, 202302, 202303] * 3,
    })

    report = reconcile.check(raw, clean,
                              raw_value="销量:销量,铺货率:铺货率,标价:标价")
    expect("per-metric reconcile passes when every metric actually matches", report.ok,
          "; ".join(report.notes))
    expect("value_checked is set", report.value_checked is True)
    expect("byMetric has one entry per pair", len(report.by_metric) == 3)
    expect("each entry reports its own drift",
          all(e["driftPct"] == 0.0 for e in report.by_metric))
    expect("byMetric reaches the payload", "byMetric" in report.as_dict())

    dropped_clean = clean[~((clean["metric"] == "标价") & (clean["month"] == 202303))]
    lossy = reconcile.check(raw, dropped_clean,
                             raw_value="销量:销量,铺货率:铺货率,标价:标价")
    expect("dropping one metric's row is caught for that metric only", not lossy.ok)
    price_entry = next(e for e in lossy.by_metric if e["metric"] == "标价")
    other_entries = [e for e in lossy.by_metric if e["metric"] != "标价"]
    expect("the dropped metric fails", not price_entry["ok"])
    expect("the untouched metrics still pass", all(e["ok"] for e in other_entries))

    missing_col = reconcile.check(raw, clean,
                                   raw_value="销量:销量,不存在的列:铺货率")
    expect("a raw column that does not exist is reported, not silently skipped",
          not missing_col.ok)
    expect("the reason names the missing column",
          any("不存在的列" in n for n in missing_col.notes))

    plain = reconcile.check(raw.rename(columns={"销量": "amount"}),
                             pd.DataFrame({"value": [100.0, 200.0, 300.0],
                                           "month": [202301, 202302, 202303]}),
                             raw_value="amount")
    expect("the old single-column syntax (no colon) still works unchanged", plain.ok)
    expect("and does not populate byMetric", plain.by_metric == [])


def test_reconcile_disambiguates_a_metric_name_reused_across_l4() -> None:
    """A factor tree legitimately reuses a bare indicator name like 花费 under more
    than one L4 — POSM spend and freezer spend are both just "花费" in the tree,
    disambiguated only by L4 (target_schema.DEFAULT_GRAIN_KEYS makes L1-L4 part of
    the row identity, not metric alone). The two-part <raw column>:<metric> syntax
    must refuse rather than silently sum two unrelated series into one total —
    found by actually reconciling trade-execution, whose POSM and freezer spend
    columns both map to metric="花费" under different L4s."""
    import pandas as pd
    raw = pd.DataFrame({"posm花费": [100.0, 200.0], "冰柜花费": [10.0, 20.0]})
    clean = pd.DataFrame({
        "l4": ["POSM", "POSM", "冰柜", "冰柜"],
        "metric": ["花费", "花费", "花费", "花费"],
        "value": [100.0, 200.0, 10.0, 20.0],
        "month": [202301, 202302, 202301, 202302],
    })

    ambiguous = reconcile.check(raw, clean, raw_value="posm花费:花费,冰柜花费:花费")
    expect("an ambiguous bare metric name is refused, not silently summed",
          not ambiguous.ok)
    expect("neither pair reconciles when the metric is ambiguous",
          all(not e["ok"] for e in ambiguous.by_metric))
    expect("the note names the colliding L4s",
          any("POSM" in n and "冰柜" in n for n in ambiguous.notes))

    disambiguated = reconcile.check(
        raw, clean, raw_value="posm花费:POSM:花费,冰柜花费:冰柜:花费")
    expect("the three-part <raw column>:<l4>:<metric> form resolves it",
          disambiguated.ok, "; ".join(disambiguated.notes))
    posm_entry = next(e for e in disambiguated.by_metric if e["l4"] == "POSM")
    fridge_entry = next(e for e in disambiguated.by_metric if e["l4"] == "冰柜")
    expect("POSM spend only counts POSM rows", posm_entry["cleanSum"] == 300.0)
    expect("freezer spend only counts freezer rows", fridge_entry["cleanSum"] == 30.0)


def test_by_source_counts_series_not_bare_metric_names() -> None:
    """by_source()'s per-source metrics count feeds data/published/manifest.yaml —
    same bug class as the two reconcile fixes above: a bare metric name is not the
    row identity, so a source with POSM spend and freezer spend (both named 花费,
    disambiguated only by L4) has 2 series, not 1."""
    import pandas as pd
    clean = pd.DataFrame({
        "source": ["trade-execution"] * 4,
        "l1": ["渠道成交驱动"] * 4, "l2": ["渠道/终端营销"] * 4,
        "l3": ["品牌显现及陈列展示", "品牌显现及陈列展示", "冰柜", "冰柜"],
        "l4": ["POSM", "POSM", "冰柜", "冰柜"],
        "metric": ["花费", "花费", "花费", "花费"],
        "value": [10.0, 20.0, 1.0, 2.0],
        "month": [202301, 202302, 202301, 202302],
    })
    rows = reconcile.by_source(clean)
    expect("one source", len(rows) == 1)
    expect("two distinct L4-qualified series, not one bare metric name",
          rows[0]["metrics"] == 2, "got %r" % rows[0]["metrics"])


def test_quality_disposition_matches_the_skill_it_serves() -> None:
    """QualityRow.disposition used to be Literal["accept","flag","drop"] defaulting
    to "accept" — a vocabulary skills/data-quality/references/review.md never
    documents ("只有 keep 和 drop 两个值") and a default that pre-decided every row
    before a human reviewed anything, so following score.md's own template
    (disposition left "" until review) failed pydantic validation outright. This
    is the exact drift docs/specs/platform-contracts/data-quality.md already
    flagged and prescribed the fix for; found independently by actually running
    data-quality/score end to end and hitting the validation error live."""
    blank = QualityRow(id="q-1")
    expect("score-step default is blank, not a pre-made decision",
          blank.disposition == "")

    kept = QualityRow(id="q-2", disposition="keep")
    expect("review.md's real vocabulary (keep) is accepted", kept.disposition == "keep")

    dropped = QualityRow(id="q-3", disposition="drop")
    expect("drop is accepted", dropped.disposition == "drop")

    for bad in ("accept", "flag"):
        try:
            QualityRow(id="q-4", disposition=bad)
            expect("the old vocabulary (%r) is now rejected" % bad, False)
        except ValidationError:
            expect("the old vocabulary (%r) is now rejected" % bad, True)


def main() -> int:
    print("=== DATA LAYER CONTRACT TESTS ===")
    for test in (test_supplied_by_is_not_empty,
                 test_summary_and_orphans_are_reported,
                 test_pending_rows_carry_scored_candidates,
                 test_candidate_score_is_the_platform_formula,
                 test_candidates_are_capped_and_ordered,
                 test_quality_verdict_has_one_implementation,
                 test_all_zero_factor_escalates,
                 test_time_and_variance_invariants,
                 test_reconcile_will_not_pass_unchecked,
                 test_reconcile_by_metric_isolates_mixed_units,
                 test_reconcile_disambiguates_a_metric_name_reused_across_l4,
                 test_by_source_counts_series_not_bare_metric_names,
                 test_quality_disposition_matches_the_skill_it_serves):
        print("\n%s" % test.__name__)
        test()
    print("\n%d checks · %d failed" % (CHECKS[0], len(FAILURES)))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
