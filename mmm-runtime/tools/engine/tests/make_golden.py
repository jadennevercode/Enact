#!/usr/bin/env python3
"""Freeze the platform's answers as golden vectors. Run once, by hand.

    .venv/bin/python tools/engine/tests/make_golden.py [path/to/platform/backend]

This is the **only** thing in the repo that reads the platform, it is never run by
a test or a build, and its output — `golden/expected.json` — is what makes parity
checkable forever after without the platform being present.

Regenerate it only when you have deliberately re-synced against a newer upstream
and recorded that in UPSTREAM.md. Regenerating it to make a failing test pass is
how a silently changed number becomes the new truth.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import golden_cases  # noqa: E402
import golden_fixture as fx  # noqa: E402

DEFAULT_PLATFORM = os.environ.get("MMM_PLATFORM_BACKEND", "")
OUT = os.path.join(HERE, "golden", "expected.json")


def platform_api(platform: str) -> dict:
    sys.path.insert(0, platform)
    import numpy as np
    import pandas as pd

    from app.agents import quality_scoring
    from app.agents.data import _field_context
    from app.agents.dataset_cache import DatasetResolution, model_objects
    from app.agents import dataset_cache, ledger
    from app.domain.models import (FactorRow, FactorTree, IndustryRef, ProjectMeta,
                                   QualityRow, QualityScorecard)
    from app.mmm import run_mmm
    from app.mmm.pivot import build_model_frame
    from app.store.state import ProjectState
    from app.tools.registry import get

    def state():
        pid = "golden"
        rows = []
        for r in fx.tree_rows():
            rows.append(FactorRow(id=r["id"], l1=r["l1"], l2=r["l2"], l3=r["l3"],
                                  l4=r["l4"], indicator=r["indicator"],
                                  status=r["status"], source=r["source"]))
        st = ProjectState(
            project_id=pid,
            meta=ProjectMeta(id=pid, name="Golden", brand="AURELIA",
                             industry=IndustryRef(l1="beauty", l2="skincare", l3="sunscreen"),
                             createdAt="2026-08-06T00:00:00+00:00"),
            factor_tree=FactorTree(rows=rows),
            quality_scorecard=QualityScorecard(
                rows=[QualityRow(**r) for r in fx.QUALITY_ROWS]),
        )
        dataset_cache._PROJECT_CACHE[pid] = DatasetResolution(fx.frame(), "published")
        ledger.invalidate_universe(pid)
        return st

    return {
        "frame": fx.frame,
        "tool": lambda tid: get(tid).run,
        "compute_series_evidence": quality_scoring.compute_series_evidence,
        "roll_up_quality": quality_scoring.roll_up_quality,
        "field_context": _field_context,
        "make_context": quality_scoring.SeriesContext,
        "build_model_frame": build_model_frame,
        "column_stack": np.column_stack,
        "run_mmm": run_mmm,
        "state": state,
        "model_objects": model_objects,
        "indicator_ledger": ledger.indicator_ledger,
        "model_selection": ledger.model_selection,
    }


def main(argv: list[str]) -> int:
    platform = argv[0] if argv else DEFAULT_PLATFORM
    if not os.path.isdir(platform):
        print("platform not found at %r — pass its backend/ path, or set "
              "MMM_PLATFORM_BACKEND" % platform)
        return 2
    results = golden_cases.compute(platform_api(platform))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(results, handle, ensure_ascii=False, indent=1, sort_keys=True)
        handle.write("\n")
    counts = {k: (len(v) if isinstance(v, (list, dict)) else 1) for k, v in results.items()}
    print("wrote %s" % os.path.relpath(OUT, os.path.dirname(HERE)))
    for key in sorted(counts):
        print("  %-12s %d" % (key, counts[key]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
