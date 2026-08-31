# MMM Skill Suite — Stage 1 (Business Understanding)

Design doc · 2026-07-30 · repo `mmm-skills`

> **This is the design record as written before implementation.** Where it
> disagrees with `shared/`, `skills/` or `scripts/`, the code wins — those were
> corrected by a fixture walk and an adversarial review that the design predates.
> Known divergences: artifact meta is camelCase; workbooks are written by a
> bundled writer, not openpyxl; the read allowlist lives in the manifest's
> `reads:` and is enforced by a predicate; task modes are a list.

## 1. What we are building

A Claude Code **plugin** that lets a consultant run the Business Understanding
stage of a Marketing Mix Modeling engagement inside a plain Claude Code session,
with no platform server running. The engagement lives in a client project
directory; every deliverable is a file; every human checkpoint is a hard gate
whose evidence is a file on disk.

The plugin is named `mmm`, so its commands are `/mmm:status`,
`/mmm:scoping`, `/mmm:factor-tree`, `/mmm:interview`, `/mmm:data-request`.

**This is a methodology port, not a client of the platform.** The AgenticMMM
platform (`AgenticMMM0612 V2`) remains the source the standards are *distilled
from* — its `app/domain/blueprint.py` S1 DAG, its `FactorRow` / `ProjectProfile`
contracts, and the failure modes its history recorded. Nothing here calls its
API.

### The two things that must actually work

Everything below serves two goals the user named explicitly:

1. **Context loading accuracy** — at any moment, only the standard for the task
   at hand is in the window, and the model can tell what it was allowed to read.
2. **Standard execution** — the flow cannot be improvised. Gates close on
   checkable predicates, not on the model's judgment that things look fine.

Both are implemented as *mechanisms* (§6, §7), not as instructions to try hard.

### Out of scope for v1

- Stages S2–S5 (data intake, modeling, reporting). The suite is built so they
  slot in as further skills against the same conventions.
- Audio transcription. `1.4b` (ASR) has no offline equivalent; the interview
  skill accepts text transcripts and minutes, and says so plainly when handed
  audio.
- The vector knowledge base itself. v1 defines the **recall protocol** and
  degrades loudly when no knowledge source is reachable (§8).

## 2. Skill decomposition — one skill per artifact

Four artifact skills, plus one global orchestrator. Each skill owns one
deliverable end to end and is internally **multi-mode**; the modes are the
interaction relationships, which is where the real value sits.

| Skill | Command | Owns | Platform tasks distilled |
|---|---|---|---|
| `orchestrator` | `/mmm:status` | `mmm-state.yaml`, routing, stage recap | replaces `1.7` (see §5) |
| `scoping` | `/mmm:scoping` | `project-profile.yaml`, `knowledge-package.md`, `materials-index.md` | `1.0a` `1.0` `1.1a` `1.1` |
| `factor-tree` | `/mmm:factor-tree` | `factor-tree.yaml` — **sole writer** | `1.21` `1.21d` `1.4d` |
| `interview` | `/mmm:interview` | `interview/*` | `1.3` `1.3b` `1.4a` `1.4` |
| `data-request` | `/mmm:data-request` | `data-request/*.xlsx` | `1.5` `1.5d` |

Skill directories carry no `mmm-` prefix: the plugin already namespaces them, and
`mmm:scoping` reads better than `mmm:mmm-scoping`.

Every task id in the manifest is owned by **exactly one** skill; a static check
enforces this (§10) so a task cannot be silently dropped or implemented twice.
`1.7` is the one platform task with no manifest entry — it is not a step to
execute but a question to answer at any time, which is what the orchestrator's
`status` mode does (§5).

### 2.1 `scoping`

| Mode | In | Out | Gate |
|---|---|---|---|
| `profile` | SOW + kickoff brief in `intake/project-background/` | `project-profile.yaml`: `projectIntro`, `timeGranularity ∈ {Year,Month,Week}`, `modelScope` (named dimensions × values), `sourceOrigin` | `d-1.0` lock profile |
| `materials` | reports in `intake/industry-reference/` | `materials-index.md` + recorded **baseline choice**: industry template, or the client's own factor tree | — |
| `knowledge` | industry L1–L3 + profile | `knowledge-package.md`: L1/L2 skeleton + brand analysis framework, each item carrying its recall provenance | — |

Locking the profile fixes the analysis granularity and the model-scope matrix.
Downstream skills read those two values rather than re-deciding them — the
granularity is a *contract*, and a data-request sheet whose columns disagree
with it is the failure this prevents.

The baseline choice is recorded because it changes what `factor-tree derive`
does: derive-from-template versus supplement-the-client's-tree.

### 2.2 `factor-tree` — the hub

| Mode | Purpose |
|---|---|
| `derive` | knowledge package + materials → L3/L4 rows + candidate indicators per L4, each with a rationale |
| `review` | per-row `accepted` / `rejected` + pick the primary indicator per L4 → `d-1.21` |
| `apply-proposals` | consume `proposed` rows from **any** source (interview writeback today; data orphan adoption in S2) → the human decides each one |
| `inspect` | answer questions about the tree: status counts, provenance, what an interview changed, coverage vs the data request |

Rules carried over from the platform's scar tissue:

- **L1/L2 stay locked** once the knowledge package is assembled; the human
  confirms L3/L4 and the primary indicator per L4.
- **Row identity is `L1–L4 path + indicator`**, never the path alone. Several
  rows legitimately share one L1–L4; path-only matching bound 8 of 16 metrics to
  the wrong sibling on the platform (2026-07-28).
- **Writeback appends, never overwrites.** A proposal enters as a new row with
  `status: proposed` and `source: interview` plus its quote in `evidence`. The
  tree is append-plus-verdict, so provenance survives.
- **One writer.** Only this skill mutates `factor-tree.yaml`. Interview
  writeback produces a *proposal file*; this skill applies it. That is what keeps
  the accept/reject history coherent.

`factor-tree.yaml` is the store (`id`, `l1`–`l4`, `indicator`, `dimension`,
`source ∈ {template,ai,interview,manual,upload,data_upload}`,
`status ∈ {baseline,proposed,accepted,rejected}`, `rationale`, `evidence`) —
mirroring `FactorRow`. A rendered `factor-tree.md` is **derived** for reading and
is never edited; a real tree runs to hundreds of rows and editing a markdown
table of that size by hand is how rows get corrupted.

### 2.3 `interview` — the interaction-heavy one

| Mode | In | Out |
|---|---|---|
| `outline` | confirmed tree + profile | `interview/outline.md` — layered question sets (GM / management / operations), **each question tagged with the factor row it probes** |
| `pre-answer` | outline + profile + materials + knowledge | `interview/pre-answers.md` — a preliminary answer per question with confidence and source, so the interview spends its time on gaps |
| `minutes` | a transcript or raw notes in `intake/interview-minutes/` | `interview/minutes-<slug>.md` — structured minutes, sections anchored to the outline |
| `answers` | minutes × outline | `interview/answers.md` — answer per question, **plus an explicit "not covered" list** |
| `writeback` | minutes + current tree | `interview/proposals-<slug>.yaml` — proposed factor rows, each with its source quote → handed to `factor-tree apply-proposals` → `d-1.4` |

The modes chain: dropping a transcript into the project triggers `minutes`, which
offers `answers` and `writeback` next. Each mode is independently runnable —
someone who already has minutes starts at `answers`.

**An empty result is a reported finding, never silence.** If `writeback` proposes
nothing, or `answers` cannot answer a question, that is written into the artifact
with the reason. The platform lost an entire interview writeback to a silent
timeout; the artifact looked finished and was empty.

### 2.4 `data-request`

| Mode | In | Out | Gate |
|---|---|---|---|
| `build` | `accepted` rows + profile granularity | `data-request/<L3>.xlsx` — one workbook per L3, one sheet per L4, granularity columns from the profile, definition + example row per indicator | — |
| `coverage` | tree × request | `data-request/coverage.md` — every accepted row appears in exactly one sheet; missing and orphan sheets listed | — |
| `signoff` | client confirmation | appended to `decisions.log` | `d-1.5` closes S1 |

**The request carries no KPI.** Y is the dependent variable, not a factor to
collect as a driver. (The platform's export template has the same rule, and its
sample-data generator has to add a KPI workbook separately.)

Workbook writing is done by a bundled script (`openpyxl`), not by the model
describing a spreadsheet. Deterministic output, and the script fails loudly if
the dependency is absent.

## 3. Project directory — the blackboard

```
<client-project>/
├── mmm-state.yaml            # progress truth: per task status + gate evidence paths
├── decisions.log             # append-only: when, who, what was decided
├── intake/                   # raw human input, by category
│   ├── project-background/   # SOW, kickoff brief
│   ├── industry-reference/   # brand & competitor reports, internal materials
│   ├── interview-minutes/    # transcripts / notes
│   └── client-factor-tree/   # only when the baseline choice was "upload my own"
└── artifacts/
    ├── project-profile.yaml
    ├── knowledge-package.md
    ├── materials-index.md
    ├── factor-tree.yaml      # store (sole writer: factor-tree)
    ├── factor-tree.md        # derived view
    ├── interview/
    │   ├── outline.md · pre-answers.md · minutes-*.md · answers.md
    │   └── proposals-*.yaml
    └── data-request/*.xlsx + coverage.md
```

`intake/` categories mirror the platform's Project Folder categories, so a
consultant moving between the two puts files in the same conceptual place.

## 4. `mmm-state.yaml` and the stage manifest

`shared/stage-manifest.yaml` is the file-form twin of the platform's S1 DAG. One
entry per task:

```yaml
- id: "1.21d"
  name: Confirm factor tree
  skill: factor-tree
  mode: review
  klass: H                      # H human · A/C AI-grounded · M mechanical
  depends_on: ["1.21"]
  gate:
    id: d-1.21
    kind: approval
    evidence: artifacts/factor-tree.yaml
    predicate: no_row_with_status_proposed   # checkable, not judged
```

`mmm-state.yaml` in the project records, per task, `status ∈
{pending, blocked, done}`, the artifact paths produced, and the gate verdict with
its timestamp. **The model walks the flow by reading the manifest, not by
remembering it** — the same reason the platform keeps the DAG as configuration
and computes only content.

The manifest carries a provenance line (`distilled_from: blueprint.py S1 @
<commit>`) so drift from the platform is at least detectable when someone goes
looking. Keeping them in sync is a manual, acknowledged cost; nothing here reads
the platform repo at runtime.

## 5. `orchestrator` — global, not a stage recap

Replaces the platform's `1.7` BU summary with something more useful in a chat
context. Modes:

| Mode | Answers |
|---|---|
| `status` | What is done · what is missing · what the next action is · what the significant problems are |
| `next` | Routes to the owning skill and mode for the next actionable task |
| `audit` | Verifies the state file against reality: does each claimed gate's evidence exist, does each predicate still hold, are there artifacts no task claims |

`audit` exists because a progress file can lie — it is the only defense against a
state that says `done` over an artifact that was never written or was later
edited into a failing state.

`status` reads only `mmm-state.yaml`, the manifest, and artifact front-matter
(§7) — never full artifact bodies. That is what keeps the recap cheap enough to
run constantly.

## 6. Context loading accuracy — the mechanism

Three layers, each doing one job:

1. **Routing before loading.** The orchestrator holds only the manifest and the
   state file. It decides which skill and mode is next, and only that skill's
   material is then loaded. The four artifact skills are never in the window
   together.
2. **Progressive disclosure inside a skill.** `SKILL.md` is capped at 150 lines:
   the mode table, the gate rules, the read allowlist. Per-mode procedure lives
   in `references/<mode>.md`, loaded when that mode runs.
3. **A declared read allowlist per mode.** Each mode names exactly which paths it
   may use as grounding. `interview writeback` may read minutes and the tree; it
   may not read the data request. This is the honest version of "context
   accuracy" — accuracy is enforced by narrowing what is reachable, not by hoping
   the right thing gets read.

Plus a budget: grounding text is clipped to a declared character budget, and
**clipping is written into the artifact's front-matter** (§7). The platform ran
for weeks with a dozen silent `[:6000]` slices, where a 200-page deck and its
first six thousand characters produced indistinguishable deliverables.

## 7. Standard execution — the mechanism

**Every artifact opens with machine-checkable front-matter:**

```yaml
---
task: "1.4"
skill: interview
mode: writeback
generated: 2026-07-30T14:02:00+08:00
grounding:
  - path: intake/interview-minutes/layer1-gm.txt
    chars: 18422
    truncated: false
  - path: artifacts/factor-tree.yaml
    chars: 9310
    truncated: false
knowledge_recall: none        # none | <source id>
counts: { proposed: 6, evidence_backed: 6 }
---
```

**Gate rules:**

- **Hard gates, file as evidence.** A gate closes only when its manifest
  predicate evaluates true against a file on disk. Verification is a grep or a
  script, never an assessment.
- **Binary verdicts only.** No `proposed` / `pending` / `review` row may survive
  a gate. The platform shipped a version where non-binary verdicts were silently
  *kept*, which is exactly the class of bug that makes a review meaningless.
- **A human verdict pins a row.** Re-running a mode recomputes recommendations
  and shows them, but never overwrites a row a human decided. Overwriting on
  refresh silently reverts the reviewer.
- **Upstream freezes once a downstream gate is signed off.** After `d-1.5`, S1
  artifacts are read-only to the suite; changing them requires an explicit
  reopen recorded in `decisions.log`.
- **Every verdict is appended to `decisions.log`.** The log is the audit trail;
  the state file is only an index into it.

**Auto-trigger safety.** Skills are also invocable by description match ("here
are the interview minutes"). Step one of every `SKILL.md` is: read
`shared/conventions.md` and `mmm-state.yaml`; if the owning task's dependencies
are not `done`, stop and say what is missing. An auto-triggered skill therefore
cannot bypass a gate.

## 8. Knowledge recall protocol

The knowledge base will be a vector store; the suite only defines how to talk to
it. `shared/knowledge-recall.md` specifies:

- **When to recall** — after the industry is fixed (`scoping knowledge`), when
  the tree is first derived (`factor-tree derive`), when the outline is drafted
  (`interview outline`).
- **What to ask** — query templates keyed on industry L1–L3 plus the factor
  domain, so a beverage query cannot silently answer a skincare project. (A
  Danone ROI band applied to skincare is a bug the platform's synthetic case
  caught.)
- **How to fail** — no reachable knowledge source means the mode proceeds with
  AI proposals only and stamps `knowledge_recall: none` in the front-matter.
  Loud degradation, never a quiet substitution.

A single adapter file holds the actual call, so wiring the real store later
touches one place.

## 9. Repository layout

```
mmm-skills/
├── .claude-plugin/plugin.json        # name: mmm
├── skills/
│   ├── orchestrator/SKILL.md
│   ├── scoping/{SKILL.md,references/}
│   ├── factor-tree/{SKILL.md,references/,scripts/render_tree.py}
│   ├── interview/{SKILL.md,references/}
│   └── data-request/{SKILL.md,references/,scripts/build_workbooks.py}
├── shared/                           # read by every skill via ../../shared/
│   ├── conventions.md · gate-protocol.md · artifact-frontmatter.md
│   ├── knowledge-recall.md · stage-manifest.yaml
│   └── lib/{yamlio.py,engagement.py,knowledge.py,xlsx.py}
├── commands/{status,scoping,factor-tree,interview,data-request}.md
├── scripts/{gate_check.py,state.py,selftest.py,check_suite.py}
├── fixtures/acme-sunscreen/          # the foreign-data test (§10)
└── docs/superpowers/specs/
```

`shared/` sits at the plugin root rather than under `skills/`, so no directory
inside `skills/` lacks a `SKILL.md`. The suite has **no third-party dependencies**:
`shared/lib/yamlio.py` falls back to a bundled parser when PyYAML is absent, and
`shared/lib/xlsx.py` writes workbooks without openpyxl. A consultant's laptop is
the target environment, and it does not have a prepared virtualenv.

All skill and command text is **English** — this is product surface, and the
project rule is English-only for anything in-product. Chinese domain terms appear
only where they are the actual data (`本品销量`).

## 10. Testing

**The fixture is the real test.** `fixtures/acme-sunscreen/` is deliberately not
a beverage case: skincare, English taxonomy, a client-supplied factor tree
baseline, one interview transcript that contradicts the template, and a factor
the interview adds. Running the suite against it end to end is what proves the
skills are not silently specialised to one client. The platform learned this the
hard way — its synthetic non-Danone case caught six hardcoded assumptions in a
single run.

Two levels:

1. **End-to-end fixture walk** — run the five commands in order; assert each
   artifact exists, its front-matter validates, each gate predicate holds, and
   `decisions.log` has one entry per gate. Assert `orchestrator audit` reports
   clean.
2. **Static checks** (`scripts/check_suite.py`) — `SKILL.md` line caps; every
   manifest task owned by exactly one skill/mode; every mode's read allowlist
   references paths the conventions define; front-matter schema is consistent
   across skills; no skill other than `factor-tree` writes
   `factor-tree.yaml`.

3. **Adversarial self-test** (`scripts/selftest.py`) — builds a throwaway
   engagement and asserts that each way of cheating a gate is caught: an
   undecided row surviving a review, a stale view shown to a reviewer, a
   proposal with no quote, a pending proposal, a profile that says `locked`
   without a logged verdict, a sign-off nobody gave, a data request with no
   dependent variable, and a state file that claims done over failing
   predicates. Each case is a failure the platform actually shipped.

## 11. Build order

| Phase | Deliverable | Verified by |
|---|---|---|
| 1 | Repo skeleton, plugin manifest, `shared/*`, `orchestrator` | `status` + `audit` run correctly against an empty project dir |
| 2 | `scoping` (profile / materials / knowledge) | fixture SOW → profile locked, `d-1.0` closes |
| 3 | `factor-tree` (derive / review / apply-proposals / inspect) + render script | fixture tree derived and confirmed, `d-1.21` closes |
| 4 | `interview` (outline / pre-answer / minutes / answers / writeback) | fixture transcript → proposals → applied via phase 3, `d-1.4` closes |
| 5 | `data-request` (build / coverage / signoff) + workbook script | workbooks match accepted rows, `d-1.5` closes S1 |
| 6 | Fixture end-to-end + static checks + README | full walk green, adversarial assertions pass |

Phase 1 is the load-bearing one: conventions, gate protocol, and manifest format
are what phases 2–5 merely instantiate, and what S2–S5 will reuse. Phases 3 and
4 are coupled through the proposal handoff and are best built in that order.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Skill files grow until "load only what you need" stops being true | 150-line cap on `SKILL.md`, enforced by the static check |
| Manifest drifts from the platform's `blueprint.py` | provenance line + a documented sync step; accepted manual cost |
| An auto-triggered skill skips the state read and bypasses a gate | mandatory step-one state read; `orchestrator audit` catches drift after the fact |
| Model edits the derived `factor-tree.md` instead of the store | the file carries a "generated, do not edit" header, and `view_current` fails the task when the view's recorded hash no longer matches the store |
| Knowledge base not yet available, so early tree quality is thin | recall protocol + loud `knowledge_recall: none`; the adapter is one file to wire later |
| Hundreds of factor rows make YAML review tedious for a human | `inspect` mode summarises by status and provenance; review works on diffs, not the whole file |

## 13. Complexity

MEDIUM-HIGH. Not algorithmically hard — the hard part is that the mechanisms in
§6 and §7 have to be real, since a suite that merely *describes* good practice
will drift the first time a session gets long.

Phase 1 is roughly a third of the total effort and should not be compressed.
