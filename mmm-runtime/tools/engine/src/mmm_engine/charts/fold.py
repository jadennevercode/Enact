"""The reduction the business-validation page performs in the browser.

This module and `apps/charts/js/fold.js` are two implementations of one contract,
`shared/fold-contract.md`. Four hundred enumerated filter states are replayed
across both before a page is allowed to exist, so the rules below are not
preferences — each one is a place where two reasonable implementations would
disagree, and each one is pinned.

The page may **reduce**; it may not **decide**. Every decision arrives as data:
which rows are in scope (the ledger dropped the rest before the payload was
built), whether a metric sums or averages (`coverage.yaml`), which metric is the
response (`metric_type == "Y"`), what unit it carries, which mark it gets. This
module applies a mask and folds. It chooses nothing.

Nothing here imports pandas. The payload arrives as plain lists so that the same
arithmetic can run in a browser, and so that a parity failure is a difference in
the rules rather than a difference between two libraries' idea of a mean.
"""
from __future__ import annotations

#: The grains a page may offer: id -> (prose label, control label, months).
#: **This is a lookup, not an order.** The two orders below are separate on
#: purpose and must stay that way.
GRAINS = (
    ("month", "月", "Month", 1),
    ("quarter", "季", "Quarter", 3),
    ("half", "半年", "Half-year", 6),
    ("year", "年", "Year", 12),
)

#: Button order, coarse -> fine. Presentation only.
GRAIN_DISPLAY = ("year", "half", "quarter", "month")

#: R7 fallback order, **fine -> coarse**. An unsupported grain falls back to the
#: finest supported one.
#:
#: This is NOT the button order and must never be made to follow it. Reading the
#: fallback off the display array turns "twelve months cannot make a year" into
#: "twelve months become one year" — a single bar where there was a trend, which
#: is exactly the phantom R6 exists to expose. The two arrays looked like
#: duplication right up until the buttons had to be reordered to match the
#: product, and then one of them was the answer to a different question.
GRAIN_FALLBACK = ("month", "quarter", "half", "year")

#: id -> (prose label, control label, months)
_GRAIN = {gid: (zh, en, months) for gid, zh, en, months in GRAINS}

#: The drill-down levels, outermost first. A card is an L1›L2›L3 path, so the
#: ladder starts below it.
LEVELS = ("l4", "l5", "l6", "l7", "l8")

#: Columns whose filter moves the response backdrop as well as the drivers. The
#: rest move only the overlay: whichever file or sub-factor you are looking at,
#: the baseline you judge it against has to hold still.
SCOPE_BOTH = ("brand", "channelType", "region")
SCOPE_OVERLAY = ("source",)

#: Payload field ↔ the short code carried on each series record.
_CODE = {"brand": "b", "channelType": "ct", "region": "r", "source": "s",
         "l4": "l4", "l5": "l5", "l6": "l6", "l7": "l7", "l8": "l8",
         "metric": "m"}

#: A bucket at or below this coverage is drawn hatched. Anything under 1.0 is
#: partial; the constant exists so both hosts round the same way.
FULL = 1.0


# ── period buckets ───────────────────────────────────────────────────

def bucket_of(month, grain):
    """The bucket key a yyyymm month belongs to, at `grain`.

    Keys are strings and sort correctly inside a grain, which is the only place
    they are ever compared. Deliberately not integers: `20241` could be a quarter
    or a truncated month, and a key nobody can read out loud is a key that hides
    an off-by-one.
    """
    month = int(month)
    year, mm = month // 100, month % 100
    if grain == "month":
        return "%04d%02d" % (year, mm)
    if grain == "quarter":
        return "%04dQ%d" % (year, (mm - 1) // 3 + 1)
    if grain == "half":
        return "%04dH%d" % (year, 1 if mm <= 6 else 2)
    if grain == "year":
        return "%04d" % year
    raise ValueError("unknown grain %r" % grain)


def bucket_months(key, grain):
    """Every calendar month the bucket spans, whether or not the data has it.

    Coverage is measured against the calendar, not against what happened to be
    delivered: a quarter holding two months is two thirds of a quarter, and a sum
    over it is two thirds of a number. Measuring against the delivered months
    instead would report every bucket as complete and hide exactly the artefact
    R6 exists to expose.
    """
    if grain == "month":
        return [int(key)]
    if grain == "quarter":
        year, q = int(key[:4]), int(key[5])
        first = (q - 1) * 3 + 1
        return [year * 100 + first + i for i in range(3)]
    if grain == "half":
        year, h = int(key[:4]), int(key[5])
        first = 1 if h == 1 else 7
        return [year * 100 + first + i for i in range(6)]
    if grain == "year":
        year = int(key)
        return [year * 100 + i for i in range(1, 13)]
    raise ValueError("unknown grain %r" % grain)


def _axis(periods, grain):
    """Bucket keys in ascending order, plus the months feeding each one."""
    order, members = [], {}
    for month in periods:
        key = bucket_of(month, grain)
        if key not in members:
            members[key] = []
            order.append(key)
        members[key].append(int(month))
    return order, members


# ── filtering ────────────────────────────────────────────────────────

def _codes(panel, column, values):
    """Dictionary codes for the chosen values. Unknown names contribute nothing.

    A filter naming a value the payload has never heard of selects the empty set
    rather than everything — the opposite would turn a typo into "no filter", and
    the reader would never see that it happened.
    """
    table = (panel.get("dict") or {}).get(column) or []
    index = {name: i for i, name in enumerate(table)}
    return {index[v] for v in values if v in index}


def _card_index(panel, path):
    for i, card in enumerate(panel.get("cards") or []):
        if card.get("path") == path:
            return i
    return -1


def card_of(panel, path):
    i = _card_index(panel, path)
    return (panel.get("cards") or [])[i] if i >= 0 else None


def blank_state(panel, card_path=None):
    """The state a card opens on: no filter, finest grain, the default six.

    Both hosts start here, so "what the page showed before anyone touched it" is
    one definition rather than two — and the written reading, which is keyed to
    this state, describes the same picture the reader first sees.
    """
    cards = panel.get("cards") or []
    if card_path is None:
        card_path = cards[0].get("path") if cards else ""
    return {"card": card_path, "grain": "month",
            "brand": [], "channelType": [], "region": [], "source": [],
            "levels": {level: "" for level in LEVELS},
            "indicators": [], "compareMonth": 0}


def selected_metrics(panel, state):
    """The indicators to draw. **Empty means the card's default six, not all.**

    This is the one filter where empty is a default rather than "no filter", and
    it is spelled out in both hosts because the asymmetry is real: an empty
    indicator picker cannot mean "draw all forty" — the palette caps at eight and
    the chart would be unreadable. The default is the card's own top six by
    absolute total, computed once by the tool.
    """
    chosen = [m for m in (state.get("indicators") or []) if m]
    if chosen:
        return list(chosen)
    card = card_of(panel, state.get("card"))
    return list((card or {}).get("defaultMetrics") or [])


def _matches(record, wanted):
    """`wanted` maps a series-record code to the set of codes that pass.

    A blank cell (code -1) passes only when the column carries no filter. That is
    R5: national-grain rows, which carry no channel and no region, are inside the
    unfiltered total and outside every explicit choice — the same semantics the
    row-level `df[df[dim] == value]` had before this payload existed.
    """
    for code, allowed in wanted.items():
        if record.get(code, -1) not in allowed:
            return False
    return True


def _mask(panel, state, *, scope):
    """The code filter for a scope. `scope="both"` skips the overlay-only columns."""
    wanted = {}
    for column in SCOPE_BOTH:
        values = state.get(column) or []
        if values:
            wanted[_CODE[column]] = _codes(panel, column, values)
    if scope == "overlay":
        for column in SCOPE_OVERLAY:
            values = state.get(column) or []
            if values:
                wanted[_CODE[column]] = _codes(panel, column, values)
        for level in LEVELS:
            value = (state.get("levels") or {}).get(level) or ""
            if value:
                wanted[_CODE[level]] = _codes(panel, level, [value])
    return wanted


# ── the fold ─────────────────────────────────────────────────────────

#: The closed operator set. Four, and no more: what makes the page's arithmetic
#: replayable is that there is no branch capable of producing a different answer
#: for the same payload. A rule the factor tree declares that is not one of these
#: — `weighted_average`, `distinct_count` — is substituted by `validation.panel`,
#: *in the tool*, with the substitution recorded on the metric. Never here.
OPS = ("sum", "average", "min", "max")


def _reduce(cells, how):
    """R2 · `sum` skips nulls; `mean` divides by contributing cells, not periods.

    A metric observed in 8 of 12 months has the average of those 8 values.
    Dividing by 12 would silently read absence as zero, which is the lie R3 exists
    to prevent from entering anywhere else.

    `min` and `max` are here because the factor tree lets a human declare them and
    a stock level is genuinely a min, not a sum. They are order-independent, so
    they cost nothing to keep exact across hosts.
    """
    seen = [c for c in cells if c is not None]
    if not seen:
        return None                     # R3 · a gap stays a gap
    if how == "min":
        return float(min(seen))
    if how == "max":
        return float(max(seen))
    total = 0.0
    for value in seen:                  # R1 · fixed order, binary64 both hosts
        total += float(value)
    if how == "average":
        return total / float(len(seen))
    return total


def _agg_of(panel, metric):
    """The metric's operator, defaulting to `sum`.

    Anything outside `OPS` means the payload declared something the fold cannot
    do, which `validation.panel` is supposed to have substituted already. Falling
    back to `sum` here is the last line, not the design.
    """
    meta = (panel.get("metricMeta") or {}).get(metric) or {}
    how = str(meta.get("agg") or "sum")
    return how if how in OPS else "sum"


def fold(panel, state):
    """Reduce the panel under one filter state.

    Returns ``{periods, bounds, response, responseMetric, series, partial,
    dropped}``:

    * ``periods`` — bucket keys, ascending
    * ``bounds`` — ``{key: [firstMonth, lastMonth]}`` so a caller can map a bucket
      back to the calendar without re-deriving the rule
    * ``response`` — the backdrop, folded under the **scope-both** filters only
    * ``series`` — ``{metric: {"agg", "v"}}``, one entry per selected indicator
    * ``partial`` — ``{key: coverage}`` for every bucket the calendar says is
      incomplete (R6)
    * ``dropped`` — how many blank-dimension series a filter excluded, so the page
      can say so (R5 is invisible on the chart: a line simply gets shorter)
    """
    grain = state.get("grain") or "month"
    periods = [int(p) for p in (panel.get("periods") or [])]
    keys, members = _axis(periods, grain)
    slot = {month: i for i, month in enumerate(periods)}

    card_i = _card_index(panel, state.get("card"))
    metrics = selected_metrics(panel, state)
    names = (panel.get("dict") or {}).get("metric") or []
    wanted_names = set(metrics)

    overlay = _mask(panel, state, scope="overlay")
    both = _mask(panel, state, scope="both")

    buckets = {metric: {key: [] for key in keys} for metric in metrics}
    dropped = 0
    for record in (panel.get("series") or []):
        if record.get("c", -1) != card_i:
            continue
        code = record.get("m", -1)
        metric = names[code] if 0 <= code < len(names) else ""
        if metric not in wanted_names:
            continue
        if not _matches(record, overlay):
            # A blank cell excluded by an explicit filter is R5 biting, and the
            # reader has to be told: on the chart it looks like a shorter line.
            if any(record.get(c, -1) == -1 for c in overlay):
                dropped += 1
            continue
        values = record.get("v") or []
        for key in keys:
            pool = buckets[metric][key]
            for month in members[key]:
                i = slot.get(month)
                if i is not None and i < len(values):
                    pool.append(values[i])

    series = {}
    for metric in metrics:
        how = _agg_of(panel, metric)
        series[metric] = {"agg": how,
                          "v": [_reduce(buckets[metric][key], how) for key in keys]}

    response, response_metric = _fold_response(panel, both, keys, members, slot)

    # R6 · a bucket the calendar says is incomplete says so, whatever is in it.
    partial = {}
    for key in keys:
        span = bucket_months(key, grain)
        have = sum(1 for month in span if month in slot)
        cover = float(have) / float(len(span))
        if cover < FULL:
            partial[key] = cover

    return {"periods": keys,
            "bounds": {key: [members[key][0], members[key][-1]] for key in keys},
            "response": response, "responseMetric": response_metric,
            "series": series, "partial": partial, "dropped": dropped}


def _fold_response(panel, both, keys, members, slot):
    """The backdrop. Moves with brand / channel / region, never with the overlay.

    "MT 的销量" and "EC 的销量" are two different curves, so a channel filter must
    move it. Which file a spend row came from, or which sub-factor is on screen,
    must not: the whole point of the backdrop is that the thing you are judging
    investment against holds still while you look around.
    """
    info = panel.get("response") or {}
    if not info.get("present"):
        return [None for _ in keys], ""
    how = "average" if str((info.get("meta") or {}).get("agg")) == "average" else "sum"
    pools = {key: [] for key in keys}
    for record in (panel.get("responseSeries") or []):
        if not _matches(record, both):
            continue
        values = record.get("v") or []
        for key in keys:
            for month in members[key]:
                i = slot.get(month)
                if i is not None and i < len(values):
                    pools[key].append(values[i])
    return [_reduce(pools[key], how) for key in keys], str(info.get("metric") or "")


# ── which grain buttons are live ─────────────────────────────────────

def live_periods(panel, state):
    """The months this filter state actually has a number in.

    Not the panel's whole axis: a region that only started reporting last year
    carries twelve months, and the grain buttons have to reflect *that*, not the
    three years the table spans in total.
    """
    scoped = dict(state)
    scoped["grain"] = "month"
    folded = fold(panel, scoped)
    out = []
    for i, key in enumerate(folded["periods"]):
        if folded["response"][i] is not None:
            out.append(int(key))
            continue
        if any(block["v"][i] is not None for block in folded["series"].values()):
            out.append(int(key))
    return out


def grains_for(panel, state):
    """R7 · recomputed per filter state, never once per page.

    Picking a region that carries twelve months has to grey out 「年」 that
    instant. Buttons are greyed, never removed: a control row that changes length
    reads as a bug, and the reader cannot tell "not applicable here" from "gone".
    """
    periods = live_periods(panel, state)
    out = []
    for gid in GRAIN_DISPLAY:          # 按钮顺序，粗 -> 细
        label, en, _months = _GRAIN[gid]
        keys, _members = _axis(periods, gid)
        if len(keys) >= 2:
            out.append({"id": gid, "label": label, "en": en,
                        "supported": True, "why": ""})
        else:
            out.append({"id": gid, "label": label, "en": en, "supported": False,
                        "why": "这一片只有 %d 个月，按%s只有 %d 个点"
                               % (len(periods), label, len(keys))})
    return out


def resolve_grain(panel, state):
    """The grain actually used, and whether it was asked for.

    Returns ``(grain, fell_back_from)``. The transition is automatic; the fact is
    never silent — the caller prints `fell_back_from` in the breadcrumb.
    """
    wanted = state.get("grain") or "month"
    live = {g["id"]: g["supported"] for g in grains_for(panel, state)}
    if live.get(wanted):
        return wanted, ""
    for gid in GRAIN_FALLBACK:         # 降级顺序，细 -> 粗。不是按钮顺序。
        if live.get(gid):
            return gid, wanted
    return "month", wanted


# ── the yearly table ─────────────────────────────────────────────────

def yearly(panel, state, compare_month=0):
    """Rows = response + each selected indicator; columns = years; cells carry YoY.

    `compare_month` 0 is the full year. 1–12 restricts every year to that calendar
    month, so year-on-year becomes this March against last March. In a seasonal
    business the full-year comparison both hides the season and punishes the
    current year for not being over yet; same-month against same-month is the
    clean one, and it is why the platform put the selector here rather than in a
    filter that would also move the chart.
    """
    months = [int(p) for p in (panel.get("periods") or [])]
    if compare_month:
        months = [m for m in months if m % 100 == int(compare_month)]
    years = sorted({m // 100 for m in months})

    scoped = dict(state)
    scoped["grain"] = "month"
    folded = fold(panel, scoped)
    index = {int(key): i for i, key in enumerate(folded["periods"])}

    def series_row(name, values, how):
        cells = []
        for year in years:
            pool = [values[index[m]] for m in months
                    if m // 100 == year and m in index]
            cells.append(_reduce(pool, how))
        return {"metric": name, "agg": how, "values": cells,
                "yoy": _yoy(cells)}

    rows = []
    if folded["responseMetric"]:
        rows.append(series_row(folded["responseMetric"], folded["response"],
                               "average" if str(((panel.get("response") or {})
                                                 .get("meta") or {}).get("agg"))
                               == "average" else "sum"))
    for metric in selected_metrics(panel, state):
        block = folded["series"].get(metric) or {"agg": "sum", "v": []}
        rows.append(series_row(metric, block["v"], block["agg"]))
    return {"years": years, "rows": rows,
            "compareMonth": int(compare_month or 0)}


def _yoy(cells):
    """Against the previous column, which is not always the previous year.

    A gap year makes "the column before this one" and "last year" different
    things. The caller shows the year labels, so the comparison is legible; what
    it must not do is silently interpolate the missing year.
    """
    out = [None]
    for i in range(1, len(cells)):
        now, before = cells[i], cells[i - 1]
        if now is None or before is None or before == 0:
            out.append(None)
        else:
            out.append((now - before) / abs(before) * 100.0)
    return out


# ── the L4–L8 ladder ─────────────────────────────────────────────────

def cascade_options(panel, card_path, chosen):
    """What each level may offer, given the levels already chosen above it.

    A level with nothing under the chosen path returns an empty list — the caller
    renders a dashed disabled box rather than hiding it, so the ladder keeps its
    length and the reader can see that the factor simply does not report that
    deep.
    """
    card_i = _card_index(panel, card_path)
    tables = panel.get("dict") or {}
    chosen = chosen or {}
    out = {}
    for depth, level in enumerate(LEVELS):
        above = {}
        for higher in LEVELS[:depth]:
            value = chosen.get(higher) or ""
            if value:
                above[_CODE[higher]] = _codes(panel, higher, [value])
        codes = set()
        for record in (panel.get("series") or []):
            if record.get("c", -1) != card_i or not _matches(record, above):
                continue
            code = record.get(_CODE[level], -1)
            if code >= 0:
                codes.add(code)
        names = tables.get(level) or []
        out[level] = [names[c] for c in sorted(codes) if c < len(names)]
    return out


def options_for(panel, state, column):
    """What this card can actually offer on one column, under the current path.

    The column's own filter is lifted first — a control that hides the options you
    have not picked yet is a control you cannot change your mind in.

    Narrowing matters most for `source`: a project has half a dozen data sources
    and a given factor usually comes from one. Offering all six on a card that has
    one means five of them empty the chart, and the reader learns nothing from
    that except distrust.

    **A `SCOPE_BOTH` column also reads the response series.** Brand, channel and
    region slice the sales base as well as the drivers, and the base is usually
    the only place a region appears at all — drivers are reported nationally. A
    list built from the drivers alone offers no regions on any card, so the reader
    cannot reach a per-region view that the fold, the golden set and
    `validation.read --region` all support. Picking one of those values empties
    the drivers by R5, which is a real answer about how this factor is reported,
    and the page prints the count.
    """
    card_i = _card_index(panel, state.get("card"))
    wanted = _mask(panel, state, scope="overlay")
    wanted.pop(_CODE[column], None)
    names = (panel.get("dict") or {}).get(column) or []
    codes = set()
    for record in (panel.get("series") or []):
        if record.get("c", -1) == card_i and _matches(record, wanted):
            code = record.get(_CODE[column], -1)
            if code >= 0:
                codes.add(code)
    if column in SCOPE_BOTH:
        for record in (panel.get("responseSeries") or []):
            code = record.get(_CODE[column], -1)
            if code >= 0:
                codes.add(code)
    return [names[c] for c in sorted(codes) if c < len(names)]


def indicator_options(panel, state):
    """The indicators available under the chosen path, and how many.

    The count is what makes the control's label honest: 「指标（央视下 12 个）」
    tells the reader the list was narrowed by the drill-down. A list that silently
    gets shorter reads as a bug.
    """
    return options_for(panel, state, "metric")


def source_options(panel, state):
    return options_for(panel, state, "source")


# ── the state key, shared by both hosts ──────────────────────────────

def state_key(state):
    """A canonical, hashable spelling of a filter state.

    Both hosts build it the same way so a parity failure names a state a person
    can paste back in. Lists are sorted; absent keys and empty lists are the same
    thing everywhere except `indicators`, where the difference is the default.
    """
    levels = state.get("levels") or {}
    parts = ["card=%s" % (state.get("card") or ""),
             "grain=%s" % (state.get("grain") or "month")]
    for column in ("brand", "channelType", "region", "source", "indicators"):
        values = sorted(str(v) for v in (state.get(column) or []))
        parts.append("%s=%s" % (column, "|".join(values)))
    for level in LEVELS:
        parts.append("%s=%s" % (level, levels.get(level) or ""))
    parts.append("compareMonth=%d" % int(state.get("compareMonth") or 0))
    return ";".join(parts)
