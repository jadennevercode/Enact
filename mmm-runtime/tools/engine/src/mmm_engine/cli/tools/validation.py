"""2.3 — business validation: the panel, the facts, the answers, the anomalies.

One card per `L1›L2›L3` factor path. On each card the response is the backdrop —
a filled area on the right axis — and the factor's own indicators ride over it:
spending as a line, everything else as bars, both on the left axis. Sales and
drivers do not share a scale because they do not share a unit, and the axis the
eye reads first belongs to the drivers, because that is what the card is about.

**`validation.panel` ships the numbers; the page folds them.** That is the shape
this file took after architecture D10. The alternative — pre-aggregating every
combination of grain × brand × channel × region × source × drill-down path ×
indicator subset — is the same arithmetic performed a million times and shipped
pre-baked. So the panel narrows the long table to what the cards need, stamps
every metric with the aggregation **the factor tree declares for it** — falling
back to the register and then to the name classifier, and saying which of the
three answered — and the page reduces. What the page may never do is *decide*:
which rows are in scope, which metric sums and which averages, which metric is the
response, and what counts as an anomaly are all settled here.

`shared/fold-contract.md` is the contract the two implementations share.
`mmm_engine/charts/fold.py` is this side of it.
"""
from __future__ import annotations

import json
import math

import pandas as pd

from mmm_engine import dataset
from mmm_engine.assemble.indicator_metadata import classify_indicator, indicator_key
from mmm_engine.charts import fold as F
from mmm_engine.charts import foldcheck as FC
from mmm_engine.charts import validation as V
from mmm_engine.cli.registry import Arg, Result, tool
from mmm_engine.domain import overrides as OV
from mmm_engine.selection import ledger as L

#: A response year-on-year swing this large, by channel, is what the client is
#: asked to explain. The threshold is the platform's and it is deliberately a
#: round business number rather than a statistic: the people ruling on these
#: cards talk in percentages, and a card nobody can restate is a card nobody rules.
ANOMALY_PCT = 40.0

#: How many capsules the page shows. Past eight the row stops being a summary.
ANOMALY_TOP = 8

#: The identity of one cell of the panel. `channel` is in the key but is not a
#: filter: keeping it here means two channels under one channel type stay two
#: records, so a rate metric averages across them cell by cell instead of
#: averaging an average.
KEY_COLS = ("brand", "channel_type", "channel", "province_group", "source",
            "l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "metric")

#: Long-table column ↔ the name the payload and the page use.
DIM_COLUMN = {"brand": "brand", "channelType": "channel_type",
              "region": "province_group", "source": "source",
              "l4": "l4", "l5": "l5", "l6": "l6", "l7": "l7", "l8": "l8",
              "metric": "metric"}

#: More cells than this and the payload stops being a page and starts being a
#: download. Failing names the dimension that exploded; an empty success at
#: twenty megabytes would not.
MAX_CELLS = 4000

#: How many indicators a card draws when nobody has chosen. Six is the readable
#: ceiling on one pair of axes and it is below the eight-slot palette cap.
DEFAULT_METRICS = 6

PANEL_REL = "data/derived/validation-panel.json"
FOLDCHECK_REL = "data/derived/validation-foldcheck.json"
ANALYSES_REL = "data/derived/chart-analyses.json"


# ── the panel ────────────────────────────────────────────────────────

@tool("validation.panel", "validation",
      "Narrow the long table to the factor cards, stamped with each metric's own "
      "aggregation, unit and mark.",
      args=[Arg("--max-cells", "refuse to build a panel larger than this many "
                               "cells (default %d)" % MAX_CELLS)],
      out_default=PANEL_REL)
def validation_panel(ctx) -> Result:
    result = Result()
    st = ctx.state
    try:
        df = dataset.model_df(st)
    except Exception as error:  # noqa: BLE001
        result.ok = False
        return result.find(str(error))

    df = df.copy()
    df["month"] = pd.to_numeric(df["month"], errors="coerce")
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["month", "value"])
    for column in KEY_COLS:
        if column not in df.columns:
            df[column] = ""
        df[column] = df[column].fillna("").astype(str).str.strip()

    response_metric, error = _resolve_response(df, st)
    if error:
        result.ok = False
        result.payload = {"cards": [], "series": [], "reason": error}
        return result.find(error)

    periods = sorted({int(m) for m in df["month"].unique()})
    drops = L.drops_before(st, "signoff")
    meta, meta_notes = _metric_meta(st, df, response_metric)

    is_response = df["metric"].astype(str) == response_metric
    drivers = df[~is_response]
    kept = []
    for (l4, metric), _group in drivers.groupby(["l4", "metric"], dropna=False):
        if drops and L._matches(L._norm_pair(l4, metric), drops):
            continue
        kept.append((str(l4), str(metric)))
    kept_keys = set(kept)
    dropped_count = len(set(drivers.groupby(["l4", "metric"]).groups)) - len(kept_keys)
    drivers = drivers[[(str(a), str(b)) in kept_keys
                       for a, b in zip(drivers["l4"], drivers["metric"])]]
    if drivers.empty:
        result.ok = False
        result.payload = {"cards": [], "series": [],
                          "reason": "每一个因子都已经被更早的层否掉了，这里没有可画的东西"}
        return result.find("no factor reached business validation — all were "
                           "rejected by an earlier layer")

    cards, card_of_row = _cards(drivers)
    tables = _dictionaries(df, cards)

    cells, dupes = _cells(drivers, meta, periods)
    limit = int(ctx.opt("max_cells") or MAX_CELLS)
    if len(cells) > limit:
        biggest = _widest_dimension(drivers)
        result.ok = False
        result.payload = {"cards": [], "series": [],
                          "reason": "这份数据会摊成 %d 条曲线，超过 %d 条的上限"
                                    % (len(cells), limit)}
        return result.find("panel would carry %d cells, over the %d cap — %s is the "
                           "dimension that exploded (%d distinct values)"
                           % (len(cells), limit, biggest[0], biggest[1]))

    series = _encode(cells, tables, cards, card_of_row)
    response_cells, _ = _cells(df[is_response], meta, periods)
    response_series = _encode(response_cells, tables, cards, card_of_row,
                              response=True)

    for card in cards:
        card["defaultMetrics"] = _default_metrics(card, series, tables)

    panel = {
        "grain": "month",
        "periods": periods,
        "grains": [],
        "dict": tables,
        "cards": cards,
        "series": series,
        "responseSeries": response_series,
        "response": {"metric": response_metric, "present": True,
                     "meta": meta.get(response_metric) or {}},
        "metricMeta": meta,
        "notShown": _not_shown(tables),
        "dropped": {"count": dropped_count,
                    "why": "更早的层已经否掉，这里不画"},
        "ruleVersion": "panel/1",
    }
    panel["grains"] = F.grains_for(panel, F.blank_state(panel))

    golden, inline = FC.build(panel)
    panel["selfCheck"] = inline
    panel["checksum"] = FC.checksum(panel)

    ctx.path(FOLDCHECK_REL).parent.mkdir(parents=True, exist_ok=True)
    with open(ctx.path(FOLDCHECK_REL), "w", encoding="utf-8") as handle:
        json.dump({"ruleVersion": panel["ruleVersion"], "states": golden},
                  handle, ensure_ascii=False, sort_keys=True)
    result.also_wrote.append(FOLDCHECK_REL)

    result.payload = panel
    result.say("%d card(s) · %d cell(s) over %d period(s)"
               % (len(cards), len(series), len(periods)))
    result.say("response %s (%s), %d cell(s) behind it"
               % (response_metric, meta.get(response_metric, {}).get("aggSymbol", "Σ"),
                  len(response_series)))
    live = [g["label"] for g in panel["grains"] if g["supported"]]
    result.say("grains available: %s" % ("、".join(live) or "none"))
    result.say("%d golden state(s) written to %s; %d ride in the page"
               % (len(golden), FOLDCHECK_REL, len(inline)))
    if dropped_count:
        result.say("%d indicator(s) rejected upstream and not charted" % dropped_count)
    for note in meta_notes:
        result.find(note)
    if dupes:
        result.find("%d cell(s) had more than one row for the same month — folded "
                    "with the metric's own method, but a duplicate row is a data "
                    "problem worth naming" % dupes)
    for line in panel["notShown"]:
        result.find("%s —— %s" % (line["what"], line["why"]))
    return result


def _resolve_response(df, st):
    """The response is whatever carries `metric_type == "Y"`. Nothing else.

    No keyword guessing lives here and none may be added. The platform's version
    of this fell back to summing every metric in the table when it could not
    recognise a Y — renminbi, degrees Celsius and percentages added together — and
    then reported anomalies on the result. Every project that was not the
    reference case took that path.

    `overrides.resolved_y_metric` is deliberately *not* used: its second step is
    that same keyword pick. Only the explicit 2.1 tag is consulted, and only to
    disambiguate when the table carries more than one Y.
    """
    y_rows = df[df["metric_type"].astype(str).str.strip().str.upper() == "Y"]
    if y_rows.empty:
        return "", ("长表里没有任何一行的 metric_type 是 Y —— 没有响应变量就没有底图，"
                    "也不扫异常。去数据处理那一步把销量指标标成 KPI 角色，再回来")
    names = sorted({str(m) for m in y_rows["metric"].unique()})
    if len(names) == 1:
        return names[0], ""

    tagged = OV.resolved_y_key(st)
    if tagged:
        for name in names:
            hit = y_rows[y_rows["metric"].astype(str) == name]
            l4 = str(hit["l4"].iloc[0]) if not hit.empty else ""
            if indicator_key(l4, name) == tagged:
                return name, ""
    return "", ("长表里有 %d 条指标都标成了 Y：%s —— 响应变量只能有一条，"
                "去数据处理那一步指定用哪条，别在这里挑"
                % (len(names), "、".join(names)))


#: What the fold can actually do. The set is closed on purpose — that is what
#: makes the page's arithmetic replayable (`shared/fold-contract.md`).
FOLD_OPS = ("sum", "average", "min", "max")

#: The factor tree lets a human declare rules the fold has no operator for. They
#: are substituted here, in the tool, never in the page — and the substitution is
#: recorded so the reader sees it rather than discovering it.
AGG_SUBSTITUTE = {
    # 没有权重列就做不了加权平均。退到普通平均，不退到求和：对一个比例求和是
    # 看不见的错，取普通平均是看得见的近似。
    "weighted_average": ("average", "没有权重列，按普通平均近似"),
    # 计数跨切片、跨期都是相加。
    "count": ("sum", "计数按求和滚动"),
    # 去重计数跨切片相加会重复计算，但没有明细就还原不了。求和是上界，说出来。
    "distinct_count": ("sum", "去重计数按求和滚动，跨切片可能高估"),
}

#: 汇总口径的三个来源，从权威到推断。
AGG_SOURCE_LABEL = {
    "tree": "是因子树里人定的",
    "coverage": "来自指标登记表（那一列本身也是按名字推断出来的）",
    "classifier": "是按名字推断的",
    "conflict": "在两个因子下定得不一致",
}


def _tree_aggregations(st):
    """`indicator_key → aggregation`，取自因子树里已采纳的行。

    这是整条链路上**唯一由人定、且过了确认门**的汇总口径（见
    `p_aggregation_declared`）。指标登记表 `coverage.yaml` 看起来更靠近数据，
    但它那一列是 `classify_indicator` 按名字猜出来再存下来的
    （`dataeng/coverage.py:173`）—— 存过一遍的猜测还是猜测。
    """
    tree = getattr(st, "factor_tree", None)
    out = {}
    for row in (getattr(tree, "rows", None) or []):
        if str(getattr(row, "status", "")) != "accepted":
            continue
        rule = str(getattr(row, "aggregation", "") or "").strip()
        if rule:
            out[indicator_key(getattr(row, "l4", ""),
                              getattr(row, "indicator", ""))] = rule
    return out


def _metric_meta(st, df, response_metric):
    """Every metric's aggregation, unit, format and mark — and where each came from.

    Three sources, in this order:

    1. **the factor tree** — the one a human declared and a gate enforced. Whether
       a number sums or averages is a property of what the indicator *means*, so
       it belongs with the people who defined the indicator.
    2. **the indicator register** (`coverage.yaml`) — carries unit, currency and
       number format, which the tree does not. Its `aggregation` column is the
       classifier's output persisted at publish time, so it is a *guess with a
       filing cabinet*, and the payload says so rather than implying otherwise.
    3. **the name classifier** — live, for anything neither of the above covers.

    Getting the order wrong is not cosmetic. 温度 matches none of the classifier's
    patterns and falls through to `sum`; a summed temperature is meaningless and
    looks exactly like a summed spend on the chart. The tree is where somebody
    actually decided it averages.
    """
    from_tree = _tree_aggregations(st)
    registered = {}
    for record in (getattr(st, "indicator_coverage", None) or []):
        key = indicator_key(getattr(record, "l4", ""), getattr(record, "metric", ""))
        registered[key] = record

    notes, out = [], {}
    for l4, metric, metric_type in zip(df["l4"], df["metric"], df["metric_type"]):
        l4, metric = str(l4), str(metric)
        key = indicator_key(l4, metric)
        record = registered.get(key)

        if record is not None:
            block = {"unit": str(getattr(record, "unit", "") or ""),
                     "currency": str(getattr(record, "currency", "") or ""),
                     "numberFormat": str(getattr(record, "number_format", "") or "number"),
                     "semanticType": str(getattr(record, "semantic_type", "") or "other")}
            agg, source = str(getattr(record, "aggregation", "") or "sum"), "coverage"
        else:
            guess = classify_indicator(metric)
            block = {"unit": guess.unit or "", "currency": guess.currency or "",
                     "numberFormat": guess.fmt, "semanticType": guess.metric_type}
            agg = OV.resolve_aggregation(st, l4, metric) or guess.aggregation
            source = "classifier"

        # 因子树赢。它是唯一有人签过字的那一个。
        if key in from_tree:
            agg, source = from_tree[key], "tree"

        agg, substitution = _fold_op(agg)
        block.update({"agg": agg, "source": source})
        if substitution:
            declared, why = substitution
            block["aggNote"] = "%s → %s（%s）" % (declared, agg, why)
            # 一个指标说一次。这个循环走的是长表的每一行，不是每个指标。
            if metric not in out:
                notes.append("「%s」定的是 %s，本轮按 %s 处理 —— %s"
                             % (metric, declared, agg, why))
        block["aggSymbol"] = _agg_symbol(agg)
        block["role"] = _role(metric_type, metric == response_metric)
        block["axis"] = "right" if block["role"] == "area" else "left"

        if metric in out and out[metric]["agg"] != block["agg"]:
            # Two factors sharing a metric name but not a method. Averaging a sum
            # is visibly wrong; summing a rate is silently wrong, so the safe
            # resolution is the one the reader can see.
            notes.append("「%s」在不同因子下定了两种汇总方式（%s / %s）—— 本轮按取平均"
                         "处理并在页面上标出，回因子树统一它"
                         % (metric, out[metric]["agg"], block["agg"]))
            block["agg"] = "average"
            block["aggSymbol"] = _agg_symbol("average")
            block["source"] = "conflict"
        out[metric] = block

    by_source = {}
    for metric, block in out.items():
        by_source.setdefault(block["source"], []).append(metric)
    for source in ("classifier", "coverage"):
        names = sorted(by_source.get(source) or [])
        if not names:
            continue
        tail = "" if len(names) <= 6 else "…另有 %d 个" % (len(names) - 6)
        notes.append("%d 个指标的汇总方式%s，没有人在因子树里定过：%s%s —— "
                     "定错的那个会被一路带到模型里，而图上看不出来"
                     % (len(names), AGG_SOURCE_LABEL[source],
                        "、".join(names[:6]), tail))
    return out, notes


def _fold_op(rule):
    """(能跑的算子, 替换说明)。替换在工具里做，页面的算子集保持封闭。"""
    rule = str(rule or "sum").strip()
    if rule in FOLD_OPS:
        return rule, None
    if rule in AGG_SUBSTITUTE:
        return AGG_SUBSTITUTE[rule][0], (rule, AGG_SUBSTITUTE[rule][1])
    return "sum", (rule, "不认识这个汇总方式，按求和处理")


def _agg_symbol(agg):
    return {"average": "avg", "min": "min", "max": "max"}.get(agg, "Σ")


def _role(metric_type, is_response):
    """Y = area, spending = line, everything else = bar. Fixed on purpose.

    A chart whose shape changes between runs is a chart nobody can compare month
    to month, and the same data in two shapes reads as two findings.
    """
    if is_response:
        return "area"
    kind = str(metric_type or "").strip().lower()
    return "line" if kind in ("spending", "spend") else "bar"


def _cards(drivers):
    """One card per `L1›L2›L3` path present in the data.

    The full path is the key, not the L3 name: two different parents can both
    carry a 「促销活动」 and they are two different things. The factor tree says
    what was asked for; the panel draws what arrived.
    """
    cards, index = [], {}
    paths = drivers[["l1", "l2", "l3"]].drop_duplicates()
    for l1, l2, l3 in sorted(zip(paths["l1"], paths["l2"], paths["l3"])):
        path = "›".join(str(x) for x in (l1, l2, l3))
        index[path] = len(cards)
        cards.append({"id": "c-%02d" % (len(cards) + 1),
                      "l1": str(l1), "l2": str(l2), "l3": str(l3),
                      "path": path, "metrics": [], "defaultMetrics": [],
                      "levels": {}})
    for card in cards:
        rows = drivers[(drivers["l1"] == card["l1"]) & (drivers["l2"] == card["l2"])
                       & (drivers["l3"] == card["l3"])]
        card["metrics"] = sorted({str(m) for m in rows["metric"].unique()})
        card["levels"] = {level: sorted({str(v) for v in rows[level].unique()
                                         if str(v).strip()})
                          for level in F.LEVELS}
    return cards, index


def _dictionaries(df, cards):
    tables = {}
    for name, column in DIM_COLUMN.items():
        values = sorted({str(v).strip() for v in df[column].dropna()
                         if str(v).strip()}) if column in df.columns else []
        tables[name] = values
    return tables


def _cells(frame, meta, periods):
    """One record per identity, values on the global month axis, gaps as `None`.

    Duplicated rows — the same identity twice in the same month — are folded with
    that metric's own method and counted, because a duplicate is a data problem
    and a silently doubled number is the worst way to learn about one.
    """
    if frame.empty:
        return [], 0
    keys = list(KEY_COLS)
    grouped = frame.groupby(keys + ["month"], dropna=False)["value"]
    sizes = grouped.size()
    dupes = int((sizes > 1).sum())
    sums, means = grouped.sum(), grouped.mean()

    slot = {month: i for i, month in enumerate(periods)}
    records = {}
    for key, total in sums.items():
        identity, month = key[:-1], int(key[-1])
        metric = identity[keys.index("metric")]
        how = (meta.get(str(metric)) or {}).get("agg", "sum")
        value = float(means[key] if how == "average" else total)
        record = records.get(identity)
        if record is None:
            record = records[identity] = [None] * len(periods)
        position = slot.get(month)
        if position is not None:
            record[position] = round(value, 6)
    return [(identity, values) for identity, values in
            sorted(records.items(), key=lambda pair: [str(x) for x in pair[0]])], dupes


def _encode(cells, tables, cards, card_of_row, response=False):
    """Dictionary-encode the identities. `-1` is a blank cell on that column.

    Series-major rather than row-major: one record per identity with its values
    aligned to the shared axis. It is four times smaller than the row-major form
    for a real engagement, and it makes "a gap is a gap" structural — an absent
    month is a `None` in a fixed position, not a row that simply is not there.
    """
    keys = list(KEY_COLS)

    def code(column, value):
        table = tables.get(column) or []
        value = str(value).strip()
        try:
            return table.index(value)
        except ValueError:
            return -1

    out = []
    for identity, values in cells:
        fields = dict(zip(keys, identity))
        path = "›".join(str(fields[level]) for level in ("l1", "l2", "l3"))
        record = {
            "c": -1 if response else card_of_row.get(path, -1),
            "b": code("brand", fields["brand"]),
            "ct": code("channelType", fields["channel_type"]),
            "r": code("region", fields["province_group"]),
            "s": code("source", fields["source"]),
            "m": code("metric", fields["metric"]),
            "v": values,
        }
        for level in F.LEVELS:
            record[level] = code(level, fields[level])
        if not response and record["c"] < 0:
            continue
        out.append(record)
    return out


def _default_metrics(card, series, tables):
    """The card's six heaviest indicators by absolute total.

    Six because the chart has to stay readable and the palette caps at eight. This
    is the one control where an empty choice means a default rather than "no
    filter", and the value is computed once here so neither host has to invent it.
    """
    names = tables.get("metric") or []
    weight = {}
    for record in series:
        if record.get("c", -1) < 0:
            continue
        code = record.get("m", -1)
        metric = names[code] if 0 <= code < len(names) else ""
        if metric not in card["metrics"]:
            continue
        total = sum(abs(float(v)) for v in (record.get("v") or []) if v is not None)
        weight[metric] = weight.get(metric, 0.0) + total
    ranked = sorted(weight.items(), key=lambda pair: (-pair[1], pair[0]))
    return [metric for metric, _w in ranked[:DEFAULT_METRICS]]


def _not_shown(tables):
    """Dimensions that exist but cannot be filtered on, said out loud.

    A control that quietly is not there is the thing the client asks about in the
    meeting. A greyed one with a reason is an answer.
    """
    out = []
    for name, label in (("brand", "品牌"), ("channelType", "渠道"),
                        ("region", "区域"), ("source", "数据来源")):
        values = tables.get(name) or []
        if len(values) <= 1:
            out.append({"what": name,
                        "why": "只有 %d 个取值（%s）—— 按钮置灰，不删"
                               % (len(values), "、".join(values) or "一个都没有")})
    return out


def _widest_dimension(frame):
    widest = ("", 0)
    for column in KEY_COLS:
        if column in frame.columns:
            count = int(frame[column].nunique())
            if count > widest[1]:
                widest = (column, count)
    return widest


# ── the facts the narration must quote ───────────────────────────────

@tool("validation.facts", "validation",
      "Reduce each card to the numbers its written reading is allowed to quote.",
      out_default="data/derived/validation-facts.json")
def validation_facts(ctx) -> Result:
    result = Result()
    panel = _read_panel(ctx)
    if panel is None:
        result.ok = False
        return result.find("%s is not there — run validation.panel first" % PANEL_REL)

    facts = []
    for card in (panel.get("cards") or []):
        state = F.blank_state(panel, card["path"])
        folded = F.fold(panel, state)
        block = {
            "card": card["path"], "id": card["id"],
            "l1": card["l1"], "l2": card["l2"], "l3": card["l3"],
            "grain": "month",
            "periods": folded["periods"],
            "periodCount": len(folded["periods"]),
            "responseMetric": folded["responseMetric"],
            "response": _reading(folded["periods"], folded["response"], None,
                                 (panel.get("response") or {}).get("meta") or {}),
            "drivers": [],
            "yearly": F.yearly(panel, state, 0),
        }
        for metric, series in sorted(folded["series"].items()):
            meta = (panel.get("metricMeta") or {}).get(metric) or {}
            block["drivers"].append(dict(
                _reading(folded["periods"], series["v"], folded["response"], meta),
                metric=metric, agg=series["agg"]))
        facts.append(block)

    empty = [f for f in facts if not f["periods"]]
    if empty:
        result.ok = False
        result.payload = {"facts": facts}
        return result.find("%d card(s) reduced to an empty block — there is nothing "
                           "to narrate on them and nothing may be written about them"
                           % len(empty))

    result.payload = {"facts": facts, "narrationStandard": V.NARRATION_STANDARD}
    result.say("%d card(s) reduced to facts" % len(facts))
    result.say("")
    result.say("Narrate from these. Every number in the deliverable must be one of")
    result.say("them, quoted — not recomputed, not rounded differently, not estimated.")
    return result


def _reading(periods, values, response, meta):
    """First, last, peak, trough, the biggest single move, the longest run, the
    gaps, and the correlation. One implementation, used by facts and by read.

    There used to be two of these with different field names, different rounding
    and different ideas of how long a run has to be before it counts. Two answers
    to "what did this series do" is one too many.
    """
    seen = [(p, v) for p, v in zip(periods, values) if v is not None]
    block = {"unit": str(meta.get("unit") or ""),
             "numberFormat": str(meta.get("numberFormat") or "number"),
             "aggSymbol": str(meta.get("aggSymbol") or "Σ"),
             "observedPeriods": len(seen),
             "missingPeriods": len(periods) - len(seen)}
    if not seen:
        block["note"] = "这条曲线在这个视角下一个观测值都没有"
        return block

    first, last = seen[0], seen[-1]
    peak = max(seen, key=lambda pair: pair[1])
    trough = min(seen, key=lambda pair: pair[1])
    block.update({
        "first": {"period": first[0], "value": round(first[1], 4)},
        "last": {"period": last[0], "value": round(last[1], 4)},
        "peak": {"period": peak[0], "value": round(peak[1], 4)},
        "trough": {"period": trough[0], "value": round(trough[1], 4)},
        "gaps": [p for p, v in zip(periods, values) if v is None],
    })
    if first[1]:
        block["changeFirstToLastPct"] = round(
            (last[1] - first[1]) / abs(first[1]) * 100.0, 1)

    move = None
    for i in range(1, len(seen)):
        delta = seen[i][1] - seen[i - 1][1]
        if move is None or abs(delta) > abs(move["delta"]):
            move = {"from": seen[i - 1][0], "to": seen[i][0],
                    "delta": round(delta, 4),
                    "deltaPct": (round(delta / abs(seen[i - 1][1]) * 100.0, 1)
                                 if seen[i - 1][1] else None)}
    if move:
        block["largestMove"] = move

    run = _longest_run(seen)
    if run:
        block["longestRun"] = run
    if response is not None:
        block["correlationWithResponse"] = _pearson(values, response)
    return block


def _longest_run(seen):
    best, current, direction = None, 1, 0
    for i in range(1, len(seen)):
        step = seen[i][1] - seen[i - 1][1]
        way = 1 if step > 0 else (-1 if step < 0 else 0)
        if way and way == direction:
            current += 1
        else:
            current, direction = (2 if way else 1), way
        if way and current >= 3 and (best is None or current > best[0]):
            best = (current, seen[i - current + 1][0], seen[i][0], direction)
    if not best:
        return None
    return {"direction": "rising" if best[3] > 0 else "falling",
            "from": best[1], "to": best[2], "periods": best[0]}


def _pearson(a, b):
    pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(pairs) < 3:
        return None
    n = float(len(pairs))
    mean_a = sum(x for x, _ in pairs) / n
    mean_b = sum(y for _, y in pairs) / n
    saa = sum((x - mean_a) ** 2 for x, _ in pairs)
    sbb = sum((y - mean_b) ** 2 for _, y in pairs)
    if saa <= 0 or sbb <= 0:
        return None
    sab = sum((x - mean_a) * (y - mean_b) for x, y in pairs)
    return round(sab / math.sqrt(saa * sbb), 3)


# ── one analysis slot per card ───────────────────────────────────────

@tool("validation.analyses", "validation",
      "One analysis slot per card, pre-filled with the computed readout and "
      "stamped so a written one can be checked against it.",
      out_default=ANALYSES_REL)
def validation_analyses(ctx) -> Result:
    result = Result()
    panel = _read_panel(ctx)
    if panel is None:
        result.ok = False
        return result.find("%s is not there — run validation.panel first" % PANEL_REL)

    language = _output_language(ctx)
    slots = []
    for card in (panel.get("cards") or []):
        state = F.blank_state(panel, card["path"])
        folded = F.fold(panel, state)
        res = V.series_response(panel, card, folded)
        query = {"card": card["path"], "l3": card.get("l3") or "", "grain": "month"}
        record = V.read_chart(res, query, now="")
        slot = record.model_dump(by_alias=True)
        # The periods this card actually has. The gate uses it to refuse an
        # analysis that quotes a month the card never plotted — the one class of
        # invented number a machine can catch in prose.
        slot["periods"] = list(folded["periods"])
        slots.append(slot)

    result.payload = {"ruleVersion": "analyses/1", "language": language,
                      "standard": V.narration_standard(language), "slots": slots}
    result.say("%d analysis slot(s), one per card" % len(slots))
    result.say("")
    result.say("Each is a computed readout. Write over it in "
               "artifacts/s2/chart-analyses.yaml, matching on `card` and copying")
    result.say("`key` / `filterLabel` / `seriesDigest` verbatim. A card nobody "
               "writes keeps the readout — no card is ever blank.")
    result.say("")
    for line in V.narration_standard(language).splitlines():
        if line.strip():
            result.say(line)
    return result


def _output_language(ctx):
    """The project's language, from `mmm.yaml`. Controls stay English; prose does not."""
    path = ctx.path("mmm.yaml")
    if not path.is_file():
        return "en"
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("outputLanguage:"):
            return line.split(":", 1)[1].strip().strip('"\'') or "en"
    return "en"


# ── reading one curve back, under the filters that drew it ───────────

@tool("validation.read", "validation",
      "Read one card back under a filter state — the numbers behind what is on "
      "screen, so a spoken answer and the page cannot disagree.",
      args=[Arg("--card", "the card's L1›L2›L3 path; a uniquely-matching fragment "
                          "also works"),
            Arg("--grain", "month | quarter | half | year (default month)"),
            Arg("--brand", "comma-separated; empty means every brand"),
            Arg("--channel", "comma-separated channel types"),
            Arg("--region", "comma-separated province groups"),
            Arg("--source", "comma-separated data sources — overlay only, the "
                            "response backdrop does not move"),
            Arg("--level", "drill-down as l5=抖音,l6=头部达人"),
            Arg("--indicator", "comma-separated; empty means the card's default six"),
            Arg("--compare-month", "1-12 to compare the same month year on year, "
                                   "0 for the full year"),
            Arg("--list", "print the card paths and stop", takes_value=False)],
      out_default="data/derived/validation-read.json")
def validation_read(ctx) -> Result:
    result = Result()
    panel = _read_panel(ctx)
    if panel is None:
        result.ok = False
        return result.find("%s is not there — run validation.panel first" % PANEL_REL)

    paths = [c["path"] for c in (panel.get("cards") or [])]
    wanted = str(ctx.opt("card") or "").strip()
    if ctx.opt("list") or not wanted:
        result.payload = {"cards": paths}
        for path in paths[:40]:
            result.say(path)
        if len(paths) > 40:
            result.say("… %d more" % (len(paths) - 40))
        if not wanted and not ctx.opt("list"):
            result.ok = False
            result.find("say which card with --card <path>")
        return result

    hits = [p for p in paths if p == wanted] or [p for p in paths if wanted in p]
    if not hits:
        result.ok = False
        result.payload = {"reason": "no card matches %r" % wanted, "cards": paths}
        return result.find("no card matches %r — run with --list" % wanted)
    if len(hits) > 1:
        result.ok = False
        result.payload = {"reason": "ambiguous", "matches": hits}
        for path in hits[:8]:
            result.say(path)
        return result.find("%r matches %d cards — say which" % (wanted, len(hits)))

    state = _state_from_args(ctx, panel, hits[0])
    grain, fell_back = F.resolve_grain(panel, state)
    state["grain"] = grain
    folded = F.fold(panel, state)
    compare = int(ctx.opt("compare_month") or 0)

    readings = []
    for metric, series in sorted(folded["series"].items()):
        meta = (panel.get("metricMeta") or {}).get(metric) or {}
        readings.append(dict(_reading(folded["periods"], series["v"],
                                      folded["response"], meta),
                             metric=metric, agg=series["agg"]))
    result.payload = {
        "card": hits[0], "state": state, "stateKey": F.state_key(state),
        "grain": grain, "fellBackFrom": fell_back,
        "responseMetric": folded["responseMetric"],
        "response": _reading(folded["periods"], folded["response"], None,
                             (panel.get("response") or {}).get("meta") or {}),
        "drivers": readings,
        "partial": folded["partial"],
        "droppedBlankRows": folded["dropped"],
        "yearly": F.yearly(panel, state, compare),
    }

    result.say("%s · %s · %d 期" % (hits[0], grain, len(folded["periods"])))
    if fell_back:
        result.say("按%s（选了「%s」，这一片撑不起那个颗粒度）" % (grain, fell_back))
    for reading in readings:
        _say_reading(result, reading)
    if folded["dropped"]:
        result.find("%d 条全国口径的曲线被这次筛选排除了 —— 它们没有渠道 / 区域标记，"
                    "图上只会显得线变短了" % folded["dropped"])
    if folded["partial"]:
        result.find("%d 个时间桶没有铺满（%s）—— 图上打了斜纹，求和类指标在这些桶上会偏低"
                    % (len(folded["partial"]),
                       "、".join(sorted(folded["partial"])[:4])))
    return result


def _say_reading(result, reading):
    metric = reading.get("metric") or ""
    if reading.get("note"):
        result.say("%s —— %s" % (metric, reading["note"]))
        return
    first, last = reading["first"], reading["last"]
    line = "%s（%s） 首末 %s → %s" % (metric, reading.get("aggSymbol", "Σ"),
                                     first["value"], last["value"])
    if reading.get("changeFirstToLastPct") is not None:
        line += "（%+.2f%%）" % reading["changeFirstToLastPct"]
    result.say(line)
    result.say("  最高 %s 在 %s · 最低 %s 在 %s"
               % (reading["peak"]["value"], reading["peak"]["period"],
                  reading["trough"]["value"], reading["trough"]["period"]))
    if reading.get("correlationWithResponse") is not None:
        result.say("  与同一片响应的相关系数 %s" % reading["correlationWithResponse"])
    if reading.get("gaps"):
        result.say("  缺 %d 期：%s" % (len(reading["gaps"]),
                                       "、".join(str(g) for g in reading["gaps"][:6])))


def _state_from_args(ctx, panel, card):
    def listed(flag):
        return [v.strip() for v in str(ctx.opt(flag) or "").split(",") if v.strip()]

    levels = {level: "" for level in F.LEVELS}
    for pair in listed("level"):
        if "=" in pair:
            name, value = pair.split("=", 1)
            if name.strip() in levels:
                levels[name.strip()] = value.strip()
    return {"card": card, "grain": str(ctx.opt("grain") or "month").strip(),
            "brand": listed("brand"), "channelType": listed("channel"),
            "region": listed("region"), "source": listed("source"),
            "levels": levels, "indicators": listed("indicator"),
            "compareMonth": int(ctx.opt("compare_month") or 0)}


# ── the anomaly capsules ─────────────────────────────────────────────

@tool("validation.anomalies", "validation",
      "The response's year-on-year swings by channel, past the threshold the "
      "client is asked to explain.",
      args=[Arg("--pct", "how big a year-on-year swing has to be, in percent "
                         "(default %g)" % ANOMALY_PCT)],
      out_default="data/derived/anomalies.json")
def validation_anomalies(ctx) -> Result:
    result = Result()
    panel = _read_panel(ctx)
    if panel is None:
        result.ok = False
        return result.find("%s is not there — run validation.panel first" % PANEL_REL)

    info = panel.get("response") or {}
    if not info.get("present"):
        result.payload = {"cards": [], "rule": {"pct": ANOMALY_PCT},
                          "reason": "没有响应变量，本轮不报异常"}
        result.say("0 anomalies — there is no response variable to scan")
        return result.find("没有响应变量，一条异常都不报 —— 去数据处理那一步把销量指标"
                           "标成 KPI 角色。绝不会退化成把整张表加起来")

    threshold = float(ctx.opt("pct") or ANOMALY_PCT)
    how = "average" if str((info.get("meta") or {}).get("agg")) == "average" else "sum"
    periods = [int(p) for p in (panel.get("periods") or [])]
    channels = (panel.get("dict") or {}).get("channelType") or []

    cards = []
    for index, channel in enumerate(channels):
        by_year = _response_by_year(panel, periods, index, how)
        years = sorted(by_year)
        for i in range(1, len(years)):
            this, last = years[i], years[i - 1]
            if this - last != 1:
                continue
            now, before, note, span = _comparable(by_year[this], by_year[last], how)
            if before in (None, 0) or now is None:
                continue
            move = (now - before) / abs(before) * 100.0
            if abs(move) <= threshold:
                continue
            cards.append({
                "id": "an-%s-%d" % (_slug(channel), this),
                "channel": channel, "year": str(this),
                "growthPct": round(move, 2),
                "hypothesis": "", "proposed": "event", "rationale": "", "tradeoff": "",
                "status": "pending", "handling": "event", "note": "",
                "start": this * 100 + 1, "end": this * 100 + 12,
                "evidence": {"metric": info.get("metric", ""), "agg": how,
                             "thisYear": round(now, 3), "lastYear": round(before, 3),
                             "comparedMonths": span["months"],
                             "comparedSlices": span["slices"],
                             "comparedCells": span["cells"],
                             "windowNote": note},
            })

    cards.sort(key=lambda c: -abs(c["growthPct"]))
    cards = cards[:ANOMALY_TOP]
    result.payload = {"cards": cards,
                      "rule": {"pct": threshold, "basis": "response year on year, "
                                                          "by channel"}}
    if not cards:
        result.say("0 anomalies — no channel moved more than %g%% year on year"
                   % threshold)
        result.say("That is an answer, not a gap.")
        return result
    result.say("%d anomaly capsule(s), largest first:" % len(cards))
    for card in cards:
        line = "  %s %s %+.1f%%" % (card["channel"], card["year"], card["growthPct"])
        if card["evidence"]["windowNote"]:
            line += "  (%s)" % card["evidence"]["windowNote"]
        result.say(line)
    result.say("")
    result.say("Each needs a hypothesis and a ruling. Only an accepted card bites:")
    result.say("event adds a control over the window, cap winsorises the response")
    result.say("there, raw rides as a caveat. A pending card does nothing at all.")
    return result


def _response_by_year(panel, periods, channel_code, how):
    """The response for one channel, per year, keyed by month *and by identity*.

    National-grain rows carry no channel type and are shared into every channel —
    the same rule the model objects use. A channel's response is its own rows plus
    the ones nobody assigned.

    The identity is kept, not summed away, because the comparison downstream has
    to know *what* it is comparing and not only how much.
    """
    slot = {month: i for i, month in enumerate(periods)}
    years = {}
    for record in (panel.get("responseSeries") or []):
        code = record.get("ct", -1)
        if code >= 0 and code != channel_code:
            continue
        identity = (record.get("b", -1), record.get("ct", -1), record.get("r", -1))
        values = record.get("v") or []
        for month, i in slot.items():
            if i < len(values) and values[i] is not None:
                years.setdefault(month // 100, {})[(month % 100, identity)] = values[i]
    return years


def _comparable(this_year, last_year, how):
    """Compare like with like, or say that you could not.

    Two ways a year-on-year number gets manufactured out of nothing, and both are
    closed here:

    * **the calendar** — a part year against a full one. A 2026 with six months of
      data is not down fifty percent on 2025.
    * **the composition** — a region or a brand that only started reporting this
      year. Every channel's total jumps, nothing about the business changed, and
      the resulting capsule sends the client looking for a cause that is not there.

    Both are handled the same way: intersect, compare, and say what was set aside.
    Silently including the new region would be a false alarm; silently dropping it
    without a word would hide a real expansion. So it is dropped *and named*.
    """
    # The intersection is on **cells**, not on the month set and the slice set
    # taken separately. A region that reports one month of last year and eleven of
    # this one is present in both years' slice sets and in both years' month sets,
    # and would survive two independent intersections while contributing eleven
    # months to one side and none to the other. That inflates every channel it
    # touches, and the capsule sends the client hunting for a cause that is a
    # reporting calendar.
    shared = set(this_year) & set(last_year)
    months = sorted({m for m, _who in shared})
    who = {w for _m, w in shared}

    notes = []
    dropped_months = ({m for m, _w in this_year} ^ {m for m, _w in last_year})
    dropped_who = ({w for _m, w in this_year} ^ {w for _m, w in last_year})
    if dropped_months:
        notes.append("两年覆盖的月份不一样，已按共同的 %d 个月对比" % len(months))
    if dropped_who:
        notes.append("两年的构成不一样（%d 个切片只在其中一年有数）" % len(dropped_who))
    thin = len(shared) < min(len(this_year), len(last_year))
    if thin and not dropped_months and not dropped_who:
        notes.append("两年有些切片的月份对不上，已按共同的 %d 个格子对比" % len(shared))

    span = {"months": len(months), "slices": len(who), "cells": len(shared)}
    if not shared:
        return None, None, "两年没有可比的共同部分，无法对比", span

    def total(year):
        return _fold_cells([value for key, value in year.items() if key in shared],
                           how)

    return total(this_year), total(last_year), "；".join(notes), span


def _fold_cells(cells, how):
    seen = [c for c in cells if c is not None]
    if not seen:
        return None
    total = 0.0
    for value in seen:
        total += float(value)
    return total if how == "sum" else total / float(len(seen))


def _slug(text):
    keep = [ch for ch in str(text).lower() if ch.isalnum()]
    return "".join(keep)[:12] or "x"


def _read_panel(ctx):
    path = ctx.path(PANEL_REL)
    if not path.is_file():
        return None
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)
