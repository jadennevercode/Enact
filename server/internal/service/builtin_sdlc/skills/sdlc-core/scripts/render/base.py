"""Shared primitives for the review renderers: escaping, palette, defs, theme.

Design rule that drives everything here: every layer must degrade to text.

    L0  text and tables       always works -- print, Ctrl+F, screen readers
    L1  hand-written SVG      no network, no JS, black-and-white print
    L2  pure-CSS interaction  no JS
    L3  mermaid via CDN       online only, degrades to a code block

Anything that exists only in a tooltip, only in colour, or only inside mermaid
does not exist. Reviewers print these pages and search them.
"""

from html import escape as _escape

# Okabe-Ito subset. Chosen because these stay distinguishable under all three
# common colour-vision deficiencies AND have different luminances, which is what
# makes them survive greyscale printing. Never use pure red/green -- that pair is
# both the least distinguishable for deuteranopia and the closest in greyscale.
PALETTE = {
    "ok": "#009E73",
    "warn": "#E69F00",
    "bad": "#D55E00",
    "info": "#0072B2",
    "muted": "#767676",
}

# Three-way encoding: colour + glyph + text label. Two of the three must survive
# in any medium. Glyphs are geometric Unicode present in essentially every font.
GLYPH = {"full": "●", "partial": "◐", "planned": "○", "missing": "✕", "na": "–", "unknown": "?"}
LABEL = {
    "full": "已覆盖",
    "partial": "部分覆盖",
    "planned": "计划中",
    "missing": "无覆盖",
    "na": "不适用",
    "unknown": "证据缺失",
}


def esc(value):
    return _escape("" if value is None else str(value), quote=True)


def attrs(**kw):
    """class_ -> class, data_state -> data-state. None/False skipped, True bare."""
    out = []
    for key, val in kw.items():
        if val is None or val is False:
            continue
        key = key.rstrip("_").replace("_", "-")
        out.append(key if val is True else f'{key}="{esc(val)}"')
    return (" " + " ".join(out)) if out else ""


def tag(name, inner="", **kw):
    return f"<{name}{attrs(**kw)}>{inner}</{name}>"


def _linear(channel):
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def luminance(hex_color):
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * _linear(r) + 0.7152 * _linear(g) + 0.0722 * _linear(b)


def contrast(a, b):
    lo, hi = sorted((luminance(a), luminance(b)))
    return (hi + 0.05) / (lo + 0.05)


def on_color(background):
    """Pick black or white foreground so the pair clears 4.5:1."""
    return "#000000" if contrast(background, "#000000") >= contrast(background, "#ffffff") else "#ffffff"


# Startup self-check rather than eyeballing: adjacent severities must stay apart
# in greyscale, or the palette silently stops working on a black-and-white printer.
assert abs(luminance(PALETTE["warn"]) - luminance(PALETTE["bad"])) > 0.10, "warn/bad 在灰度下不可分"
assert contrast(PALETTE["bad"], "#ffffff") > 3.0, "bad 在白底上对比度不足"


def fit_text(text, max_px, font_px=12.0):
    """Truncate to an estimated pixel width.

    There is no browser at generation time, so getBBox/measureText are not
    available. CJK counts as 1.0em, everything else 0.55em -- close enough for
    node labels, and the full string still goes into <title> and the node table.
    """
    width, out = 0.0, []
    for char in str(text):
        advance = font_px * (1.0 if ord(char) > 0x2E80 else 0.55)
        if width + advance > max_px - font_px * 0.6:
            return "".join(out) + "…"
        width += advance
        out.append(char)
    return str(text)


# Emitted once per document. SVG elements in one document share an id space, so
# `fill="url(#p-diag)"` works across every inline <svg> below this point.
GLOBAL_DEFS = """<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">
 <defs>
  <pattern id="p-diag" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" stroke-width="2" opacity=".55"/>
  </pattern>
  <pattern id="p-dots" width="5" height="5" patternUnits="userSpaceOnUse">
    <circle cx="1.5" cy="1.5" r="1.1" fill="currentColor" opacity=".45"/>
  </pattern>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"
          orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/>
  </marker>
 </defs>
</svg>"""


def sr_only(text):
    """Real text for screen readers behind an aria-hidden glyph."""
    return f'<span class="sr-only">{esc(text)}</span>'


def state_cell(state, refs=None, extra_class=""):
    """One matrix cell carrying all three encodings."""
    label = LABEL.get(state, state)
    title = f'{label}: {", ".join(refs)}' if refs else label
    return (
        f'<td class="m {esc(state)} {esc(extra_class)}" data-state="{esc(state)}" title="{esc(title)}">'
        f'<span aria-hidden="true">{GLYPH.get(state, "?")}</span>{sr_only(label)}</td>'
    )


def bullet(value, target, vmax, width=64, height=8, cls="ok"):
    """Bullet graph, not a gauge -- more precision in a fraction of the space."""
    if not vmax:
        return ""
    fill = width * min(value / vmax, 1)
    mark = width * min(target / vmax, 1) if target else None
    line = (f'<line x1="{mark:.1f}" y1="-1" x2="{mark:.1f}" y2="{height + 1}" class="sp-target"/>'
            if mark is not None else "")
    return (
        f'<svg class="spark" viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
        f'aria-hidden="true" focusable="false">'
        f'<rect x="0" y="0" width="{width}" height="{height}" class="sp-bg" rx="2"/>'
        f'<rect x="0" y="0" width="{fill:.1f}" height="{height}" class="sp-{esc(cls)}" rx="2"/>'
        f"{line}</svg>"
    )


def mermaid_figure(source, caption, index):
    """L3. Renders when online; stays a readable code block otherwise.

    mermaid stamps data-processed="true" on success, so the whole degrade path is
    one attribute selector and zero JS branching. Anything that must survive
    printing is drawn as hand-written SVG instead -- print can fire before
    mermaid finishes, and then the page shows source where a diagram should be.
    """
    if not str(source or "").strip():
        return ""
    return (
        f'<figure class="mmd">'
        f'<pre class="mermaid">{esc(source.strip())}</pre>'
        f'<figcaption>图 {index}：{esc(caption)}'
        f'<span class="hint">（无网络时此处显示为图定义源码，内容等价）</span>'
        f"</figcaption></figure>"
    )


MERMAID_SCRIPT = """<script type="module">
try {
  const m = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
  m.default.initialize({
    startOnLoad: false, securityLevel: 'strict',
    theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default'
  });
  await m.default.run({ querySelector: 'pre.mermaid' });
} catch (e) { /* 静默降级：源码本身就是可读内容 */ }
</script>"""
