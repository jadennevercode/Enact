#!/usr/bin/env python3
"""A registered tool must be an identity wrapper over its implementation.

    .venv/bin/python tools/engine/tests/test_tools_parity.py

Different question from `test_golden.py`. Golden vectors ask "does this engine
still compute what the platform computed". This asks "does calling a check
*through the registry* give the same answer as calling it directly" — i.e. has the
tool layer started doing arithmetic of its own.

The platform's rule, kept verbatim: registering a computation must never change
its numbers. If this fails, revert the tool layer rather than updating the
expectation.

Descended from `app/tools/_test_tools.py`, which needed a live platform project.
This runs on the golden fixture, so it needs nothing.
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

import golden_fixture as fx  # noqa: E402

FAILURES: list[str] = []
CHECKS = [0]


def expect(label, condition):
    CHECKS[0] += 1
    print("  %s %s" % ("ok  " if condition else "FAIL", label))
    if not condition:
        FAILURES.append(label)


def test_registry_shape():
    from mmm_engine.tools import get, list_specs

    specs = list_specs()
    expect("the catalog has the 8 registered checks", len(specs) == 8)
    ids = sorted(s.id for s in specs)
    expect("ids are the documented ones", ids == [
        "model.ols", "quality.accuracy", "quality.completeness", "quality.consistency",
        "quality.granularity", "stat.cv", "stat.pearson", "stat.vif"])
    expect("every spec carries a category badge", all(s.category for s in specs))
    expect("every tool resolves", all(get(s.id) is not None for s in specs))


def test_documentation_reads_the_live_source():
    """`detail()` reads the implementation off disk, so a tool page cannot drift."""
    from mmm_engine.tools import detail

    for tool_id in ("quality.consistency", "stat.vif", "model.ols"):
        page = detail(tool_id)
        code = getattr(getattr(page, "source", None), "code", "") or ""
        expect("%s shows real source" % tool_id,
               code.strip().startswith("def ") and "source unavailable" not in code)


def test_quality_tools_identity(df):
    from mmm_engine.scoring import quality as q
    from mmm_engine.tools import get

    evidences, contexts = _series(df, q)

    pairs = [("quality.consistency", q.consistency_subs),
             ("quality.accuracy", q.accuracy_subs),
             ("quality.completeness", q.completeness_subs),
             ("quality.granularity", q.granularity_subs)]
    for tool_id, fn in pairs:
        through = get(tool_id).run(evidences, contexts)
        direct = [fn(ev, ctx) for ev, ctx in zip(evidences, contexts)]
        same = (len(through) == len(direct) and all(
            [(s.key, s.score, s.blocking, s.computed) for s in a]
            == [(s.key, s.score, s.blocking, s.computed) for s in b]
            for a, b in zip(through, direct)))
        expect("%s is an identity wrapper over %d series" % (tool_id, len(evidences)), same)


def _series(df, q):
    """(evidence, context) per series — every dimension tool takes both now."""
    fields = q.field_context(df)
    evidences, contexts = [], []
    for (l1, l2, l3, l4, metric), group in df.groupby(
            ["l1", "l2", "l3", "l4", "metric"], dropna=False):
        if not str(metric).strip():
            continue
        pair = fields.get((l1, l2, l3, l4))
        ctx = q.SeriesContext(has_spend=bool(pair and pair.has_spend),
                              has_performance=not pair or pair.has_performance)
        evidences.append(q.compute_series_evidence(group, ctx))
        contexts.append(ctx)
    return evidences, contexts


def test_composed_scorecard_matches_score_quality(df):
    """The tool-composed 2.2 scorecard equals `score_quality`, cell for cell.

    This is the assertion the platform cared about most: the four tools are called
    separately and their subchecks concatenated, so a change in ordering or in what
    a tool returns would silently move a dimension score.
    """
    from mmm_engine.scoring import quality as q
    from mmm_engine.tools import get

    ok = True
    for ev, ctx in zip(*_series(df, q)):
        composed = q.roll_up_quality(
            get("quality.consistency").run([ev], [ctx])[0]
            + get("quality.accuracy").run([ev], [ctx])[0]
            + get("quality.completeness").run([ev], [ctx])[0]
            + get("quality.granularity").run([ev], [ctx])[0])
        direct = q.score_quality(ev, ctx)
        if (round(composed.consistency, 9), round(composed.accuracy, 9),
                round(composed.completeness, 9), round(composed.granularity, 9),
                round(composed.total, 9)) != (
                round(direct.consistency, 9), round(direct.accuracy, 9),
                round(direct.completeness, 9), round(direct.granularity, 9),
                round(direct.total, 9)):
            ok = False
            print("       composed=%s direct=%s" % (composed.total, direct.total))
    expect("the tool-composed scorecard equals score_quality", ok)


def test_stat_tools_identity(df):
    from mmm_engine.mmm.pivot import build_model_frame
    from mmm_engine.scoring.rules import reference_cv, vif_all
    from mmm_engine.scoring.statistical import pearson
    from mmm_engine.tools import get

    mf = build_model_frame(df, "MT::AURELIA")
    cols = sorted(mf.x_cols)
    y = mf.frame[mf.y_col]
    arrays = [mf.frame[c].to_numpy(dtype=float) for c in cols]

    expect("stat.cv is an identity wrapper",
           get("stat.cv").run(arrays) == [reference_cv(a) for a in arrays])
    expect("stat.pearson is an identity wrapper",
           get("stat.pearson").run([mf.frame[c] for c in cols], y)
           == [pearson(mf.frame[c], y) for c in cols])
    matrix = np.column_stack(arrays)
    expect("stat.vif is an identity wrapper",
           list(get("stat.vif").run(matrix)) == list(vif_all(matrix)))


def test_ols_tool_identity(df):
    from mmm_engine.mmm import run_mmm
    from mmm_engine.tools import get

    through = get("model.ols").run(df, "MT::AURELIA", adstock=0.5, hill_half=1.0)
    direct = run_mmm(df, "MT::AURELIA", adstock=0.5, hill_half=1.0)
    expect("model.ols returns the same r2", round(through.r2, 12) == round(direct.r2, 12))
    expect("model.ols returns the same contributions",
           {k: round(v, 12) for k, v in through.contribution.items()}
           == {k: round(v, 12) for k, v in direct.contribution.items()})
    expect("model.ols returns the same roi",
           {k: round(v, 12) for k, v in through.roi.items()}
           == {k: round(v, 12) for k, v in direct.roi.items()})


def test_tracing_records_a_run():
    """`traced` records an invocation; with no state it runs untraced.

    The second half matters as much as the first: a secondary call path that
    logged itself would make the trace claim a check ran twice when it ran once.
    """
    from mmm_engine.domain.models import ProjectState
    from mmm_engine.trace import traced

    st = ProjectState(project_id="trace-test")
    out = traced(None, st, "2.4", "stat.cv", "3 series", lambda xs: [len(xs)], [1, 2, 3])
    expect("the call still returns its value", out == [3])
    expect("one invocation was recorded", len(st.tool_invocations) == 1)
    record = st.tool_invocations[0]
    expect("recorded against the right tool and task",
           record.tool_id == "stat.cv" and record.task_id == "2.4")
    expect("recorded as ok with a real duration",
           record.status == "ok" and record.duration_ms is not None)

    untraced = traced(None, None, "2.4", "stat.cv", "", lambda xs: [len(xs)], [1, 2])
    expect("with no state the call runs untraced", untraced == [2])


def main() -> int:
    df = fx.frame()
    print("registry")
    test_registry_shape()
    test_documentation_reads_the_live_source()
    print("\nquality")
    test_quality_tools_identity(df)
    test_composed_scorecard_matches_score_quality(df)
    print("\nstatistical")
    test_stat_tools_identity(df)
    print("\nmodel")
    test_ols_tool_identity(df)
    print("\ntracing")
    test_tracing_records_a_run()

    print("\n%d checks · %d failed" % (CHECKS[0], len(FAILURES)))
    if FAILURES:
        print("\nA registered tool changed its implementation's numbers. Revert the tool "
              "layer rather than updating the expectation.")
        for label in FAILURES:
            print("  FAILED: %s" % label)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
