"""The model-object id space, and what widening it must not disturb.

    .venv/bin/python tools/engine/tests/test_model_objects.py

`ANY` ("*") lets a coarser split be written in the same id space, so `ols.plan`
can offer `total` / `by-brand` / `by-channel` alongside `channel-x-brand` without
a second id format. That matters because the id is quoted verbatim by the change
ledger, by `ols-config.yaml`, and by gate verdicts a human already signed: two
spellings for one cell would silently orphan every one of them.

So the load-bearing assertion here is the boring one — **every id that could be
written before still parses and still selects the same rows**. The wildcard cases
are the new behaviour; the compatibility cases are the reason the wildcard was
chosen over a scheme prefix.
"""
from __future__ import annotations

import pandas as pd

from mmm_engine.selection.model_objects import (
    ANY,
    make_object,
    object_label,
    object_mask,
    split_object,
)

CHECKS = [0, 0]


def check(name: str, cond: bool, detail: str = "") -> None:
    CHECKS[0] += 1
    if not cond:
        CHECKS[1] += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


def frame() -> pd.DataFrame:
    """Five rows spanning the cases.

    `l1` carries the taxonomy the vocabulary reads: "KPI" marks a response, so
    MIZONE is a product that can own a model and RIVAL — spend with no response
    behind it — is market context. Without those columns every brand looks like
    market context and the brand half of the mask is a no-op, which is exactly the
    shape that makes a brand-filter test quietly assert nothing.
    """
    return pd.DataFrame([
        # (channel, brand, l1) — MIZONE sell-out is what makes it a response brand
        {"channel_type": "MT", "brand": "MIZONE", "l1": "KPI",
         "metric_type": "volume", "metric": "sales"},
        {"channel_type": "EC", "brand": "MIZONE", "l1": "MARKETING FACTOR",
         "metric_type": "spend", "metric": "display spend"},
        {"channel_type": "", "brand": "MIZONE", "l1": "MARKETING FACTOR",
         "metric_type": "spend", "metric": "tv spend"},          # national media
        {"channel_type": "MT", "brand": "RIVAL", "l1": "MARKETING FACTOR",
         "metric_type": "spend", "metric": "rival spend"},       # market row
        {"channel_type": "EC", "brand": "OTHERBRAND", "l1": "KPI",
         "metric_type": "volume", "metric": "sales"},            # a second product
    ])


def main() -> int:
    df = frame()

    # ── compatibility: ids that existed before schemes did ──
    check("a channel×brand id is unchanged", make_object("MT", "MIZONE") == "MT::MIZONE")
    check("a brand-less id stays a bare channel", make_object("MT", "") == "MT")
    check("splitting a bare channel yields no brand", split_object("MT") == ("MT", ""))
    check("a legacy bare id still selects its channel plus national rows",
          object_mask(df, "MT").tolist() == [True, False, True, True, False])
    check("the union syntax still works",
          object_mask(df, "MT+EC").tolist() == [True, True, True, True, True])
    check("a market row is shared into a product's model, not partitioned away",
          bool(object_mask(df, "MT::MIZONE").iloc[3]))
    check("another product's response is NOT shared in",
          not bool(object_mask(df, "MT::MIZONE").iloc[4]))

    # ── the wildcard ──
    check("a wildcard id keeps its separator", make_object(ANY, ANY) == "*::*")
    check("a wildcard channel keeps its separator too",
          make_object(ANY, "MIZONE") == "*::MIZONE")
    check("`*::*` selects every row", object_mask(df, "*::*").all())
    check("`*::MIZONE` spans channels, keeps market rows, drops the other product",
          object_mask(df, "*::MIZONE").tolist() == [True, True, True, True, False])
    check("`MT::*` is one channel, every brand",
          object_mask(df, "MT::*").tolist() == [True, False, True, True, False])

    # A brand named like the wildcard is not a thing, but the id must not become
    # ambiguous if a channel is ever blank on one side only.
    check("a half-blank wildcard still round-trips",
          split_object(make_object("", ANY)) == (ANY, ANY))

    # ── labels stay language-neutral: they land in payloads ──
    check("a wildcard renders as ALL, not as prose in one language",
          object_label("*::MIZONE") == "ALL · MIZONE")
    check("an ordinary label is untouched", object_label("MT::MIZONE") == "MT · MIZONE")

    print(f"\n{CHECKS[0]} checks · {CHECKS[1]} failed")
    return 1 if CHECKS[1] else 0


if __name__ == "__main__":
    raise SystemExit(main())
