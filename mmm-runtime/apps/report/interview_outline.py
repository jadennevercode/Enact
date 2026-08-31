"""访谈提纲的 Word 版 —— 客户拿去排会的那一份。

内容全部来自 `artifacts/s1/interview/outline.md`。这个应用不算数、不判断、不补内容：
提纲里没写的东西，这里就写"还没写"，不替它编一个。

排版上做了一件事，是 Markdown 做不到的：**「访谈对象一览」表在最前面**。提纲的第一
用途是让客户排会，而排会要看的是层级、团队、时长、题数、参与人、档期这六列。
数据题那一节动辄一百多题，放在同一个流里会把这张表冲到看不见的地方。
"""
from __future__ import annotations

import os

from apps.report import interview_common as iv

TOOL = "report.interview-outline"
DELIVERABLE = "interview"
SOURCE_REL = iv.relative("outline.md")
OUT_REL = iv.relative("outline.docx")

#: 数据题那一节太长，Word 里按因子路径归组，每条路径一段小标题加四问。
#: 逐条平铺出来是 168 行没有结构的列表，客户拿到只会问「这是什么」。
DATA_SECTION_HINT = "数据"


def documents(root):
    path = os.path.join(root, SOURCE_REL)
    if not os.path.isfile(path):
        raise FileNotFoundError("%s 不存在 —— 先起草提纲" % SOURCE_REL)
    model, notes = build(root)
    return [(SOURCE_REL, OUT_REL, model, notes)]


def build(root):
    path = os.path.join(root, SOURCE_REL)
    meta = iv.meta_of(path)
    sections, questions = iv.parse_outline(path)
    counts = meta.get("counts") or {}
    notes = []

    blocks = [{"kind": "title", "text": "访谈提纲"},
              {"kind": "note", "text": iv.caption(meta, "访谈提纲")}]

    blocks += _overview(sections, counts, meta, notes)
    for section in sections:
        blocks += _section(section)
    blocks += _assumed(meta, notes)
    blocks.append({"kind": "heading", "text": "这份提纲的来源"})
    blocks += iv.grounding_block(meta)

    if not questions:
        notes.append("提纲里一道题都没有 —— 检查 outline.md 的问题是不是写成了别的格式")
    return {"title": "访谈提纲", "blocks": blocks}, notes


def _overview(sections, counts, meta, notes):
    """访谈对象一览 —— 客户拿这张表排会，所以它在最前面。"""
    blocks = [{"kind": "heading", "text": "一 · 访谈对象一览"},
              {"kind": "para", "text":
               "参与人与档期两列留给贵方填写。时长按访谈层级固定："
               "高层与管理层 60 分钟，执行层与数据团队 90 分钟。"}]
    rows = []
    for section in sections:
        if not section["questions"]:
            continue
        rows.append([section["title"], _duration(section["title"]),
                     str(len(section["questions"])), "", ""])
    if rows:
        blocks.append({"kind": "table",
                       "header": ["访谈对象", "时长", "题数", "参与人", "建议档期"],
                       "rows": rows})
    else:
        blocks.append({"kind": "para", "text": "提纲里没有分节 —— 排不了会，先补访谈对象。"})
        notes.append("提纲没有分节，这份 Word 排不出访谈对象表")

    business = counts.get("businessQuestions")
    data = counts.get("dataQuestions")
    if business is not None or data is not None:
        blocks.append({"kind": "para", "text":
                       "共 %s 道业务问题、%s 道数据问题。数据问题按每个因子固定四问生成，"
                       "不必在会上逐条问完——会上过重点题，其余请数据团队书面回填。"
                       % (business if business is not None else "若干",
                          data if data is not None else "若干")})
    if str(meta.get("knowledgeRecall") or "none") == "none":
        blocks.append({"kind": "para", "text":
                       "说明：本提纲没有行业题库背书，问题全部来自本项目自己的材料。"})
        notes.append("没有召回到行业题库 —— 交付时要主动说出来")
    return blocks


def _duration(title):
    """时长是查表来的，不是估的。见 knowledge/methodology/interview-framework.yaml。"""
    if "高层" in title or "管理层" in title:
        return "60 分钟"
    if "执行层" in title or "数据" in title:
        return "90 分钟"
    return "—"


def _section(section):
    questions = section["questions"]
    if not questions:
        return []
    blocks = [{"kind": "heading", "text": section["title"]}]
    if any(q["path"] for q in questions):
        return blocks + _data_questions(questions)
    for question in questions:
        blocks.append({"kind": "para", "text": "%s　%s" % (question["id"], question["text"])})
        if question["probing"]:
            blocks.append({"kind": "note", "text": "追问：%s" % question["probing"]})
    return blocks


def _data_questions(questions):
    """按因子路径归组。同一条路径的四问放在一起，客户才看得出这是在问同一个指标。"""
    blocks, seen = [], None
    bucket = []
    for question in questions:
        path = question["path"] or "（未标注因子路径）"
        if path != seen:
            if bucket:
                blocks.append({"kind": "bullets", "items": bucket})
                bucket = []
            blocks.append({"kind": "para", "text": path})
            seen = path
        bucket.append("%s　%s" % (question["id"], question["text"]))
    if bucket:
        blocks.append({"kind": "bullets", "items": bucket})
    return blocks


def _assumed(meta, notes):
    """按推荐项预设的澄清点。假设要登记出来，不能沉默滑过去。"""
    assumed = [a for a in (meta.get("assumed") or []) if a]
    if not assumed:
        return []
    rows = []
    for item in assumed:
        if isinstance(item, dict):
            rows.append([str(item.get("question") or ""), str(item.get("answer") or ""),
                         str(item.get("why") or "")])
        else:
            rows.append([str(item), "", ""])
    notes.append("有 %d 项澄清没拿到答复，按推荐项预设 —— 确认时要逐条念出来" % len(rows))
    return [{"kind": "heading", "text": "按推荐项预设的部分"},
            {"kind": "para", "text":
             "以下几项没有拿到贵方答复，我们按行业推荐做法预设。确认本提纲即视为接受这些预设。"},
            {"kind": "table", "header": ["澄清点", "预设为", "理由"], "rows": rows}]
