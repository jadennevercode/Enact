"""render.html — one self-contained page a human opens.

No CDN, no npm, no build step: inline SVG and inline CSS in a single file that
works from a filesystem, in an email, and in five years. The platform's answer to
this was a React app; the runtime's is a file.

The chart role is fixed by what the series **is** — response = area,
spend = line, everything else = bars. A chart whose type changes between runs is a
chart nobody can compare month to month.

Every page stamps the payload it was rendered from and that payload's hash, which
is what `view_derived_from` checks. A rendered document is a **view**: nobody edits
it, and the next render replaces it.
"""
from __future__ import annotations

import html
import json

from mmm_engine.cli.registry import Arg, Result, tool
from mmm_engine.trace import sha256_file

W, H = 720, 220
PAD_L, PAD_R, PAD_T, PAD_B = 56, 16, 16, 30


@tool("render.html", "render",
      "Render a payload as one self-contained HTML page. No external assets.",
      args=[Arg("--payload", "the computed payload to render", required=True),
            Arg("--title", "page title")],
      out_default="")
def render_html(ctx) -> Result:
    result = Result()
    rel = str(ctx.opt("payload"))
    source = ctx.path(rel)
    if not source.is_file():
        result.ok = False
        return result.find("%s does not exist — run the tool that produces it" % rel)

    data = json.loads(source.read_text(encoding="utf-8"))
    # The total only. This renders one static page per payload; the sliced views
    # belong to the chart book, which can switch between them without redrawing.
    charts = [c for c in (data.get("charts") or []) if not c.get("sliceKey")]
    if not charts:
        result.ok = False
        return result.find("%s carries no charts" % rel)

    title = str(ctx.opt("title") or "Business validation")
    digest = sha256_file(source)
    body = [_chart_svg(c) for c in charts]

    result.payload = _PAGE % {
        "title": html.escape(title),
        "source": html.escape(rel),
        "hash": digest[:16],
        "charts": "\n".join(body),
    }
    if ctx.out is None:
        result.ok = False
        return result.find("pass --out")
    result.say("%d chart(s) rendered from %s" % (len(charts), rel))
    result.say("payload sha256 %s… stamped into the page" % digest[:16])
    result.say("")
    result.say("A view, not a document: nobody edits it, and re-rendering replaces it.")
    return result


def _chart_svg(chart: dict) -> str:
    xs, ys = chart.get("x") or [], [float(v) for v in (chart.get("y") or [])]
    if not ys:
        return ""
    lo, hi = min(ys), max(ys)
    if hi == lo:
        hi = lo + 1.0
    span = hi - lo
    n = len(ys)

    def px(i):
        return PAD_L + (W - PAD_L - PAD_R) * (i / max(n - 1, 1))

    def py(v):
        return PAD_T + (H - PAD_T - PAD_B) * (1 - (v - lo) / span)

    role = chart.get("role", "bar")
    points = " ".join("%.1f,%.1f" % (px(i), py(v)) for i, v in enumerate(ys))
    if role == "area":
        shape = ('<polygon class="area" points="%.1f,%.1f %s %.1f,%.1f"/>'
                 '<polyline class="line" points="%s"/>'
                 % (px(0), py(lo), points, px(n - 1), py(lo), points))
    elif role == "line":
        shape = '<polyline class="line" points="%s"/>' % points
    else:
        width = max((W - PAD_L - PAD_R) / max(n, 1) * 0.62, 1.2)
        shape = "".join(
            '<rect class="bar" x="%.1f" y="%.1f" width="%.1f" height="%.1f"/>'
            % (px(i) - width / 2, py(v), width, max(py(lo) - py(v), 0.6))
            for i, v in enumerate(ys))

    ticks = []
    for i in (0, n // 2, n - 1):
        if 0 <= i < n:
            ticks.append('<text class="tick" x="%.1f" y="%d" text-anchor="middle">%s</text>'
                         % (px(i), H - 10, html.escape(str(xs[i]))))
    for value in (hi, lo):
        ticks.append('<text class="tick" x="%d" y="%.1f" text-anchor="end">%s</text>'
                     % (PAD_L - 8, py(value) + 4, _fmt(value)))

    label = "%s · %s" % (chart.get("l4", ""), chart.get("metric", ""))
    return _CHART % {
        "label": html.escape(label),
        "role": html.escape(role),
        "w": W, "h": H,
        "baseline": '<line class="axis" x1="%d" y1="%.1f" x2="%d" y2="%.1f"/>'
                    % (PAD_L, py(lo), W - PAD_R, py(lo)),
        "shape": shape,
        "ticks": "\n      ".join(ticks),
    }


def _fmt(value: float) -> str:
    if abs(value) >= 1_000_000:
        return "%.1fM" % (value / 1_000_000)
    if abs(value) >= 1_000:
        return "%.0fk" % (value / 1_000)
    return "%.4g" % value


_CHART = """    <figure class="chart" data-role="%(role)s">
      <figcaption>%(label)s <span class="role">%(role)s</span></figcaption>
      <svg viewBox="0 0 %(w)d %(h)d" role="img" aria-label="%(label)s">
      %(baseline)s
      %(shape)s
      %(ticks)s
      </svg>
    </figure>
"""

#: One file. Both themes, because a page is read wherever it is opened.
_PAGE = """<!doctype html>
<meta charset="utf-8">
<title>%(title)s</title>
<style>
  :root {
    --bg: #fbfbfa; --fg: #1a1a18; --muted: #6b6b65; --rule: #e0dfd9;
    --accent: #2f5d50; --accent-soft: #2f5d5022;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #16171a; --fg: #e9e8e4; --muted: #93938c; --rule: #2b2d31;
            --accent: #7fb3a1; --accent-soft: #7fb3a133; }
  }
  body { background: var(--bg); color: var(--fg); margin: 0 auto; max-width: 900px;
         padding: 2.5rem 1.25rem 4rem;
         font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
  .provenance { color: var(--muted); font-size: .8rem; margin-bottom: 2rem;
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .chart { margin: 0 0 2rem; padding-bottom: 1rem; border-bottom: 1px solid var(--rule); }
  figcaption { font-weight: 600; font-size: .9rem; margin-bottom: .35rem; }
  .role { color: var(--muted); font-weight: 400; font-size: .75rem;
          text-transform: uppercase; letter-spacing: .06em; margin-left: .4rem; }
  svg { width: 100%%; height: auto; display: block; overflow: visible; }
  .line { fill: none; stroke: var(--accent); stroke-width: 2;
          stroke-linejoin: round; stroke-linecap: round; }
  .area { fill: var(--accent-soft); stroke: none; }
  .bar  { fill: var(--accent); opacity: .78; }
  .axis { stroke: var(--rule); stroke-width: 1; }
  .tick { fill: var(--muted); font-size: 10px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
<h1>%(title)s</h1>
<p class="provenance">
  rendered from %(source)s &middot; sha256 %(hash)s&hellip;<br>
  A view. Every figure here came from that payload; none was typed.
</p>
%(charts)s
"""
