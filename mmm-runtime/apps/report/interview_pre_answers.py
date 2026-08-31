"""访谈预答的 Word 版 —— 给访谈者的简报，不给客户。

内容全部来自 `artifacts/s1/interview/pre-answers.md`。这个应用不算数、不判断、不补内容。

**这份文档不该发给客户。** 它写的是"我们现在以为答案是什么"，把它发出去等于让客户
看到一份对他自己生意的猜测。文档第一页就印着这句话——一份没有免责的简报，
迟早会被顺手转发出去。

排版上做了一件 Markdown 做不到的事：**访谈重点在最前面**。置信度 `low` 与 `none` 的
那些题就是这一小时真正要问的内容，其余的随提纲交给对方书面回填。
"""
from __future__ import annotations

import os

from apps.report import interview_common as iv

TOOL = "report.interview-pre-answers"
DELIVERABLE = "interview"
SOURCE_REL = iv.relative("pre-answers.md")
OUT_REL = iv.relative("pre-answers.docx")

#: 置信度落在这两档，就是现场必须问出结果的题。
FOCUS = ("none", "low", "")

CONFIDENCE_ZH = {
    "high": "高 · 有文档明说",
    "medium": "中 · 从文档能推出来",
    "low": "低 · 行业惯例或推断，由访谈定夺",
    "none": "无 · 完全没依据",
}

DISCLAIMER = ("本文档是访谈前的准备材料，供访谈者使用，请勿发给客户。"
              "其中每一条都是待验证的假设，不是结论。")


def documents(root):
    path = os.path.join(root, SOURCE_REL)
    if not os.path.isfile(path):
        raise FileNotFoundError("%s 不存在 —— 先出一版预答" % SOURCE_REL)
    model, notes = build(root)
    return [(SOURCE_REL, OUT_REL, model, notes)]


def build(root):
    path = os.path.join(root, SOURCE_REL)
    meta = iv.meta_of(path)
    answers = iv.parse_pre_answers(path)
    notes = []

    blocks = [{"kind": "title", "text": "访谈预答（内部）"},
              {"kind": "note", "text": iv.caption(meta, "访谈预答")},
              {"kind": "para", "text": DISCLAIMER}]

    blocks += _focus(answers, meta, notes)
    blocks += _all_answers(answers, notes)
    blocks.append({"kind": "heading", "text": "这份预答的来源"})
    blocks += iv.grounding_block(meta)

    if not answers:
        notes.append("一条预答都没解析出来 —— 检查 pre-answers.md 的锚点是不是 `### Q<n> · 题干`")
    return {"title": "访谈预答（内部）", "blocks": blocks}, notes


def _focus(answers, meta, notes):
    focus = [a for a in answers.values() if iv.confidence_of(a["confidence"]) in FOCUS]
    blocks = [{"kind": "heading", "text": "一 · 访谈重点"},
              {"kind": "para", "text":
               "以下问题现有材料答不上来或只有推断。这一小时应该花在它们身上——"
               "其余问题随提纲交给对方书面回填即可。"}]
    if not focus:
        blocks.append({"kind": "para", "text":
                       "没有低置信度的问题。这很少见：材料真的覆盖到了每一处，"
                       "还是有几条本该写「没有依据」的被写成了推断？"})
        notes.append("一条重点题都没有 —— 值得回头看看置信度是不是给高了")
        return blocks
    rows = [[a["id"], a["stem"] or a["answer"][:40],
             CONFIDENCE_ZH.get(iv.confidence_of(a["confidence"]), "未标注"),
             a["listenFor"] or "—"] for a in focus]
    blocks.append({"kind": "table", "header": ["题号", "问题", "置信度", "现场留意"],
                   "rows": rows})
    counts = meta.get("counts") or {}
    web = counts.get("web")
    if web:
        blocks.append({"kind": "para", "text":
                       "其中 %s 条的依据来自公开检索，只对行业与竞品类问题使用，"
                       "对本项目是否成立要由访谈定夺。" % web})
        notes.append("有 %s 条预答的依据是联网查来的 —— 现场要当作假设去验" % web)
    return blocks


def _all_answers(answers, notes):
    blocks = [{"kind": "heading", "text": "二 · 逐题预答"}]
    if not answers:
        blocks.append({"kind": "para", "text": "没有读到任何预答。"})
        return blocks
    missing_basis = []
    for answer in answers.values():
        level = iv.confidence_of(answer["confidence"])
        blocks.append({"kind": "para", "text": "%s　%s" % (answer["id"], answer["stem"])})
        blocks.append({"kind": "bullets", "items": [
            "初步回答：%s" % (answer["answer"] or iv.UNSET),
            "置信度：%s" % CONFIDENCE_ZH.get(level, answer["confidence"] or "未标注"),
            "依据：%s" % (answer["basis"] or "没有依据"),
            "若成立：%s" % (answer["ifTrue"] or "—"),
            "现场留意：%s" % (answer["listenFor"] or "—"),
        ]})
        if level not in ("none", "") and not answer["basis"]:
            missing_basis.append(answer["id"])
    if missing_basis:
        notes.append("%d 条预答报了置信度却没写依据：%s"
                     % (len(missing_basis), "、".join(missing_basis[:6])))
    return blocks
