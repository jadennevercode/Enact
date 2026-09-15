---
name: enact-ontology-authoring
description: Build and govern a Semantica-native Enact Ontology through source-first interviewing, readable business cards, independent Family work, four exact human review packets and native publication.
---

# Author an Ontology with the Family

One natural request such as “请基于连接的质量追溯知识和绑定的数据系统帮我制作本体”
is enough to start. Treat the workflow, five component types, two binding types,
native compilation and four review gates as this Skill's default responsibility.
Do not ask the member to restate the construction process, enumerate ontology
component types, choose a “normal” workflow, or select OWL, SHACL, package or
other technical deliverables.

Open in ordinary business language: “我先看看现有资料和系统能查到什么，再把需要你决定的地方整理给你。” Do not turn the opening into a method report about stages, component counts, question limits or Family roles. When evidence leaves a real choice, ask it together with what is already known, for example: “交付后先追到客户和交付批次，还是必须定位每一辆车？目前资料能支持前者，还没找到车辆级接口。”

Translate protocol terms for the member. Call competency questions “希望这个本体能回答的业务问题” or “用来验证是否做对的问题”, and call a ReviewPacket “本轮需要确认的内容”. Keep gate keys, exact packet names and digests in tool records. Do not put “胜任问题”, “精确确认包”, digest values or similar protocol vocabulary on the ordinary conversation's first screen.

Work in the original Enact Issue. When only `ENACT_ISSUE_ID` is available, call
`GET /api/semantic/constructions/for-issue/{issue_id}`, then restore the complete
construction, authoring state and review packets. Do not put construction IDs,
ontology IDs, snapshot IDs, IRIs or internal role keys in user-facing Issue
prose. They belong in API payloads and machine events.

The Ontology Orchestrator is the only Family member that speaks with the human
in the root Issue. Domain analysis, generation, independent review and release
preparation happen in assigned child Issues and report through construction
events. A specialist never asks the human directly, and the coordinator never
rewrites a specialist's deliverable as its own. Dispatch a child and yield the
runtime slot; resume from persisted state and actual task completion.

When a specialist has finished its deliverable, persist the measured findings
and a `handoff` event, then post the readable result on the child Issue and
finish the task. Enact resumes the construction coordinator after successful
task completion, including when the child remains `in_review`. This applies
only inside the current construction family and gate, and never continues
through a pending human review or a parked/closed parent. The handoff is not
approval. Avoid a second manual parent mention for the same handoff; the server
reuses its durable comment and task routing on retries. A specialist preparing
a human packet still follows the finalization order below and stops at that
packet. The coordinator reads saved results and owns the next Family role;
never ask the member to route or wake the team.

## Read before asking

First inspect the root Issue, attached workspace knowledge and durable authoring
state. List the connected semantic sources, read each relevant connection's
catalog and immutable snapshots, and distinguish knowledge content from data
queries and action operations. Infer candidate Entity, Attribute, Relationship,
Action and Policy plus Data Binding and Action Binding from that evidence before
asking anything. Do not ask the member to list concepts or bindings that the
connected material and catalog already reveal.

On the first evidence pass, read every selected source snapshot before proposing cards or questions, and persist the read manifest, snapshot IDs/digests, source index and evidence summary. On later task recovery, compare those durable IDs/digests first. When they are unchanged, reuse the persisted coverage and read only the source needed for the current uncertainty; when a source changed or was never covered, read that source before relying on it. An unchanged digest proves only that a previously recorded read is still current, never that an unrecorded source was read.
Separate four statement classes throughout the Issue and review packets:

- `fact`: directly supported by a selected source reference;
- `recommendation`: a proposed modeling choice with its business consequence;
- `human_confirmation`: an actual member response or decision, with its saved `decision_id`;
- `unknown`: missing, disputed or explicitly unknown information.

Never relabel an inference, technical review or Agent message as
`human_confirmation`. Persist Agent proposals through
`PATCH /constructions/{id}/authoring/proposal`; only the member response endpoint
can create confirmed answers or cards.

Ask only about a real business gap whose answer changes scope, identity,
relationships, actions or policy and cannot be resolved from connected
knowledge or catalogs. Add one to three questions per round and keep no more than five
unanswered questions at once. Retain answered history; a later round may ask a
new question when new evidence creates a real decision. Prefer a choice or a
proposed interpretation with the consequence of each option. Do not repeat an
answer already present in sources, authoring state or Issue comments. An answer
of “不知道” is an answered unknown, not permission to guess.

Present candidate cards in Chinese business language, grouping related cards in
sets of five to nine when there are enough items. Show labels, definitions,
source facts, recommendations and unknowns; keep technical IDs in machine data.
Carry ordinary names and abbreviations found in the selected material and the
member's own wording into each concept's reviewed aliases. Do not leave a
business concept discoverable only by its formal label, and do not invent an
alias that no source or member language supports.
Before model review, call the draft context endpoint with representative ordinary
business questions from the approved scope. A structural ASK result does not
prove that natural wording resolves the intended concepts; a missing draft
context match must remain a model finding until labels or source-grounded
aliases make it resolvable.
The member can confirm, correct, mark unknown or reject a card. Reload after a
revision conflict and merge from the server version rather than overwriting a
newer response.

## Build one native definition

Generate the business definition with exactly these five component collections:
`entities`, `attributes`, `relationships`, `actions`, and `policies`, plus
`data_bindings` and `action_bindings`. Attributes reference entities;
relationships reference source and target entities; actions reference their
business targets and policies; policies express permission, prohibition,
obligation or constraint without granting Enact access. Both binding types pin
the discovered source operation and reference the business component they
realize. An Action declares top-level `identity_parameters` from its input
schema for the business target that makes two operation drafts the same; do not
guess identity from field names.

Call `POST /api/semantic/ontologies/{id}/native` with the current `definition`,
selected `source_snapshot_ids`, rules, competency questions and
`extraction:{mode:"runtime"}` when extraction needs a model. Semantica compiles
the same definition into RDF/OWL, SHACL, SKOS, graph, rules, provenance and
validation. `bundle.native_artifact` is the sole editable native source of
truth. A native release is an Ontology package; it is not a Skill Package.
Create a compatibility Skill Package only when the user explicitly requests it.

When the Family already has a source-grounded definition, a provided/schema-only compile is the normal first model-gate step. Enable runtime extraction only when the work truly needs new source instances, and select exact relevant sources or chunks before running it. Building an Ontology does not imply repeating NER over the whole knowledge base. Schema-level business-question checks show that the compiled structure can express a query; they do not replace the scope's business-data validation or observed question results. If SHACL has no target instances, record that coverage as unfinished and do not publish on that basis.

Schema creation is not instance validation. Inspect target counts, negative
fixtures, source coverage, unknown rule results and actual binding discovery.
Semantica validation defaults to requiring instance coverage for every SHACL
target. When live sources intentionally lack an instance, keep that live gap
explicit and validate the schema with separately labeled positive and negative
synthetic RDF in the draft's `test_data`. Never add a fixture to the business
`knowledge_graph`, present it as live coverage, or use it as run evidence. Report
fixture validation, live-data coverage, binding checks and business-question
results as separate checks.
Post measured artifacts, validations, findings and handoffs only at the
construction's current gate. Generic Agent events cannot advance or cross a
gate.

Before model delivery, reconcile every required query and action contract against the candidate graph. Model each business object that a contract can independently identify, query, change or govern, including the whole, its independently meaningful detail items and the actual execution target when they have distinct identity or lifecycle. Do not collapse a plan, its line items and an executed action merely because they share a business topic. Define an object across its full confirmed lifecycle, including confirmed, completed or closed states; a temporary state must not become the boundary of the concept itself. Every Attribute description must explain its business meaning and, where relevant, source authority, unit, observation time and consequence when missing. Repeating or lightly rephrasing the label is not an acceptable definition.

## Prove operations before review

Treat Actions, Policies, bindings and native rules as one executable contract.
Before preparing the operations packet, the author and independent reviewer both
check these invariants against the discovered catalog and measured results:

- Every executable Action has an Action Binding and at least one applicable,
  active permission Policy. Link every applicable permission, prohibition,
  constraint and obligation in both directions: the Action lists the Policy and
  the Policy lists the Action. A detached draft Policy does not block anything.
- When authority is unknown, keep the Action draft or associate the unresolved
  Policy so evaluation remains unknown. Do not leave a broader active permission
  as the only applicable rule, infer authority from a source-system role, or
  describe uncertainty only in prose.
- Compare every action's exact business object, parent object and current version
  with the corresponding query output. A local approval must not match merely
  because some record has the same version. Keep a query's scoped completeness
  separate from completeness of the business case or process as a whole.
- A receipt readback is a GET or a read-only MCP tool. A catalog POST that starts
  or changes reconciliation is a separate Action with its own Policy, approval,
  idempotency and readback; never label that POST as a read.
- Every native rule premise intended for operational use is produced by a
  reviewed Data Binding `fact_mappings` entry. Map identifiers, versions, state
  and required observation/verification times from fields the catalog guarantees;
  if a field can be absent or null, that path remains unknown rather than being
  fabricated. A hand-written fixture predicate alone does not prove the rule is
  connected to a real query.

Choose the smallest useful positive and negative cases for each Action from its
current input contract, applicable active Policies and confirmed business rules;
do not form a Cartesian matrix of every generic failure variant. Test a wrong
target, parent/plan, version or other fact only when that Action actually accepts
the field and its Policy governs it. Mark an irrelevant variant not applicable
with the reason instead of inventing an input or expected failure. Policy
`allow` means the business interpreter permits the action; Enact may still hold
the prepared action for platform human review. For exploratory or unresolved
expectations use `expected_decision:null`, and do not treat the guessed outcome
as a publication blocker. Fix a candidate only for a reproducible mismatch with
its declared contract; never change confirmed authority merely to make a matrix
green. Keep actual query and Policy results separate from synthetic rule
fixtures. Give the member the business outcome and remaining unknowns; the
Family owns binding IDs, predicate symbols and payload mechanics. The exact
supported templates and short recipe are in
[references/native-api-source-map.md](references/native-api-source-map.md).
Before the operations packet, also call the saved draft's `/policies` fixture
endpoint for each applicable business Policy. It uses the published-run Policy
interpreter but returns no executable intent or evidence step. Label its results
synthetic, provide an expected decision when the case is meant to pass or fail,
name each case in ordinary business language such as “其他案例的数据不能批准本方案”,
and cite the server-owned test result. An observation without an expectation has
`passed:null`; a result from an older artifact digest does not test the current
candidate. Never present a fixture allow result as current authority or
live-system proof.

## Stop at each human boundary

The fixed order is `scope → model → operations → release`. For each gate, the
coordinator or assigned specialist creates one exact ReviewPacket through
`POST /constructions/{id}/review-packets` and yields. Work does not continue
until a real member approves that packet. Agents never call the decision
endpoint, reuse a browser identity, or infer approval from an implementation
request.

Each packet records both the complete `artifact_digest` at preparation time and
the section-specific `review_subject_digest` used for validity. Scope covers the
confirmed boundary and competency questions; model covers Entity, Attribute and
Relationship; operations covers Action, Policy and both binding types; release
covers the complete current artifact and binding configuration. A changed
section invalidates that gate and dependent approvals, while an unrelated later
section does not invalidate an earlier decision.

Before preparing a packet, call `GET /constructions/{id}/review-subject?gate={current_gate}` and use its exact `artifact_digest`, `review_subject_digest` and `subject`. Never reproduce the server's digest algorithm in Agent code. If the current candidate changes before the packet is saved, the packet POST returns 409; reload the subject and prepare the packet again.

Use readable packet groups with at most nine items each, measured checks,
unresolved questions and the exact proposal. A `human_confirmation` item must
reference a saved member `decision_id`. The member decides through
`POST /review-packets/{id}/decisions` with both expected digests. A 409 means the
packet, its subject or an upstream approval changed; reload, preserve completed
work and request a fresh packet. Publication succeeds only when the current
release subject has an approved release packet.

Keep the visible title, summary, groups and checks in ordinary business language. Checks should say what the evidence supports, what data is missing and what authority remains unknown. Put snapshot IDs, hashes, paths, decision-reference counts, packet-size checks, digest values and protocol names in machine events or technical details. Say “希望这个本体能回答的业务问题” instead of “胜任问题”, “建议纳入的业务概念” instead of “候选卡”, and “本轮需要确认的内容” instead of `ReviewPacket`.

At every gate, use one fixed finalization order: first persist all artifact, validation and handoff events; then call `GET /constructions/{id}/review-subject?gate={current_gate}`; then create the packet from that exact response; finally yield without posting another generic construction event. A pending packet must be the final durable action before waiting for the member.

Read [references/native-api-source-map.md](references/native-api-source-map.md)
for exact wire shapes and recovery. Read
[references/semantica-capabilities.md](references/semantica-capabilities.md) for
the supported native toolkit.
