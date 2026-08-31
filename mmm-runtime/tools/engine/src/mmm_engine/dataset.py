"""The project's modeling table — resolved from the workspace, and nowhere else.

VENDORING NOTE. This replaces the platform's `app/agents/dataset_cache.py`, which
resolved a project's long table from its upload store and, failing that, from the
**Danone reference dataset**. That fallback was guarded by an allowlist and a
config switch precisely because it was dangerous: scoring a real client on another
client's 23.8k rows is the kind of error that produces a confident, complete,
entirely fictional deliverable.

Here the table is `data/published/long.parquet` in the workspace. There is no
second source to fall back to, so the guard is not a policy — there is nothing to
guard. A project with no published table resolves to `source="none"` with a
reason, and S2 blocks on it.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import pandas as pd

from mmm_engine.dataeng.columns import COLUMN_NAMES, OPTIONAL_COLUMNS

#: Resolutions, keyed by workspace path. Cleared by `invalidate`.
_CACHE: dict[str, "DatasetResolution"] = {}

PUBLISHED_REL = Path("data") / "published" / "long.parquet"


@dataclass(frozen=True)
class DatasetResolution:
    """Where a project's modeling table came from, and why."""
    df: Optional[pd.DataFrame]
    source: str          # "published" | "none"
    reason: str = ""     # populated for "none" — this is what the human is told

    @property
    def usable(self) -> bool:
        return self.df is not None and not self.df.empty


def _workspace_of(st) -> Optional[Path]:
    ws = getattr(st, "_workspace", None)
    return Path(ws) if ws else None


def attach(st, workspace: "str | Path", df: Optional[pd.DataFrame] = None) -> None:
    """Bind a state to its workspace, optionally seeding an in-memory table.

    `workspace.load_state` calls this. The seed exists so a tool that has just
    computed a table can score it without a round trip through disk — but note it
    is still the *tool's* table, never the model's.
    """
    object.__setattr__(st, "_workspace", str(workspace))
    if df is not None:
        _CACHE[str(workspace)] = DatasetResolution(df, "published")


def invalidate(workspace: "str | Path" = "") -> None:
    if workspace:
        _CACHE.pop(str(workspace), None)
    else:
        _CACHE.clear()


def resolve_dataset(st) -> DatasetResolution:
    ws = _workspace_of(st)
    if ws is None:
        return DatasetResolution(None, "none",
                                 "this state is not attached to a workspace")
    key = str(ws)
    if key in _CACHE:
        return _CACHE[key]

    path = ws / PUBLISHED_REL
    if not path.is_file():
        res = DatasetResolution(
            None, "none",
            "no published long table at %s — run the Data Engine (2.0) and publish "
            "before anything downstream can be scored" % PUBLISHED_REL.as_posix())
    else:
        try:
            df = pd.read_parquet(path)
        except Exception as error:  # noqa: BLE001
            res = DatasetResolution(None, "none",
                                    "%s could not be read: %s" % (PUBLISHED_REL.as_posix(), error))
        else:
            missing = [c for c in COLUMN_NAMES
                       if c not in df.columns and c not in OPTIONAL_COLUMNS]
            if missing:
                res = DatasetResolution(
                    None, "none",
                    "the published table is missing %s — it does not match the long-table "
                    "contract" % ", ".join(missing))
            else:
                # An optional column that is absent is backfilled empty rather than
                # left out: every consumer can then name it, and "the column is not
                # there" and "the column is there and blank" become the same case —
                # which is what they mean (nobody declared this).
                for name in OPTIONAL_COLUMNS:
                    if name not in df.columns:
                        df[name] = ""
                res = DatasetResolution(df, "published")
    _CACHE[key] = res
    return res


def model_df(st) -> pd.DataFrame:
    """The project's modeling table.

    Raises when there is none. A caller that would rather degrade catches it —
    but the default is to stop, because the alternative is scoring nothing and
    reporting success over an empty universe.
    """
    res = resolve_dataset(st)
    if not res.usable:
        raise ValueError(res.reason or "no modeling table for this project")
    return res.df


def raw_long_df(st) -> pd.DataFrame:
    """The published rows as published — same table here.

    On the platform this differed from `model_df` because the latter rolled up to
    a national total. That roll-up was deleted in 2026-07-27 and S2 now scores the
    assembled rows, so the two are the same table and this exists only so vendored
    callers keep working.
    """
    return model_df(st)


def uses_project_data(st) -> bool:
    return resolve_dataset(st).source == "published"


def model_objects(st) -> list[str]:
    """The model objects present in the data — one per `(channel_type, brand)` cell
    that can carry a model, busiest first.

    Nothing is hardcoded: the channel list, the product list and which combinations
    are modelable all come from the data. See `selection.model_objects` for the id
    format and for why a cell needs both a response and a driver to qualify.
    """
    from mmm_engine.selection.model_objects import enumerate_objects
    return enumerate_objects(model_df(st), st)
