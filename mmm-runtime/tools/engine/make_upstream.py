#!/usr/bin/env python3
"""Regenerate UPSTREAM.md — what was copied, from where, at which commit.

    .venv/bin/python tools/engine/make_upstream.py [path/to/platform/backend]

The sha256 recorded is of the **platform source** at copy time. A vendored file
whose upstream sha no longer matches has diverged; `scripts/check_suite.py` reports
that. Local modification is allowed and expected — undeclared modification is not.
"""
from __future__ import annotations
import hashlib, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.environ.get("MMM_PLATFORM_BACKEND", "")

# vendored path (under src/mmm_engine) → platform path (under backend/)
COPIED = {
 "domain/models.py": "app/domain/models.py",
 "domain/vocabulary.py": "app/agents/vocabulary.py",
 "domain/overrides.py": "app/agents/overrides.py",
 "mmm/__init__.py": "app/mmm/__init__.py",
 "mmm/transforms.py": "app/mmm/transforms.py",
 "mmm/ols.py": "app/mmm/ols.py",
 "mmm/pivot.py": "app/mmm/pivot.py",
 "mmm/engine.py": "app/mmm/engine.py",
 "scoring/quality.py": "app/agents/quality_scoring.py",
 "scoring/statistical.py": "app/agents/stat_scoring.py",
 "scoring/rules.py": "app/agents/data_rules.py",
 "selection/ledger.py": "app/agents/ledger.py",
 "selection/factor_link.py": "app/agents/factor_link.py",
 "selection/model_objects.py": "app/agents/model_objects.py",
 "selection/ols_review.py": "app/agents/ols_review.py",
 "selection/ols_scorecard.py": "app/agents/ols_scorecard.py",
 "assemble/master_data.py": "app/agents/master_data.py",
 "assemble/time_windows.py": "app/agents/time_windows.py",
 "assemble/indicator_metadata.py": "app/agents/indicator_metadata.py",
 "charts/result.py": "app/agents/result_charts.py",
 "charts/validation.py": "app/agents/validation_analysis.py",
 "dataeng/duck.py": "app/dataeng/duck.py",
 "dataeng/cluster.py": "app/dataeng/cluster.py",
 "dataeng/mapping.py": "app/dataeng/mapping.py",
 "dataeng/indicators.py": "app/dataeng/indicators.py",
 "dataeng/orphans.py": "app/dataeng/orphans.py",
 "dataeng/validation_query.py": "app/dataeng/validation_query.py",
 "dataeng/binding.py": "app/agents/data_binding.py",
 "dataeng/extract.py": "app/ingest/extract.py",
 "dataeng/coverage.py": "app/dataeng/dbt/service.py",
 "dataeng/columns.py": "app/ingest/dataset.py",
 "tools.py": "app/tools/registry.py",
 "trace.py": "app/tools/tracing.py",
}
REWRITTEN = {
 "workspace.py": "app/store/state.py (ProjectStore, heal_state) — replaced by one file per store",
 "dataset.py": "app/agents/dataset_cache.py — reference-dataset fallback deleted by construction",
 "knowledge.py": "app/store/templates.py + app/config.py — packs on disk, anchored by directory",
 "dataeng/conformance.py": "app/dataeng/dbt/service.py::_check_conformance — made pure, plus type and grain-key checks",
 "dataeng/reconcile.py": "new — row/value/span invariants conformance cannot see",
 "dataeng/target_schema.py": "app/dataeng/dbt/target_schema.py — YAML-declared, enums opened/closed",
}
DROPPED = [
 ("app/main.py + routers", "FastAPI; a runtime has no server"),
 ("frontend/", "React; the runtime is the UI"),
 ("app/llm/volcano.py, app/asr/whisper.py", "the model IS the caller here"),
 ("app/store/model_service.py", "no credentials anywhere in this project"),
 ("app/orchestrator/{engine,runner}.py", "replaced by the manifests + gate_check.py"),
 ("app/agents/{business,data,model,report,uploads}.py", "prompt construction → SKILL.md"),
 ("app/dataeng/dbt/{executor,binary,workspace}.py", "dbt dropped; one compiler, the DuckDB sandbox"),
]

def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def main(argv):
    platform = argv[0] if argv else DEFAULT
    if not os.path.isdir(platform):
        print("platform backend not found at %r — pass its path, or set "
              "MMM_PLATFORM_BACKEND" % platform)
        return 2
    try:
        commit = subprocess.run(["git", "-C", platform, "log", "-1", "--format=%H"],
                                capture_output=True, text=True, check=True).stdout.strip()
        when = subprocess.run(["git", "-C", platform, "log", "-1", "--format=%cI"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        commit, when = "unknown", "unknown"

    L = []
    L.append("# Upstream\n")
    L.append("The engine is **vendored**: copied, not imported. `mmm-runtime` has no\n"
             "runtime, build-time or test-time dependency on the platform.\n")
    L.append("| | |\n|---|---|")
    L.append("| Source | `AgenticMMM0612 V2/backend` |")
    L.append("| Commit | `%s` |" % commit)
    L.append("| Committed | %s |" % when)
    L.append("| Copied | 2026-08-06 |\n")
    L.append("## How parity is kept\n")
    L.append("Not by this file. `tests/golden/expected.json` freezes input→output pairs\n"
             "taken from the platform once; `tests/test_golden.py` asserts the vendored\n"
             "engine reproduces them cell for cell, and needs no platform checkout. That\n"
             "catches a botched port **and** a later change that quietly moves a number.\n")
    L.append("This table is the other half: it says what a file *was*, so a re-sync has\n"
             "something to diff against. A recorded sha that no longer matches upstream\n"
             "means the platform moved; a vendored file edited here is fine, but say so\n"
             "in the Local edits section.\n")
    L.append("## Copied\n")
    L.append("| Vendored | Upstream | sha256 of upstream at copy time |")
    L.append("|---|---|---|")
    missing = []
    for dest in sorted(COPIED):
        src = COPIED[dest]
        full = os.path.join(platform, src)
        digest = sha(full)[:16] if os.path.isfile(full) else "MISSING"
        if digest == "MISSING":
            missing.append(src)
        L.append("| `%s` | `%s` | `%s` |" % (dest, src, digest))
    L.append("\n## Rewritten, not copied\n")
    L.append("These answer the same question with the platform's infrastructure removed.\n"
             "Golden vectors do not cover them — their tests are the suite's own.\n")
    L.append("| Module | Replaces |")
    L.append("|---|---|")
    for dest in sorted(REWRITTEN):
        L.append("| `%s` | %s |" % (dest, REWRITTEN[dest]))
    L.append("\n## Dropped\n")
    L.append("| Platform | Why |")
    L.append("|---|---|")
    for what, why in DROPPED:
        L.append("| `%s` | %s |" % (what, why))
    L.append("\n## Local edits to vendored files\n")
    L.append("Recorded so a re-sync knows what to preserve. Anything not listed here\n"
             "should be a clean copy plus the mechanical `app.* → mmm_engine.*` rewrite\n"
             "(`vendor_rewrite.py`, kept in-tree as the record of how).\n")
    L.append("- `charts/validation.py` — the async LLM path (`analyze_chart`) removed; the\n"
             "  computed readout it fell back to is now the only mode (`read_chart`), and the\n"
             "  prompt is kept as `NARRATION_STANDARD` for the skill to meet.\n"
             "- `dataeng/binding.py` — takes explicit workbook paths instead of the upload\n"
             "  store; **the silent Danone-reference fallback is gone**.\n"
             "- `scoring/rules.py` — `KB_DIR` resolves through `knowledge.methodology_dir()`.\n"
             "- `scoring/quality.py` — gained `field_context()`, which was stranded in the\n"
             "  platform's `app/agents/data.py` LLM handler.\n"
             "- `domain/models.py` — `ProjectState` appended here from `app/store/state.py`,\n"
             "  whose module imported `app.config`. The model itself was free of it.\n"
             "- `dataeng/coverage.py` — `claim_published_metrics` extracted from the dbt\n"
             "  service; `DataAsset` replaced by a two-field `Asset`.\n"
             "- `tools.py` — the documented module paths point at their new homes so\n"
             "  `detail()`'s `inspect.getsource` still resolves.\n")
    out = os.path.join(HERE, "UPSTREAM.md")
    open(out, "w", encoding="utf-8").write("\n".join(L) + "\n")
    print("wrote %s (%d copied, %d rewritten, %d dropped)" % (out, len(COPIED), len(REWRITTEN), len(DROPPED)))
    for m in missing:
        print("  WARNING upstream not found: %s" % m)
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
