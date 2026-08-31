#!/usr/bin/env python3
"""The vendored engine must reproduce the platform's frozen answers, cell for cell.

    .venv/bin/python tools/engine/tests/test_golden.py

This is the whole parity story, and it needs no access to the platform. It catches
a botched port *and* — more importantly — a later "improvement" that quietly
changes a number. When it fails, the answer is almost never to regenerate the
golden file: it is to find out which number moved and why.

Descendant of the platform's `app/tools/_test_tools.py`, which asserted
wrapper == direct call. Same intent, one layer out: engine == engine.

**One deliberate refreeze, 2026-08-11.** The data-quality rubric was rewritten to
the client's restated rules (ten subchecks instead of eleven, continuity dropped,
completeness by missing rate instead of history span, model granularity measured
against the contract's scope, Total >= 0.5 accepting). Only the `quality` case was
regenerated; `fit` / `ledger` / `objects` / `selection` / `stat` still hold the
platform's original answers and were untouched. Worth recording: on this fixture
the four dimension scores and every Total came out **identical** either way — what
moved was the subcheck breakdown, which now also freezes each check's `computed`
flag so a check quietly becoming unverifiable is a visible diff.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import golden_cases  # noqa: E402
import golden_fixture as fx  # noqa: E402

EXPECTED = os.path.join(HERE, "golden", "expected.json")


def engine_api() -> dict:
    import numpy as np

    from mmm_engine import dataset
    from mmm_engine.domain.models import (FactorRow, FactorTree, IndustryRef, ProjectMeta,
                                          ProjectState, QualityRow, QualityScorecard)
    from mmm_engine.mmm import run_mmm
    from mmm_engine.mmm.pivot import build_model_frame
    from mmm_engine.scoring import quality as quality_scoring
    from mmm_engine.selection import ledger
    from mmm_engine.tools import get

    def state():
        pid = "golden"
        rows = [FactorRow(id=r["id"], l1=r["l1"], l2=r["l2"], l3=r["l3"], l4=r["l4"],
                          indicator=r["indicator"], status=r["status"], source=r["source"])
                for r in fx.tree_rows()]
        st = ProjectState(
            project_id=pid,
            meta=ProjectMeta(id=pid, name="Golden", brand="AURELIA",
                             industry=IndustryRef(l1="beauty", l2="skincare", l3="sunscreen"),
                             createdAt="2026-08-06T00:00:00+00:00"),
            factor_tree=FactorTree(rows=rows),
            quality_scorecard=QualityScorecard(rows=[QualityRow(**r) for r in fx.QUALITY_ROWS]),
        )
        dataset.attach(st, "/golden", fx.frame())
        ledger.invalidate_universe(pid)
        return st

    return {
        "frame": fx.frame,
        "tool": lambda tid: get(tid).run,
        "compute_series_evidence": quality_scoring.compute_series_evidence,
        "roll_up_quality": quality_scoring.roll_up_quality,
        "field_context": quality_scoring.field_context,
        "make_context": quality_scoring.SeriesContext,
        "build_model_frame": build_model_frame,
        "column_stack": np.column_stack,
        "run_mmm": run_mmm,
        "state": state,
        "model_objects": dataset.model_objects,
        "indicator_ledger": ledger.indicator_ledger,
        "model_selection": ledger.model_selection,
    }


def main() -> int:
    if not os.path.isfile(EXPECTED):
        print("no golden file at %s — run make_golden.py against a platform checkout "
              "once, then commit it" % os.path.relpath(EXPECTED, HERE))
        return 2
    with open(EXPECTED, encoding="utf-8") as handle:
        expected = json.load(handle)

    actual = golden_cases.compute(engine_api())
    problems = golden_cases.compare(expected, actual)

    for case in sorted(expected):
        case_problems = [p for p in problems if p.startswith(case)]
        size = len(expected[case]) if isinstance(expected[case], (list, dict)) else 1
        print("  %-4s %-11s %d entries" % ("FAIL" if case_problems else "ok", case, size))
        for line in case_problems[:6]:
            print("       %s" % line)

    print("\n%d case(s) · %d difference(s)" % (len(expected), len(problems)))
    if problems:
        print("\nThe vendored engine no longer computes what the platform computed.")
        print("Find the number that moved. Regenerating the golden file makes the")
        print("difference permanent and invisible — that is the one wrong answer here.")
        return 1
    print("parity holds: the engine reproduces every frozen answer.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
