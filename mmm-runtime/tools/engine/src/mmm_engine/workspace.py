"""Workspace directory ⇄ ProjectState.

This is the module the whole vendoring rests on. The platform's computation —
the ledger, the scorecards, the OLS review, the master-data assembly — all take
`st: ProjectState` and keep doing so unchanged. What changes is where that state
comes from: not a JSON blob and a migration chain, but one file per store, read on
demand and written back one at a time.

Two rules keep it honest:

* **Read each store from its own file.** A single serialised blackboard is how a
  saved state and the files it describes drift apart. Here there is nothing to
  drift: the files *are* the state.
* **Never write a computed payload.** `save_store` writes YAML stores only.
  Payloads belong to tools, and `shared/numbers-provenance.md` is what checks it.

Proven by `spikes/spike_a_workspace_ledger.py` before any of it was written.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

from mmm_engine import dataset
from mmm_engine.domain.models import (
    AnomalyHypothesis,
    AnomalyReview,
    FactorRow,
    FactorTree,
    IndustryRef,
    OlsConfig,
    OlsPlan,
    OlsRangeScorecard,
    ProjectMeta,
    ProjectProfile,
    ProjectState,
    QualityRow,
    QualityScorecard,
    ReferenceTotal,
    StatScorecard,
    StatScoreRow,
)

# ── the layout, in one place (mirrors shared/workspace-layout.md) ────

IDENTITY = "mmm.yaml"
PROGRESS = "state/progress.yaml"
DECISIONS = "state/decisions.log"
TOOL_RUNS = "state/tool-runs.jsonl"

TARGET_SCHEMA = "metadata/schema/target-schema.yaml"
ENUM_DIR = "metadata/schema/enums"
GRANULARITY = "metadata/granularity.yaml"
REFERENCE_TOTALS = "metadata/reference-totals.yaml"

PUBLISHED = "data/published/long.parquet"
COVERAGE = "data/published/coverage.yaml"
CLEAN_DIR = "data/clean"
RAW_DIR = "data/raw"
DERIVED_DIR = "data/derived"

PROFILE = "artifacts/s1/project-profile.yaml"
FACTOR_TREE = "artifacts/s1/factor-tree.yaml"
FACTOR_MAP = "artifacts/s2/factor-map.yaml"
QUALITY_CARD = "artifacts/s2/quality-scorecard.yaml"
STAT_CARD = "artifacts/s2/stat-scorecard.yaml"
ANOMALIES = "artifacts/s2/anomalies.yaml"
SIGNOFFS = "artifacts/s2/signoffs.yaml"
OLS_PLAN = "artifacts/s2/ols-plan.yaml"
OLS_CONFIG = "artifacts/s2/ols-config.yaml"
OLS_CARD = "artifacts/s2/ols-scorecard.yaml"
FUNNEL = "artifacts/s2/funnel.yaml"

#: store name → (relative path, root key). `save_store` writes exactly these.
STORES: dict[str, tuple[str, str]] = {
    "profile": (PROFILE, "profile"),
    "factor-tree": (FACTOR_TREE, "rows"),
    "factor-map": (FACTOR_MAP, "rows"),
    "quality-scorecard": (QUALITY_CARD, "rows"),
    "stat-scorecard": (STAT_CARD, "rows"),
    "anomalies": (ANOMALIES, "cards"),
    "signoffs": (SIGNOFFS, "signoffs"),
    "ols-config": (OLS_CONFIG, "config"),
    "ols-scorecard": (OLS_CARD, "rows"),
    "funnel": (FUNNEL, "layers"),
    "target-schema": (TARGET_SCHEMA, "columns"),
    "reference-totals": (REFERENCE_TOTALS, "totals"),
    "coverage": (COVERAGE, "records"),
}


# ── yaml, without a hard dependency ──────────────────────────────────

def _yamlio():
    """The suite's reader. Shared with the skills so both sides parse identically."""
    import sys
    for parent in Path(__file__).resolve().parents:
        lib = parent / "shared" / "lib"
        if lib.is_dir():
            if str(lib) not in sys.path:
                sys.path.insert(0, str(lib))
            break
    import yamlio  # type: ignore
    return yamlio


def read_yaml(path: "str | Path") -> dict:
    path = Path(path)
    if not path.is_file():
        return {}
    text = path.read_text(encoding="utf-8")
    data = _yamlio().load(text) or {}
    return data if isinstance(data, dict) else {}


def write_yaml(path: "str | Path", data: dict) -> None:
    """Atomic: write beside, then replace. A half-written store is a store that
    parses into something plausible and wrong."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(_yamlio().dump(data), encoding="utf-8")
    os.replace(tmp, path)


# ── finding the workspace ────────────────────────────────────────────

def find(start: "str | Path" = ".") -> Optional[Path]:
    """The nearest directory containing `mmm.yaml` (v2) or `mmm-state.yaml` (v1)."""
    here = Path(start).expanduser().resolve()
    if here.is_file():
        here = here.parent
    for candidate in [here] + list(here.parents):
        if (candidate / IDENTITY).is_file() or (candidate / "mmm-state.yaml").is_file():
            return candidate
    return None


def require(start: "str | Path" = ".") -> Path:
    found = find(start)
    if found is None:
        raise ValueError(
            "no workspace at %s — a workspace is the directory containing mmm.yaml. "
            "Only `orchestrator init` may create one." % start)
    return found


def version(root: "str | Path") -> int:
    root = Path(root)
    if (root / IDENTITY).is_file():
        return int(read_yaml(root / IDENTITY).get("workspaceVersion") or 2)
    return 1


# ── loading ──────────────────────────────────────────────────────────

def _rows(root: Path, rel: str, key: str) -> list[dict]:
    data = read_yaml(root / rel)
    items = data.get(key)
    return [r for r in items if isinstance(r, dict)] if isinstance(items, list) else []


def load_state(root: "str | Path", *, project_id: str = "") -> ProjectState:
    """Rebuild a ProjectState from the workspace. Missing stores are simply absent.

    An absent store is not an error and not a default: a project that has not
    reached 2.2 has no quality scorecard, and every layer that reads one already
    treats "no verdicts recorded" correctly. Inventing an empty-but-present
    scorecard would tell the ledger that 2.2 ran and rejected nothing.
    """
    root = Path(root).expanduser().resolve()
    identity = read_yaml(root / IDENTITY)
    pid = project_id or str(identity.get("projectId") or root.name)

    ind = identity.get("industry") or {}
    meta = ProjectMeta(
        id=pid,
        name=str(identity.get("project") or root.name),
        brand=str(identity.get("brand") or ""),
        industry=IndustryRef(l1=str(ind.get("l1", "") or ""),
                             l2=str(ind.get("l2", "") or ""),
                             l3=str(ind.get("l3", "") or "")),
        kpi=str(identity.get("kpi") or "Sell-out Volume"),
        createdAt=str(identity.get("createdAt") or ""),
    )

    st = ProjectState(project_id=pid, meta=meta)

    profile_data = read_yaml(root / PROFILE).get("profile")
    if isinstance(profile_data, dict) and profile_data:
        try:
            st.profile = ProjectProfile(**profile_data)
        except Exception:  # noqa: BLE001 — a malformed profile is a finding, not a crash
            st.profile = None

    tree_rows = _rows(root, FACTOR_TREE, "rows")
    if tree_rows:
        st.factor_tree = FactorTree(rows=[_factor_row(r) for r in tree_rows])

    totals = _rows(root, REFERENCE_TOTALS, "totals")
    if totals:
        st.reference_totals = [_model(ReferenceTotal, t) for t in totals]

    quality_rows = _rows(root, QUALITY_CARD, "rows")
    if quality_rows:
        st.quality_scorecard = QualityScorecard(rows=[_model(QualityRow, r) for r in quality_rows])

    stat_rows = _rows(root, STAT_CARD, "rows")
    if stat_rows:
        st.stat_scorecard = StatScorecard(rows=[_model(StatScoreRow, r) for r in stat_rows])

    # The plan has no single root key — `candidates` is recomputed every run and
    # `chosen` is the human's ruling, so both sit at the top level. Everything but
    # `meta` is the model.
    plan_doc = read_yaml(root / OLS_PLAN)
    if isinstance(plan_doc, dict) and plan_doc.get("candidates"):
        try:
            st.ols_plan = OlsPlan(**{k: v for k, v in plan_doc.items() if k != "meta"})
        except Exception:  # noqa: BLE001
            st.ols_plan = None

    ols_cfg = read_yaml(root / OLS_CONFIG).get("config")
    if isinstance(ols_cfg, dict) and ols_cfg:
        try:
            st.ols_config = OlsConfig(**ols_cfg)
        except Exception:  # noqa: BLE001
            st.ols_config = None

    # The whole document, not just `rows`. Loading rows alone dropped `factors`
    # on the way in, so the code that pins a human's factor verdict against a
    # re-fit compared against an empty list and pinned nothing — the verdict was
    # reverted on the next run, and the check that guards this only inspected
    # `rows`, so nothing reported it.
    ols_doc = read_yaml(root / OLS_CARD)
    if isinstance(ols_doc, dict) and (ols_doc.get("rows") or ols_doc.get("factors")):
        try:
            st.ols_scorecard = OlsRangeScorecard(
                **{k: v for k, v in ols_doc.items() if k != "meta"})
        except Exception:  # noqa: BLE001
            st.ols_scorecard = None

    cards = _rows(root, ANOMALIES, "cards")
    if cards:
        # The field is `rows`. It used to be built as ``AnomalyReview(cards=cards)``
        # — pydantic ignored the unknown key, the review came back empty, and every
        # handling a client had ruled on reached the fit as nothing at all. Nothing
        # failed, and the gate stayed green for months, because the check read the
        # file the model wrote instead of the state the engine built from it.
        #
        # Cards are parsed one at a time, and a card that will not parse is simply
        # absent rather than taking the whole review down with it. That is not
        # leniency: `anomaly_cards_bind` compares this count against the file's and
        # fails loudly on the difference. One bad card should be reported as one
        # bad card, not as "there were no anomalies".
        rows = []
        for card in cards:
            try:
                rows.append(_model(AnomalyHypothesis, card))
            except Exception:  # noqa: BLE001
                continue
        st.anomaly_review = AnomalyReview(rows=rows)

    signoffs = read_yaml(root / SIGNOFFS).get("signoffs")
    if isinstance(signoffs, dict):
        st.signoffs = {str(k): str(v) for k, v in signoffs.items()}

    schema_cols = _rows(root, TARGET_SCHEMA, "columns")
    if schema_cols:
        from mmm_engine.dataeng import target_schema
        st.target_schema = target_schema.columns_from_yaml(schema_cols)

    coverage = _rows(root, COVERAGE, "records")
    if coverage:
        from mmm_engine.dataeng import coverage as cov
        st.indicator_coverage = cov.records_from_yaml(coverage)

    ignores = read_yaml(root / FACTOR_MAP).get("ignores")
    if isinstance(ignores, dict):
        st.factor_map_ignores = {str(k): str(v) for k, v in ignores.items()}

    dataset.attach(st, root)
    return st


def _factor_row(data: dict) -> FactorRow:
    """One tree row. `role` and `primary` are the suite's, not the platform's —
    `gate_check.primary_indicator_per_l4` rules on them, so they are first-class."""
    return _model(FactorRow, data)


def _model(cls, data: dict):
    """Construct a pydantic model, dropping keys it does not declare.

    Stores are hand-edited YAML: a stray key is a typo or a note, and refusing the
    whole row over one would lose a human's verdict to a spelling mistake.
    """
    fields = set(cls.model_fields.keys())
    aliases = {f.alias for f in cls.model_fields.values() if getattr(f, "alias", None)}
    clean = {k: v for k, v in data.items() if k in fields or k in aliases}
    return cls(**clean)


# ── writing ──────────────────────────────────────────────────────────

def save_store(root: "str | Path", name: str, payload: Any, *, meta: Optional[dict] = None) -> Path:
    """Write one store. Refuses a name the layout does not declare.

    Refusing is the point: a store nobody declared has no owning skill, so nothing
    checks it and nothing knows to read it.
    """
    if name not in STORES:
        raise ValueError("unknown store %r — declare it in workspace.STORES first "
                         "(known: %s)" % (name, ", ".join(sorted(STORES))))
    rel, key = STORES[name]
    path = Path(root) / rel
    data: dict = {}
    if meta:
        data["meta"] = meta
    data[key] = _plain(payload)
    write_yaml(path, data)
    return path


def _plain(value: Any) -> Any:
    """Pydantic models → dicts under their aliases.

    This used to dump by field name, on the reasoning that a store written with
    camelCase keys is one `load_state` silently reads as empty — the mismatch that
    once cost the platform its `ols_config`. That reasoning no longer holds:
    every store model is a `CamelModel`, which sets `populate_by_name`, so both
    spellings load. Dumping by field name is now the harmful direction, because
    the templates, the deliverables and every raw-dict reader ask for the alias —
    and a check that cannot find a field concludes there is nothing to check
    rather than failing, which is how `human_verdicts_preserved` came to pass
    on every workspace for as long as it existed.

    `ProjectState` itself declares no aliases, so its own keys are unaffected.
    """
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True)
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    return value


def derived_path(root: "str | Path", name: str) -> Path:
    path = Path(root) / DERIVED_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    return path
