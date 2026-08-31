"""访谈工作簿 —— 提纲与 AI 预答各一张表。

内容全部来自 `artifacts/s1/interview/outline.md` 与 `pre-answers.md`。这里只做解析
和搬运：题目怎么问、预答说了什么，都是访谈交付物写好的，这个文件一个字也不改写。
"""
from __future__ import annotations

import os
import re

import engagement as eng
import xlsx

from .. import layout

TOOL = "workbook.interview"
DELIVERABLE = "interview"
OUTLINE_REL = "artifacts/s1/interview/outline.md"
PRE_ANSWERS_REL = "artifacts/s1/interview/pre-answers.md"
DEFAULT_OUT = "exports/interview.xlsx"

#: 置信度落在这两档，就是访谈当天必须问出结果的题。
FOCUS_CONFIDENCE = ("none", "low", "")

TEXT = {
    "zh": {
        "deliverable": "访谈",
        "title": "访谈提纲与预答",
        "sheet_outline": "访谈提纲",
        "sheet_answers": "AI 预答",
        "outline_columns": ["题号", "问题", "对应因子", "访谈对象层级", "为什么问"],
        "answer_columns": ["题号", "初步回答", "依据", "置信度", "是否访谈重点"],
        "empty_outline": "没有读到访谈提纲（%s）。先让访谈交付物起草提纲。" % OUTLINE_REL,
        "empty_answers": "没有读到 AI 预答（%s）。提纲已在，预答还没写。" % PRE_ANSWERS_REL,
        "notes": [
            ("题号", "提纲里的编号，两张表靠它对上", "每题一个", "访谈交付物"),
            ("问题", "现场要问的原话", "每题一句", "访谈交付物"),
            ("对应因子", "这题是为哪一行因子问的；答案回来要写回那一行", "每题零到多个", "访谈交付物"),
            ("访谈对象层级", "这题该问谁——只有那一层的人知道答案", "每题一层", "访谈交付物"),
            ("为什么问", "不问会怎样；答不上来的题不该出现在提纲里", "每题一句", "访谈交付物"),
            ("初步回答", "访谈前按现有材料先答的一版，给访谈者用，不给客户看", "每题一条", "访谈交付物"),
            ("依据", "这条初步回答是从哪份材料得来的", "每题一条", "访谈交付物"),
            ("置信度", "high 有文档明写 · medium 有旁证 · low 靠行业惯例 · none 没有依据", "每题一个", "访谈交付物"),
            ("是否访谈重点", "置信度 low 或 none 就是重点——这些题的答案只能现场拿到", "每题一个", "按置信度自动判定"),
        ],
        "tail": [
            "本表由访谈提纲与预答自动生成，改这里不会改到原文。",
            "「是否访谈重点」是按置信度算出来的：low 与 none 记为重点。",
        ],
    },
    "en": {
        "deliverable": "Interview",
        "title": "Interview outline and pre-answers",
        "sheet_outline": "Outline",
        "sheet_answers": "Pre-answers",
        "outline_columns": ["No.", "Question", "Factor rows", "Interviewee layer", "Why we ask"],
        "answer_columns": ["No.", "Pre-answer", "Basis", "Confidence", "Focus of the interview"],
        "empty_outline": "No outline found (%s). Draft it first." % OUTLINE_REL,
        "empty_answers": "No pre-answers found (%s)." % PRE_ANSWERS_REL,
        "notes": [
            ("No.", "The outline's numbering; it joins the two sheets", "one per question", "interview deliverable"),
            ("Question", "What is actually asked, verbatim", "one per question", "interview deliverable"),
            ("Factor rows", "Which factor rows this question serves", "zero to many", "interview deliverable"),
            ("Interviewee layer", "Who to ask — only that layer knows the answer", "one per question", "interview deliverable"),
            ("Why we ask", "What breaks without the answer", "one per question", "interview deliverable"),
            ("Pre-answer", "A first pass from existing material; for the interviewer, not the client", "one per question", "interview deliverable"),
            ("Basis", "Which material the pre-answer came from", "one per question", "interview deliverable"),
            ("Confidence", "high stated in a document · medium corroborated · low industry habit · none nothing", "one per question", "interview deliverable"),
            ("Focus of the interview", "low or none means the answer exists only in the room", "one per question", "derived from confidence"),
        ],
        "tail": [
            "Generated from the outline and pre-answers; edits here do not reach the source.",
            "\"Focus\" is derived: low and none confidence are marked as focus questions.",
        ],
    },
}

_QUESTION = re.compile(r"^\s*[-*]\s+(Q\d+)[\s·.、]*(.*)$")
_FACTOR = re.compile(r"\[factor:\s*([^\]]+)\]", re.I)
_PROBING = re.compile(r"^\s*[-*]\s*\*?[_*]*(?:Probing|追问)[:：]\*?\*?\s*(.*)$", re.I)
_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_ANSWER_HEADING = re.compile(r"^#{2,6}\s+(Q\d+)\s*[·.、:：-]?\s*(.*)$")
_BULLET_LABEL = re.compile(r"^\s*[-*]\s+\*\*(.+?)\*\*[:：]?\s*(.*)$")

_LABELS = {
    "pre-answer": "answer", "preanswer": "answer", "初步回答": "answer", "预答": "answer",
    "confidence": "confidence", "置信度": "confidence",
    "basis": "basis", "依据": "basis",
}


def default_out(_root, _options):
    return DEFAULT_OUT


def run(root, out, language, options):
    words = TEXT.get(language, TEXT["zh"])
    outline_path = os.path.join(root, OUTLINE_REL)
    answers_path = os.path.join(root, PRE_ANSWERS_REL)
    if not os.path.isfile(outline_path) and not os.path.isfile(answers_path):
        raise FileNotFoundError(
            "%s 与 %s 都不在——访谈交付物还没产出内容。" % (OUTLINE_REL, PRE_ANSWERS_REL))

    questions = _parse_outline(outline_path) if os.path.isfile(outline_path) else []
    answers = _parse_answers(answers_path) if os.path.isfile(answers_path) else {}

    sources = [rel for rel, path in ((OUTLINE_REL, outline_path),
                                     (PRE_ANSWERS_REL, answers_path))
               if os.path.isfile(path)]
    note = layout.caption(language, words["deliverable"], sources)

    answer_rows = _answer_rows(questions, answers, language)
    sheets = [
        layout.sheet(words["sheet_outline"], words["title"], note,
                     words["outline_columns"],
                     [[q["id"], q["question"], ", ".join(q["factors"]), q["layer"], q["why"]]
                      for q in questions],
                     widths=[10, 72, 20, 26, 60],
                     empty_reason=layout.empty_reason(language, words["empty_outline"])),
        layout.sheet(words["sheet_answers"], words["title"], note,
                     words["answer_columns"], answer_rows,
                     widths=[10, 72, 48, 14, 14],
                     empty_reason=layout.empty_reason(language, words["empty_answers"])),
        layout.notes_sheet(language, words["title"], note, words["notes"],
                           tail=words["tail"]),
    ]
    xlsx.write_workbook(out, sheets)

    focus = sum(1 for row in answer_rows if row[4] == layout.text(language, "yes"))
    lines = ["%s · 提纲 %d 题 · 预答 %d 条 · 访谈重点 %d 题"
             % (layout.relative(root, out), len(questions), len(answers), focus)]
    if not questions:
        lines.append(words["empty_outline"])
    if not answers:
        lines.append(words["empty_answers"])
    return out, [], lines


# ── 解析 ─────────────────────────────────────────────────────────────

def _parse_outline(path):
    """提纲的形状：`## 层` / `### 子层` 下面挂 `- Qn 题目 [factor: ...]`。"""
    _meta, body = eng.split_frontmatter(eng.read_text(path))
    section, sub = "", ""
    questions, current = [], None
    for line in body.splitlines():
        heading = _HEADING.match(line)
        if heading:
            level, title = len(heading.group(1)), heading.group(2).strip()
            if level <= 2:
                section, sub = title, ""
            else:
                sub = title
            current = None
            continue
        match = _QUESTION.match(line)
        if match:
            text = match.group(2).strip()
            factors = []
            for hit in _FACTOR.findall(text):
                factors.extend(part.strip() for part in re.split(r"[,，;；]", hit) if part.strip())
            current = {
                "id": match.group(1),
                "question": _FACTOR.sub("", text).strip(),
                "factors": factors,
                "layer": sub or section,
                "why": "",
            }
            questions.append(current)
            continue
        probing = _PROBING.match(line)
        if probing and current is not None:
            current["why"] = _join(current["why"], probing.group(1).strip())
    return questions


def _parse_answers(path):
    """预答的形状：`### Qn · 题目` 下面挂 `- **Pre-answer:** …` 一组标签行。"""
    _meta, body = eng.split_frontmatter(eng.read_text(path))
    answers, current, label = {}, None, None
    for line in body.splitlines():
        heading = _ANSWER_HEADING.match(line)
        if heading:
            current = {"id": heading.group(1), "answer": "", "basis": "", "confidence": ""}
            answers[current["id"]] = current
            label = None
            continue
        if _HEADING.match(line):
            current, label = None, None
            continue
        if current is None:
            continue
        bullet = _BULLET_LABEL.match(line)
        if bullet:
            label = _normalize_label(bullet.group(1))
            if label:
                current[label] = _join(current[label], bullet.group(2).strip())
            continue
        if line.strip().startswith(("-", "*")):
            label = None
            continue
        if label and line.strip():
            current[label] = _join(current[label], line.strip())
    return answers


def _normalize_label(raw):
    """`If confirmed（若价值口径也算）` 这种带括注的标签也要认得出来。"""
    text = re.split(r"[（(]", str(raw), 1)[0]
    text = text.strip().rstrip(":：").strip().lower()
    return _LABELS.get(text.replace(" ", ""), _LABELS.get(text))


def _join(existing, addition):
    if not addition:
        return existing
    return ("%s %s" % (existing, addition)).strip() if existing else addition


def _answer_rows(questions, answers, language):
    rows = []
    order = [q["id"] for q in questions] or sorted(answers, key=_number)
    seen = set()
    for qid in order + sorted(set(answers) - set(q["id"] for q in questions), key=_number):
        if qid in seen:
            continue
        seen.add(qid)
        entry = answers.get(qid)
        if entry is None:
            continue
        confidence = _confidence(entry.get("confidence", ""))
        focus = confidence in FOCUS_CONFIDENCE
        rows.append([qid, entry.get("answer", ""), entry.get("basis", ""),
                     entry.get("confidence", "") or layout.text(language, "unknown"),
                     layout.flag(language, focus)])
    return rows


def _confidence(raw):
    """`medium（…括注…）` → `medium`。括注是给人读的，判定只看那个词。"""
    token = re.split(r"[（(\s]", str(raw).strip(), 1)[0]
    return token.strip().lower()


def _number(qid):
    digits = re.sub(r"\D", "", str(qid))
    return int(digits) if digits else 0
