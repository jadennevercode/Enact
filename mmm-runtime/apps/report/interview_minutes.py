"""访谈纪要的 Word 版 —— 发回给受访人确认的那一份。

一场访谈一份文件：`minutes-<来源>.md` → `minutes-<来源>.docx`。这个应用不算数、
不判断、不补内容。

**原话逐字保留。** 纪要要发回给受访人确认，而受访人认得出自己有没有说过那句话。
把引用改写成归纳，等于把这份文档从"记录"降级成"我们的理解"——后面每一条因子改动
建议都要靠这些原话撑着。
"""
from __future__ import annotations

import os
import re

import engagement as eng

from apps.report import interview_common as iv

TOOL = "report.interview-minutes"
DELIVERABLE = "interview"

#: 段标签 `[Q14, Q15]` 或 `[unplanned]`，跟在段落标题后面
SECTION_TAG = re.compile(r"\[([^\]]+)\]\s*$")
QUOTE = re.compile(r"^\s*>\s?(.*)$")
BEARING = re.compile(r"^\s*\*\*(?:对因子树的影响|Bearing on the tree)[:：]?\*\*\s*(.*)$", re.I)
NOT_COVERED = re.compile(r"^##+\s*(?:没覆盖到|Not covered)\s*$")
UNPLANNED = "unplanned"


def documents(root):
    sources = eng.resolve(root, os.path.join(iv.INTERVIEW_DIR, "minutes-*.md"))
    if not sources:
        raise FileNotFoundError(
            "%s 下没有整理好的纪要 —— 先把逐字稿整理成 minutes-<来源>.md"
            % iv.INTERVIEW_DIR.replace(os.sep, "/"))
    out = []
    for path in sorted(sources):
        stem = os.path.splitext(os.path.basename(path))[0]
        model, notes = build(path)
        out.append((iv.relative("%s.md" % stem), iv.relative("%s.docx" % stem), model, notes))
    return out


def build(path):
    meta = iv.meta_of(path)
    layer = str(meta.get("layer") or "").strip()
    title = "访谈纪要%s" % ("　—　%s" % layer if layer else "")
    notes = []

    blocks = [{"kind": "title", "text": title},
              {"kind": "note", "text": iv.caption(meta, "访谈纪要")}]
    blocks += _header_table(meta)

    sections, missed = _parse(path)
    blocks += _sections(sections, notes)
    blocks += _not_covered(missed, meta, notes)
    blocks.append({"kind": "heading", "text": "这份纪要的来源"})
    blocks += iv.grounding_block(meta)

    if not str(meta.get("attendees") or "").strip():
        notes.append("没有记参与人 —— 后面引用原话要写「谁说的」，同一句话出自数据团队"
                     "和出自品牌经理，处置完全不同")
    return {"title": title, "blocks": blocks}, notes


def _header_table(meta):
    rows = [["访谈对象", str(meta.get("layer") or iv.UNSET)],
            ["访谈日期", str(meta.get("interviewedAt") or iv.UNSET)],
            ["参与人", str(meta.get("attendees") or iv.UNSET)]]
    return [{"kind": "table", "header": ["项目", "内容"], "rows": rows}]


def _parse(path):
    """([sections], [没覆盖到的行])。section = {title, tags, paragraphs, quotes, bearing}。"""
    sections, current, in_missed, missed = [], None, False, []
    for line in iv.body_of(path).splitlines():
        if NOT_COVERED.match(line):
            in_missed, current = True, None
            continue
        heading = iv.HEADING.match(line)
        if heading:
            in_missed = False
            # The Markdown's own H1 repeats what the Word already puts in its
            # title block, and a document that says its own name twice reads as
            # a template someone forgot to fill in.
            if len(heading.group(1)) == 1:
                current = None
                continue
            title = heading.group(2).strip()
            tag_hit = SECTION_TAG.search(title)
            tags = []
            if tag_hit:
                tags = [t.strip() for t in re.split(r"[,，]", tag_hit.group(1)) if t.strip()]
                title = title[:tag_hit.start()].strip()
            current = {"title": title, "tags": tags, "paragraphs": [],
                       "quotes": [], "bearing": ""}
            sections.append(current)
            continue
        if in_missed:
            if line.strip():
                missed.append(re.sub(r"^\s*[-*]\s*", "", line).strip())
            continue
        if current is None:
            continue
        bearing = BEARING.match(line)
        if bearing:
            current["bearing"] = iv.join(current["bearing"], bearing.group(1).strip())
            continue
        quote = QUOTE.match(line)
        if quote:
            if quote.group(1).strip():
                current["quotes"].append(quote.group(1).strip())
            continue
        if line.strip():
            current["paragraphs"].append(line.strip())
    return sections, missed


def _sections(sections, notes):
    if not sections:
        notes.append("这份纪要没有解析出任何段落 —— 检查它是不是照模板写的")
        return [{"kind": "para", "text": "没有读到任何段落。"}]
    blocks, unplanned, quoted = [], 0, 0
    for section in sections:
        label = section["title"]
        if UNPLANNED in [t.lower() for t in section["tags"]]:
            label += "（提纲之外，受访人主动提出）"
            unplanned += 1
        elif section["tags"]:
            label += "（对应 %s）" % "、".join(section["tags"])
        blocks.append({"kind": "heading", "text": label})
        for paragraph in section["paragraphs"]:
            blocks.append({"kind": "para", "text": paragraph})
        for quote in section["quotes"]:
            blocks.append({"kind": "note", "text": _quoted(quote)})
            quoted += 1
        if section["bearing"]:
            blocks.append({"kind": "para", "text": "对因子树的影响：%s" % section["bearing"]})
    if unplanned:
        notes.append("有 %d 段是提纲之外主动提起的 —— 这往往是全场最有价值的内容" % unplanned)
    if not quoted:
        notes.append("整份纪要没有一句逐字原话 —— 后面的因子改动建议会无处引用")
    return blocks


#: 纪要里的原话，作者可能已经自己加了引号，也可能没有。
OPENING_QUOTES = "「\"'“『"


def _quoted(text):
    """给原话加引号，除非它自己已经有了 —— 双层引号读起来像转述的转述。"""
    return text if text[:1] in OPENING_QUOTES else "「%s」" % text


def _not_covered(missed, meta, notes):
    blocks = [{"kind": "heading", "text": "本场没有覆盖到的问题"}]
    if not missed:
        blocks.append({"kind": "para", "text":
                       "本场覆盖了提纲上安排的全部问题。"})
        notes.append("这份纪要声称全覆盖 —— 一场什么都问到了的访谈很罕见，值得再核一遍")
        return blocks
    blocks.append({"kind": "bullets", "items": missed})
    counts = meta.get("counts") or {}
    if counts.get("questionsMissed"):
        blocks.append({"kind": "para", "text":
                       "共 %s 个问题未覆盖，将在其余场次或以书面形式补齐。"
                       % counts["questionsMissed"]})
    return blocks
