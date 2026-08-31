"""每张卡的解读：算好的槽位打底，写下来的覆盖上去。

**没有一张卡是空的。** `validation.analyses` 给每张卡预填一份计算读数，写解读的人
按卡片路径覆盖它。没人写的那张显示读数，并且页面上写明它是读数 —— 一份刻意平实的
东西，不会被误当成谁的判断。

这里替换掉的是「按 markdown 标题字符串找解读」那套机制。它只有一种失败方式，而且
是安静的：标题差一个字，那一段不报错、不提示，只是不出现，读的人看到「待写入」，
以为没人写过。改成按 `card` 路径匹配之后，对不上就是 `chart_analyses_bind` 的一次
响亮失败。

只依赖标准库与 `yamlio` —— 图册要能在只有 Python 的机器上生成。
"""
from __future__ import annotations

import json
import os

import yamlio

SLOTS_REL = "data/derived/chart-analyses.json"
STORE_REL = "artifacts/s2/chart-analyses.yaml"

#: 一段解读的来源，决定页面上那一行小字。
WRITTEN = "written"     # 有人写的
COMPUTED = "computed"   # 工具算的读数
STALE = "stale"         # 有人写过，但那之后数动了 —— 退回读数，并说明为什么


def _read_json(root, rel):
    path = os.path.join(root, rel)
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _read_yaml(root, rel):
    path = os.path.join(root, rel)
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as handle:
        data = yamlio.load(handle.read())
    return data if isinstance(data, dict) else {}


def merge(root):
    """`{card_path: {"record": …, "source": …, "note": …}}`，每张卡一条。

    覆盖只认 `card` 字段。写的时候是哪批数，靠 `seriesDigest` 认 —— 对不上的那条
    退回计算读数并说明，因为一段描述着另一批数的话，比没有话更危险。
    """
    payload = _read_json(root, SLOTS_REL)
    out = {}
    for slot in (payload.get("slots") or []):
        if isinstance(slot, dict) and slot.get("card"):
            out[str(slot["card"])] = {"record": slot, "source": COMPUTED, "note": ""}

    store = _read_yaml(root, STORE_REL)
    for entry in (store.get("analyses") or []):
        if not isinstance(entry, dict):
            continue
        card = str(entry.get("card") or "")
        if card not in out:
            continue          # 对不上的由 chart_analyses_bind 点名，这里不假装收到了
        slot = out[card]["record"]
        if str(entry.get("seriesDigest") or "") != str(slot.get("seriesDigest") or ""):
            out[card]["source"] = STALE
            out[card]["note"] = ("这段解读写的时候是另一批数 —— 数在那之后动过，"
                                 "所以这里显示的是计算读数")
            continue
        merged = dict(slot)
        for field in ("headline", "trends", "anomalies", "inflections", "caveats"):
            if field in entry:
                merged[field] = entry[field]
        merged["fallback"] = False
        out[card] = {"record": merged, "source": WRITTEN, "note": ""}
    return out


#: 区块标题。**英文，固定** —— 它们是产品骨架的一部分，不是正文。
SECTIONS = (("trends", "TRENDS"), ("anomalies", "ANOMALIES"),
            ("inflections", "INFLECTIONS"), ("caveats", "CAVEATS"))


def lines_of(record, field):
    """一段里的每一行，不管它是字符串还是 {period, metric, note}。"""
    out = []
    for item in (record.get(field) or []):
        if isinstance(item, dict):
            head = " · ".join(x for x in (str(item.get("period") or ""),
                                          str(item.get("metric") or "")) if x)
            note = str(item.get("note") or "")
            out.append("%s —— %s" % (head, note) if head and note else (head or note))
        elif str(item).strip():
            out.append(str(item).strip())
    return [line for line in out if line]


def to_markdown(merged, panel, title):
    """把合并结果渲染成交付物的那份 Markdown。

    这份 `.md` 是**生成的视图**，不是手写的源。以前它是源，于是没有任何东西能约束
    里面写了什么、写了几条、有没有写。现在源是那张受校验的表，这里只负责把它排出来。
    """
    response = (panel.get("response") or {}).get("metric") or ""
    lines = ["---", "step: business-validation/page", "skill: business-validation",
             "derivedFrom: %s" % SLOTS_REL,
             'responseMetric: "%s"' % response,
             "generatedBy: charts.book", "---", "",
             "# %s" % title, "",
             "> 这份文档是图册的文字版，由 `charts.book` 从 "
             "`artifacts/s2/chart-analyses.yaml` 生成。**改这里没有用** —— "
             "下一次重出会覆盖它。要改解读，改那张表。", ""]
    for card in (panel.get("cards") or []):
        path = card.get("path") or ""
        block = merged.get(path)
        lines.append("## %s" % path)
        lines.append("")
        if not block:
            lines.append("（这张卡没有解读槽位 —— 重新跑一次 validation.analyses）")
            lines.append("")
            continue
        record = block["record"]
        lines.append("**AI analysis · %s**" % (record.get("filterLabel") or ""))
        if block["source"] != WRITTEN:
            lines.append("")
            lines.append("*%s*" % (block["note"] or "没有人写这张卡的解读，"
                                                   "下面是计算读数。"))
        lines.append("")
        lines.append(str(record.get("headline") or "").strip())
        lines.append("")
        for field, label in SECTIONS:
            rows = lines_of(record, field)
            if not rows:
                continue
            lines.append("### %s" % label)
            lines.extend(rows)
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"
