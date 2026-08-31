"""因子树工作簿 —— 把 `artifacts/s1/factor-tree.yaml` 摆成四张表。

**这是因子树给人看的唯一形态。** 逐行确认就在这份 Excel 上做，所以它必须带着做判断
需要的全部东西：每行的理由与出处、还没裁决的行单列一张表、以及相对基线增删了多少。

这里一行判断也不做：采纳还是剔除、哪个是主指标，都是因子树那个交付物早就定下的，
这个文件只负责把它们摆整齐。看到的数不对，就去改因子树，不要改这里。

工作簿带一个 `sourceHash` 自定义属性，记住它是照哪一版因子树生成的。`workbook_current`
谓词据此判断这份 Excel 有没有过期——一份过期的评审表比没有表更危险。
"""
from __future__ import annotations

import os
import sys

import engagement as eng
import xlsx

from .. import layout

TOOL = "workbook.factor-tree"
DELIVERABLE = "factor-tree"
SOURCE_REL = "artifacts/s1/factor-tree.yaml"
DEFAULT_OUT = "artifacts/s1/factor-tree.xlsx"

#: 还没有被人裁决的状态。它们出现在「待裁决」表上，也是确认关卡过不去的原因。
UNDECIDED = ("baseline", "proposed")

TEXT = {
    "zh": {
        "deliverable": "因子树",
        "title": "因子树",
        "sheet_rows": "因子树",
        "sheet_undecided": "待裁决",
        "sheet_stats": "统计",
        "columns": ["L1", "L2", "L3", "L4", "指标", "是否主指标", "聚合方式", "状态", "来源",
                    "理由", "证据/出处", "最细颗粒度"],
        "primary": "主指标", "alternate": "备选",
        "status": {"accepted": "采纳", "rejected": "剔除", "proposed": "待裁决",
                   "baseline": "基线未裁决", "unsure": "待裁决"},
        "source": {"template": "知识库召回", "ai": "模型先验", "websearch": "网络检索",
                   "report": "客户材料", "upload": "客户上传", "interview": "访谈",
                   "manual": "人工补充", "data_upload": "数据上传"},
        "aggregation": {"sum": "求和", "average": "平均", "weighted_average": "加权平均",
                        "min": "最小值", "max": "最大值", "count": "计数",
                        "distinct_count": "去重计数"},
        "group_levels": "层级", "group_status": "状态", "group_source": "来源",
        "group_role": "角色", "group_primary": "主指标", "group_delta": "增删幅度",
        "group_aggregation": "聚合方式",
        "level_l1": "L1 个数", "level_l2": "L2 个数", "level_l3": "L3 个数",
        "level_l4": "L4 个数", "level_rows": "指标行数",
        "role_driver": "驱动因子", "role_response": "响应变量",
        "delta_baseline": "基线 L4 个数", "delta_added": "新增 L4",
        "delta_removed": "剔除 L4", "delta_ratio": "相对基线比例",
        "delta_threshold": "参考幅度上限", "delta_exceeds": "是否超出参考幅度",
        "empty": "因子树里一行也没有。先让因子树交付物产出内容，再生成工作簿。",
        "empty_undecided": "没有待裁决的行——每一行都已经采纳或剔除。",
        "baseline_line": "本次起底方式：%(baseline)s · 行业召回：%(recall)s",
        "notes": [
            ("L1 / L2", "骨架层，锁定；要改必须先知道代价（数据需求分册重排、跨项目不可比）", "每行一个", "因子树交付物，人明确拍板才动"),
            ("L3 / L4", "在骨架下推导出的因子分类", "每行一个", "因子树交付物"),
            ("指标", "这一行实际要拿到的那个数", "每行一个", "因子树交付物"),
            ("是否主指标", "同一个 L4 只有一个主指标，其余是备选口径", "每个 L4 一个主指标", "因子树交付物，需人工确认"),
            ("聚合方式", "往上滚（周→月、省→大区）的时候怎么合并。比例、份额、指数取平均，花费、销量求和——对比例类求和会造出一个没有意义的数", "每行一个", "因子树交付物，需人工确认"),
            ("状态", "采纳 / 剔除 / 待裁决。待裁决的行不能进下一步", "每行一个", "人工逐行裁定"),
            ("来源", "这一行的依据是哪一类：知识库召回 / 网络检索 / 模型先验 / 客户材料 / 客户上传 / 访谈", "每行一个", "因子树交付物"),
            ("理由", "为什么留下或为什么剔除；没有理由的行不算被判过", "每行一个", "因子树交付物"),
            ("证据/出处", "依据落在哪里：知识库包与行、网页 URL 与访问日期、材料页码、访谈原话", "每行一个", "因子树交付物"),
            ("最细颗粒度", "这个指标最细能拆到什么维度，决定数据请求怎么问", "每行一个", "因子树交付物"),
        ],
        "tail": [
            "「来源」是模型先验的行没有外部出处，确认时要重点看。",
            "本表由因子树自动生成，不要在这里改内容——下次生成会覆盖掉。",
            "要改因子、指标或状态，请回到因子树交付物，改完重新生成。",
        ],
    },
    "en": {
        "deliverable": "Factor tree",
        "title": "Factor tree",
        "sheet_rows": "Factor tree",
        "sheet_undecided": "Undecided",
        "sheet_stats": "Statistics",
        "columns": ["L1", "L2", "L3", "L4", "Indicator", "Primary", "Aggregation", "Status", "Source",
                    "Rationale", "Evidence", "Finest grain"],
        "primary": "primary", "alternate": "alternate",
        "status": {"accepted": "accepted", "rejected": "rejected", "proposed": "undecided",
                   "baseline": "baseline, undecided", "unsure": "undecided"},
        "source": {"template": "knowledge base", "ai": "model prior", "websearch": "web search",
                   "report": "client material", "upload": "client upload",
                   "interview": "interview", "manual": "added by hand",
                   "data_upload": "data upload"},
        "aggregation": {"sum": "sum", "average": "average", "weighted_average": "weighted average",
                        "min": "min", "max": "max", "count": "count",
                        "distinct_count": "distinct count"},
        "group_levels": "Levels", "group_status": "Status", "group_source": "Source",
        "group_role": "Role", "group_primary": "Primary", "group_delta": "Delta",
        "group_aggregation": "Aggregation",
        "level_l1": "distinct L1", "level_l2": "distinct L2", "level_l3": "distinct L3",
        "level_l4": "distinct L4", "level_rows": "indicator rows",
        "role_driver": "driver", "role_response": "response",
        "delta_baseline": "baseline L4", "delta_added": "L4 added",
        "delta_removed": "L4 removed", "delta_ratio": "ratio vs baseline",
        "delta_threshold": "reference ceiling", "delta_exceeds": "over the reference band",
        "empty": "The factor tree has no rows yet. Build the deliverable first.",
        "empty_undecided": "Nothing undecided — every row is accepted or rejected.",
        "baseline_line": "Baseline: %(baseline)s · industry recall: %(recall)s",
        "notes": [
            ("L1 / L2", "The skeleton, locked; changing it reshuffles the data-request workbooks and breaks cross-project comparability", "one per row", "factor-tree deliverable, only on an explicit human call"),
            ("L3 / L4", "Factor classes derived under the skeleton", "one per row", "factor-tree deliverable"),
            ("Indicator", "The number this row actually asks for", "one per row", "factor-tree deliverable"),
            ("Primary", "Exactly one primary per L4; the rest are alternates", "one primary per L4", "factor-tree deliverable, confirmed by a human"),
            ("Aggregation", "How the indicator rolls up (week→month, province→region). Rates, shares and indices average; spend and volume sum — summing a rate manufactures a number that means nothing", "one per row", "factor-tree deliverable, confirmed by a human"),
            ("Status", "accepted / rejected / undecided; undecided blocks the next step", "one per row", "ruled row by row"),
            ("Source", "Which kind of ground this row stands on: knowledge base / web search / model prior / client material / client upload / interview", "one per row", "factor-tree deliverable"),
            ("Rationale", "Why it stayed or went; a row without one was never judged", "one per row", "factor-tree deliverable"),
            ("Evidence", "Where the ground actually is: pack and row, URL and date read, page number, quoted words", "one per row", "factor-tree deliverable"),
            ("Finest grain", "How deep this indicator can be split; it drives the data request", "one per row", "factor-tree deliverable"),
        ],
        "tail": [
            "Rows sourced from a model prior have no external citation — read those closely.",
            "This workbook is generated. Editing it here is lost on the next build.",
            "Change the factor tree deliverable instead, then generate again.",
        ],
    },
}

_COLUMN_WIDTHS = [14, 16, 18, 18, 34, 12, 14, 12, 14, 48, 40, 24]


def default_out(_root, _options):
    return DEFAULT_OUT


def run(root, out, language, options):
    words = TEXT.get(language, TEXT["zh"])
    source = os.path.join(root, SOURCE_REL)
    if not os.path.isfile(source):
        raise FileNotFoundError(
            "%s 不在——因子树还没产出，工作簿没有内容可摆。" % SOURCE_REL)
    meta, rows = eng.load_tree(root)
    undecided = [row for row in rows if row.get("status") in UNDECIDED]

    note = layout.caption(language, words["deliverable"], [SOURCE_REL])
    sheets = [
        layout.sheet(words["sheet_rows"], words["title"], note, words["columns"],
                     [_row(row, words) for row in rows],
                     widths=_COLUMN_WIDTHS,
                     empty_reason=layout.empty_reason(language, words["empty"])),
        # 待裁决单列一张表。因子树那张表保持树的顺序——把待裁决的行抽到顶上，
        # 人就再也读不出这棵树的形状了，而形状正是他要判断的东西。
        layout.sheet(words["sheet_undecided"], words["title"], note, words["columns"],
                     [_row(row, words) for row in undecided],
                     widths=_COLUMN_WIDTHS,
                     empty_reason=layout.empty_reason(language, words["empty_undecided"])),
        layout.stats_sheet(words["sheet_stats"], words["title"], note, language,
                           _stats(rows, meta, words, language),
                           empty_reason=layout.empty_reason(language, words["empty"])),
        layout.notes_sheet(language, words["title"], note, words["notes"],
                           tail=[_baseline_line(meta, words)] + list(words["tail"])),
    ]
    xlsx.write_workbook(out, sheets, properties={"sourceHash": _source_hash(source)})

    lines = ["%s · %d 行" % (layout.relative(root, out), len(rows))]
    if undecided:
        lines.append("其中 %d 行待裁决，见「%s」表" % (len(undecided), words["sheet_undecided"]))
    if not rows:
        lines.append(words["empty"])
    return out, [], lines


def _source_hash(path):
    """因子树内容的指纹。实现在 `layout.source_hash`，评分卡工作簿用的是同一个。"""
    return layout.source_hash(path)


def _baseline_line(meta, words):
    return words["baseline_line"] % {
        "baseline": meta.get("baselineChoice") or "—",
        "recall": meta.get("knowledgeRecall") or "none",
    }


def _row(row, words):
    primary = row.get("primary")
    if primary is None:
        mark = "—"
    else:
        mark = words["primary"] if primary else words["alternate"]
    status = str(row.get("status", ""))
    source = str(row.get("source", ""))
    aggregation = str(row.get("aggregation", ""))
    return [
        row.get("l1", ""), row.get("l2", ""), row.get("l3", ""), row.get("l4", ""),
        row.get("indicator", ""), mark,
        words["aggregation"].get(aggregation, aggregation or "—"),
        words["status"].get(status, status),
        words["source"].get(source, source),
        str(row.get("rationale") or ""),
        str(row.get("evidence") or ""),
        row.get("dimension", ""),
    ]


def _stats(rows, meta, words, language):
    """各层级计数、采纳与剔除、按来源分布、增删幅度——都是数出来的，没有推断。"""
    if not rows:
        return []
    entries = []
    for label, key in ((words["level_l1"], "l1"), (words["level_l2"], "l2"),
                       (words["level_l3"], "l3"), (words["level_l4"], "l4")):
        distinct = {_path(row, key) for row in rows if row.get(key)}
        entries.append([words["group_levels"], label, len(distinct)])
    entries.append([words["group_levels"], words["level_rows"], len(rows)])

    for status, count in _tally(rows, "status"):
        entries.append([words["group_status"], words["status"].get(status, status), count])
    for source, count in _tally(rows, "source"):
        entries.append([words["group_source"], words["source"].get(source, source), count])
    # 聚合方式的分布：一眼看出"20 行求和"里有没有混进比例类。
    for method, count in _tally(rows, "aggregation"):
        entries.append([words["group_aggregation"],
                        words["aggregation"].get(method, method), count])

    drivers = sum(1 for row in rows if row.get("role") != "response")
    responses = len(rows) - drivers
    entries.append([words["group_role"], words["role_driver"], drivers])
    entries.append([words["group_role"], words["role_response"], responses])

    entries.append([words["group_primary"], words["primary"],
                    sum(1 for row in rows if row.get("primary") is True)])
    entries.append([words["group_primary"], words["alternate"],
                    sum(1 for row in rows if row.get("primary") is False)])
    entries.extend(_delta(meta, words, language))
    return entries


def _delta(meta, words, language):
    """`meta.delta` 原样摆出来。确认时要报的那一行数字，就在这里。

    因子树没算这一块时不编——空着比编一个 0 诚实，而编出来的 0 会被读成"没有增删"。
    """
    delta = meta.get("delta")
    if not isinstance(delta, dict) or not delta:
        return []
    group = words["group_delta"]
    ratio = delta.get("ratio")
    return [
        [group, words["delta_baseline"], delta.get("baselineL4", 0)],
        [group, words["delta_added"], delta.get("added", 0)],
        [group, words["delta_removed"], delta.get("removed", 0)],
        [group, words["delta_ratio"], _percent(ratio)],
        [group, words["delta_threshold"], _percent(delta.get("threshold"))],
        [group, words["delta_exceeds"], layout.flag(language, delta.get("exceeds"))],
    ]


def _percent(value):
    try:
        return "%.1f%%" % (float(value) * 100)
    except (TypeError, ValueError):
        return "—"


def _path(row, key):
    """L3 的"两个不同分支下的同名节点"是两个节点，所以按全路径去重。"""
    order = ["l1", "l2", "l3", "l4"]
    return " / ".join(str(row.get(level, "")) for level in order[:order.index(key) + 1])


def _tally(rows, key):
    counts = {}
    for row in rows:
        value = str(row.get(key, "") or "—")
        counts[value] = counts.get(value, 0) + 1
    return sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))
