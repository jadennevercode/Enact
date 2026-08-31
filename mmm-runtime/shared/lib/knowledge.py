"""The one place the suite talks to the knowledge library.

Two retrieval modes, deliberately different (`shared/knowledge-recall.md`):

**Prose recall** (:func:`recall`) is fuzzy and grounds narrative. **Keyed lookup**
(:func:`lookup`) is exact and supplies numbers. Keeping them apart is not
tidiness: the most expensive knowledge bug in the platform this suite is
distilled from was a *fuzzy* lookup used for a *number* — a Danone beverage ROI
band applied to a skincare factor, caught only because someone happened to run a
non-beverage case. Substring matching had manufactured benchmarks that were never
in the library (`Connected TV`→`TV`, `OOH Billboards`→`OOH`, `价格变动率`→`价格变动`).

So:

* numbers are matched on an exact ``(l4, indicator)`` key and never on a substring;
* an industry pack is reachable only from a workspace whose industry anchor
  matches its **directory**. A skincare engagement cannot read
  ``knowledge/industry/food-bev/beverage/`` at all — by construction, not by policy;
* a missing pack is reported as missing. It is never quietly substituted.

`knowledge/index.yaml` is the only candidate surface. A file that is not listed in
some pack's ``files`` cannot be recalled, which is how a retired rule stops
acquiring provenance by being sat in the directory.

Standard library only. This has to work on a laptop with nothing installed.
"""
from __future__ import annotations

import json
import os
import re
import sys

__all__ = [
    "Recall", "recall", "lookup", "library_root", "packs",
    "industry_pack", "reachable_packs", "NO_PACK",
]

#: What a caller says, and stamps, when this engagement's industry has no pack.
NO_PACK = "no knowledge pack for this industry"

#: Library root override, for a workspace that carries its own copy.
_ENV = "MMM_KNOWLEDGE_DIR"

_TEXT_SUFFIXES = (".yaml", ".yml", ".json", ".md", ".txt")


# ── the library on disk ──────────────────────────────────────────────

def _yamlio():
    """The suite's dependency-free YAML reader, importable from anywhere."""
    here = os.path.dirname(os.path.realpath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    import yamlio  # noqa: PLC0415 — deliberately late, keeps this module importable alone
    return yamlio


def library_root():
    """The knowledge library directory.

    `$MMM_KNOWLEDGE_DIR` first, then the repo's own `knowledge/` found by walking
    up from this file. Resolved per call, not cached at import: the environment
    can change between calls and a stale root silently answers from the wrong
    library.

    Raises when neither resolves. Handing back a path that does not exist made
    `packs()` answer `[]`, which is also the answer for "no packs registered" —
    so a library the code simply could not find read as a library with nothing
    in it.
    """
    override = os.environ.get(_ENV)
    if override:
        return os.path.abspath(os.path.expanduser(override))
    here = os.path.dirname(os.path.realpath(__file__))
    start = here
    while True:
        candidate = os.path.join(here, "knowledge")
        if os.path.isdir(candidate):
            return candidate
        parent = os.path.dirname(here)
        if parent == here:
            raise RuntimeError(
                "找不到知识库：从 %s 一路往上都没有 knowledge/ 目录。"
                "用 MMM_KNOWLEDGE_DIR 显式指出来。" % start)
        here = parent


def packs():
    """Every registered pack in `index.yaml`, or [] when there is no registry."""
    path = os.path.join(library_root(), "index.yaml")
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as handle:
            data = _yamlio().load(handle.read()) or {}
    except Exception:  # noqa: BLE001 — an unreadable registry is "no library", not a crash
        return []
    return [p for p in (data.get("packs") or []) if isinstance(p, dict)]


def _pack_dir(pack):
    """The industry directory a pack is anchored to, as a list of levels.

    Read off the pack's own files (`industry/<l1>/<l2>/...`) because the directory
    IS the boundary; the declared `anchor` is only a fallback for a pack that has
    no files yet, like a placeholder for an industry nobody has worked in.
    """
    for rel in pack.get("files") or []:
        parts = str(rel).replace("\\", "/").split("/")
        if len(parts) > 2 and parts[0] == "industry":
            return parts[1:-1]
    anchor = pack.get("anchor") or {}
    return [str(anchor.get(key) or "").strip()
            for key in ("l1", "l2", "l3") if str(anchor.get(key) or "").strip()]


def _anchor_levels(anchor):
    if not anchor or not str(anchor.get("l1") or "").strip():
        raise ValueError("knowledge recall needs an industry anchor (l1/l2/l3)")
    return [str(anchor.get(key) or "").strip()
            for key in ("l1", "l2", "l3") if str(anchor.get(key) or "").strip()]


def industry_pack(anchor):
    """The deepest industry pack this anchor can reach, or None.

    Deepest-first, and never sideways: a pack for a *different* industry is not a
    worse match, it is the wrong answer. A pack deeper than the anchor is also not
    a match — knowing `food-bev` does not entitle you to the beverage bands.
    """
    levels = _anchor_levels(anchor)
    best = None
    for pack in packs():
        if pack.get("kind") != "industry":
            continue
        pack_levels = _pack_dir(pack)
        if not pack_levels or pack_levels != levels[:len(pack_levels)]:
            continue
        if not (pack.get("files") or []):
            continue                      # a registered placeholder is still no pack
        if best is None or len(pack_levels) > len(_pack_dir(best)):
            best = pack
    return best


def reachable_packs(anchor):
    """Every pack this engagement may read: the `scope: all` ones plus its own industry."""
    mine = industry_pack(anchor)
    out = [p for p in packs() if p.get("scope") == "all" and (p.get("files") or [])]
    if mine is not None:
        out.append(mine)
    return out


# ── prose recall ─────────────────────────────────────────────────────

class Recall(object):
    """A recall result.

    `source` is what belongs in the deliverable's `knowledgeRecall`. `industry` is
    the pack id that supplied industry material, or None — and None has to be
    said out loud, because a deliverable grounded on nothing looks exactly like
    one grounded on something right up until someone asks where a number came from.
    """

    def __init__(self, source, items, industry=None, note=""):
        self.source = source
        self.items = items
        self.industry = industry
        self.note = note

    @property
    def pack_ids(self):
        seen = []
        for item in self.items:
            if item["pack"] not in seen:
                seen.append(item["pack"])
        return seen

    def __repr__(self):  # pragma: no cover - debugging aid
        return "Recall(source=%r, items=%d, industry=%r)" % (
            self.source, len(self.items), self.industry)


def recall(anchor, ask, k=8):
    """Retrieve priors for `ask`, anchored on an industry L1-L3.

    `anchor` is `{"l1":..., "l2":..., "l3":...}`. Anchoring is not optional: an
    unanchored recall returns a plausible number from the wrong industry, and it
    looks entirely at home in the deliverable.

    Searches the `scope: all` packs plus this engagement's own industry pack, and
    nothing else. The ROI/contribution range file is deliberately excluded — those
    are numbers, and numbers go through :func:`lookup` on an exact key.

    Returns a :class:`Recall`, or None when nothing matched. None is a normal
    outcome, not an error: the caller proceeds on the engagement's own documents
    and stamps `knowledgeRecall: none`.
    """
    root = library_root()
    reachable = reachable_packs(anchor)
    mine = industry_pack(anchor)

    if not reachable and not os.path.isfile(os.path.join(root, "index.yaml")):
        return _scan_loose(root, anchor, ask, k)

    terms = _terms(ask or "")
    hits = []
    for pack in reachable:
        for entry in _entries(root, pack):
            entry["score"] = _score(entry["text"], terms)
            if entry["score"] > 0:
                hits.append(entry)
    hits.sort(key=lambda e: (-e["score"], e["pack"], e["file"], e["title"]))
    hits = hits[:k]
    if not hits:
        return None

    industry_id = mine.get("id") if mine is not None else None
    used_industry = industry_id if any(h["pack"] == industry_id for h in hits) else None
    label = used_industry or "methodology"
    return Recall("kb:%s@v%s" % (label, _version(root)), hits, used_industry,
                  "" if mine is not None else NO_PACK)


def _version(root):
    path = os.path.join(root, "index.yaml")
    try:
        with open(path, encoding="utf-8") as handle:
            return str((_yamlio().load(handle.read()) or {}).get("version", "0"))
    except Exception:  # noqa: BLE001
        return "0"


#: Files that hold numbers rather than prose. Excluded from recall on purpose:
#: the whole reason the two modes exist is that a band must never be reached by a
#: fuzzy match.
_NUMBERS = ("factor-ranges.json",)


def _entries(root, pack):
    """Chunk a pack's registered files into recallable entries."""
    out = []
    for rel in pack.get("files") or []:
        if os.path.basename(rel) in _NUMBERS:
            continue
        path = os.path.join(root, *str(rel).split("/"))
        if not os.path.isfile(path) or not path.endswith(_TEXT_SUFFIXES):
            continue
        try:
            with open(path, encoding="utf-8") as handle:
                raw = handle.read()
        except OSError:
            continue
        data = _parse(path, raw)
        chunks = _chunk(data) if isinstance(data, dict) else []
        if not chunks:
            chunks = [(os.path.basename(rel), raw)]
        for title, text in chunks:
            out.append({"pack": pack.get("id", ""), "file": rel, "kind": pack.get("kind", ""),
                        "title": title, "text": text, "score": 0})
    return out


def _parse(path, raw):
    try:
        if path.endswith(".json"):
            return json.loads(raw)
        if path.endswith((".yaml", ".yml")):
            return _yamlio().load(raw)
    except Exception:  # noqa: BLE001 — a malformed pack file degrades to plain text
        return None
    return None


def _chunk(data):
    """Split one pack file into entries a narrative can actually cite.

    Whole files make bad entries: a 94-row factor tree recalled as one blob is a
    hit on everything and evidence for nothing.
    """
    if isinstance(data.get("rows"), list):                     # a factor-tree pack
        groups = _group(data["rows"], lambda r: (r.get("l1"), r.get("l2"), r.get("l3")))
        out = []
        for key, rows in groups:
            title = " › ".join([p for p in key if p])
            body = [title] + ["%s — %s" % (r.get("l4") or "", r.get("indicator") or "")
                              for r in rows]
            body += [str(r.get("drilldown")) for r in rows if r.get("drilldown")]
            out.append((title, "\n".join(body)))
        return out

    if isinstance(data.get("questions"), list):                # an interview pack
        groups = _group(data["questions"], lambda q: (q.get("layer"), q.get("team") or q.get("role")))
        out = []
        for key, qs in groups:
            title = " · ".join([p for p in key if p])
            out.append((title, "\n".join([title] + [str(q.get("tag") or "") + " " +
                                                    str(q.get("question") or "") for q in qs])))
        return out

    if isinstance(data.get("pairs"), list):                    # the L1/L2 skeleton
        groups = _group(data["pairs"], lambda p: (p.get("l1"),))
        out = [(str(key[0]), "\n".join([str(key[0])] + [str(p.get("l2")) for p in rows]))
               for key, rows in groups]
        out.append(("levels & rules", _join(data.get("levels"), data.get("rules"))))
        return out

    if isinstance(data.get("layers"), list):                   # the interview framework
        out = [(str(lay.get("layer") or ""), _join(lay.get("layer"), lay.get("zh"),
                                                   lay.get("asks"), lay.get("durationMin")))
               for lay in data["layers"] if isinstance(lay, dict)]
        out.append(("data sub-questions", _join(data.get("dataSubQuestions"))))
        out.append(("question tags", _join(data.get("questionTags"), data.get("notes"))))
        out.append(("reference roles", _join(data.get("referenceRoles"))))
        return out

    return []


def _group(rows, key_of):
    """Stable group-by that keeps the file's own order — packs are ordered on purpose."""
    order, buckets = [], {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = tuple(str(part or "") for part in key_of(row))
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        buckets[key].append(row)
    return [(key, buckets[key]) for key in order]


def _join(*parts):
    out = []
    for part in parts:
        if part is None:
            continue
        if isinstance(part, (list, tuple)):
            out.extend(_join(*part).splitlines())
        elif isinstance(part, dict):
            out.extend(_join(*list(part.keys()) + list(part.values())).splitlines())
        else:
            out.append(str(part))
    return "\n".join(x for x in out if x)


# ── scoring ──────────────────────────────────────────────────────────
#
# Whitespace tokenising answers an English question and silently returns nothing
# for a Chinese one, and every factor name in this library is Chinese. So Latin
# runs become words and CJK runs become character bigrams, which is enough to make
# 「冰柜」 find 「自有冰柜」 without pretending to be a tokeniser.

_LATIN = re.compile(r"[A-Za-z0-9_]{2,}")
_CJK = re.compile(r"[㐀-鿿぀-ヿ]+")


def _terms(text):
    out = []
    for word in _LATIN.findall(text):
        out.append(word.lower())
    for run in _CJK.findall(text):
        if len(run) == 1:
            out.append(run)
            continue
        out.extend(run[i:i + 2] for i in range(len(run) - 1))
        if len(run) <= 8:
            out.append(run)
    seen, uniq = set(), []
    for term in out:
        if term not in seen:
            seen.add(term)
            uniq.append(term)
    return uniq


def _score(text, terms):
    """Longer matched terms count for more, so a whole phrase beats two bigrams."""
    haystack = text.lower()
    return sum(len(term) for term in terms if term in haystack)


# ── the loose-directory fallback ─────────────────────────────────────

def _scan_loose(root, anchor, ask, k):
    """`$MMM_KNOWLEDGE_DIR` pointed at a plain directory with no `index.yaml`.

    A convenience, not the design. The anchor still has to appear in the file's
    path — an unanchored plain-file scan is exactly the failure this module exists
    to prevent.
    """
    if not os.path.isdir(root):
        return None
    terms = _terms(ask or "")
    levels = [level.lower() for level in _anchor_levels(anchor)]
    hits = []
    for folder, _dirs, files in os.walk(root):
        for name in files:
            if not name.endswith(_TEXT_SUFFIXES):
                continue
            path = os.path.join(folder, name)
            where = os.path.relpath(path, root).lower()
            if not any(level in where for level in levels):
                continue
            try:
                with open(path, encoding="utf-8") as handle:
                    body = handle.read()
            except OSError:
                continue
            score = _score(body, terms)
            if score:
                hits.append({"pack": "dir:%s" % os.path.basename(root.rstrip(os.sep)),
                             "file": os.path.relpath(path, root), "kind": "loose",
                             "title": name, "text": body, "score": score})
    hits.sort(key=lambda hit: -hit["score"])
    if not hits:
        return None
    return Recall("dir:%s" % os.path.basename(root.rstrip(os.sep)), hits[:k], None, "")


# ── keyed lookup ─────────────────────────────────────────────────────

def lookup(anchor, l4, indicator=""):
    """The expected ROI / contribution bands for one factor. Exact key, or nothing.

    Matching is exact on `(l4, indicator)` after trimming and case folding. There
    is no substring path and there will not be one: a benchmark has to be a
    benchmark for *this* factor, or it is worse than none.

    Returns a dict carrying the bands **and their provenance**, or None. None
    means "no band for this factor", which is not the same as "out of range" — a
    factor with no band has not failed a check, there was no check.

    An engagement whose industry has no pack always gets None. It never borrows
    another industry's bands; see this module's header for what that cost once.
    """
    pack = industry_pack(anchor)
    if pack is None:
        return None
    rel = ((pack.get("numbers") or {}).get("file")
           or _first(pack.get("files") or [], lambda f: os.path.basename(f) in _NUMBERS))
    if not rel:
        return None
    path = os.path.join(library_root(), *str(rel).split("/"))
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.loads(handle.read())
    except (OSError, ValueError):
        return None

    rows = data.get("factors") or data.get("rows") or []
    want_l4, want_ind = _norm(l4), _norm(indicator)
    if not want_l4:
        return None

    hit, matched_on = None, ""
    if want_ind:
        for row in rows:
            if _norm(_get(row, "l4", "L4")) == want_l4 and _norm(_get(row, "indicator", "指标")) == want_ind:
                hit, matched_on = row, "l4+indicator"
                break
    else:
        for row in rows:
            if _norm(_get(row, "l4", "L4")) == want_l4:
                hit, matched_on = row, "l4"
                break
    if hit is None:
        return None

    return {
        "l1": _get(hit, "l1", "L1"), "l2": _get(hit, "l2", "L2"), "l3": _get(hit, "l3", "L3"),
        "l4": _get(hit, "l4", "L4"), "indicator": _get(hit, "indicator", "指标"),
        "roiRange": hit.get("roiRange"),
        "contributionYearly": hit.get("contributionYearly", hit.get("contributionRange")),
        "drilldown": hit.get("drilldown"),
        "suspect": hit.get("roiRangeSuspect"),
        "matchedOn": matched_on,
        "pack": pack.get("id", ""),
        "file": rel,
        # The provenance travels with the number. A caption in `index.yaml` cannot
        # protect the next person, who will not read `index.yaml`.
        "provenance": dict(data.get("provenance") or {},
                           **{"pack": pack.get("id", ""), "file": rel}),
    }


def _first(items, predicate):
    for item in items:
        if predicate(item):
            return item
    return None


def _get(row, *keys):
    for key in keys:
        if row.get(key):
            return row[key]
    return ""


def _norm(value):
    return str(value or "").strip().lower()
