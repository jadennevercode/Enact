"""The row set every scoring layer works over: the factor tree, joined to the data.

Both scoring layers ask the same question first — *which indicators am I scoring,
and what state is each one in?* — and they must answer it identically, because the
funnel counts only add up if they do. So the answer lives here, once.

**Rows come from the factor tree, not from the data.** One row per accepted
`(L1..L4 + indicator)`, carrying a `dataStatus`:

    scored          the long table has this series
    no-data         the tree asked for it and nothing arrived
    inherited-drop  an earlier layer already ruled it out; not re-scored

`no-data` is the state a data-driven row set cannot express at all: the row simply
is not there, which reads exactly like a factor nobody ever wanted. It is also a
different finding with a different fix — "we looked and it cannot be used" goes to
the data owner, "it never came" goes back to the data request.

Data that arrives without a factor asking for it is an **orphan**: counted and
named, never scored. A metric nobody claimed and nobody mentions is indistinguishable
from a metric that does not exist.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Optional

SCORED = "scored"
NO_DATA = "no-data"
INHERITED = "inherited-drop"


@dataclass(frozen=True)
class Row:
    """One row of a scorecard, before anything has been scored."""

    id: str
    tree_row_id: str
    l1: str
    l2: str
    l3: str
    l4: str
    indicator: str
    data_status: str
    tree_row: Any = None      # the FactorRow, for layers that read its declarations
    key: tuple[str, str] = ("", "")

    def head(self) -> dict:
        """The identity columns every scorecard row starts with."""
        return {"id": self.id, "l1": self.l1, "l2": self.l2, "l3": self.l3,
                "l4": self.l4, "indicator": self.indicator,
                "treeRowId": self.tree_row_id, "dataStatus": self.data_status}


@dataclass
class Universe:
    rows: list[Row]
    groups: dict[tuple[str, str], Any] = field(default_factory=dict)  # key → the series' rows
    orphans: list[str] = field(default_factory=list)
    inherited: int = 0

    @property
    def scored(self) -> list[Row]:
        return [r for r in self.rows if r.data_status == SCORED]

    def counts(self) -> dict[str, int]:
        out = {SCORED: 0, NO_DATA: 0, INHERITED: 0}
        for row in self.rows:
            out[row.data_status] = out.get(row.data_status, 0) + 1
        return out

    def signature(self) -> str:
        """A fingerprint of which rows exist and what state each is in.

        A rollup refuses to combine per-dimension payloads whose signatures differ.
        Mixing generations produces a scorecard that is internally consistent,
        wrong, and impossible to spot by reading it.
        """
        joined = "|".join("%s:%s" % (r.id, r.data_status) for r in self.rows)
        return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


def build(st, layer: str, *, prefix: str = "q", df=None) -> Universe:
    """Join the accepted factor-tree rows to the published long table.

    `layer` is the ledger layer being scored (`quality` / `statistical`); everything
    an earlier layer rejected comes back as `inherited-drop`. `prefix` is the row-id
    prefix, so one scorecard's `q-0007` is never confused with another's.
    """
    from mmm_engine import dataset
    from mmm_engine.selection import factor_link, ledger as L

    frame = dataset.model_df(st) if df is None else df
    link = factor_link.build(st)
    inherited_pairs = L.drops_before(st, layer)

    groups: dict[tuple[str, str], Any] = {}
    for (l4, metric), grp in frame.groupby(["l4", "metric"], dropna=False):
        if not str(metric).strip() or str(metric) == "<NA>":
            continue
        groups[L._norm_pair(l4, metric)] = grp

    tree_rows = [r for r in (getattr(getattr(st, "factor_tree", None), "rows", None) or [])
                 if getattr(r, "status", "") == "accepted"]

    rows, claimed = [], set()
    for i, tree_row in enumerate(tree_rows):
        key = L._norm_pair(tree_row.l4, tree_row.indicator)
        grp = groups.get(key)
        if grp is not None:
            claimed.add(key)
        if L._matches(key, inherited_pairs):
            status = INHERITED
        elif grp is None or grp.empty:
            status = NO_DATA
        else:
            status = SCORED
        rows.append(Row(
            id="%s-%04d" % (prefix, i + 1),
            tree_row_id=str(getattr(tree_row, "id", "")) or link.row_for(
                tree_row.l4, tree_row.indicator),
            l1=_s(tree_row.l1), l2=_s(tree_row.l2), l3=_s(tree_row.l3),
            l4=_s(tree_row.l4), indicator=_s(tree_row.indicator),
            data_status=status, tree_row=tree_row, key=key,
        ))

    orphans = sorted("%s :: %s" % (l4, metric) for (l4, metric) in groups
                     if (l4, metric) not in claimed)
    return Universe(rows=rows, groups=groups, orphans=orphans,
                    inherited=len(inherited_pairs))


def empty_reason(universe: Universe, what: str) -> str:
    """Why there is nothing to score — never a bare "no rows".

    An empty scorecard is a finding, and which finding it is decides who fixes it:
    an empty tree is the factor tree's problem, nothing delivered is the data
    request's, everything rejected upstream is the previous gate's.
    """
    counts = universe.counts()
    if not universe.rows:
        return "因子树里一条已采纳的指标都没有——%s无从做起" % what
    if counts[NO_DATA] and not counts[INHERITED]:
        return ("因子树要了 %d 个指标，一条数据都没到——%s无从做起，回数据需求与验收追交付"
                % (counts[NO_DATA], what))
    return ("因子树 %d 行，其中 %d 行没有数据、%d 行上游已否——一条都没剩，这是个发现，不是通过"
            % (len(universe.rows), counts[NO_DATA], counts[INHERITED]))


def read_payload(path) -> Optional[dict]:
    import json

    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None


def _s(value) -> str:
    text = str(value)
    return "" if text in ("nan", "<NA>", "None") else text.strip()
