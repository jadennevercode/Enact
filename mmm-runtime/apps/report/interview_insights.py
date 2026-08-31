"""访谈洞察与关键假设的 Word 版。

内容来自 `insights.yaml` 与 `assumptions.yaml`，两份合成一份 Word——它们回答的是同一个
问题的两半：这几场访谈告诉了我们什么，以及建模时哪些设定现在有客户背书、哪些没有。

这个应用不算数、不判断、不补内容。**尤其不替谁把一条洞察标成"已忽略"**：
忽略是人的决定，这里只负责把它印出来。

指纹跟着 `insights.yaml` 走（`doc_current` 也是这么配的）。`assumptions.yaml` 改了而
洞察没改时，这份 Word 不会被判过期——这是个已知的取舍：两份源文件由同一步产出，
同一次生成，实际不会分叉。
"""
from __future__ import annotations

import os

import engagement as eng

from apps.report import interview_common as iv

TOOL = "report.interview-insights"
DELIVERABLE = "interview"
SOURCE_REL = iv.relative("insights.yaml")
ASSUMPTIONS_REL = iv.relative("assumptions.yaml")
OUT_REL = iv.relative("insights.docx")

KIND_ZH = {"gap": "缺口", "conflict": "矛盾"}

TOPIC_ZH = {
    "adstock": "广告衰减", "saturation": "饱和", "lag": "滞后",
    "baseline": "基线归属", "overlap": "渠道重叠", "seasonality": "季节",
    "pricing": "价格", "other": "其他",
}


def documents(root):
    path = os.path.join(root, SOURCE_REL)
    if not os.path.isfile(path):
        raise FileNotFoundError("%s 不存在 —— 先从纪要里提洞察" % SOURCE_REL)
    model, notes = build(root)
    return [(SOURCE_REL, OUT_REL, model, notes)]


def build(root):
    insights_path = os.path.join(root, SOURCE_REL)
    meta = eng.read_yaml(insights_path).get("meta") or {}
    insights = eng.read_yaml(insights_path).get("insights") or []
    notes = []

    blocks = [{"kind": "title", "text": "访谈洞察与关键假设"},
              {"kind": "note", "text": iv.caption(meta, "访谈洞察与关键假设")}]
    blocks += _insights(insights, meta, notes)
    blocks += _assumptions(root, notes)
    blocks.append({"kind": "heading", "text": "这份文档的来源"})
    blocks += iv.grounding_block(meta)
    return {"title": "访谈洞察与关键假设", "blocks": blocks}, notes


def _insights(insights, meta, notes):
    blocks = [{"kind": "heading", "text": "一 · 洞察"}]
    if not insights:
        blocks.append({"kind": "para", "text":
                       str(meta.get("note") or "").strip()
                       or "这几场访谈没有发现覆盖缺口，也没有发现已确认结论之间的矛盾。"})
        notes.append("一条洞察都没有 —— 交付时把「覆盖了什么、为什么没有」说出来")
        return blocks

    blocks.append({"kind": "para", "text":
                   "只列两类：覆盖链上的缺口，和已确认结论之间的矛盾。"
                   "每一条都带至少两个证据锚点和一条可执行建议。"})
    active = [i for i in insights if not i.get("ignored")]
    ignored = [i for i in insights if i.get("ignored")]

    for item in active:
        blocks.append({"kind": "heading",
                       "text": "%s · %s（%s）" % (item.get("id") or "?",
                                                 item.get("title") or iv.UNSET,
                                                 KIND_ZH.get(str(item.get("kind")), "—"))})
        blocks.append({"kind": "para", "text": str(item.get("finding") or iv.UNSET)})
        anchors = [str(a) for a in (item.get("anchors") or []) if str(a or "").strip()]
        if anchors:
            blocks.append({"kind": "bullets", "items": anchors})
        blocks.append({"kind": "para", "text":
                       "建议：%s" % (item.get("recommendation") or iv.UNSET)})
        if item.get("affects"):
            blocks.append({"kind": "note", "text": "落在：%s" % item["affects"]})

    if ignored:
        blocks.append({"kind": "heading", "text": "已看过并决定不处理"})
        blocks.append({"kind": "table", "header": ["编号", "发现", "不处理的理由"],
                       "rows": [[str(i.get("id") or ""), str(i.get("title") or ""),
                                 str(i.get("ignoredReason") or "")] for i in ignored]})
        notes.append("有 %d 条洞察被标记为不处理 —— 那是人的决定，这份文档只是印出来" % len(ignored))

    gaps = sum(1 for i in active if str(i.get("kind")) == "gap")
    notes.append("%d 条缺口、%d 条矛盾" % (gaps, len(active) - gaps))
    return blocks


def _assumptions(root, notes):
    path = os.path.join(root, ASSUMPTIONS_REL)
    blocks = [{"kind": "heading", "text": "二 · 关键假设"}]
    if not os.path.isfile(path):
        blocks.append({"kind": "para", "text": "还没有整理关键假设。"})
        notes.append("%s 不存在 —— 关键假设和洞察是同一步的两份产出" % ASSUMPTIONS_REL)
        return blocks

    data = eng.read_yaml(path) or {}
    items = data.get("assumptions") or []
    if not items:
        blocks.append({"kind": "para", "text":
                       str((data.get("meta") or {}).get("note") or "").strip()
                       or "还没有从访谈里提炼出关键假设。"})
        return blocks

    blocks.append({"kind": "para", "text":
                   "建模时无论如何都要给出的那些设定。下表里没有答案的，"
                   "建模时会用默认值——而默认值不会在报告里说明自己是默认值。"})
    rows = [[str(a.get("id") or ""), TOPIC_ZH.get(str(a.get("topic")), str(a.get("topic") or "")),
             str(a.get("question") or ""), str(a.get("answer") or ""),
             str(a.get("source") or "—"), str(a.get("decision") or "")]
            for a in items]
    blocks.append({"kind": "table",
                   "header": ["编号", "主题", "问题", "回答", "出处", "影响哪个建模决策"],
                   "rows": rows})

    unanswered = [a for a in items if str(a.get("status")) == "unanswered"]
    if unanswered:
        blocks.append({"kind": "para", "text":
                       "其中 %d 条访谈没有问到。它们在建模时会取默认值，"
                       "而没有人为那个默认值背书——这几条值得在下一次接触时补问。"
                       % len(unanswered)})
        notes.append("%d 条关键假设访谈没问到 —— 这是给 S2 的预警" % len(unanswered))
    return blocks
