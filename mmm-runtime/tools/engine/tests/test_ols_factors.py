"""Cross-run factor synthesis: what pools, what does not, and who may reject.

    .venv/bin/python tools/engine/tests/test_ols_factors.py

Two rules carry this module, and both were learned the expensive way.

**Only dimensionless evidence pools.** A factor contributing 8% nationally, 15%
in EC and 2% in TT has no meaningful average, so contribution and ROI are listed
per cell and never reduced. What pools is the shape: sign agreement, significance
rate, worst band verdict.

**A language model may not be the sole author of a removal.** On the real project
every row came back `noBenchmark` — the knowledge pack had no entry for that
industry — which left `implausible` as the only path that rejected anything. A
step whose stated premise is that it does not choose variables was choosing them,
by model verdict alone. With no band there is nothing computed for the reading to
stand beside, so it becomes `watch` and a person rules.
"""
from __future__ import annotations

from mmm_engine.selection import ols_factors as F

CHECKS = [0, 0]


def check(name: str, cond: bool, detail: str = "") -> None:
    CHECKS[0] += 1
    if not cond:
        CHECKS[1] += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


def cell(run, obj, coef, p=0.01, contrib=10.0, roi=1.0):
    return {"runId": run, "object": obj, "coef": coef, "pValue": p,
            "contribution": contrib, "roi": roi, "l4": "TV", "indicator": "GRP"}


def main() -> int:
    steady = [cell("r-0001", "MT", 3.0), cell("r-0001", "EC", 2.5)]
    flipped = [cell("r-0001", "MT", 3.0), cell("r-0001", "EC", -2.5)]
    weak = [cell("r-0001", "MT", 3.0, p=0.9), cell("r-0001", "EC", 2.5, p=0.8)]

    s = F.synthesise(steady)
    check("a factor agreeing with itself scores 1.0 on sign", s["signConsistency"] == 1.0)
    check("and its dominant sign is reported", s["dominantSign"] == "+")
    check("significance is a rate over the cells it entered", s["significanceRate"] == 1.0)

    # The rule that shapes the module: dimensioned values are listed, not averaged.
    mixed = [cell("r-0001", "ALL", 1.0, contrib=8.0),
             cell("r-0002", "EC", 1.0, contrib=15.0),
             cell("r-0002", "TT", 1.0, contrib=2.0)]
    m = F.synthesise(mixed)
    check("contribution is reported per cell, never pooled",
          [o["value"] for o in m["contributionObserved"]] == [8.0, 15.0, 2.0])
    check("and each observation says which run and object it came from",
          all(o["runId"] and o["object"] for o in m["contributionObserved"]))
    check("no averaged contribution field is produced at all",
          not any("avg" in k.lower() or "mean" in k.lower() for k in m))

    # Worst-severity wins: one red anywhere is the factor's severity.
    sev = {("r-0001", "MT", ("tv", "grp")): "green",
           ("r-0001", "EC", ("tv", "grp")): "red"}
    check("the worst band verdict anywhere is the factor's",
          F.synthesise(steady, sev)["rangeSeverity"] == "red")

    # ── advice ──
    check("steady and significant is include",
          F.recommend(F.synthesise(steady))[0] == F.INCLUDE)
    check("a sign that flips between objects is conditional, not a rejection",
          F.recommend(F.synthesise(flipped))[0] == F.CONDITIONAL)
    check("steady but mostly insignificant is watch",
          F.recommend(F.synthesise(weak))[0] == F.WATCH)
    check("red anywhere is exclude",
          F.recommend(F.synthesise(steady, sev))[0] == F.EXCLUDE)
    check("a factor that entered no adopted run is insufficient, not excluded",
          F.recommend(F.synthesise([]))[0] == F.INSUFFICIENT)

    # ── the one that matters most ──
    no_band = F.recommend(F.synthesise(steady), ai_verdict="implausible", has_band=False)
    check("implausible with NO band is watch — the model does not remove a "
          "variable on its own say-so", no_band[0] == F.WATCH, no_band[1][:40])
    with_band = F.recommend(F.synthesise(steady), ai_verdict="implausible", has_band=True)
    check("implausible WITH a band is exclude — there is computed evidence beside it",
          with_band[0] == F.EXCLUDE)

    # ── the whole scorecard must survive a round trip through the workspace ──
    # Loading only `rows` silently dropped `factors`, so the code that pins a
    # human's factor verdict compared against an empty list and pinned nothing.
    import tempfile
    from mmm_engine import workspace as ws
    from mmm_engine.domain.models import OlsFactorRow, OlsRangeRow, OlsRangeScorecard

    root = tempfile.mkdtemp()
    ws.save_store(root, "ols-scorecard", [OlsRangeRow(id="x")])
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))), "shared", "lib"))
    import yamlio
    card_path = os.path.join(root, "artifacts", "s2", "ols-scorecard.yaml")
    with open(card_path, "w", encoding="utf-8") as handle:
        handle.write(yamlio.dump({
            "rows": [{"id": "x", "object": "MT", "l4": "TV", "indicator": "GRP"}],
            "factors": [{"l4": "TV", "indicator": "GRP", "disposition": "reject",
                         "decidedBy": "human", "note": "客户说今年没投"}]}))
    st = ws.load_state(root)
    loaded = getattr(st.ols_scorecard, "factors", None) or []
    check("`factors` survives being loaded back from the workspace",
          len(loaded) == 1, "loaded %d" % len(loaded))
    check("and the human's ruling comes back with it",
          bool(loaded) and loaded[0].disposition == "reject"
          and loaded[0].decided_by == "human")

    print(f"\n{CHECKS[0]} checks · {CHECKS[1]} failed")
    return 1 if CHECKS[1] else 0


if __name__ == "__main__":
    raise SystemExit(main())
