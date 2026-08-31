"""工作簿的共用排版 —— 所有工作簿长一个样，靠的就是这个文件。

规范（README 里有同一份说明，改这里要一起改）：

* 第 1 行是标题行，第 2 行是生成说明（来自哪个交付物、什么时候生成、依据哪个文件）
* 第 3 行是表头，加粗；冻结到第 4 行，滚动时标题与表头不动
* 列宽按内容估算，中文按两格算，不是所有列一样宽
* 表头语言跟工作区 `mmm.yaml` 的 `outputLanguage` 走：`zh` 中文、`en` 英文
* 每个工作簿最后一张表叫「说明」，逐列写清含义、颗粒度、谁来填
* 没有内容时也要出一行，写明为什么是空的——不允许静默产出空文件

这里只管长相。内容从哪来、算不算数，是各个 builder 的事，而它们也只搬运工作区里
已有的文件，不自己判断。
"""
from __future__ import annotations

import os

import engagement as eng

#: 标题行、说明行、表头行的行号，以及冻结点。整套排版就是这四个数。
TITLE_ROW = 1
CAPTION_ROW = 2
HEADER_ROW = 3
FREEZE_AT = "A4"

_ROW_STYLES = {TITLE_ROW: "title", CAPTION_ROW: "note", HEADER_ROW: "header"}

DEFAULT_LANGUAGE = "zh"
LANGUAGES = ("zh", "en")

TEXT = {
    "zh": {
        "notes_sheet": "说明",
        "notes_columns": ["列名", "含义", "颗粒度", "谁来填"],
        "caption": "来自交付物「%(deliverable)s」· 生成于 %(generated)s · 依据 %(sources)s",
        "empty": "（没有内容）%s",
        "stats_columns": ["分组", "项目", "数量"],
        "yes": "是",
        "no": "否",
        "unknown": "—",
    },
    "en": {
        "notes_sheet": "Notes",
        "notes_columns": ["Column", "What it means", "Grain", "Who fills it"],
        "caption": "From deliverable \"%(deliverable)s\" · generated %(generated)s · based on %(sources)s",
        "empty": "(nothing to show) %s",
        "stats_columns": ["Group", "Item", "Count"],
        "yes": "yes",
        "no": "no",
        "unknown": "—",
    },
}


def language_of(root):
    """工作区声明的产出语言。没声明就按中文——对话与产出都是中文优先。"""
    path = os.path.join(root, "mmm.yaml")
    if not os.path.isfile(path):
        return DEFAULT_LANGUAGE
    data = eng.read_yaml(path) or {}
    declared = str(data.get("outputLanguage") or data.get("language") or "").strip().lower()
    return declared if declared in LANGUAGES else DEFAULT_LANGUAGE


def text(language, key):
    return TEXT.get(language, TEXT[DEFAULT_LANGUAGE])[key]


def caption(language, deliverable, sources, generated=None):
    """第 2 行那句话：来自哪个交付物、什么时候生成、依据哪个文件。"""
    return text(language, "caption") % {
        "deliverable": deliverable,
        "generated": generated or eng.now_iso(),
        "sources": " · ".join(sources) if sources else "—",
    }


def sheet(name, title, note, header, rows, *, widths=None, empty_reason=None):
    """一张标准表：标题 / 生成说明 / 表头 / 数据。

    `empty_reason` 在 rows 为空时写进第一格。空结果是个结论，不是一张空表——
    一份没有说明的空文件会被当成"跑过了没问题"。
    """
    body = [[title], [note], list(header)]
    if rows:
        body.extend(list(row) for row in rows)
    elif empty_reason:
        body.append([empty_reason])
    options = {"styles": dict(_ROW_STYLES), "freeze": FREEZE_AT, "widths": widths}
    return (name, body, options)


def stats_sheet(name, title, note, language, entries, *, empty_reason=None):
    """统计表：分组 / 项目 / 数量。entries 是 [(分组, 项目, 数量)]。"""
    return sheet(name, title, note, text(language, "stats_columns"), entries,
                 widths=[22, 34, 10], empty_reason=empty_reason)


def notes_sheet(language, title, note, entries, *, tail=None):
    """最后一张「说明」表。entries 是 [(列名, 含义, 颗粒度, 谁来填)]。

    `tail` 是补充说明，一行一句，接在表格下面。
    """
    rows = [list(entry) for entry in entries]
    for line in tail or []:
        rows.append([line])
    return sheet(text(language, "notes_sheet"), title, note,
                 text(language, "notes_columns"), rows,
                 widths=[18, 46, 20, 22])


def empty_reason(language, why):
    return text(language, "empty") % why


def flag(language, value):
    return text(language, "yes") if value else text(language, "no")


def source_hash(path):
    """交付物内容的指纹，与 `workbook_current` 检查用的是同一个算法。

    工作簿把它写进自定义文档属性，检查那边重算一次比对。两边必须是同一个函数——
    各写各的哈希，只会在交付物改过之后、检查却说同步的那一刻才被发现。
    """
    import sys

    plugin = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
    scripts = os.path.join(plugin, "scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    import gate_check  # noqa: PLC0415 —— 只有真要生成工作簿时才需要它

    return gate_check.source_hash(path)


def relative(root, path):
    """工作区相对路径——运行记录与终端输出都用它。"""
    return os.path.relpath(path, root).replace(os.sep, "/")


def resolve_out(root, given, default_rel):
    """--out 给了就用，没给就用默认位置，并把目录建好。"""
    target = given or os.path.join(root, default_rel)
    if not os.path.isabs(target):
        target = os.path.join(root, target)
    parent = os.path.dirname(os.path.abspath(target))
    if parent:
        os.makedirs(parent, exist_ok=True)
    return os.path.abspath(target)
