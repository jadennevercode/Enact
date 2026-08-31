# mmm-runtime — design record

**Date:** 2026-08-06
**Supersedes:** `2026-07-30-mmm-s1-skill-suite-design.md` (S1 only), which stands as
the design of the five skills carried forward here unchanged.

## What this is

An agent-runtime-native MMM project: the workflow's staged deliverables are
**Skills**, the computation is **Tools** the agent invokes, and the methodology is
**Knowledge** that is retrieved rather than recited. It runs on a laptop in a plain
Claude Code session with no server, no database and no credentials.

It is a *distillation* of `AgenticMMM0612 V2`, not a client of it. Nothing here
imports, calls or reads that platform at runtime. The relationship is recorded in
`tools/engine/UPSTREAM.md` and enforced by frozen golden vectors, not by a
dependency.

## Decisions taken

| # | Decision | Rationale |
|---|---|---|
| 1 | **Repo `mmm-runtime`**, seeded by copying `mmm-skills`; plugin name stays `mmm` | Keeps `/mmm:*` commands stable for existing S1 users; a repo whose stated identity is "zero third-party dependencies" cannot host an OLS engine without that promise becoming meaningless |
| 2 | **`mmm-skills` is archived** with a pointer here | Two S1 implementations is exactly the drift this project exists to remove |
| 3 | **Knowledge ships the beverage pack only** | It is the one real industry library available (`food-bev/beverage/`); everywhere else `knowledgeRecall: none` is the honest default rather than a borrowed benchmark |
| 4 | **S4 modeling and S5 reporting are out of scope** | The project ends at `2.6d` — master data locked. S2's output is a validated, filtered, assembled model input; what consumes it is a later decision |
| 5 | **One target schema per workspace** | It is the modeling contract. Per-asset variation is what `clean.sql` is for |

## Scope

**In:** S1 (already built) and S2 in full — `2.0` Data Engine, `2.1` factor map,
`2.2` quality, `2.3` business validation, `2.4` statistical screening, `2.5` OLS
test, `2.6` master data, with their review and gate tasks.

**Out:** S4, S5, ASR, the interactive data grid, dbt, autopilot.

**Deliberately lost:** the TanStack grid and React Flow DAG of the platform's Data
Engine. They were a review surface for *rows*; the replacement reviews *violations
and unmapped values*, which is a smaller and decidable set. Pipeline authoring gets
worse; everything downstream gets better. Recorded here so nobody re-discovers it
as a bug.

## The mechanisms

Two hard requirements, both mechanisms rather than instructions — as in S1:

1. **Context-loading accuracy** — the manifest's per-task `reads:` allowlist, the
   grounding budget, and honest truncation.
2. **Standard execution** — `scripts/gate_check.py` predicates close gates.
   Verification is a script, never an assessment.

v2 adds a third, which has no ancestor in the platform:

3. **Numbers provenance** — `shared/numbers-provenance.md`. The platform enforced
   "numbers come from the engine" *structurally* (they arrived over HTTP); in a
   runtime the model holds the same pen that writes the report. Rebuilt as
   `computed_by_tool` + `view_derived_from` over a per-run trace log.

Supporting conventions, both new: `shared/file-kinds.md` (store / computed / view)
and `shared/workspace-layout.md` (the authoritative tree, `workspaceVersion: 2`).

## The Data Engine, as a skill

The platform's Data Engine is ~4,000 lines, a dbt Fusion binary and a React grid.
Here it is one skill over a declared contract:

```
inputs/data/…        → data.extract · data.profile      → data/raw/<src>/
                     → LLM drafts clean.sql + enum map  → data/clean/<asset>/  [store]
                     → data.clean (DuckDB sandbox)      → result.parquet    [computed]
                     → data.conform · data.reconcile    → violations, not rows
                     → human resolves exceptions
                     → data.publish · data.claim        → data/published/
```

The human declares `metadata/schema/target-schema.yaml` and its enums **before the
data arrives**; the model writes the mapping query; tools execute and validate it.
This is stronger than the platform's `data_binding.py`, which guesses column roles
from header keywords and silently falls back to the reference dataset when the
guess is unconvincing. A contract plus a mechanical check replaces a heuristic plus
a fallback.

`closed: true|false` on each enum is the one addition: a value outside a closed
enum is a violation, outside an open one it is an unmapped value awaiting review.
The platform could not distinguish "we forgot to fill the list" from "anything
goes".

**One path, not two.** The filled data-request workbooks from `1.5` are just
another raw source. `data.draft-sql` (the repurposed `data_binding.py`) writes them
a good first `clean.sql` because S1 defined their shape — and it then goes through
conform, reconcile, review and publish like everything else. No silent parse, no
reference fallback.

## Phases — all delivered 2026-08-06

| Phase | Deliverable | State |
|---|---|---|
| 0 | Repo seed · governing docs · two spikes · failing adversarial selftests | done |
| 1 | `tools/engine` vendored package · `mmm-tool` CLI · tracing · provenance predicates · golden vectors · v2 workspace migration | done |
| 2 | Schema + Data Engine skill (`2.0`/`2.0d`) · both fixtures | done |
| 3 | Factor map + ledger (`2.1`/`2.1d`) | done |
| 4 | Quality and statistical scorecards (`2.2`, `2.4`) | done |
| 5 | Business validation + HTML chart renderer (`2.3`) | done |
| 6 | OLS test, range verdicts, master data (`2.5`–`2.6d`) | done |
| 7 | Hardening: adversarial selftests, static checks, docs | done |

### What it does now

`_fixtures/walk_aurelia.sh` — which lives in the engagement space, not in the
runtime — drives the whole S2 mechanical path against a case nothing was tuned
for. On that run: 3 deliveries cleaned and published (793 rows),
6 model objects enumerated **from the data**, 36 ledger rows, 7 quality scores, 6
screened indicators, 6 fitted models over 24 months, 6 master tables, and the
factor tree closed out at 6 adopted / 1 never supplied.

Everything mechanical passes; what remains open at each gate is the human verdict,
which is the design working rather than a gap.

### What the foreign-data fixture caught

Building and running it found, in one pass:

* Chinese sheet names all reducing to `t`, so a second sheet silently overwrote the
  first while the run reported success
* the CLI recording a payload path for a tool that wrote nothing — a **stale** file
  from an earlier run would then be hashed as this run's output, which is exactly
  the hole `computed_by_tool` exists to close
* an anomaly detector that flagged all 24 months of a seasonal series and buried the
  one real disruption among them

And it caught **itself** twice, which is the fixture doing its job: purely seasonal
drivers have an identically zero year-over-year difference, so 2.4 scored 0.000
correlation for drivers the response was literally built from; and identically
shaped media series hit the VIF cap so no fit could separate them. A fixture that
cannot fail a check cannot verify it either.

### Two behaviours worth naming

The skincare fixture reports **"no benchmark for this industry"** for all 18 fitted
factors rather than borrowing the beverage bands — the directory boundary works by
construction. And the adopted set carries its **response**, so the exported model
input does not ship without its dependent variable.

## Phase 0 — result: both spikes PASS

The spikes are **gone**, as this section always said they would be: they
imported the platform in place, which was the point while the question was
whether *those* modules survive being driven from a directory. Phase 1 vendored
them and `tools/engine/tests/` now asks the same questions of the copy. What they
found is recorded below, which is the only part worth keeping.

### Spike A — the ledger runs off a directory ✅

A `ProjectState` built from `mmm.yaml` + `factor-tree.yaml` + `long.parquet` +
`quality-scorecard.yaml`, with no `ProjectStore` and no database, ran
`indicator_ledger` and `model_selection` unchanged:

- 2 model objects enumerated from the data alone (`MT::AURELIA`, `TT::AURELIA`)
- 5 drivers in the universe — the response correctly *not* among them
- the national row (blank `channel_type`) reached **both** objects
- a 2.2 `drop` was **inherited** by signoff, statistical, selection and range in
  both objects — the ledger's whole point, working off files

**The vendoring thesis holds.** `workspace.py` is the only new module carrying
weight, as planned.

### Spike B — schema-driven cleaning works standalone ✅

The DuckDB sandbox, a **pure** rewrite of `_check_conformance` (frame + schema, no
`Workspace`, no mart) and a new `reconcile` all ran outside the platform, and every
wrong recipe was caught mechanically rather than by a human noticing:

| Wrong recipe | Caught by |
|---|---|
| `DROP` / `read_csv` / two statements | `validate_sql` |
| a channel nobody declared (`O2O`) | closed-enum violation |
| the enum map not applied — raw `现代渠道` reaching the table | closed-enum violation |
| a required column dropped, 25 of 37 rows lost (58% of value) | `missingRequired` + reconciliation |
| a join fanning every row out | **grain-key uniqueness** (new check) |

The last two are the ones that matter most: conformance alone cannot see silent
row loss, and neither check can see a fan-out. All three are needed.

### Findings that change Phase 1

1. **`ProjectState` must move out of `store/state.py`.** That module imports
   `app.config` → `pydantic_settings` → env settings. The vendored package owns no
   env config; `ProjectState` belongs beside the other domain models.
2. **`dataset_cache` is a rewrite, not a port.** It imports `app.ingest` (→
   openpyxl, docx) purely for the Danone reference dataset. In the vendored package
   it becomes a resolver that reads `data/published/long.parquet` — which also
   deletes the reference-fallback path by construction, not by policy.
3. **`FactorRow` must gain `role` and `primary`.** The platform's model has
   neither; the S1 suite's tree carries both and `gate_check.py`'s
   `primary_indicator_per_l4` depends on them. The suite's schema is the richer one
   and wins.
4. **`ProjectMeta` needs `IndustryRef` and `createdAt`** — trivial, noted so the
   adapter is written once.
5. **The factor columns (`l1`–`l4`) have no enum and land in
   `unenforcedDimensions`.** Correct — they are free text from the tree — but it
   means nothing checks that a cleaned row's factor path *exists in the tree*. That
   is exactly what `data.claim` and the coverage record do, so Phase 2 must treat
   the claim as a required step and not an afterthought.

### Also delivered

- `shared/file-kinds.md`, `shared/numbers-provenance.md`,
  `shared/workspace-layout.md`
- Three adversarial provenance cases in `scripts/selftest.py` that **fail today**
  (`computed_by_tool` and `view_derived_from` do not exist yet) and must pass at
  the end of Phase 1. 51 S1 checks stay green.
- `.venv` with the pinned set proven working: duckdb 1.5.4 · pandas 3.0.3 ·
  numpy 2.5.0 · pyarrow 24.0.0 · pydantic 2.13.4.

## Risks carried into Phase 1

| Risk | Severity | Mitigation |
|---|---|---|
| The model writes numbers instead of running tools | CRITICAL | The provenance predicates + the two adversarial selftests |
| LLM-generated SQL is wrong | HIGH | Sandbox allowlist · schema conformance · reconciliation invariants · human review of `preview.md`; the model sees profiles, never rows |
| Semantically-wrong SQL that passes every check | MED (residual) | Coverage claim, 2.2 caliber subchecks, 2.3 validation charts. Not eliminable — name it, do not paper over it |
| Vendored engine drifts from upstream | MED | Golden vectors (need no platform access) + per-file sha in `UPSTREAM.md` |
| Large tables enter the context window | HIGH | Tools print bounded summaries; payloads stay on disk; grounding is profiles |
| Bulk review of hundreds of rows in chat | HIGH | Exception review; every row pre-carries a proposal; bulk verdicts logged |

## Upstream reference

Platform commit at time of writing: `83ecb76560a57c04491721d093699bdc462ad97e`.
Environment proven available: duckdb 1.5.4 · pandas 3.0.3 · numpy 2.5.0 ·
pyarrow 24.0.0.
