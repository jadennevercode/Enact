"""项目档案的 Word 版 —— 客户真正拿到手的那一份。

内容全部来自 `artifacts/s1/project-profile.yaml`。这个应用不算数、不判断、不补内容：
档案里没有的东西，这里就写"还没定"，不替它编一个。

固定取值的中文说法从 `shared/conventions.md §9` 那张表来（下面的 LABELS）。翻译只此一处，
因为存进 YAML 的是英文键：多一套译名就多一处对不上的地方。
"""
from __future__ import annotations

import os

import engagement as eng

TOOL = "report.project-profile"
DELIVERABLE = "project-profile"
OUT_REL = os.path.join("artifacts", "s1", "project-profile.docx")

#: conventions.md §9。轴名与颗粒度存英文，给客户看时才转中文。
LABELS = {
    "Brand": "品牌", "Channel": "渠道", "Geo": "地区",
    "Year": "年度", "Month": "月度", "Week": "周度",
    "uploaded": "来自客户提供的材料", "elicited": "由问答推导得出",
}

ADVISORY_LABELS = {"productLines": "产品线", "channels": "渠道", "geoGroups": "地区分组"}

UNSET = "还没定"


def label(value):
    return LABELS.get(str(value), str(value or UNSET))


SOURCE_REL = os.path.join("artifacts", "s1", "project-profile.yaml")


def documents(root):
    """[(source, out, model, notes)] —— 档案只有一份，所以这里永远只有一条。"""
    model, notes = build(root)
    return [(SOURCE_REL, OUT_REL, model, notes)]


def build(root):
    """(document model, notes). The model is what render_docx.js consumes."""
    path = os.path.join(root, SOURCE_REL)
    if not os.path.isfile(path):
        raise FileNotFoundError("artifacts/s1/project-profile.yaml 不存在 —— 先把档案写出来")
    data = eng.read_yaml(path) or {}
    profile = data.get("profile") or {}
    meta = data.get("meta") or {}

    blocks, notes = [], []
    blocks.append({"kind": "title", "text": "项目档案"})
    blocks.append({"kind": "note", "text": "%s · %s · 生成于 %s%s" % (
        profile.get("brand") or UNSET,
        "/".join(str((profile.get("industry") or {}).get(k) or "")
                 for k in ("l1", "l2", "l3")).strip("/") or UNSET,
        meta.get("generated") or UNSET,
        "" if meta.get("status") == "locked" else "（草稿，尚未确认）")})

    blocks += _summary(profile, notes)
    blocks += _objective(profile)
    blocks += _measures(profile)
    blocks += _scope(profile, notes)
    blocks += _advisories(profile, notes)
    blocks += _lists(profile)
    blocks += _clarifications(profile, notes)
    blocks += _sources(meta, profile)

    return {"title": "项目档案", "blocks": blocks}, notes


def _summary(profile, notes):
    text = str(profile.get("summary") or "").strip()
    if not text:
        # 空总结不静默略过：一份没有开头的档案，读的人会以为这一节本来就不存在。
        notes.append("档案里没有项目总结 —— Word 的第一章是空的")
        text = "（项目总结还没写。这一章应当用一段话说清楚：模型要回答什么、" \
               "解释的是哪个数、覆盖多少格、回溯多久、哪些事不做。）"
    return [{"kind": "heading", "text": "一 · 项目总结"}, {"kind": "para", "text": text}]


def _objective(profile):
    blocks = [{"kind": "heading", "text": "二 · 要回答的生意问题"},
              {"kind": "para", "text": str(profile.get("objective") or UNSET)}]
    intro = str(profile.get("projectIntro") or "").strip()
    if intro:
        blocks.append({"kind": "para", "text": intro})
    return blocks


def _measures(profile):
    window = profile.get("timeWindow") or {}
    return [
        {"kind": "heading", "text": "三 · 模型口径"},
        {"kind": "table", "header": ["项", "口径"], "rows": [
            ["模型解释的数（Y）", str(profile.get("responseMetric") or UNSET)],
            ["建模时间颗粒度", label(profile.get("timeGranularity"))],
            ["数据回溯区间", "%s 至 %s" % (window.get("from") or UNSET, window.get("to") or UNSET)],
        ]},
        {"kind": "note", "text": "这三项一经确认即对全流程生效：数据需求的表格按它们出，"
                                 "收回来的数据也按它们核对。要改得重走这一步。"},
    ]


def _scope(profile, notes):
    axes = profile.get("modelScope") or []
    rows = profile.get("scopeRows") or []
    blocks = [{"kind": "heading", "text": "四 · 模型范围"},
              {"kind": "table", "header": ["维度", "取值"],
               "rows": [[label((a or {}).get("name")),
                         "、".join(str(v) for v in ((a or {}).get("values") or [])) or UNSET]
                        for a in axes] or [[UNSET, UNSET]]}]

    full = 1
    for axis in axes:
        full *= max(1, len((axis or {}).get("values") or []))
    if axes and rows:
        blocks.append({"kind": "para", "text":
                       "三个维度全部交叉共 %d 个组合，本次实际建模 %d 个。"
                       "没有列进下表的组合不在本次范围内。" % (full, len(rows))})
    blocks.append({"kind": "table",
                   "header": [label((a or {}).get("name")) for a in axes] or ["范围"],
                   "rows": [[str(v) for v in (row or [])] for row in rows]
                           or [[UNSET] * max(1, len(axes))]})
    if not rows:
        notes.append("档案里一个范围行都没有 —— Word 的范围表是空的")

    exclusions = profile.get("productExclusions") or []
    if exclusions:
        blocks.append({"kind": "para", "text": "产品线中明确排除："})
        blocks.append({"kind": "bullets", "items": [str(x) for x in exclusions]})
    return blocks


def _advisories(profile, notes):
    advisories = profile.get("scopeAdvisories") or {}
    if not advisories:
        return []
    rows, over = [], []
    for key in ("productLines", "channels", "geoGroups"):
        entry = advisories.get(key) or {}
        actual, suggested = entry.get("actual"), entry.get("suggested")
        beyond = isinstance(actual, int) and isinstance(suggested, int) and actual > suggested
        if beyond:
            over.append(ADVISORY_LABELS[key])
        rows.append([ADVISORY_LABELS[key], str(actual), "≤ %s" % suggested,
                     "超出建议" if beyond else "在建议范围内",
                     str(entry.get("note") or "")])
    blocks = [{"kind": "heading", "text": "五 · 范围规模提醒"},
              {"kind": "table",
               "header": ["项", "本次", "建议", "对照", "说明"], "rows": rows}]
    if over:
        # 提醒是给人看的，不是给流程挡的。所以它必须在文档里说清楚代价，
        # 否则客户看到的只是一个数字大于另一个数字。
        blocks.append({"kind": "para", "text":
                       "本次的%s超出建议规模。这三条建议的理由是项目工期，不是模型质量——"
                       "多出来的每一格都意味着一整套额外的数据收集和一个要单独跑的模型。"
                       "确认接受即可继续。" % "、".join(over)})
        notes.append("范围规模超出建议：%s" % "、".join(over))
    return blocks


def _lists(profile):
    blocks = [{"kind": "heading", "text": "六 · 交付物与范围外事项"}]
    deliverables = [str(x) for x in (profile.get("deliverables") or [])]
    out_of_scope = [str(x) for x in (profile.get("outOfScope") or [])]
    blocks.append({"kind": "para", "text": "本项目最终交付："})
    blocks.append({"kind": "bullets", "items": deliverables or ["（还没定）"]})
    blocks.append({"kind": "para", "text": "本项目明确不做："})
    blocks.append({"kind": "bullets", "items": out_of_scope or ["（没有列出范围外事项）"]})
    return blocks


def _clarifications(profile, notes):
    assumptions = profile.get("assumptions") or []
    questions = [str(q) for q in (profile.get("openQuestions") or [])]
    blocks = [{"kind": "heading", "text": "七 · 澄清记录"}]

    real = [a for a in assumptions if str((a or {}).get("question") or "").strip()]
    if real:
        blocks.append({"kind": "table",
                       "header": ["问题", "结论", "谁定的", "时间", "来源"],
                       "rows": [[str(a.get("question") or ""), str(a.get("answer") or ""),
                                 str(a.get("decidedBy") or ""), str(a.get("at") or ""),
                                 "我方按推荐项预设" if a.get("assumed") else "客户确认"]
                                for a in real]})
        guessed = [a for a in real if a.get("assumed")]
        if guessed:
            blocks.append({"kind": "para", "text":
                           "其中 %d 项没有拿到客户答复，按行业推荐项预设。"
                           "确认这份档案即视为接受这些预设。" % len(guessed)})
            notes.append("%d 项是按推荐项预设的，确认时要逐条念出来" % len(guessed))
    else:
        blocks.append({"kind": "para", "text": "没有登记任何澄清记录。"})

    blocks.append({"kind": "para", "text": "以下问题尚未解决，留待访谈或数据需求阶段处理："})
    blocks.append({"kind": "bullets", "items": questions or ["（没有未决问题）"]})
    if questions:
        notes.append("还有 %d 个未决问题 —— 确认时不要把「通过」报成默认推荐" % len(questions))
    return blocks


def _sources(meta, profile):
    grounding = meta.get("grounding") or []
    rows = [[str((item or {}).get("path") or ""), str((item or {}).get("chars") or ""),
             "是" if (item or {}).get("truncated") else "否"] for item in grounding]
    blocks = [{"kind": "heading", "text": "八 · 这份档案的来源"},
              {"kind": "para", "text": "范围的来路：%s。"
                                       % label(profile.get("sourceOrigin"))}]
    if rows:
        blocks.append({"kind": "table", "header": ["材料", "读取字数", "是否有截断"], "rows": rows})
    else:
        blocks.append({"kind": "para", "text":
                       "没有读取任何上传材料——本项目没有正式的立项文件，"
                       "范围是通过逐项问答推导出来的。"})
    return blocks
