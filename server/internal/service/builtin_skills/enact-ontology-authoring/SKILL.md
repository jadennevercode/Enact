---
name: enact-ontology-authoring
description: Build, revise and independently review a Semantica-native Ontology in an Enact Issue with the Ontologizer Agent Family, source snapshots, operational bindings and governed release.
---

# Author an Ontology with the Family

The Issue gives construction_id, ontology_id and immutable source_snapshot_ids.
Use the injected ENACT_SERVER_URL, ENACT_TOKEN and ENACT_WORKSPACE_ID through
`scripts/semantic.py call METHOD /api/semantic/... --body-file request.json`.
The script is self-contained Python. It does not need ONTOLOGIZER_HOME or a
local package checkout. Never put the task bearer into source files or logs.

Read source text through `GET /api/semantic/connections` and
`GET /api/semantic/connections/{id}/snapshots`, selecting the exact snapshot IDs
from the Issue. Each snapshot supplies documents with content, source_path,
source_hash and commit metadata. A missing local snapshot file is expected;
do not search other task workspaces, host configuration or repository caches.
Only quote documents present in the selected snapshot. Request another scoped
snapshot if additional source material is needed. Match the user's language
for visible discussion and labels while keeping stable technical IRIs.

Before final delivery or declaring a blocker, reread the latest Issue comments
and the triggering comment thread. Use `enact issue comment list <issue-id>
--roots-only --summary --output json` to find changed discussions, then
`enact issue comment list <issue-id> --thread <trigger-comment-id> --tail 20
--output json` and open any other relevant new thread. A CLI task does not
automatically receive comments posted after it started. Judge readiness from
the latest scoped evidence and a bounded authorized API check. Do not invent
an extra deployment event or approval gate when an authorized integration
update confirms readiness. If the check still fails, report that actual failure
and preserve the candidate rather than repeating model extraction.

Read `GET /api/semantic/constructions/{id}` before a handoff. It returns the
actual Issue, Family task tree, human decisions, artifact events and model
operations. A specialist records its deliverable with
`POST /api/semantic/constructions/{id}/events`; the coordinator creates child
Issues through the ordinary Enact CLI, delegates to the roster assignee, and
ends its turn so the runtime slot becomes available. Child completion wakes
it through Enact's existing task flow.

To resume a specialist on an existing child Issue, explicitly mention its
roster agent using `[@Agent Name](mention://agent/agent-id)` in the handoff
comment. A reply between member-authored comments does not implicitly start
the Issue assignee. Check `GET /api/issues/{id}/task-runs` or the construction
task tree for a new queued/running task before reporting that work has started.
If that specialist already has an active task, reuse its discussion and avoid
another trigger; writing a comment alone is not evidence of execution.

The native authoring request is `POST /api/semantic/ontologies/{id}/native`.
Use the selected source_snapshot_ids, optional native ontology classes and
properties, rules, competency_questions, and extraction: {mode: runtime} for
model extraction. The service calls a controlled model sub-operation on the
active task's runtime, with tools and skill dispatch excluded. Do not dispatch
another Issue for this model call or use an internal service credential.

On a failed native build, the helper prints only the server's allowlisted
diagnostic code, stage and a static repair instruction. Follow that repair
before retrying. A matching active Family task also receives a durable finding
in its construction events; no failed artifact revision is created. An
unrecognized downstream error stays private and is reported as
native_build_failed rather than being echoed into the Issue.

If model operations completed but a later native stage failed, first replay the
exact completed results using extraction: {mode: replay, model_operation_ids:
["completed-operation-id"], source_ids: ["original-document-id"]}. Keep the
original source selection and extraction schema inputs, and omit extractions.
Enact resolves stored results; never supply replay_operations or model output
in the request. Agent replay is limited to completed operations of the current
task and principal; an authorized human owner can recover across task turns.
Replay verifies the original prompt and schema, reruns native stages, and
records reused_model_operation_ids without new model calls. Resolve provenance
or validation findings before treating the replayed artifact as publishable.

`bundle.native_artifact` is the editable draft's native source of truth. It
contains ontology_turtle, shapes_turtle, native_ontology, knowledge_graph,
knowledge_turtle, native_rules, competency_questions, bindings, source_manifest,
provenance_turtle and validation_report. Preserve IRIs, source anchors and
binding IDs when revising. Keep business process and evidence explanations as
supporting records; do not maintain candidate.yaml as a parallel editable
ontology. Native releases freeze the artifact with digest and validation.

Schema creation alone does not populate the knowledge graph. Inspect actual
entity/relation counts and extraction_coverage, and preserve exact source
anchors for source-derived extractions. If sources describe concepts but contain
no business instances, keep that distinction visible. Create separately labeled
validation fixtures with meaningful relationships, property values and negative
cases, and save them in the ontology's test_data for publication revalidation.
Fixtures are test evidence, never live operational facts. Zero SHACL targets or
a generated schema alone cannot establish business conformance.

The analyst establishes scope and evidence; the engineer authors; the reviewer
independently tests; the release steward prepares publication; the coordinator
handles handoffs and unresolved human decisions. Group human review into scope,
semantic review and release. Existing explicit authorization remains valid.
Agents record proposed findings, never human acceptance. The human publishes
using Enact's release endpoint after reviewing the exact candidate.

Read [references/native-api-source-map.md](references/native-api-source-map.md)
for payloads and [references/semantica-capabilities.md](references/semantica-capabilities.md)
for the adapted native skill toolkit. Only a requested compatibility export
uses ontologizer:package; producing a Skill Package is not ontology publication.
