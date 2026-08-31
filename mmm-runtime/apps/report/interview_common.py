"""访谈几份 Word 共用的解析与排版零件。

访谈的真相是 `artifacts/s1/interview/` 下的 Markdown 与 YAML；Word 是照它们渲染出来的
视图。这个模块只做解析和搬运——**它不算数、不判断、不补内容**。提纲里没写的东西，
Word 里就不该出现，否则客户手上那一份和机器读的那一份说的就不是同一件事了。

题号 `Q<n>` 是跨文件主键，所有解析都以它为准。
"""
from __future__ import annotations

import os
import re

import engagement as eng

INTERVIEW_DIR = os.path.join("artifacts", "s1", "interview")

#: 提纲里的一条问题：`- Q43 [路径] 题干 [factor: f-0041]`
QUESTION = re.compile(r"^\s*[-*]\s+(Q\d+)\s*(.*)$")
#: 题干开头的因子路径，数据题才有
PATH_PREFIX = re.compile(r"^\[([^\]]+)\]\s*")
FACTOR_TAG = re.compile(r"\[factor:\s*([^\]]+)\]", re.I)
PROBING = re.compile(r"^\s*[-*]\s*\*?[_*]*(?:追问|Probing)[:：]\*?\*?\s*(.*)$", re.I)
HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
#: 预答的一块：`### Q14 · 题干`
PRE_HEADING = re.compile(r"^#{2,4}\s+(Q\d+)\s*[·.、:：-]?\s*(.*)$")
BULLET_LABEL = re.compile(r"^\s*[-*]\s+\*\*(.+?)\*\*[:：]?\s*(.*)$")

#: 预答的字段名。中英两套都认：模板写中文，早期工程写的是英文。
PRE_LABELS = {
    "初步回答": "answer", "预答": "answer", "pre-answer": "answer", "preanswer": "answer",
    "置信度": "confidence", "confidence": "confidence",
    "依据": "basis", "basis": "basis",
    "若成立": "ifTrue", "ifconfirmed": "ifTrue",
    "现场留意": "listenFor", "listenfor": "listenFor",
}

UNSET = "还没写"


def interview_path(root, name):
    return os.path.join(root, INTERVIEW_DIR, name)


def relative(name):
    return os.path.join(INTERVIEW_DIR, name).replace(os.sep, "/")


def body_of(path):
    return eng.split_frontmatter(eng.read_text(path))[1]


def meta_of(path):
    return eng.artifact_meta(path)


def join(existing, addition):
    if not addition:
        return existing
    return ("%s %s" % (existing, addition)).strip() if existing else addition


def normalize_label(raw):
    """`若成立（含口径）` 这种带括注的字段名也要认得出来。"""
    text = re.split(r"[（(]", str(raw), 1)[0]
    text = text.strip().rstrip(":：").strip().lower()
    return PRE_LABELS.get(text.replace(" ", ""), PRE_LABELS.get(text))


def parse_outline(path):
    """([sections], [questions])。

    section = {title, questions: [...]}，question = {id, path, text, factors, probing}。
    章节标题原样保留——它同时是访谈对象那一节的抬头，客户拿它排会。
    """
    sections, current_section, current_question = [], None, None
    for line in body_of(path).splitlines():
        heading = HEADING.match(line)
        if heading:
            level, title = len(heading.group(1)), heading.group(2).strip()
            if level >= 2:
                current_section = {"title": title, "level": level, "questions": []}
                sections.append(current_section)
            current_question = None
            continue
        match = QUESTION.match(line)
        if match:
            text = match.group(2).strip()
            factors = []
            for hit in FACTOR_TAG.findall(text):
                factors.extend(p.strip() for p in re.split(r"[,，;；]", hit) if p.strip())
            text = FACTOR_TAG.sub("", text).strip()
            path_hit = PATH_PREFIX.match(text)
            factor_path = ""
            if path_hit:
                factor_path = path_hit.group(1).strip()
                text = text[path_hit.end():].strip()
            current_question = {"id": match.group(1), "path": factor_path, "text": text,
                                "factors": factors, "probing": ""}
            if current_section is None:
                current_section = {"title": "问题", "level": 2, "questions": []}
                sections.append(current_section)
            current_section["questions"].append(current_question)
            continue
        probing = PROBING.match(line)
        if probing and current_question is not None:
            current_question["probing"] = join(current_question["probing"],
                                               probing.group(1).strip())
    questions = [q for section in sections for q in section["questions"]]
    return sections, questions


def parse_pre_answers(path):
    """{Q id: {id, stem, answer, confidence, basis, ifTrue, listenFor}}，保持文件顺序。"""
    answers, current, label = {}, None, None
    for line in body_of(path).splitlines():
        heading = PRE_HEADING.match(line)
        if heading:
            current = {"id": heading.group(1), "stem": heading.group(2).strip(),
                       "answer": "", "confidence": "", "basis": "",
                       "ifTrue": "", "listenFor": ""}
            answers[current["id"]] = current
            label = None
            continue
        if HEADING.match(line):
            current, label = None, None
            continue
        if current is None:
            continue
        bullet = BULLET_LABEL.match(line)
        if bullet:
            label = normalize_label(bullet.group(1))
            if label:
                current[label] = join(current[label], bullet.group(2).strip())
            continue
        if line.strip().startswith(("-", "*")):
            label = None
            continue
        if label and line.strip():
            current[label] = join(current[label], line.strip())
    return answers


def confidence_of(raw):
    """`medium（有旁证）` → `medium`。括注是给人读的，判定只看那个词。"""
    return re.split(r"[（(\s]", str(raw or "").strip(), 1)[0].strip().lower()


def caption(meta, title):
    """每份 Word 顶上那一行：它是什么、出自哪一步、什么时候生成的。"""
    return "%s · 由 %s 生成于 %s · 这是渲染出来的视图，内容以工作区里的源文件为准" % (
        title, meta.get("step") or UNSET, meta.get("generated") or UNSET)


def grounding_block(meta):
    """取材表。一份基于半份材料做出来的东西，事后唯一看得出来的地方就是这张表。"""
    rows = []
    for item in meta.get("grounding") or []:
        if not isinstance(item, dict):
            continue
        rows.append([str(item.get("path") or item.get("url") or ""),
                     str(item.get("chars") or ""),
                     "是" if item.get("truncated") else "否"])
    if not rows:
        return [{"kind": "para", "text": "没有声明取材。"}]
    return [{"kind": "table", "header": ["材料", "读取字数", "是否有截断"], "rows": rows}]
