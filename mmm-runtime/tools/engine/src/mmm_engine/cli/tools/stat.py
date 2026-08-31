"""统计检验 — three test tools plus the rollup that combines them.

Three tests, each 0 / 0.5 / 1, and Total is their **product**: one failing test
zeroes it. Total >= 0.5 accepts, anything between 0 and 0.5 goes to a human, 0 is
unusable.

    stat.cv        → data/derived/stat-volatility.json     波动性
    stat.pearson   → data/derived/stat-correlation.json    相关性（读 KPI）
    stat.vif       → data/derived/stat-collinearity.json   共线性（读上一份）
    stat.scorecard → data/derived/stat-panel.json          三份卷成总分

`stat.vif` genuinely depends on `stat.pearson`: the design matrix it measures each
indicator against is the most Y-correlated dozen. Reading that from the correlation
payload makes the dependency visible in the run record, instead of hiding a second
— possibly different — Pearson run inside the collinearity step.

**Rows come from the factor tree**, same as the quality scorecard, carrying the same
`dataStatus` (`scored` / `no-data` / `inherited-drop`). A row with no data has
**null statistics, not zeros** — and for VIF that distinction is load-bearing in the
opposite direction from everywhere else: 1.0 is the GOOD end of the VIF scale, so a
defaulted 1.0 would read as "no collinearity" for a series nobody ever screened.

Two properties of the panel are load-bearing and easy to lose:

* **One row per indicator.** An indicator is measured once, across every
  channel × product at the same time, on `n_objects × n_months` observations —
  more evidence than any single cell has for the question actually being asked.
* **YoY differencing runs *within* each object**, never down the stack. Differencing
  a column that concatenates MT then TT then EC computes one meaningless difference
  at every boundary.

Indicators an earlier layer rejected are listed but never screened. That is not
tidiness: VIF is computed across the whole set at once, so a dead indicator's
collinearity would inflate the VIF of the ones still in play.
"""
from __future__ import annotations

from mmm_engine.cli.registry import Result, tool
from mmm_engine.scoring import rules as data_rules
from mmm_engine.scoring import statistical as S
from mmm_engine.scoring import universe as U
from mmm_engine.scoring.universe import INHERITED, NO_DATA, SCORED

CORRELATION_PAYLOAD = "data/derived/stat-correlation.json"

#: test → (payload path, Chinese label, the statistic's own field name)
TESTS: dict[str, tuple[str, str, str]] = {
    "cv": ("data/derived/stat-volatility.json", "波动性", "cv"),
    "pearson": (CORRELATION_PAYLOAD, "相关性", "pearson"),
    "vif": ("data/derived/stat-collinearity.json", "共线性", "vif"),
}


def _prepare(ctx, label: str):
    """(universe, panel) or a Result explaining why there is nothing to screen."""
    st = ctx.state
    universe = U.build(st, "statistical", prefix="s")
    panel = S.build_panel(st, universe)
    if not panel.metas:
        result = Result()
        result.ok = False
        reason = U.empty_reason(universe, "%s检验" % label)
        result.payload = {"rows": [], "reason": reason}
        return universe, panel, result.find(reason)
    return universe, panel, None


def _rows(universe, panel, by_col: dict, field: str) -> list[dict]:
    """One payload row per SCORED universe row, carrying its own statistic."""
    out = []
    for row in universe.scored:
        col = panel.by_row.get(row.id)
        if col is None:
            continue
        out.append({**row.head(), field: round(float(by_col[col]), 4),
                    "months": panel.months_for(col)})
    return out


def _skipped(universe) -> dict:
    counts = universe.counts()
    return {NO_DATA: counts[NO_DATA], INHERITED: counts[INHERITED]}


@tool("stat.cv", "statistical",
      "波动性检验：序列缩放到 [0,1] 后的 方差/均值。不动的序列解释不了任何事。",
      out_default="data/derived/stat-volatility.json")
def stat_cv(ctx) -> Result:
    universe, panel, failed = _prepare(ctx, "波动性")
    if failed is not None:
        return failed
    result = Result()
    cvs = S.volatility(panel)
    rows = _rows(universe, panel, cvs, "cv")
    result.payload = {"test": "cv", "signature": universe.signature(), "rows": rows,
                      "panel": panel.scope, "months": panel.months,
                      "skipped": _skipped(universe), "orphanCount": len(universe.orphans)}

    bands = _tally(rows, "cv", data_rules._cv_band)
    result.say("波动性：%d 条序列 · %s" % (len(rows), bands))
    flat = sorted((r for r in rows if data_rules._cv_band(r["cv"]) == 0),
                  key=lambda r: r["cv"])
    if flat:
        result.say("")
        result.say("几乎不动的序列（CV ≤ 0.05，建议剔除或找替代数据）：")
        for row in flat[:12]:
            result.say("  %-8.4f %-24s %s" % (row["cv"], row["l4"][:24], row["indicator"][:24]))
        result.say("  把零说成生意的话：「这条序列 %d 个月几乎没动过」比「波动性 0 分」"
                   "更能让人行动。" % panel.months)
    return result


@tool("stat.pearson", "statistical",
      "相关性检验：因子与响应的有符号 Pearson r，跑在对象内同比差分上。",
      out_default=CORRELATION_PAYLOAD)
def stat_pearson(ctx) -> Result:
    universe, panel, failed = _prepare(ctx, "相关性")
    if failed is not None:
        return failed
    result = Result()
    rs, period_label = S.correlation(panel)
    rows = _rows(universe, panel, rs, "pearson")
    result.payload = {"test": "pearson", "signature": universe.signature(), "rows": rows,
                      "panel": panel.scope, "months": panel.months,
                      "detrend": period_label,
                      "skipped": _skipped(universe), "orphanCount": len(universe.orphans)}

    result.say("相关性：%d 条序列 · %s" % (
        len(rows), _tally(rows, "pearson", data_rules._pearson_band)))
    result.say("去趋势：%s" % period_label)
    if "too short to detrend" in period_label:
        result.say("  项目太短，差分之后剩不下几行，所以这一轮跑在原始水平上。")
        result.say("  原始水平上每个指标都和响应相关——它们共骑同一条季节趋势。产出里要说明。")
    weak = sorted((r for r in rows if data_rules._pearson_band(r["pearson"]) == 0),
                  key=lambda r: abs(r["pearson"]))
    if weak:
        result.say("")
        result.say("几乎与响应不相关（|r| < 0.1）：")
        for row in weak[:12]:
            result.say("  %-+8.4f %-24s %s" % (row["pearson"], row["l4"][:24],
                                               row["indicator"][:24]))
    return result


@tool("stat.vif", "statistical",
      "共线性检验：每个指标对着一个现实宽度的设计矩阵算方差膨胀因子。1 是好的那一端。",
      out_default="data/derived/stat-collinearity.json")
def stat_vif(ctx) -> Result:
    universe, panel, failed = _prepare(ctx, "共线性")
    if failed is not None:
        return failed
    result = Result()

    correlation = U.read_payload(ctx.workspace / CORRELATION_PAYLOAD)
    if correlation is None:
        result.ok = False
        return result.find("先跑一遍 stat.pearson —— 共线性要对着「与响应最相关的那一批」"
                           "构成的设计矩阵来算，没有相关性就没有那批")
    if str(correlation.get("signature") or "") != universe.signature():
        result.ok = False
        return result.find("相关性的结果是在另一版因子树或另一份数据上算的 —— 重跑一遍 "
                           "stat.pearson。用旧的相关性挑设计矩阵，算出来的共线性对着一个"
                           "并不存在的模型")

    by_row = {str(r.get("id")): float(r.get("pearson") or 0.0)
              for r in correlation.get("rows") or []}
    r_by_col = {panel.by_row[row_id]: value for row_id, value in by_row.items()
                if row_id in panel.by_row}
    out = S.collinearity(panel, r_by_col)
    rows = _rows(universe, panel, out["byCol"], "vif")
    for row in rows:
        row["severeCollinearity"] = row["vif"] >= S.SEVERE_VIF
    result.payload = {"test": "vif", "signature": universe.signature(), "rows": rows,
                      "panel": panel.scope, "months": panel.months,
                      "vifDesign": "each against a %d-driver design" % out["designCols"],
                      "vifRegime": out["regime"], "severeVif": S.SEVERE_VIF,
                      "skipped": _skipped(universe), "orphanCount": len(universe.orphans)}

    result.say("共线性：%d 条序列 · %s" % (
        len(rows), _tally(rows, "vif", data_rules._vif_band)))
    result.say("设计矩阵：%s（与建模驱动数上限同源）" % result.payload["vifDesign"])
    if out["regime"] == "pairwise-proxy":
        result.say("")
        result.say("规制 pairwise-proxy：变量数 ≥ 观测数，完整的多元共线性指标不存在。")
        result.say("  报出来的是「最共线的那一个同伴能解释这个指标多少」。")
        result.say("  **这句话要出现在给人看的那一页上**，不是只躺在字段里。")
    severe = sorted((r for r in rows if r["severeCollinearity"]),
                    key=lambda r: -r["vif"])
    if severe:
        result.say("")
        result.say("%d 条严重共线（VIF ≥ %.0f）——一律建议剔除，不论总分多高："
                   % (len(severe), S.SEVERE_VIF))
        for row in severe[:8]:
            result.say("  %-10.3f %-24s %s" % (row["vif"], row["l4"][:24],
                                               row["indicator"][:24]))
        result.say("  共线性说的是「这一组」：拿掉一个，其余每一个的值都会变。成组定，不逐行定。")
    return result


def _tally(rows: list[dict], field: str, band) -> str:
    counts: dict[float, int] = {}
    for row in rows:
        score = band(row[field])
        counts[score] = counts.get(score, 0) + 1
    return " · ".join("%d 个 %g 分" % (v, k) for k, v in sorted(counts.items()))


# ── the rollup ──────────────────────────────────────────────────────────────


@tool("stat.scorecard", "statistical",
      "把三项检验卷成总分：三项相乘，>=0.5 良好 / (0,0.5) 交人 / =0 不可用。",
      out_default="data/derived/stat-panel.json")
def stat_scorecard(ctx) -> Result:
    result = Result()
    st = ctx.state
    try:
        universe = U.build(st, "statistical", prefix="s")
        panel = S.build_panel(st, universe)
    except Exception as error:  # noqa: BLE001
        result.ok = False
        return result.find("建不出面板：%s" % error)

    parts, missing = {}, []
    for test, (path, label, _field) in TESTS.items():
        data = U.read_payload(ctx.workspace / path)
        if data is None:
            missing.append("%s（%s）" % (label, path))
            continue
        parts[test] = data
    if missing:
        result.ok = False
        return result.find("先把三项检验都跑一遍，还缺：%s" % "、".join(missing))

    stale = [TESTS[t][1] for t, data in parts.items()
             if str(data.get("signature") or "") != universe.signature()]
    if stale:
        result.ok = False
        return result.find(
            "%s 的结果是在另一版因子树或另一份数据上算的 —— 三项重新跑一遍。"
            "混着卷积出来的打分表内部自洽、但每个数都错，读的时候看不出来" % "、".join(stale))

    stats: dict[str, dict[str, float]] = {"cv": {}, "pearson": {}, "vif": {}}
    for test, data in parts.items():
        field = TESTS[test][2]
        for row in data.get("rows") or []:
            col = panel.by_row.get(str(row.get("id")))
            if col is not None:
                stats[test][col] = float(row.get(field) or 0.0)

    period_label = str(parts["pearson"].get("detrend") or "")
    vif_out = {"byCol": stats["vif"],
               "designCols": min(S.SCREEN_DESIGN_COLS, max(len(panel.cols), 1)),
               "regime": str(parts["vif"].get("vifRegime") or "exact")}
    rows = S.compose_rows(universe, panel, stats["cv"], stats["pearson"], stats["vif"])

    card = S.StatScorecard(rows=[r for r in rows if r.data_status == SCORED])
    alerts = S.factor_alerts(card)
    payload_rows = [_row(r) for r in rows]
    counts = universe.counts()
    result.payload = {
        "panel": S.panel_summary(panel, period_label, vif_out),
        "rows": payload_rows,
        "counts": counts,
        "factorAlerts": alerts,
        "signature": universe.signature(),
        "inheritedDrops": universe.inherited,
        "orphanCount": len(universe.orphans),
        "orphans": universe.orphans,
    }

    verdicts: dict[str, int] = {}
    for row in payload_rows:
        verdicts[row["autoVerdict"]] = verdicts.get(row["autoVerdict"], 0) + 1
    result.say("因子树 %d 行 · %d 行已检验 · %d 行没有数据 · %d 行上游已否" % (
        len(rows), counts[SCORED], counts[NO_DATA], counts[INHERITED]))
    result.say("判读：%s" % " · ".join("%d %s" % (v, k) for k, v in sorted(verdicts.items())))
    if universe.orphans:
        result.say("另有 %d 个指标数据里有、因子树没要过（孤儿，不进这张表）"
                   % len(universe.orphans))

    weak = [r for r in payload_rows if r["total"] is not None and r["total"] < 1.0]
    if weak:
        result.say("")
        result.say("需要你决定的行，最差在前：")
        result.say("  %-6s %-24s %-20s %-9s %-9s %s"
                   % ("total", "l4", "指标", "cv", "pearson", "vif"))
        for row in sorted(weak, key=lambda r: r["total"])[:12]:
            result.say("  %-6.4g %-24s %-20s %-9s %-9s %s" % (
                row["total"], str(row["l4"])[:24], str(row["indicator"])[:20],
                _fmt(row["cv"]), _fmt(row["pearson"]), _fmt(row["vif"])))
    severe = [r for r in payload_rows if r.get("severeCollinearity")]
    if severe:
        result.say("")
        result.say("%d 条严重共线（VIF ≥ %.0f）——一律建议剔除，不论总分多高。"
                   % (len(severe), S.SEVERE_VIF))
    if counts[NO_DATA]:
        result.say("")
        result.say("%d 行是「树上要了、一条数据都没到」——它们没有统计量，不是 0 分。"
                   % counts[NO_DATA])
    if alerts:
        result.say("")
        result.say("%d 个因子的全部候选指标都不达标 —— 预警，回业务理解找替代指标："
                   % len(alerts))
        for alert in alerts[:8]:
            result.say("    %-24s %s" % (str(alert.get("l4"))[:24],
                                         "、".join(alert.get("indicators") or [])))
    regime = str(result.payload["panel"].get("vifRegime", ""))
    if regime == "pairwise-proxy":
        result.say("")
        result.say("变量数 ≥ 观测数：这里的共线性是两两近似值，不是完整的多元指标。")
        result.say("  产出里要直说这一点。")
    result.say("")
    result.say("总分是三项相乘，一项不合格总分就是零。")
    result.say(">=0.5 良好 · 0 与 0.5 之间交你决定 · =0 不可用。")
    return result


def _row(row) -> dict:
    out = {}
    for name in ("id", "object", "data_status", "l1", "l2", "l3", "l4", "indicator",
                 "cv", "pearson", "vif", "cv_score", "pearson_score", "vif_score",
                 "total", "severe_collinearity", "zero_reason", "auto_verdict",
                 "disposition", "rationale", "note"):
        if hasattr(row, name):
            out[_camel(name)] = getattr(row, name)
    if hasattr(row, "tree_row_id"):
        out["treeRowId"] = row.tree_row_id
    return out


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


def _fmt(value) -> str:
    if value is None:
        return "—"
    try:
        return "%.3f" % float(value)
    except (TypeError, ValueError):
        return str(value)
