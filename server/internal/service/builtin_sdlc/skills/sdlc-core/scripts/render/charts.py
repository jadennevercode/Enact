"""matrix / tree / compare / report renderers.

None of these need SVG for their main content. A traceability matrix drawn in
SVG loses text selection, Ctrl+F, sticky headers, print pagination and screen
reader semantics -- an HTML table gets all of that for free.
"""

import re
from difflib import SequenceMatcher

from .base import GLYPH, LABEL, bullet, esc, sr_only, state_cell

# --- matrix ----------------------------------------------------------------

_RISK = {"missing": 3, "unknown": 3, "partial": 1, "planned": 1, "full": 0, "na": 0}


def matrix(rows, columns, title, row_label="验收标准", note=""):
    """Traceability matrix / coverage heat map.

    rows: [{"id","text","cells":{col:state},"refs":{col:[str]}}]

    The single most important decision here is inverse ink: normal cells are
    nearly invisible so the eye scans ink *density*, not hue. A heat map where
    every cell is coloured carries as much information as a blank one.

    The second is that gaps are filled in explicitly. Blank space does not
    attract attention, so "not covered" renders as ✕ rather than as nothing --
    otherwise the one thing a reviewer most needs to see is the one thing
    drawn with no ink at all.
    """
    if not rows:
        return f'<section class="chart"><h3>{esc(title)}</h3><p class="empty">没有可显示的行。</p></section>'

    def risk(row):
        return sum(_RISK.get(row["cells"].get(c), 0) for c in columns)

    ordered = sorted(rows, key=lambda r: (-risk(r), str(r["id"])))
    total_cells = len(rows) * max(len(columns), 1)
    missing = sum(1 for r in rows for c in columns if r["cells"].get(c) in ("missing", "unknown"))

    head = "".join(f'<th scope="col" class="colh"><span>{esc(c)}</span></th>' for c in columns)
    body = []
    for row in ordered:
        states = [row["cells"].get(c, "missing") for c in columns]
        covered = sum(1 for s in states if s == "full")
        empty = all(s in ("missing", "unknown") for s in states)
        cells = "".join(
            state_cell(row["cells"].get(c, "missing"), row.get("refs", {}).get(c))
            for c in columns
        )
        flag = '<span class="rowflag" title="整行无覆盖">⚠</span>' if empty else ""
        body.append(
            f'<tr class="{"row-empty" if empty else ""}">'
            f'<th scope="row" class="rowh">{flag}<code>{esc(row["id"])}</code>'
            f'<span class="rowtext">{esc(row.get("text", ""))}</span></th>'
            f'<td class="spark-cell">{bullet(covered, None, len(columns))}'
            f'<span class="frac">{covered}/{len(columns)}</span></td>'
            f"{cells}</tr>"
        )

    # Column totals expose the reverse question: a task or test that covers nothing.
    foot = "".join(
        f'<td class="colsum{" zero" if not sum(1 for r in rows if r["cells"].get(c) == "full") else ""}">'
        f'{sum(1 for r in rows if r["cells"].get(c) == "full")}</td>'
        for c in columns
    )

    return f"""<section class="chart">
<h3>{esc(title)}</h3>
<p class="lede">{'共 %d 项，<strong class="bad">%d 处缺口</strong>。' % (len(rows), missing) if missing else '共 %d 项，无缺口。' % len(rows)}
<span class="hint">按缺口严重度降序排列，不按编号。</span>{(' ' + esc(note)) if note else ''}</p>
<div class="scrollx"><table class="matrix">
<thead><tr><th scope="col">{esc(row_label)}</th><th scope="col">覆盖</th>{head}</tr></thead>
<tbody>{''.join(body)}</tbody>
<tfoot><tr><th scope="row" colspan="2">各列已覆盖数</th>{foot}</tr></tfoot>
</table></div>
{legend()}
</section>"""


def legend():
    items = "".join(
        f'<span class="lg"><span class="m {k}" aria-hidden="true">{GLYPH[k]}</span> {esc(v)}</span>'
        for k, v in LABEL.items()
    )
    return f'<p class="legend">{items}</p>'


# --- tree ------------------------------------------------------------------

_TREE_ORDER = {"未决": 0, "unknown": 0, "有假设": 1, "partial": 1, "已确认": 2, "full": 2, "不适用": 3, "na": 3}
_TREE_STATE = {"已确认": "full", "有假设": "partial", "未决": "unknown", "不适用": "na"}


def tree(items, title, note=""):
    """Hierarchical coverage: a stacked bar plus a sorted list. No SVG tree.

    "不适用" and "未决" must sit at opposite ends of the visual spectrum. One is
    benign (someone judged it irrelevant), the other is malignant (nobody has
    looked). Rendering them in similar greys is the most common semantic mix-up
    in governance reports, and it hides exactly the rows that need attention.
    """
    if not items:
        return f'<section class="chart"><h3>{esc(title)}</h3><p class="empty">没有可显示的维度。</p></section>'

    counts = {}
    for it in items:
        counts[it.get("status", "未决")] = counts.get(it.get("status", "未决"), 0) + 1

    total, x, bars, legend_bits = len(items), 0.0, [], []
    for status in ("已确认", "有假设", "未决", "不适用"):
        n = counts.get(status, 0)
        if not n:
            continue
        w = 100 * n / total
        state = _TREE_STATE[status]
        bars.append(f'<rect x="{x:.2f}" y="0" width="{w:.2f}" height="10" class="tb {state}"/>')
        legend_bits.append(f'<span class="lg"><span class="m {state}" aria-hidden="true">'
                           f'{GLYPH[state]}</span> {esc(status)} {n}</span>')
        x += w

    rows = []
    for it in sorted(items, key=lambda i: (_TREE_ORDER.get(i.get("status", "未决"), 9), str(i.get("name")))):
        status = it.get("status", "未决")
        state = _TREE_STATE.get(status, "unknown")
        rows.append(
            f'<li class="{state}"><span class="m {state}" aria-hidden="true">{GLYPH[state]}</span>'
            f"{sr_only(status)}"
            f'<span class="tname">{esc(it.get("name"))}</span>'
            f'<span class="tconc">{esc(it.get("conclusion") or "（未填结论）")}</span></li>'
        )

    unresolved = counts.get("未决", 0)
    return f"""<section class="chart">
<h3>{esc(title)}</h3>
<p class="lede">{'<strong class="bad">%d 个维度未决</strong>——没人看过，不是判定为不需要。' % unresolved if unresolved else '所有维度都有结论。'}
{esc(note)}</p>
<svg class="stack" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="维度状态分布">
{''.join(bars)}</svg>
<p class="legend">{''.join(legend_bits)}</p>
<ul class="tree">{''.join(rows)}</ul>
</section>"""


# --- compare ---------------------------------------------------------------

def diff_lines(old_text, new_text, title, context=3):
    """Line diff with an inline character-level pass on replaced pairs.

    Without the inline pass the reviewer still has to compare two columns
    character by character, which is the work the diff was supposed to remove.
    The +/- prefixes matter as much as the colours: a printer can drop
    background colours, it cannot drop a character.
    """
    old = str(old_text or "").splitlines()
    new = str(new_text or "").splitlines()
    out, matcher = [], SequenceMatcher(None, old, new)
    opcodes = matcher.get_opcodes()

    for tag_, i1, i2, j1, j2 in opcodes:
        if tag_ == "equal":
            block = old[i1:i2]
            if len(block) > context * 2 + 1:
                block = block[:context] + [f"⋯ 省略 {len(block) - context * 2} 行未变更 ⋯"] + block[-context:]
            out += [f'<div class="dl eq"><span class="pfx"> </span>{esc(line)}</div>' for line in block]
        elif tag_ == "delete":
            out += [f'<div class="dl del"><span class="pfx">−</span>{esc(line)}</div>' for line in old[i1:i2]]
        elif tag_ == "insert":
            out += [f'<div class="dl ins"><span class="pfx">+</span>{esc(line)}</div>' for line in new[j1:j2]]
        else:
            for k in range(max(i2 - i1, j2 - j1)):
                o = old[i1 + k] if i1 + k < i2 else ""
                n = new[j1 + k] if j1 + k < j2 else ""
                out.append(f'<div class="dl del"><span class="pfx">−</span>{_inline(o, n, "a")}</div>')
                out.append(f'<div class="dl ins"><span class="pfx">+</span>{_inline(o, n, "b")}</div>')

    changed = sum(1 for t, *_ in opcodes if t != "equal")
    return f"""<section class="chart">
<h3>{esc(title)}</h3>
<p class="lede">{'%d 处变更。' % changed if changed else '无差异。'}</p>
<div class="diff">{''.join(out)}</div>
</section>"""


def _inline(a, b, side):
    """Mark the characters that actually changed inside a replaced line pair."""
    parts = []
    for tag_, i1, i2, j1, j2 in SequenceMatcher(None, a, b).get_opcodes():
        seg = a[i1:i2] if side == "a" else b[j1:j2]
        if not seg:
            continue
        parts.append(esc(seg) if tag_ == "equal" else f"<mark>{esc(seg)}</mark>")
    return "".join(parts)


def set_compare(declared, actual, title, declared_label="已声明", actual_label="实际"):
    """Three partitions, not a Venn diagram -- areas cannot be read precisely.

    Visual weight goes to the two edges; the agreeing middle collapses.
    """
    d, a = set(declared or []), set(actual or [])
    only_d, both, only_a = sorted(d - a), sorted(d & a), sorted(a - d)

    def block(items, cls, label, why):
        if not items:
            return f'<div class="part {cls} empty-part"><h4>{esc(label)} <span class="badge">0</span></h4></div>'
        lis = "".join(f"<li><code>{esc(i)}</code></li>" for i in items)
        return (f'<div class="part {cls}"><h4>{esc(label)} <span class="badge">{len(items)}</span></h4>'
                f'<p class="why">{esc(why)}</p><ul>{lis}</ul></div>')

    middle = (f'<details class="part both"><summary>两者一致 <span class="badge">{len(both)}</span></summary>'
              f'<ul>{"".join(f"<li><code>{esc(i)}</code></li>" for i in both)}</ul></details>')

    return f"""<section class="chart">
<h3>{esc(title)}</h3>
{block(only_d, "only-declared", f"仅{declared_label}", "声明了但没有对应的实际内容")}
{middle}
{block(only_a, "only-actual", f"仅{actual_label}", "实际存在但没有声明——范围蔓延，无授权")}
</section>"""


# --- report ----------------------------------------------------------------

def kpi_cards(cards):
    """Big numbers with a reference frame. An isolated "23" means nothing.

    Cards that flag a problem break format: heavier border, severity rail, and
    they sort first. Five identical-looking cards are the same as no cards.
    """
    if not cards:
        return ""
    out = []
    for c in sorted(cards, key=lambda c: (0 if c.get("state") in ("bad", "warn") else 1, c.get("label", ""))):
        state = c.get("state", "info")
        target = c.get("target")
        vmax = c.get("max") or (max(c.get("value", 0), target or 0) or 1)
        ref = ""
        if target is not None:
            ref = f'<span class="ref">目标 {esc(target)}</span>'
        elif c.get("of"):
            ref = f'<span class="ref">/ {esc(c["of"])}</span>'
        spark = bullet(c.get("value", 0), target, vmax, cls=state) if c.get("show_bar", True) else ""
        note = f'<span class="cnote">{esc(c["note"])}</span>' if c.get("note") else ""
        out.append(
            f'<div class="kpi k-{esc(state)}"><span class="klabel">{esc(c.get("label"))}</span>'
            f'<span class="kvalue">{esc(c.get("value"))}</span>{ref}{spark}{note}</div>'
        )
    return f'<div class="kpis">{"".join(out)}</div>'


def verdict_banner(state, headline, decisions):
    """First screen must answer: can it pass, what is missing, who decides.

    Everything else in the document is supporting evidence for this block.
    """
    labels = {"pass": "可以放行", "conditional": "有条件放行", "block": "不可放行", "info": "情况说明"}
    items = "".join(
        f'<li><a href="#{esc(d.get("anchor", ""))}">{esc(d.get("text"))}</a>'
        f'{" — " + esc(d["owner"]) if d.get("owner") else ""}</li>'
        for d in (decisions or [])
    )
    body = (f'<p class="dq">需要你决策的 {len(decisions)} 件事：</p><ol class="decisions">{items}</ol>'
            if decisions else '<p class="dq">没有需要你现在决策的事项。</p>')
    return f"""<section class="verdict v-{esc(state)}">
<p class="vlabel">{esc(labels.get(state, state))}</p>
<h2 class="vhead">{esc(headline)}</h2>
{body}
</section>"""


def section(anchor, heading, conclusion, detail_html="", detail_summary="", open_by_default=False):
    """Conclusion first, then the evidence. Detail folds away past ten items."""
    detail = ""
    if detail_html:
        if detail_summary:
            detail = (f'<details{" open" if open_by_default else ""}>'
                      f"<summary>{esc(detail_summary)}</summary>{detail_html}</details>")
        else:
            detail = detail_html
    return (f'<section id="{esc(anchor)}" class="sec"><h2>{esc(heading)}</h2>'
            f'<p class="conclusion">{esc(conclusion)}</p>{detail}</section>')


def simple_table(headers, rows, cls=""):
    head = "".join(f'<th scope="col">{esc(h)}</th>' for h in headers)
    body = "".join("<tr>" + "".join(f"<td>{c if isinstance(c, str) and c.startswith('<') else esc(c)}</td>"
                                    for c in r) + "</tr>" for r in rows)
    return f'<div class="scrollx"><table class="{esc(cls)}"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'
