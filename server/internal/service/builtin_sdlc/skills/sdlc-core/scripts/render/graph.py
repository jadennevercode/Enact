"""graph / path renderers -- the two that genuinely need hand-drawn SVG.

Layered layout, never force-directed. The reason is not weight, it is
reproducibility: the same input must produce the same picture every time, or the
diagram cannot be diffed, cited ("the node top-left") or trusted in a governance
record.
"""

from datetime import date, datetime, timezone

from .base import esc, fit_text

NODE_W, NODE_H, H_GAP, V_GAP = 150, 34, 70, 20
MAX_NODES = 30


def _strip_cycles(nodes, edges):
    """DFS back-edge detection. Cycles are a finding, not an error to swallow."""
    adj = {n: [] for n in nodes}
    for u, v in edges:
        if u in adj and v in adj:
            adj[u].append(v)
    color, back = {n: 0 for n in nodes}, []

    def walk(u):
        color[u] = 1
        for v in adj[u]:
            if color[v] == 1:
                back.append((u, v))
            elif color[v] == 0:
                walk(v)
        color[u] = 2

    for n in nodes:
        if color[n] == 0:
            walk(n)
    return back


def layout(nodes, edges, sweeps=4):
    back = set(_strip_cycles(nodes, edges))
    pred = {n: [] for n in nodes}
    for u, v in edges:
        if (u, v) not in back and u in pred and v in pred:
            pred[v].append(u)

    # Longest-path layering.
    layer, active = {}, set()
    def depth(n):
        if n in layer:
            return layer[n]
        active.add(n)
        ups = [depth(p) + 1 for p in pred[n] if p not in active]
        layer[n] = max(ups) if ups else 0
        active.discard(n)
        return layer[n]
    for n in nodes:
        depth(n)

    depth_count = max(layer.values()) + 1 if layer else 1
    layers = [[] for _ in range(depth_count)]
    for n in nodes:
        layers[layer[n]].append(n)

    # Dummy nodes so long edges never cut through an intermediate layer's boxes.
    # Skipping this is the most common failure of hand-rolled graph layout: the
    # line runs straight over a label and the picture becomes unreadable.
    chains = []
    for u, v in edges:
        if (u, v) in back or u not in layer or v not in layer:
            continue
        chain = [u]
        for k in range(layer[u] + 1, layer[v]):
            dummy = f"__d_{u}_{v}_{k}"
            layers[k].append(dummy)
            chain.append(dummy)
        chain.append(v)
        chains.append((u, v, chain))

    # Barycentre ordering, a few alternating sweeps.
    upper = {}
    for _, _, chain in chains:
        for a, b in zip(chain, chain[1:]):
            upper.setdefault(b, []).append(a)
    for i in range(sweeps):
        rng = range(1, depth_count) if i % 2 == 0 else range(depth_count - 2, -1, -1)
        order = {n: idx for lay in layers for idx, n in enumerate(lay)}
        for k in rng:
            layers[k].sort(key=lambda n: (
                sum(order.get(p, 0) for p in upper.get(n, [])) / len(upper[n])
                if upper.get(n) else order.get(n, 0)))

    widest = max((len(l) for l in layers), default=1)
    pos = {}
    for k, lay in enumerate(layers):
        offset = (widest - len(lay)) * (NODE_H + V_GAP) / 2
        for i, n in enumerate(lay):
            pos[n] = (k * (NODE_W + H_GAP), offset + i * (NODE_H + V_GAP))
    return pos, layers, chains, sorted(back), depth_count, widest


def _edge_path(chain, pos):
    pts = []
    for i, n in enumerate(chain):
        x, y = pos[n]
        pts.append((x + NODE_W if i == 0 else (x if i == len(chain) - 1 else x + NODE_W / 2),
                    y + NODE_H / 2))
    if len(pts) == 2:
        (x1, y1), (x2, y2) = pts
        dx = x2 - x1
        return f"M {x1:.1f},{y1:.1f} C {x1 + dx / 2:.1f},{y1:.1f} {x2 - dx / 2:.1f},{y2:.1f} {x2:.1f},{y2:.1f}"
    return "M " + " L ".join(f"{x:.1f},{y:.1f}" for x, y in pts)


def graph(nodes, edges, title, blocked=None, labels=None, note=""):
    """Directed graph with blockage propagation.

    Past ~30 nodes a layered diagram stops being readable, so it degrades to a
    grouped table rather than producing an unusable picture.
    """
    nodes = list(dict.fromkeys(nodes))
    blocked, labels = set(blocked or []), labels or {}
    if not nodes:
        return f'<section class="chart"><h3>{esc(title)}</h3><p class="empty">没有可显示的节点。</p></section>'
    if len(nodes) > MAX_NODES:
        rows = "".join(f"<li><code>{esc(n)}</code> {esc(labels.get(n, ''))}</li>" for n in nodes)
        return (f'<section class="chart"><h3>{esc(title)}</h3>'
                f'<p class="lede">节点数 {len(nodes)} 超过 {MAX_NODES}，图形会难以阅读，改用清单。</p>'
                f"<ul>{rows}</ul></section>")

    pos, layers, chains, back, depth_count, widest = layout(nodes, edges)

    # Downstream reachability from every blocked node.
    succ = {n: [] for n in nodes}
    for u, v in edges:
        if u in succ and v in succ:
            succ[u].append(v)
    affected, stack = set(), list(blocked)
    while stack:
        for nxt in succ.get(stack.pop(), []):
            if nxt not in affected and nxt not in blocked:
                affected.add(nxt)
                stack.append(nxt)

    parts = []
    for u, v, chain in chains:
        cls = "e-blocked" if (u in blocked or u in affected) else "e"
        parts.append(f'<path d="{_edge_path(chain, pos)}" class="{cls}" marker-end="url(#arrow)" fill="none"/>')
    for u, v in back:
        if u in pos and v in pos:
            x1, y1 = pos[u][0] + NODE_W / 2, pos[u][1]
            x2, y2 = pos[v][0] + NODE_W / 2, pos[v][1]
            parts.append(f'<path d="M {x1:.1f},{y1:.1f} Q {(x1 + x2) / 2:.1f},{min(y1, y2) - 30:.1f} '
                         f'{x2:.1f},{y2:.1f}" class="e-cycle" fill="none" marker-end="url(#arrow)"/>')

    for n in nodes:
        x, y = pos[n]
        cls = "n-blocked" if n in blocked else ("n-affected" if n in affected else "n")
        glyph = "✕ " if n in blocked else ("◐ " if n in affected else "")
        text = fit_text(f"{glyph}{labels.get(n, n)}", NODE_W - 14)
        parts.append(
            f'<g class="{cls}"><rect x="{x}" y="{y}" width="{NODE_W}" height="{NODE_H}" rx="4"/>'
            f'<text x="{x + NODE_W / 2}" y="{y + NODE_H / 2 + 4}" text-anchor="middle">{esc(text)}</text>'
            f"<title>{esc(labels.get(n, n))}</title></g>"
        )

    width = depth_count * (NODE_W + H_GAP)
    height = widest * (NODE_H + V_GAP) + 20

    # The picture gives topology; this line gives something actionable. It also
    # survives printing, colour blindness and screen readers, which the picture
    # may not.
    summary = ""
    if blocked:
        summary = (f'<p class="lede"><strong class="bad">{len(blocked)} 个阻塞源</strong>'
                   f"（{esc('、'.join(sorted(blocked)))}）"
                   f"{'，影响下游 %d 个：%s' % (len(affected), esc('、'.join(sorted(affected)))) if affected else '，暂无下游受影响'}。</p>")
    if back:
        summary += (f'<p class="lede bad">存在 {len(back)} 条循环依赖：'
                    f"{esc('；'.join(f'{u} → {v}' for u, v in back))}。环里没有任何一个能先开始。</p>")

    return f"""<section class="chart">
<h3>{esc(title)}</h3>{summary}{f'<p class="hint">{esc(note)}</p>' if note else ''}
<div class="scrollx"><svg role="img" aria-labelledby="gt gd" viewBox="0 0 {width} {height}"
 style="max-width:100%;height:auto" class="graph">
<title id="gt">{esc(title)}</title>
<desc id="gd">共 {len(nodes)} 个节点，{len(blocked)} 个阻塞，影响下游 {len(affected)} 个。</desc>
{''.join(parts)}</svg></div>
</section>"""


# --- path ------------------------------------------------------------------

def _as_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (ValueError, TypeError):
        return None


def timeline(segments, title, gates=None, reverts=None, note=""):
    """State timeline as horizontal bars, not a stepper of dots.

    Dots cannot express dwell time, and "stuck 14 days before the gate" is
    exactly what a reviewer wants to know. When timestamps are unusable the
    chart falls back to equal-width ordering and says so -- silently pretending
    to have time data would let someone read a duration off a picture that has
    none.
    """
    if not segments:
        return f'<section class="chart"><h3>{esc(title)}</h3><p class="empty">没有状态记录。</p></section>'

    gates, reverts = gates or [], reverts or []
    stamps = [(_as_date(s.get("start")), _as_date(s.get("end"))) for s in segments]
    dated = all(a and b for a, b in stamps)
    width, height, pad = 760, 150, 40
    y, bar_h = 46, 26

    if dated:
        t0 = min(a for a, _ in stamps)
        t1 = max(b for _, b in stamps)
        span = max((t1 - t0).days, 1)
        def scale(d):
            return pad + (d - t0).days / span * (width - 2 * pad)
        axis_note = ""
    else:
        step = (width - 2 * pad) / max(len(segments), 1)
        def scale(idx):
            return pad + idx * step
        axis_note = '<p class="hint bad">时间数据缺失或不可解析，按顺序等距显示——不要从宽度读时长。</p>'

    parts, rows = [], []
    for i, seg in enumerate(segments):
        if dated:
            a, b = stamps[i]
            x, w = scale(a), max(3.0, scale(b) - scale(a))
            days = (b - a).days
        else:
            x, w, days = scale(i), step * 0.9, None
        long_stay = days is not None and days >= 7
        cls = f'seg s-{esc(seg.get("state", ""))}{" longstay" if long_stay else ""}'
        parts.append(f'<rect x="{x:.1f}" y="{y}" width="{w:.1f}" height="{bar_h}" rx="3" class="{cls}">'
                     f'<title>{esc(seg.get("state"))}{f" · {days}d" if days is not None else ""}</title></rect>')
        if w > 46:
            lab = f'{seg.get("state")}{f" {days}d" if days is not None else ""}'
            parts.append(f'<text x="{x + 4:.1f}" y="{y - 6}" class="seglab">{esc(fit_text(lab, w))}</text>')
        if long_stay:
            parts.append(f'<text x="{x + 4:.1f}" y="{y + bar_h + 13}" class="staylab">⏱ {days}d</text>')
        rows.append([seg.get("state"), seg.get("start"), seg.get("end"),
                     f"{days}d" if days is not None else "—", seg.get("by") or ""])

    for g in gates:
        gx = scale(_as_date(g.get("at")) if dated else segments.index(g) if g in segments else 0)
        cls = "g-pass" if g.get("passed") else "g-fail"
        parts.append(f'<path d="M {gx:.1f},{y - 11} l 7,11 l -7,11 l -7,-11 z" class="gate {cls}">'
                     f'<title>{esc(g.get("name"))}</title></path>')

    for i, r in enumerate(reverts):
        if not dated:
            continue
        xf, xt = scale(_as_date(r.get("at"))), scale(_as_date(r.get("to")))
        dip = y + bar_h + 26 + i * 14
        parts.append(f'<path d="M {xf:.1f},{y + bar_h} Q {(xf + xt) / 2:.1f},{dip} {xt:.1f},{y + bar_h}" class="revert"/>'
                     f'<text x="{(xf + xt) / 2:.1f}" y="{dip + 4}" class="revlab" text-anchor="middle">↩</text>')

    from .charts import simple_table
    detail = simple_table(["状态", "从", "到", "停留", "谁触发"], rows, "tl-detail")
    revert_note = (f'<p class="lede bad">发生过 {len(reverts)} 次回退。</p>' if reverts else "")

    return f"""<section class="chart">
<h3>{esc(title)}</h3>{revert_note}{axis_note}{f'<p class="hint">{esc(note)}</p>' if note else ''}
<div class="scrollx"><svg role="img" aria-labelledby="tt td" viewBox="0 0 {width} {height}"
 style="max-width:100%;height:auto" class="tl">
<title id="tt">{esc(title)}</title>
<desc id="td">共 {len(segments)} 个状态区间，{len(gates)} 个 Gate，{len(reverts)} 次回退。</desc>
{''.join(parts)}</svg></div>
<details open><summary>状态变更明细</summary>{detail}</details>
</section>"""
