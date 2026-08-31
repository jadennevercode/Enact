"""图册的外壳 —— 一个 L1›L2›L3 因子路径一张卡，其余全部交给页面。

这个文件**不画任何几何，也不写任何数字**。它出的是骨架：HTML 结构、每张卡的空槽位、
把算好的结果和那几个 JS 文件原样内联进去，再把解读按卡片路径分发到对应的槽里。

**图是在浏览器里画的。** 这是架构 D10 有意推翻的一条旧决定，理由与机制都写在
`shared/fold-contract.md`：这套筛选器（时间粒度 × 品牌 × 渠道 × 区域 × 数据来源子集 ×
L4–L8 路径 × 指标子集）的状态空间是组合爆炸的，预先算好不是「不算」，是把同一批算术
做一百万次再塞进页面。所以页面归约，而归约被逐位验证过两次：生成前 node 重放一遍，
打开时页面自己再重放一遍。

**两个渲染器漂移的风险不是被管理掉的，是被构造消除的**：这里已经没有第二套画法。

**这一页里没有任何签核控件。** 签核是状态，页面是视图；两处可写就一定会分叉，而分叉
要到下一次重出图册时才暴露，那时人已经以为签过了。客户否掉的指标记在别处。
"""
from __future__ import annotations

import json
import os

import engagement as eng

from . import analyses as A, palette

PANEL_REL = "data/derived/validation-panel.json"
ANOMALIES_REL = "data/derived/anomalies.json"
READING_REL = "artifacts/s2/business-validation.md"
ANALYSES_REL = A.SLOTS_REL

DEFAULT_OUT = "artifacts/s2/chart-book.html"

#: 拼进页面的顺序是固定的：内核在最前，接线在最后。node 读的是同一批字节。
SCRIPTS = ("fold.js", "format.js", "render.js", "controls.js", "table.js",
           "selfcheck.js", "boot.js")

HERE = os.path.dirname(os.path.realpath(__file__))


# ── 读产物 ────────────────────────────────────────────────────────────

def _read_json(root, rel):
    path = os.path.join(root, rel)
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def load(root):
    """图册要用的三份东西。缺哪一份都不假装有 —— 缺了就在页面上说缺了。"""
    panel = _read_json(root, PANEL_REL)
    if panel is None:
        raise FileNotFoundError(
            "%s 不在。先跑 validation.panel —— 图册只搬运算好的结果。" % PANEL_REL)
    if not (panel.get("cards") or []):
        raise ValueError("%s 里一张卡都没有：%s"
                         % (PANEL_REL, panel.get("reason") or "没写原因"))
    return {"panel": panel,
            "anomalies": _read_json(root, ANOMALIES_REL) or {},
            "analyses": A.merge(root)}


def assets():
    """内联的 JS 与 CSS，按固定顺序读回来。

    它们是**真实文件**，不是 Python 里的字符串常量：node 要 import 页面运行的同一批
    字节，跨端比对才有意义。
    """
    scripts = []
    for name in SCRIPTS:
        with open(os.path.join(HERE, "js", name), encoding="utf-8") as handle:
            scripts.append("/* %s */\n%s" % (name, handle.read()))
    with open(os.path.join(HERE, "css", "page.css"), encoding="utf-8") as handle:
        page_css = handle.read()
    return "\n".join(scripts), page_css


# ── 出页面 ────────────────────────────────────────────────────────────

#: 生成时那次跨端比对的结论，写进 `<html data-selfcheck>`。**这是一句关于构建的话**，
#: 不是关于此刻这份文件的话 —— 文件被手改过，它照样这么写。抓手改的是运行记录里的
#: `payloadSha`。页面打开后 `boot.js` 会用浏览器自己的结论覆盖这个属性。
_VERDICT_ATTR = {"verified": "ok", "browser-only": "browser-only",
                 "skipped": "skipped"}


def render(data, title, sources, verdict="verified"):
    panel = data["panel"]
    scripts, page_css = assets()
    cards = "\n".join(_card(card, data["analyses"]) for card in panel["cards"])
    aside, headings = _capsules(data["anomalies"]), []
    return _PAGE % {
        "title": _esc(title),
        "heading": _esc("%s · %d factors" % (title, len(panel.get("cards") or []))),
        "lede": _esc(_lede(panel)),
        "responseY": _esc("Response Y: %s"
                          % ((panel.get("response") or {}).get("metric") or "—")),
        "selfcheck": _esc(_VERDICT_ATTR.get(verdict, "skipped")),
        "css": palette.css_tokens() + "\n" + page_css,
        "provenance": _provenance(sources, verdict),
        "aside": _aside(aside + _notices(data, headings), headings),
        "cards": cards,
        "panel": _json_for_html(panel),
        "scripts": scripts,
    }


def _aside(blocks, headings):
    """异常胶囊与各种提示，**默认收起来，但标题上写着有几条**。

    产品的页头与第一张卡之间什么都没有；而这些块每一条都在报告一个真实条件，静默
    缺失比明说糟。折叠是这两件事唯一的交集 —— 收起来的不是信息，是版面：摘要行上
    列着每一条的标题，读的人一眼知道有什么、点一下看细节。
    """
    if not blocks.strip():
        return ""
    summary = "Data notes · %d" % len(headings)
    if headings:
        summary += "：" + "、".join(headings)
    return ('<details id="notices"><summary>%s</summary>%s</details>'
            % (_esc(summary), blocks))


def _lede(panel):
    """页头那一句。照产品的写法：说清楚这一页是拿来干什么的，不罗列维度。"""
    response = (panel.get("response") or {}).get("metric") or "the response"
    return ("Explore each factor against %s — adjust axes, chart type, and "
            "dimensions freely." % response)


#: 页脚怎么说那次比对。**没验过的时候必须说没验过** —— 一句「两端比对过」印在一份
#: 谁也没比对过的页面上，比不印更糟。
_PROVENANCE_NOTE = {
    "verified": "算法两端比对过，一个也不是手写的。",
    "browser-only": ("生成这一页的机器上没有 node，**算法没有做跨端比对** —— "
                     "你打开它的时候浏览器会自己校验一遍。"),
    "skipped": "**跨端比对被跳过了**，这一页的算法没有被验证过。",
}


def _provenance(sources, verdict="verified"):
    rows = "".join("<div><code>%s</code> · sha256 %s…</div>"
                   % (_esc(rel), _esc(digest[:16])) for rel, digest in sources)
    return ('<p class="provenance">这一页上的每个数都从下面这份计算结果算出来，'
            "%s<br>%s</p>"
            % (_PROVENANCE_NOTE.get(verdict, _PROVENANCE_NOTE["skipped"]), rows))


def _capsules(anomalies):
    """页头的异常胶囊。**只扫响应变量。**

    平台的旧实现在认不出销量时会退化成把整张表的指标加起来 —— 人民币、摄氏度、比率
    加到一起，然后在那上面报异常。认不出就一条都不报，并说清楚去哪里标。
    """
    cards = anomalies.get("cards")
    if cards is None:
        return ('<div class="notice"><h3>异常还没扫过</h3><ul><li>没找到 %s —— '
                "先跑 validation.anomalies</li></ul></div>" % ANOMALIES_REL)
    if not cards:
        why = anomalies.get("reason") or "没有哪个渠道的年度同比越过阈值"
        return ('<div class="notice"><h3>没有异常</h3><ul><li>%s。0 个异常是一个'
                "结论，不是一处空白。</li></ul></div>" % _esc(why))
    pct = (anomalies.get("rule") or {}).get("pct", 40)
    items = "".join(
        '<span class="capsule">%s %s <strong>%+.1f%%</strong>%s</span>'
        % (_esc(c.get("channel", "")), _esc(c.get("year", "")),
           float(c.get("growthPct") or 0),
           ('<span class="why">%s</span>'
            % _esc((c.get("evidence") or {}).get("windowNote") or ""))
           if (c.get("evidence") or {}).get("windowNote") else "")
        for c in cards)
    return ('<h2>需要解释的年度波动</h2>'
            '<p class="lede">响应变量按渠道的年度同比，超过 ±%g%% 的都在这里。'
            "每一条都要有一个说法，并且定下它在模型里怎么处理。</p>"
            '<div class="capsules">%s</div>' % (pct, items))


def _notices(data, headings=None):
    """没显示的、推断的、被上一层否掉的，都印在页面上。

    静默缺失比明说糟得多：客户在会上问「分渠道看呢」，答不上来的就是这一步。
    """
    panel, blocks = data["panel"], []
    not_shown = panel.get("notShown") or []
    if not_shown:
        blocks.append(_notice_h(headings, "这些维度没有做成筛选",
                              ["%s：%s" % (n.get("what", ""), n.get("why", ""))
                               for n in not_shown]))
    meta = panel.get("metricMeta") or {}
    guessed = sorted(m for m, b in meta.items() if b.get("source") != "tree")
    if guessed:
        blocks.append(_notice_h(headings, 
            "这些指标的汇总方式没有人在因子树里定过",
            ["%s（按 %s 处理，%s）"
             % (m, meta[m].get("agg") or "",
                "来自指标登记表" if meta[m].get("source") == "coverage"
                else "按名字推断的")
             for m in guessed[:8]]
            + (["…另有 %d 个" % (len(guessed) - 8)] if len(guessed) > 8 else [])
            + ["定错的那个会被一路带到模型里，而图上看不出来。"]))
    substituted = sorted(m for m, b in meta.items() if b.get("aggNote"))
    if substituted:
        blocks.append(_notice_h(headings, 
            "这些指标定的汇总方式，这一页做不了",
            ["%s：%s" % (m, meta[m]["aggNote"]) for m in substituted]))
    dropped = panel.get("dropped") or {}
    if dropped.get("count"):
        blocks.append(_notice_h(headings, "这些指标没有画出来",
                              ["%d 个 —— %s" % (dropped["count"], dropped.get("why", ""))]))
    unwritten = sorted(path for path, block in (data.get("analyses") or {}).items()
                       if block["source"] != A.WRITTEN)
    if unwritten:
        blocks.append(_notice_h(headings, 
            "这些卡显示的是计算读数，不是有人写的解读",
            unwritten[:8]
            + (["…另有 %d 张" % (len(unwritten) - 8)] if len(unwritten) > 8 else [])
            + ["计算读数是刻意平实的：它读出数据做了什么，不做判断。"]))
    return "\n".join(blocks)


def _notice_h(headings, heading, lines):
    return _notice(heading, lines, headings)


def _notice(heading, lines, headings=None):
    if headings is not None:
        headings.append(heading)
    items = "".join("<li>%s</li>" % _esc(line) for line in lines)
    return ('<div class="notice"><h3>%s</h3><ul>%s</ul></div>'
            % (_esc(heading), items))


def _card(card, merged):
    """一张卡的空壳。图形、控件由页面在打开时填；解读在这里就渲染好。

    解读是**服务端渲染**的：它的结构是定死的五段，不需要页面参与，而且这样它在
    没有 JS 的环境里（比如打印、邮件预览）也读得到。
    """
    return _CARD % {
        "path": _esc(card["path"]),
        "crumb": _esc("%s › %s" % (card["l1"], card["l2"])),
        "l3": _esc(card["l3"]),
        "analysis": _analysis(merged.get(card["path"])),
    }


def _analysis(block):
    """AI analysis 区块。**结构固定** —— 一句话结论 + 四个可选小节。

    区块标题（AI analysis / TRENDS / ANOMALIES / …）是英文的产品骨架；正文跟项目
    语言走。没人写的那张显示计算读数，并且这件事写在标题旁边，不藏起来。
    """
    if not block:
        return ('<section class="analysis"><p class="empty">'
                "这张卡没有解读槽位 —— 重新跑一次 validation.analyses。</p></section>")
    record, source = block["record"], block["source"]
    badge = "" if source == A.WRITTEN else (
        '<span class="computed" title="%s">Computed readout</span>'
        % _esc(block["note"] or "没有人写这张卡的解读，下面是从数据算出来的读数。"))

    body = ['<p class="headline">%s</p>' % _esc(record.get("headline") or "")]
    for field, label in A.SECTIONS:
        rows = A.lines_of(record, field)
        if not rows:
            continue
        body.append('<h4 class="section-label">%s</h4>' % label)
        body.append("<ul>%s</ul>"
                    % "".join("<li>%s</li>" % _esc(line) for line in rows))

    return _ANALYSIS % {
        "label": _esc(record.get("filterLabel") or ""),
        "badge": badge,
        "body": "".join(body),
        "note": ('<p class="stale">%s</p>' % _esc(block["note"])) if block["note"] else "",
    }


def _json_for_html(value):
    """内联 JSON。`</script>` 与 U+2028/9 会把脚本块切断，所以先转义。"""
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return (text.replace("<", "\\u003c").replace(">", "\\u003e")
            .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def _esc(text):
    return (str("" if text is None else text)
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


_ANALYSIS = """<section class="analysis">
  <div class="analysis-head">
    <span class="spark">&#10022;</span>
    <span class="analysis-title">AI analysis · %(label)s</span>
    %(badge)s
    <span class="grow"></span>
    <button type="button" class="linky" data-role="ask">Ask about this chart</button>
    <button type="button" class="linky" data-role="regen">Regenerate</button>
  </div>
  <div class="popover" data-pop="ask" hidden></div>
  <div class="popover" data-pop="regen" hidden></div>
  %(note)s
  <div class="analysis-body">%(body)s</div>
</section>
"""

#: 槽位顺序照产品：筛选 → 图 → 刷选 → 图例 → 说明 → 解读 → 年度表。
#: 刷选在图例**之上**（与改版前相反）：刷的是时间轴，它该紧贴着轴；图例是读图的
#: 图注，该在最下面。
_CARD = """<article class="card" data-card="%(path)s">
  <div class="card-head">
    <span class="crumb">%(crumb)s</span>
    <h2>%(l3)s</h2>
    <span class="grow"></span>
    <span class="typemark" data-slot="typemark" hidden></span>
  </div>
  <div class="filter-row" data-slot="filters"></div>
  <div class="plot">
    <div data-slot="chart"></div>
    <div class="tip" data-slot="tip" hidden></div>
  </div>
  <div class="brushbar" data-slot="brush"></div>
  <div class="legend" data-slot="legend"></div>
  <div class="notes" data-slot="notes"></div>
  %(analysis)s
  <div class="yearly-wrap" data-slot="table"></div>
</article>
"""

#: 一个文件。没有 CDN、没有 npm、没有构建步骤，深浅两套都写全 ——
#: 一页纸在哪儿被打开就在哪儿被读。
_PAGE = """<!doctype html>
<html lang="zh-CN" data-selfcheck="%(selfcheck)s">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%(title)s</title>
<style>
%(css)s
</style>
<body>
<div class="wrap">
  <header class="page-head">
    <h1>%(heading)s</h1>
    <p class="lede">%(lede)s</p>
    <p class="response-y">%(responseY)s</p>
  </header>
  %(aside)s
  <div id="cards">
%(cards)s
  </div>
  <footer>%(provenance)s</footer>
</div>
<script>
window.__PANEL__ = %(panel)s;
</script>
<script>
%(scripts)s
</script>
</body>
</html>
"""
