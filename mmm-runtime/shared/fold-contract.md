# The fold contract

**One reduction, two hosts, bit-for-bit.** The business-validation page aggregates
data in the browser. `mmm_engine/charts/fold.py` and `apps/charts/js/fold.js` are
two implementations of the rules written here, and 400 enumerated filter states
are replayed across both before a page is allowed to exist.

## Why this file exists at all

Until 2026-08-11 the chart book computed nothing: every slice was pre-aggregated
by a tool and the page only showed and hid what was already there. That rule was
load-bearing and it is written into `shared/numbers-provenance.md`'s sibling
guarantee — every figure traces to a hashed payload.

The business-validation dashboard broke it on arithmetic grounds, not on taste.
Its filter space is time grain × brand × channel × region × source subset ×
L4–L8 path × indicator subset. Pre-aggregating that is not "no arithmetic"; it is
the same arithmetic performed a million times and shipped pre-baked. So the page
folds, and the guarantee is rebuilt one level up: **the page does not have to be
trusted, because its arithmetic is replayed against the tool's before it ships,
and again in the reader's browser before the first pixel.**

Decision record: architecture doc D10. §4.3 ③ was narrowed from "an App does not
compute or judge" to "an App does not judge; it may perform a **declarative
reduction** whose method is named by the payload, whose operator set is closed,
and which matches the tool's reduction bit for bit."

What the page still may not do is **decide**. Every decision is made upstream and
arrives as data:

| Decision | Made by | Arrives as |
|---|---|---|
| which rows are in scope | `ledger.drops_before(st, "signoff")` | rows absent from the payload, plus `dropped` |
| how a metric rolls up | **the factor tree** → the register → the classifier (below) | `metricMeta[m].agg`, `.source` |
| which metric is the response | `metric_type == "Y"` | `response` |
| unit, currency, number format | `coverage.yaml` | `metricMeta[m]` |
| which mark a metric gets | `metric_type` | `metricMeta[m].role` |
| what counts as an anomaly | `validation.anomalies` | `anomalies.json` |
| what a card is | `validation.panel` | `cards[]` |

The page picks none of these. It applies a mask and reduces.

### Where the aggregation comes from, and why the order is that order

1. **`artifacts/s1/factor-tree.yaml`, `rows[].aggregation`** — the only one a human
   declared and a gate enforced (`p_aggregation_declared`). Whether a number sums
   or averages is a property of what the indicator *means*, so it belongs with the
   people who defined the indicator.
2. **`data/published/coverage.yaml`** — carries unit, currency and number format,
   which the tree does not. Its `aggregation` column is **not** a human decision:
   `dataeng/coverage.py` fills it from `classify_indicator(metric)` at publish
   time. It is a guess with a filing cabinet, and `metricMeta[m].source` says
   `coverage` rather than implying otherwise.
3. **`classify_indicator`** — live, name-based, for anything neither covers.

Getting this order wrong is not cosmetic. 温度 matches none of the classifier's
patterns and falls through to `sum`; a summed temperature is meaningless and looks
exactly like a summed spend on the chart. Only the tree knows it averages.

## The four functions

Both hosts implement exactly these, against `validation-panel.json`:

```
fold(panel, state)              -> {periods[], response[], series{}, partial{}}
grains_for(panel, state)        -> [{id, supported, why}]
yearly(panel, state, compareMonth) -> {rows[], years[]}
cascade_options(panel, card, chosen) -> {l4[], l5[], l6[], l7[], l8[]}
```

`state` is the filter state, canonically ordered:

```json
{"card": "<path>", "grain": "month", "brand": [], "channelType": [], "region": [],
 "source": [], "levels": {"l4": "", "l5": "", "l6": "", "l7": "", "l8": ""},
 "indicators": []}
```

An empty list means **no filter on that column** — except `indicators`, where
empty means **the card's `defaultMetrics`** (the top 6 by absolute total). That
one asymmetry is real and it is the platform's: an empty indicator picker cannot
mean "draw all forty", because the palette caps at 8 and the chart would be
unreadable. It is spelled out here so neither host invents its own default.

## The rules

These are not preferences. Each one is a place where two reasonable
implementations would disagree, so each one is pinned.

**R1 · Accumulation order is `(period ascending, seriesIndex ascending)`.**
Both hosts use IEEE-754 binary64 (Python `float`, JS `Number`). Floating-point
addition is not associative, so identical results require identical order. The
series index is the position in `panel.series[]`, which the tool writes sorted.

**R2 · `sum` skips nulls. `mean` divides by the number of contributing non-null
cells, never by the number of periods.** A metric observed in 8 of 12 months has
a 12-month average over those 8 values. Dividing by 12 silently treats absence as
zero, which is the same lie R3 forbids.

**R2a · The operator set is closed: `sum`, `average`, `min`, `max`.** All four are
order-stable, so both hosts agree exactly. The factor tree lets a human declare
rules the fold has no operator for (`weighted_average`, `count`,
`distinct_count`); those are substituted **in `validation.panel`, never in the
page**, and the substitution is recorded on the metric as `aggNote` and printed.
Keeping the substitution in the tool is what preserves "the page decides nothing":
a page that quietly reinterpreted `weighted_average` would be making the call the
consultant thought the tree had made.

**R3 · A gap stays a gap, end to end.** A bucket with no contributing cell is
`null`, never `0`. A chart draws a break; a table draws `—`. There is no path in
either host that turns absence into a number.

**R4 · Rounding happens only at display.** Both `fold` implementations return raw
float64. Formatting (percent, currency, k/万/亿) is applied by `format.js` on the
way to the DOM and by the tool on the way to stdout. A comparison between hosts
compares raw values, so a rounding difference can never hide a real one.

**R5 · A blank dimension value is in the unfiltered total and out of every
explicit filter.** National-grain rows carry `channel_type = ""` (see
`dataeng/target_schema.py:34-36`, `nullMeans: national`). With no channel filter
they contribute; with `channelType: ["MT"]` they do not. This matches the
pre-existing `df[df[dim] == value]` semantics exactly — and because the effect is
invisible on the chart (a line simply gets shorter), **the page must say so out
loud** when a filter removes blank-dimension rows.

**R6 · Rolling to a coarser grain reports its own coverage.** A quarter built
from 2 of 3 months has `coverage = 2/3`. For `agg = sum` a partial bucket is a
falsehood shaped like a trend — the classic phantom −50% at the edge of the data.
`fold` returns `partial[period] = coverage` for every bucket below 1.0; the
renderer hatches it and the yearly table carries the same mark. Neither host
drops the bucket and neither host silently scales it up.

**R7 · An unsupported grain falls back to the finest supported one, and the
fallback is printed. Display order and fallback order are two separate arrays.**

`GRAIN_DISPLAY` is the button order (coarse → fine, `Year … Month`, matching the
product). `GRAIN_FALLBACK` is fine → coarse. They are never the same array and
neither may be derived from the other: reading the fallback off the display order
turns "twelve months cannot make a year" into "twelve months become one year" —
one bar where there was a trend, the phantom R6 exists to expose. The fixture
carries a slice whose months all fall inside one calendar year precisely so that
the golden set contains a state where the two orders disagree; without it the
cross-host replay never exercises the fallback at all. `grains_for` recomputes per filter state, not once per
page: picking a region with 12 months must grey out 「年」 that instant. The
transition is automatic; the fact is never silent. Buttons are greyed, never
removed — a row that changes length reads as a bug.

**R8 · Same input, same output, always.** No clock, no locale, no `Math.random`,
no iteration over an unordered map. Object keys are visited in sorted order in
both hosts.

## How it is enforced

Four layers, from build time to read time. Layers 1–2 fail the build; layers 3–4
fail the page.

**L1 · The golden state set is enumerated by rule, not chosen by taste.**
`validation.panel` writes `data/derived/validation-foldcheck.json` (a CI artifact,
not inlined) containing, for every card:

- every grain × {unfiltered, each single brand, each single channel, each single
  region, the deepest L4–L8 leaf, a two-source subset, the default top-6, a
  single indicator, a state guaranteed to be empty}
- plus the **named adversarial set**: a selection mixing `sum` and `average`
  metrics; a series with a mid-range gap; an unsupported grain (exercising R7);
  an all-null series; `compareMonth = 3` and `compareMonth = 0`; a card whose rows
  are all blank-dimension (exercising R5).

Each state's record carries the fold's output, the resolved grain and its
fallback, the yearly table — and **the option lists for `SCOPE_BOTH`**. Those
lists are not arithmetic, but they decide which states a reader can reach, and a
state one host can reach and the other cannot is harder to find than a wrong
number: there is no button on the page, so nobody goes looking. `evaluate` exists
three times (Python, `foldcheck.mjs`, `selfcheck.js`) and all three must carry the
same fields; missing one is a page that refuses to draw.

Then: keep at least one of every distinct `(grain, filterShape, aggMix)`, and fill
up to **N = 400** by taking the lowest `sha256(stateKey)`. A small engagement
enumerates fewer than 400 states and every one of them is kept; 400 is the ceiling
on how long the replay may take, not a quota to reach. Coverage comes from the
construction, so it is stable, regenerable, and nobody picks the cases.

**L2 · node replays the JS kernel against the Python golden, before the page is
written.** `apps/charts/js/foldcheck.mjs` imports the same `fold.js` bytes the
page inlines, replays all 400 states, and exits non-zero on the first mismatch,
printing the state key, both values, and the first divergent index. `charts.book`
shells it and **refuses to write the page** on mismatch.

This does not break "stdlib only": that constraint is on Python imports and on the
*page*'s zero-external-requests property. `scripts/doctor.py` already reports node
as an environment dependency. When node is absent the page is still written, the
run line records `selfCheck: "browser-only"`, and the page's source footer says
so — degrade honestly, never silently.

**L3 · The page checks itself before the first pixel.** 32 states (the adversarial
set plus one per card per grain, capped) ride inline as `panel.selfCheck`.
`selfcheck.js` replays them synchronously during boot. On any mismatch **no chart
is drawn at all** — the page renders a single failure card naming the state, both
numbers, and how to regenerate. A wrong number under a red banner still gets read
aloud in a meeting; a page that refuses to draw does not.

It also verifies an FNV-1a rolling checksum of the inlined arrays against a value
baked in by `book.py`, which catches a hand-edited HTML file. Result is exposed as
`window.__foldSelfCheck = {ok, checked, failed}` for headless checks.

**L4 · The predicate.** `fold_selfcheck:<page>` requires two things that are
deliberately not the same thing. The page carries `<html data-selfcheck>` stamped
at build time (`ok` when node replayed the golden set, `browser-only` when node
was absent, `skipped` when the operator passed `--skip-foldcheck`); `boot.js`
overwrites that attribute with the browser's own verdict once the page opens. And
the `charts.book` run line whose `out` is that page must carry a `payloadSha`
matching the file on disk plus `selfCheck: verified`.

The attribute alone would not be worth much — it is a claim about a build, and it
survives a hand-edited file unchanged. The `payloadSha` match is what catches the
hand edit; the attribute is what catches a page built with the check off. A
`browser-only` value reports as advice rather than a block, so a machine without
node can still build while the reviewer can see that the cross-host check did not
run — and the page's own footer says so in the same words.

## Changing this file

Per architecture §4.5: write the failing adversarial assertion in
`scripts/selftest.py` first (red), then change the mechanism, then watch it pass.
The three assertions that guard this contract today:

1. corrupt one value in a generated page's inlined panel → `fold_selfcheck` fails;
2. flip `metricMeta["温度"].agg` from `average` to `sum` → the 400-state replay
   fails (this is the aggregation-authority regression);
3. write `anomalies.yaml` in the pre-D10 template shape → `anomaly_cards_bind`
   fails.

The third one is not about the fold. It is here because it is the assertion that
would have caught `workspace.py`'s `AnomalyReview(cards=…)` on the day it was
written, and this file is where the suite records what it learned from letting a
stored decision go unread for months.
