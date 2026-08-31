"""评分卡工作簿 —— 一份代码吃三种评分卡。

`artifacts/s2/quality-scorecard.yaml`、`stat-scorecard.yaml`、`ols-scorecard.yaml`
结构相近：一个 `meta` 加一串 `rows`，每行一个指标，带打分、系统建议和人工判定。
所以这里不针对某一种写死列名，而是按行里**实际有的字段**出表：认识的字段用中文表头
并按固定顺序排在前面，不认识的按出现顺序排在后面。

这个文件不打分、不重算、不补默认值。评分卡里是什么，表里就是什么。
"""
from __future__ import annotations

import os

import engagement as eng
import xlsx

from .. import layout

TOOL = "workbook.scorecard"
DELIVERABLE = "scorecard"

#: 简写 → 文件位置。给路径也行，给简写省事。
CARDS = {
    "quality": ("artifacts/s2/quality-scorecard.yaml", "data-quality", "数据质量评分"),
    "stat": ("artifacts/s2/stat-scorecard.yaml", "stat-screening", "统计检验"),
    "ols": ("artifacts/s2/ols-scorecard.yaml", "ols-test", "OLS 预验证"),
}

#: 认识的字段，以及它们该出现的顺序。评分卡里没有的字段不会出现在表里。
FIELD_ORDER = [
    "id", "object", "dataStatus", "l1", "l2", "l3", "l4", "indicator", "treeRowId",
    "consistency", "consistencyNote", "accuracy", "accuracyNote",
    "completeness", "completenessNote", "granularity", "granularityNote",
    "cv", "cvScore", "pearson", "pearsonScore", "vif", "vifScore",
    "severeCollinearity", "zeroReason", "value", "band", "rangeStatus",
    "total", "autoVerdict", "recommendation", "rationale", "disposition",
    "decidedBy", "note", "subScores",
    # 因子表（一因子一行，跨全部被采纳的运行）
    "cells", "inModelRate", "dominantSign", "signConsistency", "significanceRate",
    "contributionObserved", "roiObserved", "roiUnit", "roiBasis", "contributionBasis",
    "rangeSeverity", "rangeSource", "recommendationReason", "conditionalScope",
    "aiVerdict", "aiRationale",
    # 模型概况（一运行 × 一对象一行）
    "runId", "label", "yMetric", "nObs", "drivers", "r2", "adjR2", "mape",
    "durbinWatson", "baselinePct", "redFlags", "misfit", "misfitAction", "error",
]

#: 打分卡里表示「这一行没有分」的写法。空字符串会被读成 0 分那一栏没填，
#: 破折号读起来是「这里没有分」——这两件事在一张要签字的表上不能长得一样。
NOT_SCORED = "—"

#: 恒为 1 分但其实没查的子项，在表上要这么写。
UNVERIFIED = {"zh": "未校验", "en": "UNVERIFIED"}

FIELD_TEXT = {
    "zh": {
        "id": ("行号", "这一行在评分卡里的编号", "每行一个", "评分卡自动生成"),
        "object": ("建模对象", "这一行属于哪个渠道×产品组合", "每个建模对象一组", "评分卡自动生成"),
        "dataStatus": ("数据状态", "已打分 / 因子树要了但一条数据都没到 / 上游已判不做。"
                       "「没有数据」不是 0 分——0 分是查过了不能用，没有数据是还没到",
                       "每行一个", "自动判定"),
        "cells": ("入模次数", "这个因子在被采纳的运行里，一共出现在多少个（运行×对象）格子里",
                  "每个因子一个", "自动统计"),
        "inModelRate": ("入模率", "上一列占全部格子的比例", "每个因子一个", "自动统计"),
        "dominantSign": ("主导符号", "系数多数时候是正还是负", "每个因子一个", "自动统计"),
        "signConsistency": ("符号一致性", "主导符号占了多大比例。1 表示每个对象都同向；"
                            "低于 0.8 说明这个因子在不同渠道表现相反",
                            "每个因子一个", "自动统计"),
        "significanceRate": ("显著率", "|t| ≥ 2 的格子占比", "每个因子一个", "自动统计"),
        "contributionObserved": ("各处贡献度", "逐个（运行, 对象）列出，**不取平均**——"
                                 "全国模型的 8% 和某渠道的 15% 回答的是不同问题，平均没有意义",
                                 "每个格子一条", "从拟合结果逐字抄"),
        "roiObserved": ("各处投资回报", "同上，逐处列出不取平均", "每个格子一条", "从拟合结果逐字抄"),
        "roiUnit": ("投资回报单位", "money 货币比率 / volume-per-spend 销量每元。"
                    "不是货币时不做区间检查", "每个因子一个", "由响应口径与单价决定"),
        "roiBasis": ("分母口径", "借用了谁的花费序列做分母；自身即花费时留空",
                     "每个因子一个", "自动判定"),
        "contributionBasis": ("贡献度基准位", "对 0 还是对窗口内最小值算的",
                              "每个因子一个", "自动判定"),
        "rangeSeverity": ("区间灯色", "none 没有可比区间 / green 带内 / yellow 偏离<30% / "
                          "red 偏离≥30%。取这个因子在所有格子里最差的那一档",
                          "每个因子一个", "对照行业区间自动判定"),
        "rangeSource": ("区间来源", "这条带取自客户行业包还是参考库", "每个因子一个", "自动判定"),
        "recommendationReason": ("建议理由", "为什么给这个建议", "每个因子一个", "自动生成"),
        "conditionalScope": ("适用对象", "建议为「有条件入模」时，它在哪些对象上成立",
                             "每个因子一条", "需人补充"),
        "aiVerdict": ("判读", "consistent / questionable / implausible / noBenchmark",
                      "每个因子一个", "AI 判读，与算出来的状态并列，不取代它"),
        "aiRationale": ("判读理由", "≤30 词，只引用已算好的数", "每个因子一个", "AI 判读"),
        "runId": ("运行编号", "这一行出自哪一次拟合", "每行一个", "拟合时自动编号"),
        "label": ("模型对象", "给人看的名字", "每行一个", "自动生成"),
        "yMetric": ("响应指标", "这个模型在解释哪个数", "每个模型一个", "方案里定的"),
        "nObs": ("观测数", "这个模型用了多少个月", "每个模型一个", "自动统计"),
        "drivers": ("驱动数", "实际进模型的驱动变量个数", "每个模型一个", "自动统计"),
        "r2": ("拟合优度", "目标带 0.85–0.95", "每个模型一个", "计算得出"),
        "adjR2": ("调整拟合优度", "扣掉变量个数之后的拟合优度", "每个模型一个", "计算得出"),
        "mape": ("平均绝对百分误差", "目标带 5–15", "每个模型一个", "计算得出"),
        "durbinWatson": ("残差自相关", "目标带 1.5–2.5", "每个模型一个", "计算得出"),
        "baselinePct": ("基线占比", "控制项吸收掉的销量占比。基线 + 各驱动贡献 = 100%，"
                        "超过 100% 说明控制项吸收的比实际销量还多",
                        "每个模型一个", "计算得出"),
        "redFlags": ("红旗", "这个模型触发的告警，逐条抄计算结果", "每个模型若干条", "自动判定"),
        "misfit": ("拟合失配", "基线占比越界或付费驱动反号。**先减控制项重跑，不要先剔指标**",
                   "每个模型一个", "自动判定"),
        "misfitAction": ("失配处置", "失配时该做什么", "失配的模型才有", "自动生成"),
        "error": ("拟不出来的原因", "这个格子没能建出模型时写在这里", "拟不出来才有", "自动记录"),
        "l1": ("L1", "因子树的一级分类", "每行一个", "因子树带过来"),
        "l2": ("L2", "因子树的二级分类", "每行一个", "因子树带过来"),
        "l3": ("L3", "因子树的三级分类", "每行一个", "因子树带过来"),
        "l4": ("L4", "因子树的四级分类", "每行一个", "因子树带过来"),
        "indicator": ("指标", "被打分的那个数", "每行一个", "因子树带过来"),
        "treeRowId": ("因子树行号", "回指因子树的哪一行", "每行一个", "自动关联"),
        "consistency": ("一致性", "单位口径、时间粒度、数据源是否前后一致", "每个指标一个分", "计算得出"),
        "consistencyNote": ("一致性情况", "这个分是被哪个子项压住的，以及算出了什么数", "每行一句", "计算得出"),
        "accuracy": ("准确性", "数值本身是否可信，与外部口径是否对得上", "每个指标一个分", "计算得出"),
        "accuracyNote": ("准确性情况", "这个分是被哪个子项压住的，以及算出了什么数", "每行一句", "计算得出"),
        "completeness": ("完整性", "字段齐不齐，该有的月份缺了多少", "每个指标一个分", "计算得出"),
        "completenessNote": ("完整性情况", "这个分是被哪个子项压住的，以及算出了什么数", "每行一句", "计算得出"),
        "granularity": ("颗粒度", "能不能拆到合同约定的建模细度", "每个指标一个分", "计算得出"),
        "granularityNote": ("颗粒度情况", "这个分是被哪个子项压住的，以及算出了什么数", "每行一句", "计算得出"),
        "cv": ("波动性", "这条序列变化够不够，不变的解释不了任何事", "每个指标一个数", "计算得出"),
        "cvScore": ("波动性得分", "波动系数落在哪一档：0 / 0.5 / 1", "每个指标一个分", "计算得出"),
        "pearson": ("相关性", "与响应变量是否同向变动，带符号", "每个指标一个数", "计算得出"),
        "pearsonScore": ("相关性得分", "相关系数绝对值落在哪一档", "每个指标一个分", "计算得出"),
        "vif": ("共线性", "能不能与其他因子区分开。**1 是好的那一端，越大越糟**",
                "每个指标一个数", "计算得出"),
        "vifScore": ("共线性得分", "共线性落在哪一档", "每个指标一个分", "计算得出"),
        "severeCollinearity": ("严重共线", "共线性 ≥ 10。为真时一律建议剔除，不论总分多高",
                               "每行一个", "自动判定"),
        "zeroReason": ("零分原因", "总分为零时点名是哪一项挂的；观测月数不足时写明月数",
                       "每行一句", "计算得出"),
        "rationale": ("入模利弊", "只基于这一行自己的三个数的一句话，不含别处的数",
                      "每行一句", "AI 起草"),
        "value": ("拟合值", "模型跑出来的贡献度或投资回报", "每个建模对象每个因子一个", "计算得出"),
        "band": ("行业区间", "同行业同类因子的常见范围", "每个因子一个区间", "行业知识给出"),
        "rangeStatus": ("区间判定", "落在区间内 / 偏高 / 偏低 / 没有参照", "每行一个", "自动判定"),
        "total": ("总分", "各项相乘；任何一项不合格，总分就是零", "每行一个", "计算得出"),
        "autoVerdict": ("系统建议", "机器先给的处置建议，不是结论", "每行一个", "自动生成"),
        "recommendation": ("系统建议", "机器先给的处置建议，不是结论", "每行一个", "自动生成"),
        "disposition": ("人工判定", "人真正拍的板；空着就是还没定", "每行一个", "人工逐行裁定"),
        "decidedBy": ("判定人", "谁定的；标了人的行，重算不会覆盖它", "每行一个", "人工填写"),
        "note": ("备注", "判定的理由或例外说明", "每行一句", "人工填写"),
        "subScores": ("分项明细", "总分是怎么来的，逐个小项。标「未校验」的是没查，不是查过没问题",
                      "每行若干项", "计算得出"),
    },
}

TEXT = {
    "zh": {
        "sheet_rows": "评分卡",
        "sheet_stats": "统计",
        "group_rows": "行数", "item_rows": "指标行",
        "group_disposition": "人工判定", "group_auto": "系统建议",
        "group_total": "总分", "group_range": "区间判定", "group_decided": "判定人",
        "group_data": "数据状态",
        "undecided": "（未定）",
        "empty": "评分卡里一行也没有。空评分卡是个结论，不是通过——先看上一层是不是把指标全筛掉了。",
        "generic": ("评分卡自带字段", "每行一个", "评分卡产出方"),
        "tail": [
            "本表由评分卡自动生成，改这里不会改到评分卡。",
            "「人工判定」为空的行还没有人拍板，不能当成通过。",
            "分值栏里的「—」是这一行没有被打分（数据没到或上游已判不做），不是 0 分。",
            "分项明细里的「未校验」是这一项缺对照输入、没查过，不是查过没问题。",
        ],
    },
    "en": {
        "sheet_rows": "Scorecard",
        "sheet_stats": "Statistics",
        "group_rows": "Rows", "item_rows": "indicator rows",
        "group_disposition": "Disposition", "group_auto": "Recommendation",
        "group_total": "Total", "group_range": "Band", "group_decided": "Decided by",
        "group_data": "Data status",
        "undecided": "(undecided)",
        "empty": "The scorecard has no rows. An empty scorecard is a finding, not a pass.",
        "generic": ("A field the scorecard carries", "one per row", "whoever wrote the scorecard"),
        "tail": [
            "Generated from the scorecard; edits here do not reach it.",
            "A row with an empty disposition has not been ruled on.",
        ],
    },
}


def card_path(root, options):
    """--card 给简写或给路径都行。"""
    choice = str((options or {}).get("card") or "quality")
    if choice in CARDS:
        return CARDS[choice][0]
    if os.path.isabs(choice):
        return layout.relative(root, choice)
    return choice.replace(os.sep, "/")


def default_out(root, options):
    """The workbook lands beside the scorecard it was rendered from.

    Same habit as the factor tree's workbook, and for the same reason: this file is
    the review surface — it is what the gate names as its evidence and what a person
    signs — so it belongs with the deliverable, not in a scratch export folder.
    """
    rel = card_path(root, options)
    stem = os.path.splitext(os.path.basename(rel))[0] or "scorecard"
    folder = os.path.dirname(rel) or "exports"
    return "%s/%s.xlsx" % (folder, stem)


def run(root, out, language, options):
    words = TEXT.get(language, TEXT["zh"])
    labels = FIELD_TEXT.get(language, FIELD_TEXT["zh"])
    rel = card_path(root, options)
    source = os.path.join(root, rel)
    if not os.path.isfile(source):
        raise FileNotFoundError(
            "%s 不在——可选的评分卡有：%s，也可以直接给一个路径。"
            % (rel, "、".join(sorted(CARDS))))

    data = eng.read_yaml(source) or {}
    rows = [row for row in (data.get("rows") or []) if isinstance(row, dict)]
    owner, title = _identity(rel, data)

    fields = _fields(rows)
    header = [labels.get(field, (field,))[0] for field in fields]
    note = layout.caption(language, owner, [rel])

    # 因子表是客户真正审的那张：一因子一行，跨全部被采纳的运行。
    # 逐（对象 × 因子）的明细留在 rows 表里给要往下钻的人。
    extra = []
    for key, sheet_title in (("factors", "因子建议"), ("models", "模型概况")):
        block = [r for r in (data.get(key) or []) if isinstance(r, dict)]
        if not block:
            continue
        block_fields = _fields(block)
        extra.append(layout.sheet(
            sheet_title, "%s · %s" % (title, sheet_title), note,
            [labels.get(f, (f,))[0] for f in block_fields],
            [[_render_field(f, r, language) for f in block_fields] for r in block],
            widths=_widths(block_fields),
            empty_reason=layout.empty_reason(language, words["empty"])))

    sheets = [
        layout.sheet(words["sheet_rows"], title, note, header,
                     [[_render_field(field, row, language) for field in fields]
                      for row in rows],
                     widths=_widths(fields),
                     empty_reason=layout.empty_reason(language, words["empty"])),
        layout.stats_sheet(words["sheet_stats"], title, note, language,
                           _stats(rows, words),
                           empty_reason=layout.empty_reason(language, words["empty"])),
        layout.notes_sheet(language, title, note,
                           [_note_row(field, labels, words) for field in fields],
                           tail=words["tail"]),
    ]
    # 因子建议排在明细之前：客户先看结论，要往下钻再翻明细。
    sheets[1:1] = extra
    # Stamp which version of the scorecard this was rendered from. The workbook is
    # the review surface — the gate names it as its evidence and a person signs it —
    # so `workbook_current` has to be able to tell a stale one from a current one.
    xlsx.write_workbook(out, sheets,
                        properties={"sourceHash": layout.source_hash(source)})

    undecided = sum(1 for row in rows if not str(row.get("disposition", "")).strip())
    lines = ["%s · %d 行 · 未定 %d 行" % (layout.relative(root, out), len(rows), undecided)]
    if not rows:
        lines.append(words["empty"])
    return out, [], lines


def deliverable(root, options):
    """运行记录里的交付物 id —— 三种评分卡分属三个交付物，记成一个就查不清了。"""
    rel = card_path(root, options)
    for _key, (path, owner, _title) in CARDS.items():
        if path == rel:
            return owner
    return DELIVERABLE


def _identity(rel, data):
    """(写进说明行的名字, 标题)。两处都用业务叫法，不用交付物的英文 id。"""
    for _key, (path, _owner, title) in CARDS.items():
        if path == rel:
            return title, title
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    stem = os.path.splitext(os.path.basename(rel))[0]
    return str(meta.get("skill") or stem), stem


#: 一行都没有时也得有表头，否则那张表看起来像坏了而不是像空的。
FALLBACK_FIELDS = ["id", "l4", "indicator", "total", "disposition"]


def _fields(rows):
    """认识的字段按 FIELD_ORDER 排前面，不认识的按出现顺序排后面。"""
    if not rows:
        return list(FALLBACK_FIELDS)
    present = []
    for row in rows:
        for key in row:
            if key not in present:
                present.append(key)
    known = [field for field in FIELD_ORDER if field in present]
    return known + [field for field in present if field not in known]


def _widths(fields):
    wide = {"indicator": 34, "note": 48, "subScores": 48, "band": 18, "object": 20}
    return [wide.get(field) for field in fields]


#: 这些字段为空表示「这一行没有被打分」，而不是「这一格没填」。
_SCORE_FIELDS = ("consistency", "accuracy", "completeness", "granularity",
                 "total", "cv", "pearson", "vif", "cvScore", "pearsonScore",
                 "vifScore", "value")


def _render_field(field, row, language):
    """一格的内容。两处不能走通用渲染：

    **没有分的行。** dataStatus 是 no-data 或 inherited-drop 时四维分与总分是 null。
    渲染成空白，读起来像「这一格漏填了」；渲染成 0，读起来像「查过了，不能用」。
    两个都不对，所以写破折号。

    **分项明细里的未校验项。** 恒为 1 分的两个子项（维度一致性、业务准确性）
    在缺对照输入时 computed=false。照着分数渲染成 1，就把「没查」和「查了没问题」
    在一张要签字的表上抹平了。
    """
    value = row.get(field)
    if field in _SCORE_FIELDS and value is None:
        return NOT_SCORED
    if field == "subScores":
        return _render_subscores(value, language)
    return _render(value)


def _render_subscores(value, language):
    if not isinstance(value, list) or not value:
        return ""
    unverified = UNVERIFIED.get(language, UNVERIFIED["zh"])
    parts = []
    for item in value:
        if not isinstance(item, dict):
            parts.append(str(item))
            continue
        label = str(item.get("label") or item.get("key") or "")
        shown = unverified if item.get("computed") is False else "%g" % float(item.get("score") or 0)
        parts.append("%s %s" % (label, shown))
    return _clip("; ".join(parts))


def _render(value):
    """区间、分项这类嵌套值要摆得下、看得懂，而不是甩一段 JSON 出来。"""
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        if len(value) == 2 and all(isinstance(v, (int, float)) for v in value):
            return "%s ~ %s" % (value[0], value[1])
        return _clip("; ".join(_flatten(item) for item in value))
    if isinstance(value, dict):
        return _clip(_flatten(value))
    return _clip(str(value))


def _flatten(item):
    if isinstance(item, dict):
        return " ".join("%s=%s" % (key, item[key]) for key in item)
    return str(item)


def _clip(text, limit=240):
    return text if len(text) <= limit else text[:limit - 1] + "…"


def _stats(rows, words):
    if not rows:
        return []
    entries = [[words["group_rows"], words["item_rows"], len(rows)]]
    for group, key in ((words["group_data"], "dataStatus"),
                       (words["group_disposition"], "disposition"),
                       (words["group_auto"], "autoVerdict"),
                       (words["group_auto"], "recommendation"),
                       (words["group_range"], "rangeStatus"),
                       (words["group_total"], "total"),
                       (words["group_decided"], "decidedBy")):
        for value, count in _tally(rows, key, words):
            entries.append([group, value, count])
    return entries


def _tally(rows, key, words):
    if not any(key in row for row in rows):
        return []
    counts = {}
    for row in rows:
        value = row.get(key)
        label = words["undecided"] if value in (None, "") else str(value)
        counts[label] = counts.get(label, 0) + 1
    return sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))


def _note_row(field, labels, words):
    known = labels.get(field)
    if known:
        return [known[0], known[1], known[2], known[3]]
    return [field, words["generic"][0], words["generic"][1], words["generic"][2]]
