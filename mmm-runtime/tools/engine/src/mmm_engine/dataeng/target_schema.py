"""The declared target schema — the contract the data must land on.

It lives in two places on purpose:

* `knowledge/schema/target-schema.yaml` — the **library default**, what ships.
* `metadata/schema/target-schema.yaml` — the **project's own**, seeded from the
  library and edited thereafter.

That split is the platform's own semantics (`schema_for(st)` returned the project's
schema if customised, else the default) with the reviewable half made a real file.
A schema that lived only in the repo could not describe this client's channels; one
that lived only in the workspace would be reinvented every project.

The contract is declared **before** the data arrives. That is what makes
`conformance` a mechanical check rather than a retrospective opinion — nobody can
tune the schema after seeing the result and call the result conformant.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from mmm_engine.dataeng.columns import COLUMN_NAMES, SYSTEM_COLUMNS
from mmm_engine.domain.models import TargetColumn

# name → (label, definition, kind, required)
_DEFAULT: dict[str, tuple[str, str, str, bool]] = {
    "task_name": ("Task", "Name of the source/task the row came from", "dimension", False),
    "brand": ("Brand", "Brand (model granularity)", "dimension", True),
    "province_group": ("Province group", "Province group / region (model granularity)", "dimension", False),
    "channel_type": ("Channel type", "Channel type, e.g. MT / TT / EC. BLANK MEANS NATIONAL — "
                     "media bought once for the country, shared into every model object", "dimension", False),
    "channel": ("Channel", "Channel (detailed)", "dimension", False),
    "year": ("Year", "Year as an integer, e.g. 2023", "time", True),
    "month": ("Month", "Month as a yyyymm integer, e.g. 202301", "time", True),
    "source": ("Source", "Data-source tag — which file/sheet the row came from", "dimension", False),
    "l1": ("Factor L1", "Factor tree Level 1", "factor", True),
    "l2": ("Factor L2", "Factor tree Level 2", "factor", True),
    "l3": ("Factor L3", "Factor tree Level 3", "factor", True),
    "l4": ("Factor L4", "Factor tree Level 4", "factor", True),
    "l5": ("Factor L5", "Drill-down Level 5 (empty if none)", "factor", False),
    "l6": ("Factor L6", "Drill-down Level 6 (empty if none)", "factor", False),
    "l7": ("Factor L7", "Drill-down Level 7 (empty if none)", "factor", False),
    "l8": ("Factor L8", "Drill-down Level 8 (empty if none)", "factor", False),
    "metric_type": ("Metric role", "Modeling role: Y (KPI/sell-out) | spending | X", "metric", True),
    "metric": ("Metric", "Indicator / metric name", "metric", True),
    # Optional, and the whole point of it being optional: without a unit column the
    # dimension-consistency subcheck has nothing to compare and must report itself
    # as UNVERIFIED rather than as a pass. Supply it and the check becomes real —
    # two units under one (l4, metric) is a caliber conflict, mechanically.
    "unit": ("Unit", "Unit of measure, e.g. 元 / 次 / % / 标准箱 — optional, but it is "
             "what makes the dimension-consistency check computable", "metric", False),
    "value": ("Value", "Numeric value (float)", "value", True),
}

_TYPE = {"time": "integer", "value": "number"}

#: The row identity. A grain key that repeats means the mapping fanned out.
DEFAULT_GRAIN_KEYS = ["brand", "channel_type", "province_group",
                      "l1", "l2", "l3", "l4", "metric", "month"]


def default_columns() -> list[TargetColumn]:
    out: list[TargetColumn] = []
    for name in COLUMN_NAMES:
        label, definition, kind, required = _DEFAULT.get(
            name, (name.title(), "", "dimension", False))
        out.append(TargetColumn(name=name, label=label, definition=definition,
                                kind=kind, required=required))
    return out


def _with_system_columns(cols: list[TargetColumn]) -> list[TargetColumn]:
    """`source` is always present. Removing it switches per-row provenance off for
    the whole project, so it is restored rather than treated as a user choice."""
    by_name = {c.name: c for c in cols}
    defaults = {c.name: c for c in default_columns()}
    out = list(cols)
    for name in SYSTEM_COLUMNS:
        if name in by_name:
            by_name[name].system = True
        elif name in defaults:
            restored = defaults[name].model_copy()
            restored.system = True
            out.append(restored)
    return out


def schema_for(st) -> list[TargetColumn]:
    """The project's target schema, or the library default if none is declared."""
    declared = list(getattr(st, "target_schema", None) or [])
    return _with_system_columns(declared or default_columns())


def columns_and_docs(st) -> tuple[list[str], dict[str, str]]:
    """(ordered column names, {name: definition}) — what grounds the AI's SQL draft."""
    schema = schema_for(st)
    docs = {c.name: (c.definition + (" [required]" if c.required else "")) for c in schema}
    return [c.name for c in schema], docs


# ── yaml ⇄ model ─────────────────────────────────────────────────────

def columns_from_yaml(rows: list[dict]) -> list[TargetColumn]:
    out: list[TargetColumn] = []
    for row in rows:
        name = str(row.get("name", "") or "").strip()
        if not name:
            continue
        kind = str(row.get("kind", "dimension") or "dimension")
        col = TargetColumn(
            name=name,
            label=str(row.get("label", "") or name.replace("_", " ").title()),
            definition=str(row.get("definition", "") or ""),
            kind=kind,
            required=bool(row.get("required")),
        )
        # Carried alongside the model so `conformance` can read them without a
        # second file: the model itself is the platform's and has no room for them.
        col.__dict__["_type"] = str(row.get("type", _TYPE.get(kind, "text")))
        col.__dict__["_enum"] = str(row.get("enum", "") or "")
        col.__dict__["_null_means"] = str(row.get("nullMeans", "") or "")
        if row.get("system"):
            col.system = True
        out.append(col)
    return out


def columns_to_yaml(cols: list[TargetColumn]) -> list[dict]:
    out = []
    for c in cols:
        row: dict[str, Any] = {"name": c.name, "label": c.label, "kind": c.kind,
                               "type": c.__dict__.get("_type", _TYPE.get(c.kind, "text")),
                               "required": bool(c.required)}
        if c.__dict__.get("_enum"):
            row["enum"] = c.__dict__["_enum"]
        if c.__dict__.get("_null_means"):
            row["nullMeans"] = c.__dict__["_null_means"]
        if c.definition:
            row["definition"] = c.definition
        if getattr(c, "system", False):
            row["system"] = True
        out.append(row)
    return out


def default_document() -> dict:
    """The library default, as the YAML a workspace is seeded with."""
    return {
        "version": 2,
        "grain": {"time": "month", "keys": list(DEFAULT_GRAIN_KEYS)},
        "columns": columns_to_yaml(_apply_default_enums(default_columns())),
    }


_DEFAULT_ENUMS = {"channel_type": "channel_type", "metric_type": "metric_type",
                  "brand": "brand", "province_group": "province_group"}


def _apply_default_enums(cols: list[TargetColumn]) -> list[TargetColumn]:
    for c in cols:
        c.__dict__.setdefault("_type", _TYPE.get(c.kind, "text"))
        enum = _DEFAULT_ENUMS.get(c.name, "")
        if enum:
            c.__dict__["_enum"] = enum
        if c.name == "channel_type":
            c.__dict__["_null_means"] = "national"
    return cols


def load_document(path: "str | Path") -> dict:
    from mmm_engine import workspace
    return workspace.read_yaml(path)


def grain_keys(document: dict) -> list[str]:
    keys = ((document.get("grain") or {}).get("keys")) or DEFAULT_GRAIN_KEYS
    return [str(k) for k in keys]


def time_grain(document: dict) -> str:
    return str((document.get("grain") or {}).get("time") or "month")


def enum_of(col: TargetColumn) -> str:
    return str(col.__dict__.get("_enum", "") or "")


def type_of(col: TargetColumn) -> str:
    return str(col.__dict__.get("_type", _TYPE.get(col.kind, "text")))
