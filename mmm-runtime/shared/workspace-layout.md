# Workspace layout

One client engagement is one directory. It is the blackboard; there is no database
and no server. This file is the authoritative copy of the tree — a skill that needs
to know where something lives reads this, not its own memory.

The governing idea: **one designated place per concern, and a rule for each
directory you can state in one line.** File kinds are marked `[store]`,
`[computed]`, `[view]` — see `shared/file-kinds.md`.

## Status — v1 and v2

`workspaceVersion: 3` is the layout below. Workspaces created by the S1 suite
before it are **v1**: `intake/` instead of `inputs/`, `mmm-state.yaml` at the root
instead of `state/progress.yaml`, and a flat `artifacts/` with no stage folders.
`scripts/new_workspace.py --migrate` converts one and bumps the version; it is a
rename, nothing is rewritten. Until a workspace is migrated the S1 skills follow
`shared/conventions.md` §1. Do not mix: a workspace is entirely v1 or entirely v2,
and `orchestrator status` says which.

## The tree

```
<workspace>/
├── mmm.yaml                    # identity: project · brand · industry L1-L3 ·
│                               #   outputLanguage · workspaceVersion        [store]
│
├── state/                      # ── machine bookkeeping
│   ├── progress.yaml           # per-STEP status · produced paths · verdict  [store]
│   ├── decisions.log           # append-only human verdicts, pipe-delimited     [log]
│   ├── tool-runs.jsonl         # one line per tool invocation — the provenance
│   │                           #   record numbers are checked against           [log]
│   └── daily/<yyyy-mm-dd>.json # one per daily report — today's reading, kept so
│                               #   tomorrow's can say what MOVED. Regenerable
│                               #   and disposable; nothing reads it but the
│                               #   next report.                             [computed]
│
├── metadata/                   # ── the contracts, declared BEFORE the data arrives.
│   │                           #    A human owns them; tools read, never write.
│   ├── schema/
│   │   ├── target-schema.yaml  # the long-table contract                        [store]
│   │   └── enums/*.yaml        # canonical values + aliases + closed?           [store]
│   ├── granularity.yaml        # time grain + model scope, written once by `scoping`
│   │                           #   when the profile locks                       [store]
│   ├── reference-totals.yaml   # externally-attested totals (finance, a source
│   │                           #   system) an indicator is reconciled against.
│   │                           #   Absent is normal and is NOT a pass — the
│   │                           #   business-accuracy subcheck reports itself
│   │                           #   UNVERIFIED without it                        [store]
│   ├── vocabulary.yaml         # per-project role keywords, overriding defaults [store]
│   ├── change-ledger.jsonl     # what this project decided differently about the
│   │                           #   client's business, and why  → shared/change-ledger.md [log]
│   └── skill-feedback.jsonl    # what the user corrected about the way we work
│                               #   → shared/skill-feedback.md                     [log]
│
├── inputs/                     # ── raw human input, by category. NO TOOL WRITES HERE.
│   ├── project-background/     # SOW, kickoff brief                        → 1.0a
│   ├── industry-reference/     # brand & competitor reports, internal      → 1.1a
│   ├── org-structure/          # org chart / named interviewees   → interview/outline
│   ├── interview-minutes/      # transcripts / notes (text)       → interview/minutes
│   ├── client-factor-tree/     # only when the baseline choice is "client-tree"
│   └── data/<yyyy-mm-dd-label>/  # one folder per data delivery  → published-dataset
│
├── data/                       # ── the data layer. Tool-written, regenerable.
│   ├── raw/<source-id>/
│   │   ├── <table>.parquet     # one per sheet / CSV, verbatim               [computed]
│   │   └── profile.json        # dtypes · nulls · distinct · top values ·
│   │                           #   detected time field & grain · enum candidates [computed]
│   ├── clean/<asset-id>/       # the one mixed directory: recipe vs result
│   │   ├── asset.yaml          # name · sources · status · notes               [store]
│   │   ├── clean.sql           # the DuckDB mapping query — AI-drafted,
│   │   │                       #   human-editable. THE RECIPE.                 [store]
│   │   ├── enum-map.yaml       # raw value → canonical · accepted|proposed     [store]
│   │   ├── result.parquet      # what clean.sql produced                    [computed]
│   │   ├── conformance.json    # missing required · extra · enum violations ·
│   │   │                       #   type & grain failures · unenforced dims  [computed]
│   │   ├── reconcile.json      # row counts & value sums vs raw            [computed]
│   │   └── preview.md          # head + profile of the result                  [view]
│   ├── published/
│   │   ├── long.parquet        # THE unified long table, `source` per row   [computed]
│   │   ├── manifest.yaml       # what each source actually contributed          [view]
│   │   └── coverage.yaml       # published (asset, metric) → factor row.
│   │                           #   treeRowId "" = orphan                       [store]
│   └── derived/                # every intermediate computed payload, one place
│       ├── quality-{consistency,accuracy,completeness,granularity}.json ·
│       │   quality-evidence.json          — 一维度一份，最后一份是卷积  [computed]
│       ├── stat-{volatility,correlation,collinearity}.json ·
│       │   stat-panel.json                — 一项检验一份，最后一份是卷积 [computed]
│       ├── validation-panel.json · validation-facts.json
│       ├── validation-foldcheck.json · anomalies.json                    [computed]
│       ├── ols-fit.json · selection.json                                 [computed]
│       └── master/<object>.csv                                            [computed]
│
├── artifacts/                  # ── the staged deliverables. Stores and views only.
│   ├── s1/  project-profile.yaml [store] · project-profile.docx [view]
│   │        materials-index.md [view]
│   │        knowledge-package.md [view] · factor-tree.yaml [store] · factor-tree.xlsx [view]
│   │        interview/ · data-request/
│   └── s2/  data-engine.md [view] · factor-map.yaml [store]
│            quality-scorecard.yaml [store] · quality-scorecard.xlsx [view]
│            business-validation.md · chart-book.html [view]
│            anomalies.yaml · signoffs.yaml [store]
│            stat-scorecard.yaml [store] · stat-scorecard.xlsx [view]
│            ols-plan.yaml · ols-config.yaml · ols-scorecard.yaml [store] · ols-test.{md,html} [view]
│   │        ledger.md [view] · funnel.yaml [store] · master-data.md [view]
│   │        model-input.xlsx [computed — built to leave the building]
│   └── s3/  retrospective.md [store — the ruled candidate lists, not a report]
│
└── exports/                    # copies that leave the building. Nothing reads from here.
```

## Why this shape

- **`inputs/` is write-protected by convention** so evidence can never be
  manufactured. Every S1 grounding failure the platform shipped came from an agent
  finding something convenient lying around; a directory only humans write to makes
  that impossible rather than discouraged.
- **`metadata/` holds contracts that exist before the data they govern.** That is
  what makes validation mechanical instead of retrospective: `data.conform` checks
  the cleaned table against a schema nobody could tune after seeing the result.
- **`data/` is regenerable**, so "delete `data/` and re-run" is always a safe
  recovery, and no reviewer has to wonder whether a payload was hand-touched.
- **`artifacts/` holds only what a human decided or a human reads**, so opening it
  shows deliverables and not machinery.
- **`state/` is an index, never the truth.** The files are the truth;
  `orchestrator audit` re-evaluates every predicate against disk precisely because
  a state file can claim `done` over an artifact that was never written.

## Store ownership — one writer each

A store with two writers loses the first writer's work silently. Enforced by
`check_suite.py` against the manifests.

| Store | Sole writer |
|---|---|
| `mmm.yaml`, `state/progress.yaml` | `orchestrator` |
| `state/daily/*` | `daily-report` — its own snapshots, read by nothing else |
| `metadata/granularity.yaml`, `artifacts/s1/project-profile.{yaml,docx}` | `scoping` |
| `artifacts/s1/factor-tree.yaml` | `factor-tree` — including orphan adoption in S2 |
| `artifacts/s1/interview/*` | `interview` |
| `artifacts/s1/data-request/*` | `data-request` |
| `metadata/schema/*`, `data/clean/*/*`, `data/published/coverage.yaml` | `data-engine` |
| `artifacts/s2/factor-map.yaml` | `data-intake` |
| `artifacts/s2/quality-scorecard.yaml` | `data-quality` |
| `metadata/reference-totals.yaml` | 人手填 —— 这个数来自流水线外面（财务的账、源系统的报表），工作区里没有任何东西能推出它 |
| `artifacts/s2/{anomalies,signoffs}.yaml` | `business-validation` |
| `artifacts/s2/stat-scorecard.yaml` | `stat-screening` |
| `artifacts/s2/{ols-plan,ols-config,ols-scorecard}.yaml` | `ols-test` |
| `artifacts/s2/funnel.yaml` | `master-data` |
| `artifacts/s3/retrospective.md` | `retrospect` |

The two ledgers under `metadata/` are not stores and have no owning skill: both are
append-only logs written through `state.py` (`record-change`, `record-feedback`) and
read by `retrospect` at closure. Anyone may append; nobody may edit.

The factor tree stays sole-writer even in S2. When the data supplies a metric no
factor asked for, `data-engine` records it as an orphan in `coverage.yaml` and
`factor-tree apply-proposals` adopts or dismisses it. A second writer reaching into
the tree is how a row's identity and a row's verdict come apart.

## The plugin and the project space

Two directories, and the line between them is the whole multi-project story.

| | The **plugin** | A **project space** |
|---|---|---|
| what | skills · tools · knowledge · manifests · predicates | one client engagement |
| where | wherever it is installed | `~/mmm-engagements/<client>` |
| how many | **one**, shared by every engagement | one per engagement |
| at runtime | **read-only** | the only thing written |
| versioned | yes, in git | no — it is client work |

**Nothing in the plugin is written while an engagement runs.** Every script and
tool takes `--workspace` (or `<dir>`) explicitly and writes only under it; the
plugin is read for the flow, the rubrics and the industry packs. That is what lets
one installation serve many clients at once with nothing to keep in sync, and it
is what makes a managed-agent deployment safe — several agents can share one
plugin because none of them can change it.

It is also **checked**: `check_suite.py` fails if a workspace marker (`mmm.yaml`)
appears anywhere inside the plugin tree. The property held by accident for a
while, which is not the same as holding.

### The one exception: closure

`retrospect` writes the plugin — `knowledge/` and the skill files themselves. It is
the only thing that does, and the exception is bounded on four sides: it runs **after
the engagement ends**, never during one; every entry and every edit is **ruled on
individually by a person**, behind the `retrospective/promote` signoff; the edits
must **pass `check_suite.py`** before they are reported as done; and the plugin is
**in git**, so the diff is the last review surface and committing stays with the user.

Without this exception the read-only property is airtight and the library never
learns anything — every project in an industry starts from the same blank page and
repeats the same detour. Written down, the exception is a door with four locks;
unwritten, it happens anyway, in an ad-hoc edit nobody reviewed.

**The one machine-level file lives outside both**: `~/.mmm/workspaces.log`, the
index `state.py list` reads. It records paths and nothing else — no state, no
progress, nothing another engagement could read.

### The runtime carries no engagements — not even test ones

End-to-end fixtures are engagements: they have inputs, a schema, published data
and gates. So they live where engagements live (`~/mmm-engagements/_fixtures/`)
and reach the runtime exactly as a real engagement does — through the installed
`mmm` entry point, which resolves the runtime itself.
A runtime shipping one client's material would be a runtime with an opinion about
who is using it, and the test path would stop being the real path.

What stays here is the runtime's test of **itself**: `selftest.py` builds and
destroys its own throwaway workspace, `check_suite.py` is static, and the engine's
parity tests run on a synthetic frame defined in `tools/engine/tests/`. None of
them needs anything outside the runtime — which is the same property, checked.

## Several engagements at once

**There is no registry, and that is the design.** One engagement is one directory;
nothing indexes them, nothing has to be kept in sync, and two projects cannot
interfere because neither knows the other exists. The platform needed a registry
because it had one process serving many projects; a runtime has one session working
in one directory.

Starting a new one:

```bash
~/.local/bin/mmm script state init ~/clients/acme-fy26 \
    --project "Acme FY26 MMM" --brand Acme --industry beauty/skincare/sunscreen
```

That creates the tree above, writes `mmm.yaml`, and **seeds
`metadata/schema/`** — the target schema and the enum starters — so the Data
Engine has a contract before any data arrives.

### What a new project inherits, and what it owns

| | Lives in | On a new project |
|---|---|---|
| the flow (deliverables, steps, gates, checks) | `shared/manifests/deliverables.yaml`, in the runtime | **shared** — read live, never copied |
| the methodology rubrics | `knowledge/methodology/`, in the runtime | **shared** — read live |
| industry packs (ROI bands, enum starters) | `knowledge/industry/`, in the runtime | **shared** for lookup, **copied** for enums |
| the target schema + enums | `metadata/schema/` | **copied once, then owned** |
| everything else | the workspace | owned outright |

Two consequences worth knowing:

**Improving the plugin improves every project immediately.** A predicate you fix, a
rubric you correct, a band you add to an industry pack — every existing engagement
picks it up on its next `gate_check` run, because nothing was copied.

**Editing a project's schema affects only that project.** `metadata/schema/` is
seeded and then belongs to the engagement. Changing the library default later does
**not** reach a project already created — deliberately, because a contract that
changed under a signed-off gate would invalidate every check made against it. To
adopt a newer default, diff it in by hand and re-run `schema.check`.

The enum seed takes the **most specific source that has the file**: the industry
pack before the library default, deepest anchor first. That is the whole reason a
pack exists — it knows this industry's channels, and the library ships a
placeholder. (It used to seed the default first and skip anything already present,
which meant a pack could never land: a beverage project silently got the generic
channel list and nothing said so.)

## Finding the workspace

The workspace is the directory containing `mmm.yaml` (v2) or `mmm-state.yaml`
(v1): the current directory, else one named in the user's request. If none exists,
only `orchestrator` may create one. Any other skill stops and says so — a skill
that invents a project directory has already lost the audit trail.
