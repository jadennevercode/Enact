"""The unified long-table column contract (the "2.21 schema").

Every published mart lands on these columns, in this order — it is what
`mmm.pivot.build_model_frame` consumes, and what `metadata/schema/target-schema.yaml`
declares in reviewable form. The list is duplicated in neither place by accident:
this module is the code's copy, the YAML is the project's copy, and
`dataeng.target_schema` is what reconciles them.

Vendored from the platform's `app/ingest/dataset.py`, which also held the
Danone-specific workbook loader. Only the contract came across.
"""
from __future__ import annotations

COLUMN_NAMES: list[str] = [
    "task_name",
    "brand",
    "province_group",
    "channel_type",
    "channel",
    "year",
    "month",
    "source",
    "l1",
    "l2",
    "l3",
    "l4",
    "l5",
    "l6",
    "l7",
    "l8",
    "metric_type",
    "metric",
    "unit",
    "value",
]

#: Columns whose values are text. Everything else is numeric.
STRING_COLS: list[str] = [
    "task_name", "brand", "province_group", "channel_type", "channel",
    "source", "l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8",
    "metric_type", "metric", "unit",
]

#: The factor path, deepest-last. A row's identity is this plus `metric`.
FACTOR_LEVELS: list[str] = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"]

#: Written by the engine, never by a human, and restored if a schema drops it —
#: removing it switches per-row provenance off for the whole project.
SYSTEM_COLUMNS: tuple[str, ...] = ("source",)

#: Columns a published table MAY omit. Everything else in `COLUMN_NAMES` is part of
#: the contract and its absence means the table is not the long table.
#:
#: `unit` is optional because it arrived after tables had already been published:
#: demanding it would have made every existing mart unreadable overnight, and the
#: check that consumes it (dimension consistency) is written to report itself as
#: UNVERIFIED when it is absent. Readers backfill it empty so downstream code can
#: always name the column.
OPTIONAL_COLUMNS: tuple[str, ...] = ("unit",)
