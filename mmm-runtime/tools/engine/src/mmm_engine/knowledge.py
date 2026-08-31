"""Knowledge resolution — two modes, deliberately different.

**Prose recall** is fuzzy and grounds narrative. **Keyed lookup** is exact and
supplies numbers. Keeping them apart is not tidiness: the platform's single most
expensive knowledge bug was a *fuzzy* lookup used for a *number* — a Danone
beverage ROI band applied to a skincare factor, caught only because someone ran a
non-beverage case. `match_factor_range`'s own docstring lists four benchmarks that
substring matching manufactured (`Connected TV`→`TV`, `OOH Billboards`→`OOH`,
`Digital Display Ads`→`Digital Display`, `价格变动率`→`价格变动`).

So numbers are looked up on an **exact** key, and an industry pack is reachable
only from a workspace whose industry anchor matches its **directory**. A skincare
project cannot read `knowledge/industry/food-bev/beverage/` at all, by
construction rather than by policy.

A missing pack is reported as missing. It is never quietly substituted.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

#: Environment override, for a workspace that carries its own library.
_ENV = "MMM_KNOWLEDGE_DIR"


@lru_cache(maxsize=1)
def root() -> Path:
    """The knowledge library directory.

    Search order: `$MMM_KNOWLEDGE_DIR`, then the repo's own `knowledge/` found by
    walking up from this file.

    Raises when neither resolves, and that is the load-bearing part. Returning a
    non-existent path was supposed to make callers report it; they do not —
    `packs()` answers `[]` and `best_match()` answers `None`, both of which are
    also the legitimate answers for "this industry has no pack". So an engine
    installed outside the runtime (a non-editable `pip install`, a moved
    checkout) recalled nothing at all and looked exactly like a project whose
    factors happen to have no precedent.
    """
    override = os.environ.get(_ENV)
    if override:
        return Path(override).expanduser().resolve()
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "knowledge"
        if candidate.is_dir():
            return candidate
    raise RuntimeError(
        "找不到知识库：从 %s 一路往上都没有 knowledge/ 目录。\n"
        "    引擎大概装在了 runtime 之外。要么装成可编辑模式"
        "（pip install -e <runtime>/tools/engine），\n"
        "    要么显式指出来：MMM_KNOWLEDGE_DIR=<runtime>/knowledge" % here)


def methodology_dir() -> Path:
    """Where the machine-readable rubrics live (`scoring.rules` reads these)."""
    return root() / "methodology"


def industry_dir(l1: str, l2: str = "", l3: str = "") -> Optional[Path]:
    """The deepest industry pack directory that exists for this anchor, or None.

    Deepest-first: `food-bev/beverage/sports-functional` before `food-bev/beverage`
    before `food-bev`. Never falls sideways into a sibling — a pack for a
    *different* industry is not a worse match, it is the wrong answer.
    """
    base = root() / "industry"
    parts = [p for p in (str(l1 or "").strip(), str(l2 or "").strip(), str(l3 or "").strip()) if p]
    for depth in range(len(parts), 0, -1):
        candidate = base.joinpath(*parts[:depth])
        if candidate.is_dir():
            return candidate
    return None


def industry_dir_for(st) -> Optional[Path]:
    """The pack for a project state's industry anchor."""
    meta = getattr(st, "meta", None)
    industry = getattr(meta, "industry", None) if meta is not None else None
    if industry is None:
        return None
    return industry_dir(getattr(industry, "l1", ""), getattr(industry, "l2", ""),
                        getattr(industry, "l3", ""))


@lru_cache(maxsize=32)
def _load_json(path_str: str) -> dict[str, Any]:
    try:
        return json.loads(Path(path_str).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def factor_ranges(st) -> dict[str, Any]:
    """This project's industry ROI/contribution band library, or `{}`.

    `{}` means "no benchmark library for this industry", and every caller must
    render that as *no benchmark* — never as "out of range". A factor with no band
    has not failed a check; there was no check.
    """
    pack = industry_dir_for(st)
    if pack is None:
        return {}
    return _load_json(str(pack / "factor-ranges.json"))


def match_range(ranges: dict, l4: str, indicator: str = "") -> Optional[dict]:
    """Exact band lookup: `(l4, indicator)` first, then `l4` alone. Never substring.

    Returns None when nothing matches. See this module's header for why the
    substring path does not exist here.
    """
    if not ranges:
        return None
    rows = ranges.get("factors") or ranges.get("rows") or []
    l4n, indn = _norm(l4), _norm(indicator)
    if indn:
        for row in rows:
            if _row_l4(row) == l4n and _row_indicator(row) == indn:
                return row
    for row in rows:
        if _row_l4(row) == l4n and not _row_indicator(row):
            return row
    for row in rows:
        if _row_l4(row) == l4n:
            return row
    return None


#: The packs are hand-maintained and came from workbooks, so a row may be spelled
#: either way. Reading both is not leniency about *matching* — the match is still
#: exact — it is leniency about which column header a spreadsheet used.
_L4_KEYS = ("l4", "L4", "l4Name")
_INDICATOR_KEYS = ("indicator", "指标", "Indicator", "metric")


def _row_l4(row: dict) -> str:
    for key in _L4_KEYS:
        if row.get(key):
            return _norm(row[key])
    return ""


def _row_indicator(row: dict) -> str:
    for key in _INDICATOR_KEYS:
        if row.get(key):
            return _norm(row[key])
    return ""


def _norm(value: object) -> str:
    return str(value or "").strip().lower()


# ── prose recall ─────────────────────────────────────────────────────

def packs() -> list[dict[str, Any]]:
    """The registry in `knowledge/index.yaml`, or [] when there is none."""
    path = root() / "index.yaml"
    if not path.is_file():
        return []
    try:
        import yaml  # optional; the suite's own reader is in shared/lib
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001
        return []
    return list(data.get("packs") or [])


# ── templates (the industry packs, as the vendored code expects them) ─

class _Row:
    """One factor-tree template row. Duck-typed to what `scoring.rules` reads."""

    __slots__ = ("l1", "l2", "l3", "l4", "indicator", "roi_range",
                 "contribution_range", "dimension", "definition", "unit")

    def __init__(self, data: dict):
        self.l1 = str(data.get("l1", "") or "")
        self.l2 = str(data.get("l2", "") or "")
        self.l3 = str(data.get("l3", "") or "")
        self.l4 = str(data.get("l4", "") or "")
        self.indicator = str(data.get("indicator", "") or "")
        # Accept both spellings: the packs are hand-maintained YAML.
        self.roi_range = str(data.get("roiRange", data.get("roi_range", "")) or "")
        self.contribution_range = str(
            data.get("contributionRange", data.get("contribution_range", "")) or "")
        self.dimension = str(data.get("dimension", "") or "")
        self.definition = str(data.get("definition", "") or "")
        self.unit = str(data.get("unit", "") or "")


class _Template:
    """One pack file. `kind` is factor_tree | interview | rules."""

    def __init__(self, kind: str, path: Path, data: dict):
        self.kind = kind
        self.path = path
        self.data = data or {}
        self.factor_rows = [_Row(r) for r in (self.data.get("rows") or [])]
        self.vocab = self.data.get("vocab") or None
        self.questions = self.data.get("questions") or []


_KIND_FILE = {"factor_tree": "factor-tree.yaml", "interview": "interview.yaml",
              "rules": "rules.yaml"}


class TemplateStore:
    """Reads industry packs off disk. Anchored by directory — see the module header.

    `best_match` walks the anchor from deepest to shallowest and stops at the first
    pack that has the requested file. It does **not** fall sideways: with no pack
    for this industry it returns None, and every caller treats that as "no
    template", which is the whole point of the directory boundary.
    """

    def best_match(self, kind: str, l1: Optional[str] = None,
                   l2: Optional[str] = None, l3: Optional[str] = None) -> Optional[_Template]:
        name = _KIND_FILE.get(kind)
        if not name or not l1:
            return None
        base = root() / "industry"
        parts = [p for p in (str(l1 or "").strip(), str(l2 or "").strip(),
                             str(l3 or "").strip()) if p]
        for depth in range(len(parts), 0, -1):
            path = base.joinpath(*parts[:depth]) / name
            if path.is_file():
                data = _read_yaml(path)
                if data:
                    return _Template(kind, path, data)
        return None


_STORE = TemplateStore()


def get_templates() -> TemplateStore:
    return _STORE


def _read_yaml(path: Path) -> dict:
    try:
        import yaml
        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001
        pass
    # Fall back to the suite's own restricted reader when PyYAML is absent, so a
    # laptop without it still gets its knowledge rather than silently getting none.
    try:
        import sys
        for parent in Path(__file__).resolve().parents:
            lib = parent / "shared" / "lib"
            if lib.is_dir():
                sys.path.insert(0, str(lib))
                break
        import yamlio  # type: ignore
        return yamlio.load(path.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001
        return {}


def recall_label(st) -> str:
    """What an artifact's `knowledgeRecall` should say — a pack id, or 'none'.

    'none' is a real answer and must be shown as one. A deliverable grounded on
    nothing looks exactly like a deliverable grounded on something, right up until
    someone asks where a number came from.
    """
    pack = industry_dir_for(st)
    if pack is None:
        return "none"
    return str(pack.relative_to(root() / "industry")).replace(os.sep, "/")
