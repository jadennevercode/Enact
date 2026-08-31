"""数据质量评分 — four dimension tools plus the rollup that combines them.

Ten deterministic subchecks over four dimensions, and Total is their **product**:
one failing dimension zeroes it. Total >= 0.5 accepts, anything between 0 and 0.5
goes to a human, 0 is unusable.

Five tools rather than one, because a dimension is a question in its own right:

    quality.consistency  → data/derived/quality-consistency.json
    quality.accuracy     → data/derived/quality-accuracy.json
    quality.completeness → data/derived/quality-completeness.json
    quality.granularity  → data/derived/quality-granularity.json
    quality.scorecard    → data/derived/quality-evidence.json   (reads the four)

When one dimension's verdict is disputed you re-run that dimension, and the run
record says so. Before, all ten subchecks arrived as a single opaque invocation.

**Rows come from the factor tree, not from the data.** One row per accepted
`(L1..L4 + indicator)`, carrying a `dataStatus`:

    scored          the long table has this series; it has scores
    no-data         the tree asked for it and nothing arrived; it has none
    inherited-drop  the factor map already ruled it out; not re-scored

`no-data` is not zero. Zero means "we looked and it cannot be used" and goes to the
data owner; `no-data` means "it never came" and goes back to the data request. A
scorecard built from the data alone cannot say the second thing at all — the row
simply is not there, which reads exactly like a factor nobody ever wanted.

Nothing is aggregated first. Scoring a national roll-up made four subchecks unable
to fail: `source` collapsed to a constant so a caliber change was invisible, region
and channel collapsed to one value each so granularity scored everything the same,
and summing dropped NaNs so per-cell missingness never reached completeness.
"""
from __future__ import annotations

from mmm_engine import dataset
from mmm_engine.cli.registry import Result, tool
from mmm_engine.scoring import quality as q
from mmm_engine.scoring import universe as U
from mmm_engine.scoring.universe import INHERITED, NO_DATA, SCORED
from mmm_engine.selection import ledger as L
from mmm_engine.tools import get as engine_tool
from mmm_engine.trace import traced

DIMENSIONS = ("consistency", "accuracy", "completeness", "granularity")

#: dimension → (engine tool id, payload path, Chinese label)
DIMENSION_TOOLS: dict[str, tuple[str, str, str]] = {
    "consistency": ("quality.consistency", "data/derived/quality-consistency.json", "一致性"),
    "accuracy": ("quality.accuracy", "data/derived/quality-accuracy.json", "准确性"),
    "completeness": ("quality.completeness", "data/derived/quality-completeness.json", "完整性"),
    "granularity": ("quality.granularity", "data/derived/quality-granularity.json", "颗粒度"),
}


# ── the evidence every dimension tool scores over ───────────────────────────


def build_universe(st):
    """The shared row set, plus the per-series evidence and context this layer needs.

    `scoring.universe` decides which rows exist and what state each is in — the
    statistical layer builds on the identical answer, which is what keeps the two
    funnels reconcilable. What is added here is the quality-specific part: the
    computed evidence for each scored series, and the context it is judged against
    (the contract's axes, the modeling window, the declared unit, the attested
    total) — none of which the series can supply about itself.
    """
    df = dataset.model_df(st)
    universe = U.build(st, "quality", prefix="q", df=df)

    profile = getattr(st, "profile", None)
    window = _window_months(profile)
    contract_axes = _contract_axes(profile)
    references = _reference_index(st)
    field_ctx = _field_context_by_l4(df)
    scored_l4 = {L._norm(r.l4) for r in universe.scored}

    evidence, contexts = {}, {}
    for row in universe.scored:
        tree_row = row.tree_row
        declared = {q.axis_column(a) for a in tree_row.axes()} - {None}
        required = (contract_axes & declared) if declared else contract_axes
        pair = field_ctx.get(L._norm(row.l4), (False, True))
        reference = references.get(row.key)
        ctx = q.SeriesContext(
            has_spend=pair[0], has_performance=pair[1],
            factor_has_data=L._norm(row.l4) in scored_l4,
            axes_required=frozenset(required),
            axes_declared=frozenset(declared),
            window_months=window,
            declared_unit=str(getattr(tree_row, "unit", "") or ""),
            reference_value=(reference or {}).get("value"),
            reference_period=str((reference or {}).get("period") or ""),
            reference_source=str((reference or {}).get("source") or ""),
        )
        contexts[row.id] = ctx
        evidence[row.id] = q.compute_series_evidence(universe.groups[row.key], ctx)
    return universe, evidence, contexts


def _window_months(profile) -> int:
    """Months in the declared modeling window; 0 when the profile does not say."""
    window = getattr(profile, "time_window", None)
    if window is None:
        return 0
    from mmm_engine.assemble.time_windows import length_months, ym_to_int

    start, end = ym_to_int(window.start), ym_to_int(window.end)
    if not start or not end:
        return 0
    return length_months(start, end)


def _contract_axes(profile) -> frozenset[str]:
    """Long-table columns the contract's model scope asks the data to split by."""
    if profile is None:
        return frozenset()
    return frozenset({q.axis_column(name) for name in profile.scope_axes()} - {None})


def _reference_index(st) -> dict[tuple[str, str], dict]:
    out: dict[tuple[str, str], dict] = {}
    for entry in getattr(st, "reference_totals", None) or []:
        key = L._norm_pair(getattr(entry, "l4", ""), getattr(entry, "indicator", ""))
        out.setdefault(key, {"value": float(getattr(entry, "value", 0.0) or 0.0),
                             "period": getattr(entry, "period", ""),
                             "source": getattr(entry, "source", "")})
    return out


def _field_context_by_l4(df) -> dict[str, tuple[bool, bool]]:
    """L4 → (has spend, has a performance metric), keyed on the normalised name.

    Keyed on L4 alone, not the full L1–L4 path: the scorecard's own row key is
    (l4, indicator), and a path that differs only by whitespace upstream would
    otherwise split one factor into two and tell both of them their partner is
    missing.
    """
    out: dict[str, tuple[bool, bool]] = {}
    for l4, grp in df.groupby("l4", dropna=False):
        types = set(grp["metric_type"].dropna().astype(str)) if "metric_type" in grp else set()
        out[L._norm(l4)] = ("spending" in types, bool(types - {"spending"}))
    return out


# ── the four dimension tools ────────────────────────────────────────────────


def _dimension_run(ctx, dimension: str) -> Result:
    result = Result()
    st = ctx.state
    label = DIMENSION_TOOLS[dimension][2]
    try:
        universe, evidence, series_contexts = build_universe(st)
    except Exception as error:  # noqa: BLE001
        result.ok = False
        return result.find(str(error))

    scored = universe.scored
    if not scored:
        reason = U.empty_reason(universe, "%s打分" % label)
        result.ok = False
        result.payload = {"dimension": dimension, "rows": [], "reason": reason}
        return result.find(reason)

    tool_id = DIMENSION_TOOLS[dimension][0]
    evidences = [evidence[r.id] for r in scored]
    contexts = [series_contexts[r.id] for r in scored]
    batches = traced(None, st, ctx.task, tool_id, "%d 条序列" % len(evidences),
                     engine_tool(tool_id).run, evidences, contexts)

    rows = []
    for row, subs in zip(scored, batches):
        rows.append({**row.head(), "score": q.dimension_score(list(subs), dimension),
                     "subScores": [_sub(s) for s in subs]})

    counts = universe.counts()
    result.payload = {
        "dimension": dimension,
        "signature": universe.signature(),
        "rows": rows,
        "skipped": {NO_DATA: counts[NO_DATA], INHERITED: counts[INHERITED]},
        "orphanCount": len(universe.orphans),
    }

    bands: dict[float, int] = {}
    for row in rows:
        bands[row["score"]] = bands.get(row["score"], 0) + 1
    result.say("%s：%d 条序列打分 · %s" % (
        label, len(rows), " · ".join("%d 个 %g 分" % (v, k) for k, v in sorted(bands.items()))))

    unverified = sorted({s["label"] for row in rows for s in row["subScores"]
                         if not s["computed"]})
    if unverified:
        result.say("未校验（缺对照输入，恒 1 分且不阻断）：%s" % "、".join(unverified))
        result.say("  视图上这几项必须渲染成「未校验」。没查和查了没问题不能长得一样。")

    weak = sorted((r for r in rows if r["score"] < 1.0), key=lambda r: r["score"])
    if weak:
        result.say("")
        result.say("扣分的行，最差在前：")
        for row in weak[:12]:
            driver = min((s for s in row["subScores"] if s["blocking"]),
                         key=lambda s: s["score"], default=None)
            result.say("  %-4g %-24s %-20s %s" % (
                row["score"], row["l4"][:24], row["indicator"][:20],
                (driver or {}).get("note", "")[:60]))

    # Everything failing the same check is a statement about the INPUT, not about
    # the data. The classic case is scoring an aggregate — four subchecks then
    # cannot fail at all. The inverse is just as loud and just as easy to miss:
    # 18 of 18 series flunking one subcheck usually means one upstream fact is
    # wrong (a window nobody delivered against, an axis nobody populated), and
    # reading it row by row costs an afternoon.
    culprit = _shared_failure(rows)
    if culprit:
        result.say("")
        result.say("全部 %d 行都栽在同一个子项上：%s。" % (len(rows), culprit))
        result.say("  这通常是一条关于输入的陈述，不是关于数据的 —— 先去核对上游那个事实。")
    return result


def _shared_failure(rows: list[dict]) -> str:
    """The label of the one blocking subcheck every scored row failed, if there is one."""
    failed_by_row = [{s["label"] for s in row["subScores"] if s["blocking"] and s["score"] < 1.0}
                     for row in rows]
    if not failed_by_row or not all(failed_by_row):
        return ""
    shared = set.intersection(*failed_by_row)
    return "、".join(sorted(shared)) if shared else ""


@tool("quality.consistency", "quality",
      "维度一致性 / 时间一致性 / 口径一致性 —— 一致性维度的三个子项。",
      out_default="data/derived/quality-consistency.json")
def quality_consistency(ctx) -> Result:
    return _dimension_run(ctx, "consistency")


@tool("quality.accuracy", "quality",
      "数值准确性 / 业务准确性 —— 准确性维度的两个子项。",
      out_default="data/derived/quality-accuracy.json")
def quality_accuracy(ctx) -> Result:
    return _dimension_run(ctx, "accuracy")


@tool("quality.completeness", "quality",
      "字段完整性 / 数据完整性 —— 完整性维度的两个子项。",
      out_default="data/derived/quality-completeness.json")
def quality_completeness(ctx) -> Result:
    return _dimension_run(ctx, "completeness")


@tool("quality.granularity", "quality",
      "时间颗粒度 / 模型颗粒度 / 下钻颗粒度 —— 颗粒度维度的三个子项。",
      out_default="data/derived/quality-granularity.json")
def quality_granularity(ctx) -> Result:
    return _dimension_run(ctx, "granularity")


def _sub(s) -> dict:
    """One subcheck, with every field the deliverable has to carry.

    `computed` is in here on purpose. It is the bit that separates "checked and
    fine" from "could not check", and it used to be dropped between the scorer and
    the payload — so the two subchecks that are hardcoded to 1 arrived looking
    exactly like a pass, on a sheet somebody signs.
    """
    return {"key": s.key, "dimension": s.dimension, "label": s.label,
            "score": s.score, "note": s.note,
            "computed": s.computed, "blocking": s.blocking}


# ── the rollup ──────────────────────────────────────────────────────────────


@tool("quality.scorecard", "quality",
      "把四个维度的结果卷成总分：四维相乘，>=0.5 验收 / (0,0.5) 交人 / =0 弃用。",
      out_default="data/derived/quality-evidence.json")
def quality_scorecard(ctx) -> Result:
    result = Result()
    st = ctx.state
    try:
        universe, _evidence, _contexts = build_universe(st)
    except Exception as error:  # noqa: BLE001
        result.ok = False
        return result.find(str(error))

    parts, missing = {}, []
    for dimension, (_tool, path, label) in DIMENSION_TOOLS.items():
        data = U.read_payload(ctx.workspace / path)
        if data is None:
            missing.append("%s（%s）" % (label, path))
            continue
        parts[dimension] = data
    if missing:
        result.ok = False
        return result.find("先把四个维度都跑一遍，还缺：%s" % "、".join(missing))

    stale = [DIMENSION_TOOLS[d][2] for d, data in parts.items()
             if str(data.get("signature") or "") != universe.signature()]
    if stale:
        result.ok = False
        return result.find(
            "%s 的结果是在另一版因子树或另一份数据上算的 —— 四个维度重新跑一遍。"
            "混着卷积出来的评分表内部自洽、但每个数都错，读的时候看不出来" % "、".join(stale))

    by_id: dict[str, dict[str, dict]] = {}
    for dimension, data in parts.items():
        for row in data.get("rows") or []:
            by_id.setdefault(str(row.get("id")), {})[dimension] = row

    rows = []
    for row in universe.rows:
        head = row.head()
        if row.data_status != SCORED:
            # No scores at all — not zeros. A zero says "we looked and it cannot
            # be used"; these rows were never looked at, and the distinction
            # decides whose desk the row lands on.
            rows.append({**head, "consistency": None, "accuracy": None,
                         "completeness": None, "granularity": None,
                         "consistencyNote": "", "accuracyNote": "",
                         "completenessNote": "", "granularityNote": "",
                         "subScores": [], "total": None,
                         "autoVerdict": row.data_status})
            continue
        found = by_id.get(row.id, {})
        subs = [q.SubScore(**{**s, "score": float(s["score"])})
                for dimension in DIMENSIONS
                for s in (found.get(dimension) or {}).get("subScores", [])]
        rolled = q.roll_up_quality(subs)
        rows.append({
            **head,
            "consistency": rolled.consistency, "accuracy": rolled.accuracy,
            "completeness": rolled.completeness, "granularity": rolled.granularity,
            # The narrative behind each dimension score: the weakest blocking
            # subcheck's own words. Transcribing a scorecard is not supposed to
            # involve working out which subcheck capped which dimension.
            "consistencyNote": rolled.dimension_note("consistency"),
            "accuracyNote": rolled.dimension_note("accuracy"),
            "completenessNote": rolled.dimension_note("completeness"),
            "granularityNote": rolled.dimension_note("granularity"),
            "subScores": [_sub(s) for s in subs],
            "total": rolled.total, "autoVerdict": rolled.verdict,
        })

    raised = q.escalations([r for r in rows if r["dataStatus"] == SCORED])
    raised += q.no_data_escalations(rows)
    counts = universe.counts()
    verdicts: dict[str, int] = {}
    for row in rows:
        verdicts[row["autoVerdict"]] = verdicts.get(row["autoVerdict"], 0) + 1

    result.payload = {
        "rows": rows,
        "signature": universe.signature(),
        "counts": counts,
        "inheritedDrops": universe.inherited,
        "orphanCount": len(universe.orphans),
        "orphans": universe.orphans,
        "escalations": sorted(raised, key=lambda e: (e["l1"], e["l2"], e["l3"], e["l4"])),
    }

    result.say("因子树 %d 行 · %d 行已打分 · %d 行没有数据 · %d 行上游已否" % (
        len(rows), counts[SCORED], counts[NO_DATA], counts[INHERITED]))
    result.say("判读：%s" % " · ".join(
        "%d %s" % (v, k) for k, v in sorted(verdicts.items())))
    if universe.orphans:
        result.say("另有 %d 个指标数据里有、因子树没要过（孤儿，不进这张表）：%s"
                   % (len(universe.orphans), "、".join(universe.orphans[:4])))

    borderline = sorted((r for r in rows if r["autoVerdict"] in ("borderline", "unusable")),
                        key=lambda r: r["total"])
    if borderline:
        result.say("")
        result.say("需要你决定的行，最差在前：")
        for row in borderline[:12]:
            weak = [d for d in DIMENSIONS if (row[d] or 0) < 1.0]
            result.say("  %-6.4g %-24s %-20s 弱在：%s" % (
                row["total"], row["l4"][:24], row["indicator"][:20],
                "、".join(weak) or "-"))
    if counts[NO_DATA]:
        result.say("")
        result.say("%d 行是「树上要了、一条数据都没到」——它们不是 0 分。"
                   "0 分找数据 Owner，没数据回数据需求追交付。" % counts[NO_DATA])
    if raised:
        result.say("")
        result.say("预警：这些因子在模型里将没有任何东西代表它")
        for item in raised[:6]:
            result.say("  %-24s %s → %s" % (
                item["l4"][:24], "、".join(item["indicators"])[:36], item["routeTo"]))
    result.say("")
    result.say("总分是四个维度相乘，一个维度不合格总分就是零。")
    result.say(">=0.5 验收 · 0 与 0.5 之间交你决定 · =0 弃用并预警。")
    return result
