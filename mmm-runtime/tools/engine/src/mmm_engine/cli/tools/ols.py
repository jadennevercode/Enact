"""2.5 — one OLS per channel × product, and the range verdicts over it.

There is no indicator search here. A benchmark is compared against, never tuned
towards: every surviving variable enters its model at once. The **only** thing that
holds one out is identifiability — `affordable_drivers` (OLS with p ≥ n has no
unique solution at all) and the collinearity limit. Both are engine constraints
reported as such, never verdicts about the indicator.

`ols.scorecard` is a **stored** sheet, not a re-derivation. That is what makes a
human verdict survive a re-fit: the recommendation goes on being recomputed and
shown, and the human's ruling is what rules.
"""
from __future__ import annotations

import os

from mmm_engine import workspace as ws
from mmm_engine.cli.meta import artifact_meta
from mmm_engine.cli.registry import Arg, Result, tool
from mmm_engine.selection import (ledger as L, ols_import, ols_plan,
                                  ols_review, ols_runs, ols_scorecard)

_SETTLE_REFITS = 3


@tool("ols.plan", "model",
      "Measure every candidate way to split the data into models. Chooses nothing.",
      out_default="artifacts/s2/ols-plan.yaml")
def ols_plan_tool(ctx) -> Result:
    result = Result()
    try:
        plan = ols_plan.build_plan(ctx.state)
    except Exception as error:  # noqa: BLE001
        result.ok = False
        return result.find("could not measure the candidate splits: %s" % error)

    candidates = plan.get("candidates") or []
    if not candidates:
        result.ok = False
        result.payload = {"candidates": [], "reason": "no candidate split could be measured"}
        return result.find("no split could be measured — check that the published "
                           "table carries a response and a driver")

    # A previously chosen scheme is a human ruling; re-measuring must not clear it.
    prior = getattr(ctx.state, "ols_plan", None)
    chosen = (prior.chosen.model_dump(mode="json", by_alias=True)
              if prior is not None and getattr(prior, "chosen", None) else {})

    result.payload = {"meta": artifact_meta(ctx, "ols-test/plan", "ols-test",
                                            ["data/published/long.parquet"]),
                      "candidates": candidates,
                      "chosen": chosen,
                      "window": plan.get("window") or {},
                      "allTight": plan.get("allTight", False),
                      "noneFeasible": plan.get("noneFeasible", False)}

    result.say("  %-17s %-11s %-8s %-9s %s"
               % ("split", "feasibility", "models", "min months", "held out"))
    for c in candidates:
        result.say("  %-17s %-11s %-8d %-9d %-8d%s"
                   % (c["scheme"], c["feasibility"], c["objectCount"],
                      c["minMonths"], c["totalHeldOut"],
                      "  ← recommended" if c.get("recommended") else ""))
    result.say("")
    result.say("Finer splits answer more questions and estimate fewer drivers each.")
    result.say("`held out` is what a split costs: variables its months cannot")
    result.say("identify. That is a limit, never a verdict about the indicator.")
    if plan.get("allTight"):
        result.say("")
        result.say("Every split holds something out. Coarsening buys degrees of")
        result.say("freedom and spends resolution — which trade is right is a")
        result.say("question about the business, so it is the human's to make.")
    return result


@tool("ols.propose", "model",
      "Propose the OLS setup — response, variables, parameters — all computed.",
      out_default="artifacts/s2/ols-config.yaml")
def ols_propose(ctx) -> Result:
    result = Result()
    st = ctx.state
    try:
        config = ols_review.build_ols_proposal(st)
    except Exception as error:  # noqa: BLE001
        result.ok = False
        return result.find("could not build the proposal: %s" % error)

    result.payload = {"meta": artifact_meta(ctx, "ols-test/fit", "ols-test",
                                            ["data/derived/stat-panel.json"]),
                      # Same reason as `card_rows`: the template, the docs and
                      # every raw-dict reader ask for the camelCase name.
                      "config": config.model_dump(mode="json", by_alias=True)}

    for choice in (getattr(config, "y", None) or []):
        result.say("  %-22s response %s" % (getattr(choice, "object", "?"),
                                            getattr(choice, "metric", "?")))
    candidates = list(getattr(config, "x_candidates", None) or [])
    result.say("%d model variable(s) offered" % len(candidates))
    ticked = [c for c in candidates if getattr(c, "selected", True)]
    held = [c for c in candidates if not getattr(c, "selected", True)]
    if held:
        result.say("")
        result.say("%d held out by the degrees-of-freedom limit:" % len(held))
        for c in held[:8]:
            result.say("    %-28s %s" % (getattr(c, "l4", ""), getattr(c, "metric", "")))
        result.say("  Not a verdict about these indicators. OLS with more parameters")
        result.say("  than observations has no unique solution, so the surplus is")
        result.say("  ranked by |r| with Y and left unticked.")
    result.say("")
    result.say("%d variable(s) will enter the fit." % len(ticked))
    return result


@tool("ols.fit", "model",
      "Fit one OLS per model object on the resolved selection.",
      args=[Arg("--settle", "re-fit until the verdicts and the fit agree",
                takes_value=False),
            Arg("--purpose", "why this run is being made — written before the "
                             "numbers exist, and not editable afterwards",
                required=True)],
      out_default="data/derived/ols-fit.json")
def ols_fit(ctx) -> Result:
    result = Result()
    st = ctx.state

    purpose = str(ctx.opt("purpose", "") or "").strip()
    if not purpose:
        result.ok = False
        return result.find("--purpose is required. A run declares what it is for "
                           "before it can see its own numbers; a reason written "
                           "afterwards is a description of the result, not a reason.")

    # The ONE resolved selection. Re-deriving it here would be exactly how S4 came
    # to train on unfiltered data: the fit runs, reports an R², and has quietly
    # included indicators three layers had already rejected.
    selection = L.model_selection(st)

    try:
        body, _analysis, flagged = ols_review.build_ols_review(st, fit=True,
                                                               task_id=ctx.task)
    except Exception as error:  # noqa: BLE001
        result.ok = False
        return result.find("the fit failed: %s" % error)

    models = _models(body)
    if not models:
        result.ok = False
        result.payload = {"models": [], "reason": "no model object could be fitted"}
        return result.find("no model was fitted. Check that each (channel, brand) "
                           "cell carries both a response and a driver.")

    excluded = {k: sorted("%s::%s" % p for p in v)
                for k, v in (getattr(selection, "exclude", None) or {}).items() if v}

    # ── this run's identity and its place in the history ──
    import json as _json

    from mmm_engine import workspace as _ws
    from mmm_engine.domain.models import ProjectState as _PS   # noqa: F401 (typing only)

    index_path = ctx.path("data/derived/ols-fit.json")
    index = {}
    if index_path.is_file():
        try:
            prior = _json.loads(index_path.read_text(encoding="utf-8"))
            if int(prior.get("schemaVersion") or 0) >= ols_runs.SCHEMA_VERSION:
                index = prior
        except Exception:  # noqa: BLE001 — an unreadable index starts a new history
            index = {}

    run_id = ols_runs.next_run_id(index)
    generated = _now_iso()
    run_body = {"runId": run_id, "purpose": purpose, "generated": generated,
                "plan": ols_runs._plain(getattr(st, "ols_plan", None)),
                "params": ols_runs._plain(getattr(getattr(st, "ols_config", None),
                                                  "params", None)),
                "models": models, "excluded": excluded,
                "flagged": list(flagged or [])}
    run_rel = "data/derived/ols-runs/%s.json" % run_id
    run_path = ctx.path(run_rel)
    run_path.parent.mkdir(parents=True, exist_ok=True)
    run_path.write_text(_json.dumps(run_body, ensure_ascii=False, indent=2),
                        encoding="utf-8")
    result.also_wrote.append(run_rel)

    index = ols_runs.append_run(
        index, run_id=run_id, purpose=purpose, generated=generated,
        plan_sha=ols_runs.snapshot_sha(getattr(st, "ols_plan", None)),
        params_sha=ols_runs.snapshot_sha(getattr(getattr(st, "ols_config", None),
                                                 "params", None)),
        selection_sha=ols_runs.snapshot_sha(selection),
        summary=ols_runs.summarise(models))

    # `models` stays at the top level: every existing reader — the predicates, the
    # renderer, the scorecard — asks for it, and this run is the current one.
    result.payload = {"schemaVersion": ols_runs.SCHEMA_VERSION,
                      "runId": run_id,
                      "adopted": index.get("adopted") or [],
                      "runs": index.get("runs") or [],
                      "models": models,
                      "excluded": excluded,
                      "flagged": list(flagged or [])}

    fitted = [m for m in models if not m.get("error")]
    failed = [m for m in models if m.get("error")]
    result.say("%d model(s) fitted%s" % (len(fitted),
                                         ", %d failed" % len(failed) if failed else ""))
    result.say("")
    result.say("  %-22s %-7s %-7s %-6s %s" % ("object", "R²", "MAPE", "months", "drivers"))
    for model in models:
        if model.get("error"):
            result.say("  %-22s %s" % (model.get("object", "?"), model["error"]))
            continue
        result.say("  %-22s %-7s %-7s %-6s %d"
                   % (model.get("object", "?"), _f(model.get("r2")),
                      _f(model.get("mape")), model.get("months") or "-",
                      len(model.get("drivers") or [])))

    weak = [m for m in models if (m.get("r2") or 0) < 0.5]
    if weak:
        result.say("")
        result.say("%d model(s) below R² 0.5: %s" % (
            len(weak), ", ".join(str(m.get("object")) for m in weak)))
        result.say("  A weak cell is a finding, not something to tune away.")
    return result


def _models(body: dict) -> list[dict]:
    """Normalise the review body into the payload the predicates read.

    `build_ols_review` returns `objects` (one fitted model each) and `tree` (one
    row per factor per object, carrying the coefficient and why it is in or out).
    The predicates need each model's drivers with their VIF, so the tree rows that
    made it into a model are folded back onto their object.
    """
    by_object: dict[str, list[dict]] = {}
    for row in (body.get("tree") or []):
        if not isinstance(row, dict) or not row.get("inModel"):
            continue
        by_object.setdefault(str(row.get("object", "")), []).append({
            "l4": row.get("l4", ""), "metric": row.get("indicator", ""),
            "treeRowId": row.get("treeRowId", ""),
            "coef": row.get("coef"), "vif": row.get("vif"),
            "contribution": row.get("contribution"), "roi": row.get("roi"),
            "pvalue": row.get("pValue", row.get("pvalue")),
        })

    out = []
    for model in (body.get("objects") or []):
        if not isinstance(model, dict):
            continue
        obj = str(model.get("object", ""))
        out.append({
            "object": obj, "label": model.get("label", obj),
            "months": model.get("nObs"), "r2": model.get("r2"),
            "adjR2": model.get("adjR2"), "mape": model.get("mape"),
            "durbinWatson": model.get("durbinWatson"),
            "baselinePct": model.get("baselinePct"),
            "redFlags": model.get("redFlags") or [],
            "error": model.get("error") or "",
            "yMetric": model.get("yMetric", ""),
            "drivers": by_object.get(obj, []),
        })
    return out


@tool("ols.scorecard", "model",
      "Refresh the 2.5d range sheet: accept/reject per fitted factor vs its band.",
      out_default="artifacts/s2/ols-scorecard.yaml")
def ols_scorecard_tool(ctx) -> Result:
    result = Result()
    st = ctx.state
    try:
        body, _analysis, _flagged = ols_review.build_ols_review(st, fit=True,
                                                                task_id=ctx.task)
        card = ols_scorecard.build_scorecard(st, body)
    except Exception as error:  # noqa: BLE001
        result.ok = False
        return result.find("could not build the range scorecard: %s" % error)

    rows = card_rows(card)
    if not rows:
        result.ok = False
        result.payload = {"rows": [], "reason": "the fit produced no factor to rule on"}
        return result.find("no fitted factor to score against a band")

    # The run index, so the factor sheet can span every adopted run.
    import json as _json
    index = {}
    fit_path = ctx.path("data/derived/ols-fit.json")
    if fit_path.is_file():
        try:
            index = _json.loads(fit_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            index = {}

    factors = ols_scorecard.build_factors(index, rows, ctx.workspace)
    models = ols_scorecard.build_models(index, ctx.workspace)
    prior_card = getattr(st, "ols_scorecard", None)
    # A human ruling on a factor is pinned, exactly as it is on a row.
    pinned = {(f.l4, f.indicator): f for f in (getattr(prior_card, "factors", None) or [])
              if f.decided_by == "human"}
    factors = [f.model_copy(update={"disposition": pinned[(f.l4, f.indicator)].disposition,
                                    "decided_by": "human",
                                    "note": pinned[(f.l4, f.indicator)].note})
               if (f.l4, f.indicator) in pinned else f for f in factors]

    result.payload = {"meta": artifact_meta(ctx, "ols-test/review", "ols-test",
                                            ["data/derived/ols-fit.json"]),
                      "rows": rows,
                      "factors": [f.model_dump(mode="json", by_alias=True) for f in factors],
                      "models": [m.model_dump(mode="json", by_alias=True) for m in models],
                      "summary": ols_scorecard.factor_summary(factors, rows),
                      "assumptions": [a for a in
                                      (getattr(prior_card, "assumptions", None) or [])]}

    counts = result.payload["summary"]
    result.say("%d factor(s): %d include · %d conditional · %d watch · %d exclude"
               % (counts["factors"], counts["include"], counts["conditional"],
                  counts["watch"], counts["exclude"]))
    misfits = [m for m in models if m.misfit]
    if misfits:
        result.say("")
        result.say("%d model(s) misfit — controls absorbed more than the data holds:"
                   % len(misfits))
        for m in misfits[:5]:
            result.say("  %-8s %-18s baseline %s%%"
                       % (m.run_id, str(m.object)[:18], _f(m.baseline_pct)))
        result.say("  Fix the controls first (fewer Fourier terms, or trend off).")
        result.say("  Dropping indicators here treats the wrong illness.")
    result.say("")
    pinned = [r for r in rows if str(r.get("decidedBy", "")).lower() == "human"]
    rejected = [r for r in rows if str(r.get("disposition", "")).lower() == "reject"]
    result.say("%d fitted factor(s) · %d rejected · %d pinned by a human"
               % (len(rows), len(rejected), len(pinned)))

    out_of_band = sorted((r for r in rows if _norm(r.get("rangeSeverity")) in ("red", "yellow")),
                         key=_worst_deviation, reverse=True)
    if out_of_band:
        result.say("")
        result.say("out of band, worst first:")
        for row in out_of_band[:10]:
            result.say("  %-6s %-14s %-20s %s"
                       % (_norm(row.get("rangeSeverity")),
                          str(row.get("object", ""))[:14],
                          str(row.get("l4", ""))[:20], _row_miss(row)))
        result.say("  Amber is a review, not a removal. Red is the one that offers")
        result.say("  the way back to business validation.")
    no_band = [r for r in rows if not row_band(r)]
    if no_band:
        result.say("")
        result.say("%d factor(s) have NO benchmark for this industry." % len(no_band))
        result.say("  That is 'no check ran', not 'out of range'. Rule on them on the")
        result.say("  business reading, or maintain a band in Knowledge.")
    if pinned:
        result.say("")
        result.say("%d row(s) carry a human verdict and are pinned against this and"
                   % len(pinned))
        result.say("every later re-fit. The recommendation is recomputed and shown;")
        result.say("the verdict is what rules.")
    return result


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


@tool("ols.factors-import", "model",
      "Read a reviewed factor workbook back into the scorecard.",
      args=[Arg("--from", "the client's saved copy of ols-scorecard.xlsx",
                required=True)],
      out_default="artifacts/s2/ols-scorecard.yaml")
def ols_factors_import(ctx) -> Result:
    result = Result()
    from mmm_engine import workspace as ws

    source = ctx.opt("from", "")
    path = os.path.abspath(os.path.expanduser(str(source)))
    if not os.path.isfile(path):
        result.ok = False
        return result.find("找不到这份工作簿：%s" % source)

    card_rel = "artifacts/s2/ols-scorecard.yaml"
    card_path = ctx.path(card_rel)
    if not card_path.is_file():
        result.ok = False
        return result.find("%s 不存在 —— 先跑 ols.scorecard" % card_rel)
    card = ws.read_yaml(card_path)
    factors = [f for f in (card.get("factors") or []) if isinstance(f, dict)]
    if not factors:
        result.ok = False
        return result.find("评分卡里没有因子表 —— 先跑一次 ols.scorecard")

    ok, why = ols_import.lineage_ok(path, _source_hash(str(card_path)))
    if not ok:
        result.ok = False
        return result.find(why)

    sheet = ols_import.read_sheet(path)
    if not sheet:
        result.ok = False
        return result.find("这份工作簿里没有「%s」这张表 —— 是不是导错了文件"
                           % ols_import.SHEET)

    merged, notes = ols_import.apply_edits(factors, sheet)
    card = dict(card)
    card["factors"] = merged
    card["meta"] = {**(card.get("meta") or {}),
                    "amendedAt": _now_iso(),
                    "amendedFrom": os.path.basename(path)}
    result.payload = card

    edits = [f for f, before in zip(merged, factors) if f != before]
    result.say("%d 个因子，其中 %d 个被客户改过" % (len(merged), len(edits)))
    for line in notes[:10]:
        result.say("  %s" % line)
    if not edits:
        result.say("工作簿里没有与评分卡不同的判定 —— 没有东西要回写。")
        result.say("客户确实审过但什么都没改，这本身也是结论，记在确认里。")
    return result


def _source_hash(path: str) -> str:
    """The fingerprint the workbook was stamped with at render time.

    Computed by the same function the freshness check uses, deliberately: two
    implementations of "which version is this" is two answers.
    """
    import hashlib
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parents[5]
    sys.path.insert(0, str(root / "scripts"))
    sys.path.insert(0, str(root / "shared" / "lib"))
    try:
        import gate_check
        return gate_check.source_hash(path)
    except Exception:  # noqa: BLE001 — fall back to the same recipe
        import yamlio
        from mmm_engine import workspace as ws
        payload = {k: v for k, v in ws.read_yaml(path).items() if k != "meta"}
        return hashlib.sha1(yamlio.dump(payload).encode("utf-8")).hexdigest()[:12]


def card_rows(card) -> list[dict]:
    """The scorecard's rows as the plain dicts everything downstream reads.

    `by_alias` is load-bearing, not cosmetic. Without it every aliased field lands
    as `decided_by` / `range_severity` / `auto_verdict`, while the template, the
    deliverable and every raw-dict reader ask for the camelCase name. Loading
    survives the mismatch (`populate_by_name`), so nothing ever errors — the checks
    simply stop finding the fields and pass on an empty set. That is why this is a
    named function: it is worth a test of its own.
    """
    return [r.model_dump(mode="json", by_alias=True) if hasattr(r, "model_dump")
            else dict(r) for r in (getattr(card, "rows", None) or [])]


def row_band(row: dict) -> object:
    return row.get("roiRange") or row.get("contributionRange")


def _norm(value) -> str:
    return str(value or "").strip().lower()


def _worst_deviation(row: dict) -> float:
    """How far outside its band this row sits, worst of the two measures.

    `in` / `out` alone cannot separate a near miss from ten times the band, and
    those two want opposite actions — so the stdout ordering has to be by the
    deviation, not by the row order.
    """
    seen = [row.get("roiDeviationPct"), row.get("contributionDeviationPct")]
    return max((float(v) for v in seen if v is not None), default=0.0)


def _row_miss(row: dict) -> str:
    """The measure(s) that broke a band, each with its value and that band."""
    parts = []
    for label, value, band, status in (
            ("ROI", row.get("roi"), row.get("roiRange"), row.get("roiStatus")),
            ("contribution", row.get("contribution"), row.get("contributionRange"),
             row.get("contributionStatus"))):
        if _norm(status) == "out":
            parts.append("%s %s vs band %s" % (label, _f(value), band or "none"))
    return "; ".join(parts) or "out of band"


def _f(value) -> str:
    if value is None:
        return "-"
    try:
        return "%.3f" % float(value)
    except (TypeError, ValueError):
        return str(value)


@tool("knowledge.range", "knowledge",
      "Look up a factor's industry ROI/contribution band. Exact key, never substring.",
      args=[Arg("--l4", "the L4 factor", required=True),
            Arg("--indicator", "the indicator")])
def knowledge_range(ctx) -> Result:
    from mmm_engine import knowledge

    result = Result()
    st = ctx.state
    ranges = knowledge.factor_ranges(st)
    anchor = knowledge.recall_label(st)
    result.say("industry pack: %s" % anchor)
    if not ranges:
        result.say("")
        result.say("No benchmark library for this industry. Every lookup returns")
        result.say("nothing, and nothing means NO CHECK RAN — never 'out of range'.")
        result.payload = {"anchor": anchor, "match": None}
        return result

    match = knowledge.match_range(ranges, str(ctx.opt("l4")), str(ctx.opt("indicator") or ""))
    result.payload = {"anchor": anchor, "l4": ctx.opt("l4"),
                      "indicator": ctx.opt("indicator"), "match": match}
    if not match:
        result.say("no band for %s :: %s" % (ctx.opt("l4"), ctx.opt("indicator") or "-"))
        result.say("  Matching is EXACT. Substring matching once manufactured four")
        result.say("  benchmarks by matching 'Connected TV' to 'TV', so it does not exist.")
        return result
    result.say("roi:          %s" % (match.get("roiRange") or "-"))
    result.say("contribution: %s" % (match.get("contributionYearly")
                                     or match.get("contributionRange") or "-"))
    return result
