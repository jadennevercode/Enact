"""The state set both hosts are replayed over, enumerated by rule.

Twelve hand-picked states are a sample, not coverage. The states that break are
the ones nobody pictured: a card mixing summed and averaged metrics, an all-null
window, the grain-fallback path, a ladder level with no options, a same-month
comparison in a year missing that month. So the set is *constructed* — every
combination of shape is entitled to a slot, the named adversarial cases are
entitled to a slot, and the remainder is filled by hash order so the choice is
stable and nobody picks it.

See `shared/fold-contract.md` §L1. `apps/charts/js/foldcheck.mjs` replays the
result; `validation.panel` writes it.
"""
from __future__ import annotations

import hashlib

from mmm_engine.charts import fold as F

#: How many states the build-time replay covers. Big enough that a shape has to
#: be genuinely rare to miss a slot, small enough that the replay stays a second.
GOLDEN_N = 400

#: How many ride inline in the page for the reader's browser to re-check. The
#: adversarial cases plus one per card per grain, capped.
INLINE_N = 32


def _blank(card_path, grain="month"):
    return {"card": card_path, "grain": grain, "brand": [], "channelType": [],
            "region": [], "source": [],
            "levels": {level: "" for level in F.LEVELS},
            "indicators": [], "compareMonth": 0}


def _with(state, **changes):
    out = dict(state)
    levels = dict(out.get("levels") or {})
    for key, value in changes.items():
        if key in F.LEVELS:
            levels[key] = value
        else:
            out[key] = value
    out["levels"] = levels
    return out


def _shape(state):
    """What kind of state this is, ignoring which particular values it names.

    Two states that filter one brand each are the same shape; keeping one of each
    shape is what makes the fill-to-400 step a top-up rather than the whole
    sample.
    """
    parts = [state.get("grain") or "month"]
    for column in ("brand", "channelType", "region", "source", "indicators"):
        parts.append("%s:%d" % (column, len(state.get(column) or [])))
    depth = sum(1 for level in F.LEVELS if (state.get("levels") or {}).get(level))
    parts.append("depth:%d" % depth)
    parts.append("cmp:%d" % (1 if state.get("compareMonth") else 0))
    return "|".join(parts)


def _agg_mix(panel, state):
    kinds = sorted({F._agg_of(panel, m) for m in F.selected_metrics(panel, state)})
    return "+".join(kinds) or "none"


def enumerate_states(panel):
    """Every state worth replaying, deduped, adversarial cases first.

    Order matters: the adversarial set is emitted first so that when the list is
    truncated to the inline budget it is the hard cases that survive, not the
    alphabetically lucky ones.
    """
    cards = panel.get("cards") or []
    if not cards:
        return []
    tables = panel.get("dict") or {}
    grains = list(F.GRAIN_DISPLAY)

    hard, plain = [], []

    for card in cards:
        path = card.get("path") or ""
        base = _blank(path)
        options = F.cascade_options(panel, path, {})

        # ── the named adversarial set ────────────────────────────────
        metrics = list(card.get("metrics") or [])
        by_agg = {}
        for metric in metrics:
            by_agg.setdefault(F._agg_of(panel, metric), []).append(metric)
        if len(by_agg) > 1:
            mixed = [sorted(v)[0] for _k, v in sorted(by_agg.items())]
            hard.append(_with(base, indicators=mixed))       # sum + average together
        for grain in grains:
            hard.append(_with(base, grain=grain))            # includes the fallback path
        hard.append(_with(base, compareMonth=3))             # same-month comparison
        hard.append(_with(base, compareMonth=0))
        if metrics:
            hard.append(_with(base, indicators=[sorted(metrics)[0]]))
        # A state that must come back empty: a level value that exists nowhere.
        hard.append(_with(base, l4="—没有这一层—"))
        # The deepest real path the card reports to.
        deepest, chosen = base, {}
        for level in F.LEVELS:
            values = F.cascade_options(panel, path, chosen).get(level) or []
            if not values:
                break
            chosen[level] = sorted(values)[0]
            deepest = _with(deepest, **{level: chosen[level]})
        if chosen:
            hard.append(deepest)

        # ── the routine sweep ────────────────────────────────────────
        for grain in grains:
            at = _with(base, grain=grain)
            plain.append(at)
            plain.append(_with(at, indicators=list(card.get("defaultMetrics") or [])))
            for column in ("brand", "channelType", "region"):
                for value in (tables.get(column) or []):
                    plain.append(_with(at, **{column: [value]}))
            sources = tables.get("source") or []
            if len(sources) >= 2:
                plain.append(_with(at, source=sorted(sources)[:2]))
            for level, values in sorted(options.items()):
                for value in sorted(values):
                    plain.append(_with(at, **{level: value}))

    seen, ordered = set(), []
    for state in hard + plain:
        key = F.state_key(state)
        if key not in seen:
            seen.add(key)
            ordered.append(state)
    return ordered


def choose(panel, states, limit=GOLDEN_N):
    """Keep one of every shape, then fill by hash order.

    Filling by `sha256(stateKey)` rather than by position means the sample does
    not drift when a card is renamed or a dimension gains a value — the same
    payload always yields the same set, and nobody had to pick it.
    """
    kept, taken = [], set()
    for state in states:
        signature = "%s#%s" % (_shape(state), _agg_mix(panel, state))
        if signature not in taken:
            taken.add(signature)
            kept.append(state)
    if len(kept) >= limit:
        return kept[:limit]
    rest = [s for s in states if s not in kept]
    rest.sort(key=lambda s: hashlib.sha256(
        F.state_key(s).encode("utf-8")).hexdigest())
    return kept + rest[:limit - len(kept)]


def evaluate(panel, state):
    """The golden result for one state: what both hosts must produce.

    Raw float64, never rounded — R4. A comparison that rounded first could hide a
    real difference behind a shared display rule.
    """
    folded = F.fold(panel, state)
    grain, fell_back = F.resolve_grain(panel, state)
    row = {
        "key": F.state_key(state),
        "state": state,
        "periods": folded["periods"],
        "response": folded["response"],
        "series": {name: block["v"] for name, block in sorted(folded["series"].items())},
        "aggs": {name: block["agg"] for name, block in sorted(folded["series"].items())},
        "partial": folded["partial"],
        "dropped": folded["dropped"],
        "grain": grain,
        "fellBackFrom": fell_back,
        # 控件上摆出来的取值也要两端一致。它不是归约的一部分，但它决定读的人到得了
        # 哪些筛选态 —— 一端能到、另一端到不了的状态，比一个算错的数更难发现：页面
        # 上根本没有那个按钮，没人会去找它。
        "options": {column: F.options_for(panel, state, column)
                    for column in F.SCOPE_BOTH},
    }
    if state.get("compareMonth") is not None:
        table = F.yearly(panel, state, state.get("compareMonth") or 0)
        row["yearly"] = {"years": table["years"],
                         "rows": [[r["metric"], r["agg"], r["values"], r["yoy"]]
                                  for r in table["rows"]]}
    return row


def build(panel, limit=GOLDEN_N):
    """`(golden, inline)` — the CI artifact and the states that ride in the page."""
    states = choose(panel, enumerate_states(panel), limit)
    golden = [evaluate(panel, state) for state in states]
    return golden, golden[:INLINE_N]


def checksum(panel):
    """FNV-1a over the inlined arrays, so a hand-edited page fails its own check.

    Cheap on purpose: it runs in the reader's browser before the first paint, and
    it is guarding against a text editor, not against an adversary.
    """
    digest = 0x811C9DC5
    def feed(text):
        nonlocal digest
        for byte in str(text).encode("utf-8"):
            digest = ((digest ^ byte) * 0x01000193) & 0xFFFFFFFF
    for record in (panel.get("series") or []) + (panel.get("responseSeries") or []):
        feed(record.get("m", -1))
        for value in (record.get("v") or []):
            feed("~" if value is None else repr(float(value)))
    return "%08x" % digest
