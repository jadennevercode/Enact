# Upstream

The engine is **vendored**: copied, not imported. `mmm-runtime` has no
runtime, build-time or test-time dependency on the platform.

| | |
|---|---|
| Source | `AgenticMMM0612 V2/backend` |
| Commit | `83ecb76560a57c04491721d093699bdc462ad97e` |
| Committed | 2026-07-28T19:43:24-07:00 |
| Copied | 2026-08-06 |

## How parity is kept

Not by this file. `tests/golden/expected.json` freezes input→output pairs
taken from the platform once; `tests/test_golden.py` asserts the vendored
engine reproduces them cell for cell, and needs no platform checkout. That
catches a botched port **and** a later change that quietly moves a number.

This table is the other half: it says what a file *was*, so a re-sync has
something to diff against. A recorded sha that no longer matches upstream
means the platform moved; a vendored file edited here is fine, but say so
in the Local edits section.

## Copied

| Vendored | Upstream | sha256 of upstream at copy time |
|---|---|---|
| `assemble/indicator_metadata.py` | `app/agents/indicator_metadata.py` | `327ea2b96bf4b0b3` |
| `assemble/master_data.py` | `app/agents/master_data.py` | `d69eb457127d9419` |
| `assemble/time_windows.py` | `app/agents/time_windows.py` | `0358f2a9a034e9e6` |
| `charts/result.py` | `app/agents/result_charts.py` | `b9fdb3a87033b681` |
| `charts/validation.py` | `app/agents/validation_analysis.py` | `74f127869df3e756` |
| `dataeng/binding.py` | `app/agents/data_binding.py` | `3034b83ca06b327e` |
| `dataeng/cluster.py` | `app/dataeng/cluster.py` | `25b00f6c4e49155e` |
| `dataeng/columns.py` | `app/ingest/dataset.py` | `64f7575cf8f52694` |
| `dataeng/coverage.py` | `app/dataeng/dbt/service.py` | `939c632ba9c9a229` |
| `dataeng/duck.py` | `app/dataeng/duck.py` | `97114b45fce13259` |
| `dataeng/extract.py` | `app/ingest/extract.py` | `583e9db87c2790bc` |
| `dataeng/indicators.py` | `app/dataeng/indicators.py` | `a7b6635352f94d9f` |
| `dataeng/mapping.py` | `app/dataeng/mapping.py` | `a34503c787bd590a` |
| `dataeng/orphans.py` | `app/dataeng/orphans.py` | `7d7aea872994f2be` |
| `dataeng/validation_query.py` | `app/dataeng/validation_query.py` | `b0061cdf380b7060` |
| `domain/models.py` | `app/domain/models.py` | `36c95a57c90cb769` |
| `domain/overrides.py` | `app/agents/overrides.py` | `dfd6189428e5eab6` |
| `domain/vocabulary.py` | `app/agents/vocabulary.py` | `3193deca607ee09a` |
| `mmm/__init__.py` | `app/mmm/__init__.py` | `abc587fd028a217f` |
| `mmm/engine.py` | `app/mmm/engine.py` | `1e43b99dbb8fe6fb` |
| `mmm/ols.py` | `app/mmm/ols.py` | `aa4bfc50cc81bae8` |
| `mmm/pivot.py` | `app/mmm/pivot.py` | `110577801a1f1458` |
| `mmm/transforms.py` | `app/mmm/transforms.py` | `9c2233be3ca627d4` |
| `scoring/quality.py` | `app/agents/quality_scoring.py` | `2e1313c76cf79df3` |
| `scoring/rules.py` | `app/agents/data_rules.py` | `40d74c578ec30093` |
| `scoring/statistical.py` | `app/agents/stat_scoring.py` | `559d65111bf8023e` |
| `selection/factor_link.py` | `app/agents/factor_link.py` | `000a96cb78ae2dd1` |
| `selection/ledger.py` | `app/agents/ledger.py` | `2c3c00867aac6249` |
| `selection/model_objects.py` | `app/agents/model_objects.py` | `7980c97468205101` |
| `selection/ols_review.py` | `app/agents/ols_review.py` | `f754215944a555c5` |
| `selection/ols_scorecard.py` | `app/agents/ols_scorecard.py` | `a1d1e10a810eb743` |
| `tools.py` | `app/tools/registry.py` | `b6d5560be4ca3034` |
| `trace.py` | `app/tools/tracing.py` | `3a287f0663dcdea0` |

## Rewritten, not copied

These answer the same question with the platform's infrastructure removed.
Golden vectors do not cover them — their tests are the suite's own.

| Module | Replaces |
|---|---|
| `dataeng/conformance.py` | app/dataeng/dbt/service.py::_check_conformance — made pure, plus type and grain-key checks |
| `dataeng/reconcile.py` | new — row/value/span invariants conformance cannot see |
| `dataeng/target_schema.py` | app/dataeng/dbt/target_schema.py — YAML-declared, enums opened/closed |
| `dataset.py` | app/agents/dataset_cache.py — reference-dataset fallback deleted by construction |
| `knowledge.py` | app/store/templates.py + app/config.py — packs on disk, anchored by directory |
| `workspace.py` | app/store/state.py (ProjectStore, heal_state) — replaced by one file per store |

## Dropped

| Platform | Why |
|---|---|
| `app/main.py + routers` | FastAPI; a runtime has no server |
| `frontend/` | React; the runtime is the UI |
| `app/llm/volcano.py, app/asr/whisper.py` | the model IS the caller here |
| `app/store/model_service.py` | no credentials anywhere in this project |
| `app/orchestrator/{engine,runner}.py` | replaced by the manifests + gate_check.py |
| `app/agents/{business,data,model,report,uploads}.py` | prompt construction → SKILL.md |
| `app/dataeng/dbt/{executor,binary,workspace}.py` | dbt dropped; one compiler, the DuckDB sandbox |

## Local edits to vendored files

Recorded so a re-sync knows what to preserve. Anything not listed here
should be a clean copy plus the mechanical `app.* → mmm_engine.*` rewrite
(`vendor_rewrite.py`, kept in-tree as the record of how).

- `charts/validation.py` — the async LLM path (`analyze_chart`) removed; the
  computed readout it fell back to is now the only mode (`read_chart`), and the
  prompt is kept as `NARRATION_STANDARD` for the skill to meet.
- `dataeng/binding.py` — takes explicit workbook paths instead of the upload
  store; **the silent Danone-reference fallback is gone**.
- `scoring/rules.py` — `KB_DIR` resolves through `knowledge.methodology_dir()`.
- `scoring/quality.py` — gained `field_context()`, which was stranded in the
  platform's `app/agents/data.py` LLM handler.
- `domain/models.py` — `ProjectState` appended here from `app/store/state.py`,
  whose module imported `app.config`. The model itself was free of it.
- `dataeng/coverage.py` — `claim_published_metrics` extracted from the dbt
  service; `DataAsset` replaced by a two-field `Asset`.
- `tools.py` — the documented module paths point at their new homes so
  `detail()`'s `inspect.getsource` still resolves.

