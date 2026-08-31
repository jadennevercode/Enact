"""2.3 · the AI's reading of one Business-Validation chart.

The analysis is grounded on **exactly the arrays the chart plotted** — the same
`validation_series` response the user is looking at — so it can name real periods
and real magnitudes instead of describing marketing in general.

Two rules make that trustworthy:

* **The facts are computed, the prose is written.** Every number the model is
  allowed to quote (first/last/peak/trough, the largest period-over-period move,
  the longest monotone run, the gap count, the correlation with the response) is
  derived here in pandas-free Python and handed over as an authoritative `FACTS`
  block. The model narrates it. This is the same contract the assistant's
  `MODEL RESULTS` line has, and it is why a "specific" analysis is safe to ask for.
* **Gaps are gaps.** A missing period is passed through as such and the model is
  told to say so rather than interpolate over it.

With no LLM configured the deterministic facts are rendered as prose instead, so
a chart always carries an analysis — just one that says where it came from.
"""
from __future__ import annotations

import hashlib
import json
from typing import Optional

from mmm_engine.domain.models import ChartObservation, ValidationChartAnalysis

# VENDORING NOTE — the platform's `analyze_chart()` called an LLM to narrate a
# chart and fell back to `_fallback()` when it failed. In an agent runtime the
# LLM *is* the caller, so the async LLM path is gone: this module computes the
# facts and the skill narrates them. `read_chart()` below is what `_fallback`
# was — the deterministic readout — promoted from a degraded mode to the only
# mode, which is also what `shared/numbers-provenance.md` requires.

# The filter fields that define "which chart is this" — the analysis key. Ordered,
# so the same filter state always hashes the same way.
# `card` leads because it is the only field that separates two same-named L3s
# under different parents. `_cards()` keeps those apart deliberately; without
# `card` here they hash identically and one card's analysis overwrites the
# other's — silently, because a hash collision looks exactly like a cache hit.
_KEY_FIELDS = ("card", "l3", "l4", "l5", "l6", "l7", "l8", "grain", "indicators",
               "sources", "brand", "channelType", "provinceGroup", "yoyMonth")

# A long axis is summarised, not transcribed: the FACTS block already carries the
# shape, and pasting 200 periods per series buys nothing but tokens.
_MAX_POINTS = 120


#: The value each key field takes when the caller did not set it. This has to match
#: what `ValidationSeriesQuery` produces, field for field: the batch generator and
#: the on-demand endpoint must hash an *identical* dict or the pre-generated
#: analyses are cached under keys the UI never asks for. (They were: a missing
#: level read as `None` from the batch and `""` from the endpoint, and 15 of 16
#: pre-generated readings were invisible.)
_KEY_DEFAULTS: dict = {
    "card": "", "l3": "", "l4": "", "l5": "", "l6": "", "l7": "", "l8": "",
    "grain": "month", "indicators": [], "sources": [], "brand": [],
    "channelType": [], "provinceGroup": [], "yoyMonth": 0,
}


def normalize_query(query: dict) -> dict:
    """The canonical, hashable filter state — every key field present and typed."""
    out: dict = {}
    for k, default in _KEY_DEFAULTS.items():
        v = query.get(k, default)
        if v is None:
            v = default
        out[k] = list(v) if isinstance(default, list) else (
            int(v) if isinstance(default, int) else str(v))
    return out


def analysis_key(query: dict) -> str:
    """A stable id for the chart a filter state produces."""
    raw = json.dumps(normalize_query(query), sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def series_digest(res: dict) -> str:
    """A fingerprint of the plotted numbers.

    Two analyses with the same key but different digests mean the data moved under
    a cached reading — the difference between "this is still true" and "this was
    true of numbers we no longer have".
    """
    payload = {
        "x": res.get("x") or [],
        "kpi": (res.get("kpi") or {}).get("data") or [],
        "series": [[s.get("metric"), s.get("data")] for s in (res.get("series") or [])],
    }
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def filter_label(res: dict, query: dict) -> str:
    """A human breadcrumb of what was plotted, for the analysis header."""
    parts = [f"{b.get('level')}: {b.get('value')}" for b in (res.get("breadcrumb") or [])]
    grain = str(query.get("grain") or res.get("grain") or "month").replace("_", "-")
    dims = [f"{k}: {', '.join(v)}"
            for k, v in (("Brand", query.get("brand")), ("Channel", query.get("channelType")),
                         ("Region", query.get("provinceGroup")))
            if v]
    return " · ".join([*parts, f"by {grain}", *dims])


# ── deterministic facts ─────────────────────────────────────────────────────


def _clean(pairs: list[tuple[str, Optional[float]]]) -> list[tuple[str, float]]:
    return [(p, float(v)) for p, v in pairs if v is not None]


def _series_facts(name: str, x: list[str], data: list, unit: str = "",
                  number_format: str = "") -> dict:
    """Everything the model is allowed to quote about one series."""
    pairs = _clean(list(zip(x, data)))
    facts: dict = {"metric": name, "unit": unit, "numberFormat": number_format,
                   "observedPeriods": len(pairs), "missingPeriods": len(x) - len(pairs)}
    if not pairs:
        facts["note"] = "no observed values in this view"
        return facts

    first_p, first_v = pairs[0]
    last_p, last_v = pairs[-1]
    peak_p, peak_v = max(pairs, key=lambda pv: pv[1])
    trough_p, trough_v = min(pairs, key=lambda pv: pv[1])
    facts.update({
        "first": {"period": first_p, "value": round(first_v, 4)},
        "last": {"period": last_p, "value": round(last_v, 4)},
        "peak": {"period": peak_p, "value": round(peak_v, 4)},
        "trough": {"period": trough_p, "value": round(trough_v, 4)},
    })
    if first_v:
        facts["changeFirstToLastPct"] = round((last_v - first_v) / abs(first_v) * 100, 1)

    # Largest single period-over-period move — the candidate anomaly.
    if len(pairs) > 1:
        i = max(range(1, len(pairs)), key=lambda j: abs(pairs[j][1] - pairs[j - 1][1]))
        d = pairs[i][1] - pairs[i - 1][1]
        base = abs(pairs[i - 1][1])
        facts["largestMove"] = {
            "from": pairs[i - 1][0], "to": pairs[i][0], "delta": round(d, 4),
            "deltaPct": round(d / base * 100, 1) if base else None,
        }

    # Longest run in one direction — the candidate trend / inflection boundary.
    best = cur = 1
    best_end = cur_dir = 0
    for i in range(1, len(pairs)):
        d = pairs[i][1] - pairs[i - 1][1]
        step = 1 if d > 0 else (-1 if d < 0 else 0)
        if step and step == cur_dir:
            cur += 1
        else:
            cur, cur_dir = 2 if step else 1, step
        if cur > best:
            best, best_end = cur, i
    if best >= 3:
        start_i = best_end - best + 1
        facts["longestRun"] = {
            "direction": "rising" if pairs[best_end][1] > pairs[start_i][1] else "falling",
            "from": pairs[start_i][0], "to": pairs[best_end][0], "periods": best,
        }
    return facts


def _pearson(a: list, b: list) -> Optional[float]:
    """Correlation over the periods both series actually cover."""
    pairs = [(float(u), float(v)) for u, v in zip(a, b) if u is not None and v is not None]
    if len(pairs) < 3:
        return None
    n = len(pairs)
    mx = sum(p[0] for p in pairs) / n
    my = sum(p[1] for p in pairs) / n
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pairs)
    sxx = sum((p[0] - mx) ** 2 for p in pairs)
    syy = sum((p[1] - my) ** 2 for p in pairs)
    if sxx <= 0 or syy <= 0:
        return None
    return round(sxy / (sxx ** 0.5 * syy ** 0.5), 3)


def compute_facts(res: dict) -> dict:
    """The authoritative numbers for one chart — computed, never asked of the LLM."""
    x = list(res.get("x") or [])[-_MAX_POINTS:]
    n = len(res.get("x") or [])
    off = max(0, n - _MAX_POINTS)
    kpi = res.get("kpi") or None

    facts: dict = {"grain": res.get("grain", ""), "periods": x,
                   "periodCount": n, "truncated": off > 0}
    if kpi:
        kdata = list(kpi.get("data") or [])[off:]
        facts["response"] = _series_facts(
            str(kpi.get("metric") or "KPI"), x, kdata,
            str(kpi.get("unit") or ""), str(kpi.get("numberFormat") or ""))
    drivers = []
    for s in res.get("series") or []:
        sdata = list(s.get("data") or [])[off:]
        f = _series_facts(str(s.get("metric") or ""), x, sdata,
                          str(s.get("unit") or ""), str(s.get("numberFormat") or ""))
        if kpi:
            f["correlationWithResponse"] = _pearson(sdata, list(kpi.get("data") or [])[off:])
        drivers.append(f)
    facts["drivers"] = drivers
    return facts


def series_response(panel: dict, card: dict, folded: dict) -> dict:
    """A folded card, in the shape `compute_facts` reads.

    One adapter, in one place, on purpose: the page's fold and the analysis's
    facts must describe the *same arrays*. Two functions building this dict
    would eventually build two different pictures, and the prose would be a
    faithful reading of the one nobody was looking at.
    """
    meta = panel.get("metricMeta") or {}
    response_meta = (panel.get("response") or {}).get("meta") or {}
    return {
        "x": list(folded.get("periods") or []),
        "grain": "month",
        "l3": str(card.get("l3") or ""),
        # The breadcrumb is what `filter_label` turns into `L3: 品牌传播 · by month`
        # — the analysis header the reader sees.
        "breadcrumb": [{"level": "L3", "value": str(card.get("l3") or "")}],
        "kpi": {"metric": str(folded.get("responseMetric") or ""),
                "data": list(folded.get("response") or []),
                "unit": str(response_meta.get("unit") or ""),
                "numberFormat": str(response_meta.get("numberFormat") or "")},
        "series": [
            {"metric": name,
             "data": list((folded.get("series") or {}).get(name, {}).get("v") or []),
             "unit": str((meta.get(name) or {}).get("unit") or ""),
             "numberFormat": str((meta.get(name) or {}).get("numberFormat") or "")}
            for name in sorted((folded.get("series") or {}))
        ],
    }


# ── prose ───────────────────────────────────────────────────────────────────

# VENDORING NOTE — this was the platform's LLM prompt. In an agent runtime there
# is nobody to send it to: the reader IS the model. So it is kept as the
# **standard** a narration must meet, emitted next to the facts by the
# `validation.facts` tool and cited by the business-validation skill. Keeping it
# here rather than in the skill is deliberate — it belongs beside the function
# that computes the facts it refers to, so the two cannot drift.
_STANDARD = """You are reading ONE chart from a marketing-mix data validation review.

FACTS below are computed from the exact series the chart plots. They are
authoritative. Do not compute, estimate, round differently, or invent any number
that is not in FACTS — quote them.

Write a specific reading of THIS chart:
- `headline`: one sentence a client would recognise as being about their data,
  naming at least one real period and one real magnitude from FACTS.
- `trends`: 2-4 statements about direction and pace over named period ranges.
  Say how a driver moves relative to the response where FACTS support it
  (`correlationWithResponse` is the only correlation you may cite).
- `anomalies`: periods where a series breaks its own pattern — use
  `largestMove`, `peak`, `trough`. Give the period and what happened. Do not
  assert a cause; say "cause not established from this data" when tempted.
- `inflections`: where a direction changes — cite the periods either side.
- `caveats`: gaps (`missingPeriods` > 0), short coverage, truncation. If a series
  has missing periods, say so instead of describing the gap as a value.

Every `period` you write must be one that appears in `FACTS.periods`. A period
that is not there is an invented period, and the gate refuses the file.

Copy `card`, `key`, `filterLabel` and `seriesDigest` verbatim from the slot you
were given. Do not construct them — they are how the page finds this analysis,
and how it tells a stale one from a current one.

Return ONLY JSON:
{"headline": "...", "trends": ["..."],
 "anomalies": [{"period": "...", "metric": "...", "note": "..."}],
 "inflections": [{"period": "...", "metric": "...", "note": "..."}],
 "caveats": ["..."]}

Write the prose in %(language)s. Be concrete. An empty list is better than a
vague entry. Field names, section labels and period keys are not prose — leave
them exactly as they are.

FACTS:
"""


#: What `%(language)s` reads as. Anything not listed is passed through as given,
#: so an unusual project language still produces a sentence rather than a blank.
_LANGUAGE_NAME = {"zh": "Chinese", "en": "English", "ja": "Japanese",
                  "ko": "Korean", "fr": "French", "de": "German", "es": "Spanish"}


def narration_standard(language: str = "en") -> str:
    """The standard a written analysis must meet, in the project's language.

    The platform sent this to an LLM. In an agent runtime the reader IS the model,
    so it is a standard rather than a prompt — but the language it asks for is a
    project setting, not a constant: the controls on the page are English because
    they are product chrome, while the sentences are what the client reads.
    """
    code = str(language or "en").strip().lower()
    return _STANDARD % {"language": _LANGUAGE_NAME.get(code, code or "English")}


#: The English form, kept under its old name so existing callers keep working.
NARRATION_STANDARD = narration_standard("en")


def _obs(items: object, limit: int = 6) -> list[ChartObservation]:
    out: list[ChartObservation] = []
    for it in (items if isinstance(items, list) else [])[:limit]:
        if isinstance(it, dict):
            out.append(ChartObservation(period=str(it.get("period", "")),
                                        metric=str(it.get("metric", "")),
                                        note=str(it.get("note", ""))))
        elif isinstance(it, str) and it.strip():
            out.append(ChartObservation(note=it.strip()))
    return out


def _strs(items: object, limit: int = 6) -> list[str]:
    return [str(s).strip() for s in (items if isinstance(items, list) else [])[:limit]
            if str(s).strip()]


def _fallback(facts: dict) -> dict:
    """The computed facts as prose — used when no LLM is configured.

    Deliberately plain: it must be obvious this is a readout, not an analysis, so
    nobody mistakes it for a judgement the AI made.
    """
    resp = facts.get("response") or {}
    trends: list[str] = []
    anomalies: list[dict] = []
    caveats: list[str] = []

    if resp.get("first"):
        chg = resp.get("changeFirstToLastPct")
        trends.append(
            f"{resp['metric']} moved from {resp['first']['value']:g} ({resp['first']['period']}) "
            f"to {resp['last']['value']:g} ({resp['last']['period']})"
            + (f", {chg:+.1f}%." if chg is not None else "."))
    for d in facts.get("drivers") or []:
        if not d.get("first"):
            caveats.append(f"{d['metric']} has no observed values in this view.")
            continue
        r = d.get("correlationWithResponse")
        trends.append(
            f"{d['metric']} peaks at {d['peak']['value']:g} ({d['peak']['period']}) and "
            f"bottoms at {d['trough']['value']:g} ({d['trough']['period']})"
            + (f"; correlation with the response is {r:+.2f}." if r is not None else "."))
        mv = d.get("largestMove")
        if mv:
            pct = f" ({mv['deltaPct']:+.1f}%)" if mv.get("deltaPct") is not None else ""
            anomalies.append({"period": mv["to"], "metric": d["metric"],
                              "note": f"largest single move: {mv['delta']:+g}{pct} from {mv['from']}"})
        if d.get("missingPeriods"):
            caveats.append(f"{d['metric']} is missing {d['missingPeriods']} period(s) in this view.")
    if facts.get("truncated"):
        caveats.append(f"Only the most recent {_MAX_POINTS} periods were analysed.")

    return {
        "headline": (f"{resp.get('metric', 'The response')} over "
                     f"{facts.get('periodCount', 0)} {facts.get('grain', 'period')}(s), "
                     f"with {len(facts.get('drivers') or [])} driver(s) — computed "
                     f"readout; no written analysis was supplied for this view."),
        "trends": trends[:4],
        "anomalies": anomalies[:6],
        "inflections": [],
        "caveats": caveats[:6],
    }


def read_chart(res: dict, query: dict, *, now: str = "") -> ValidationChartAnalysis:
    """The computed readout of one chart — every claim derived from the series.

    The skill grounds its narrative on this and on `compute_facts`; it does not
    replace the numbers, because a number the model wrote is not a number.
    """
    facts = compute_facts(res)
    reply = _fallback(facts)

    return ValidationChartAnalysis(
        key=analysis_key(query),
        card=str(query.get("card") or ""),
        l3=str(query.get("l3") or res.get("l3") or ""),
        filterLabel=filter_label(res, query),
        headline=str(reply.get("headline", "")).strip(),
        trends=_strs(reply.get("trends")),
        anomalies=_obs(reply.get("anomalies")),
        inflections=_obs(reply.get("inflections")),
        caveats=_strs(reply.get("caveats")),
        seriesDigest=series_digest(res),
        generatedAt=now,
        # This IS the floor: `validation.analyses` fills every card with one of
        # these so no card is ever blank, and a written analysis overlays it.
        # Saying `False` here would let the computed readout pass itself off as
        # somebody's reading.
        fallback=True,
    )
