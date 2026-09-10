# Native construction API source map

All paths below have prefix `/api/semantic`. The API checks workspace membership, actual task identity and human originator. Source access is resolved with that human's credentials.

| Route | Payload / behavior |
| --- | --- |
| GET /constructions/for-issue/{issueID} | Resolve `{construction_id}` from the current Issue or an ancestor, so visible Issue prose does not carry technical IDs. |
| GET /constructions/{id} | Durable construction, Issue, tasks, model_operations and events. |
| GET /constructions/{id}/authoring | `{construction_id,revision,interview,cards}`. Questions and cards include server-owned human decision fields when present. |
| PATCH /constructions/{id}/authoring/proposal | Active descendant Family task only. `{expected_revision,interview:{scope?,status,round,questions},cards}`. Add 1–3 questions per round and keep at most 5 unanswered at once; answered history remains durable. Agent proposals cannot contain answers, confirmed card status or `human_confirmation`. |
| POST /constructions/{id}/authoring/respond | Human member only. `{expected_revision,answers?:[{question_key,answer,answer_kind?:answer\|unknown}],card_decisions?:[{card_key,decision:confirm\|correct\|unknown\|reject,rationale,correction?:{kind?,label?,description?}}]}`. Returns the complete new authoring state plus `coordinator_resume:{status:queued\|coalesced\|deferred\|failed,message,comment_id?}`. |
| POST /constructions/{id}/resume | Human member only. Retries the continuation for the latest saved human decision without recreating the decision and reuses its comment when available. Returns `{coordinator_resume}`. |
| POST /constructions/{id}/events | Active descendant Family task only. `{stage,kind,message,data}`. Stage is exactly scope/model/operations/release and must equal the current gate. Kind is artifact/handoff/validation/finding. |
| GET/POST /constructions/{id}/review-packets | List exact packet envelopes or let the active Family task create `{gate,artifact_digest,review_subject_digest,packet}` at the current gate. |
| GET /constructions/{id}/review-subject?gate=scope\|model\|operations\|release | Returns the current gate's server-calculated `{construction_id,gate,artifact_digest,review_subject_digest,subject}`. Use these values verbatim when creating a packet. |
| POST /review-packets/{id}/decisions | Human member only. `{decision:approve\|request_changes,rationale,expected_artifact_digest,expected_review_subject_digest}`. Rejects stale packets and missing prior-gate approval. |
| POST /constructions/{id}/revise | Human feedback comment only. It cannot approve a review. Exact approval uses the ReviewPacket endpoint. |
| GET /connections | List the workspace's connected knowledge and operational sources before asking the member to enumerate them. |
| GET /connections/{id}/catalog | Read discovered data queries and action operations so both binding types can be proposed from the actual system contract. |
| GET /connections/{id}/snapshots | Immutable source snapshots available to the current principal. |
| POST /ontologies or PUT /ontologies/{id} | `{name,description?,bundle,binding_config?,test_data?:{format,content,facts?},expected_updated_at?}`. `name` and canonical `bundle` are required on both create and update. Explicit binding_config must be an object with structurally valid binding fields; incomplete draft bindings are allowed. On update, omit binding_config or test_data to retain it, use {} to clear intentionally, and never send null or redact authorization mode/roles. |
| POST /ontologies/{id}/native | Version 2 sends `{source_snapshot_ids,definition:{schema_version:2,entities,attributes,relationships,actions,policies,data_bindings,action_bindings},rules?,competency_questions?,extraction?:{mode:runtime\|replay\|provided},data?:{format:turtle\|xml\|json-ld\|nt,content}}` and must omit `ontology`. `ontology` is a separate legacy compatibility input used only when the saved artifact has no version-2 definition; never send both. Native response includes the compiled definition, artifact, stages, findings, quality and graph. |
| POST /ontologies/{id}/preview | Compile and validate saved native artifact and current binding configuration. Retain validation results. |
| POST /ontologies/{id}/context | Draft-only natural-language check. `{question,entity_ids?:[],hops?:2}` returns the native context result directly, without creating a run or operational evidence. Use ordinary scope questions to verify reviewed labels/aliases; do not substitute a structural ASK result. |
| POST /ontologies/{id}/query | {query: SPARQL}. Query actual native RDF. |
| POST /ontologies/{id}/evaluate | {facts:{bindings:{binding_id:output},binding_observations?:{binding_id:[{step_id,parameters,output}]}},source_step_ids?:[]}. Evaluate draft native rules against explicitly labeled fixture outputs. Optional evidence IDs must be an array of at most 100 distinct nonempty strings; null is invalid. There is no /draft/evaluate route. |
| POST /ontologies/{id}/policies | `{action_id,case_name?,parameters,facts,source_step_ids?:[],expected_decision?:allow\|needs_approval\|deny\|unknown}`. `case_name` is an optional business-readable scenario of at most 200 characters and defaults to the Action label. Run the same business Policy interpreter used by published runs against the saved draft and explicit fixture observations. Returns `{draft:true,fixture:true,execution_evidence:false,policy,test_result}` with no `action_intents` or execution step. The server-owned test result records artifact digest, Action label, case name, expected/actual decision, nullable `passed`, engine and request digest without storing the fixture input. Only a member or an active task in this ontology construction's Issue tree may call it. Caller-supplied scope, artifact and principal are ignored. |
| GET /ontologies/{id}/policy-tests | Return `{current_artifact_digest,test_results:[...]}` with the latest 100 server-measured draft Policy fixtures. Compare each row's `artifact_digest` with the current value; historical results do not test the current candidate. |
| POST /ontologies/{id}/graph | Native concept graph for interactive review. |
| GET /ontologies/{id}/releases | Immutable native artifacts and binding snapshots. |
| POST /ontologies/{id}/releases | Human owner/admin only. `{version,binding_config?,test_data?:{format,content,facts?}}`; omitted binding_config/test_data reuse the saved draft values. Agents prepare the proposal and evidence but never call publication as the member. |

Post evidence artifacts as construction events: source_snapshot_ids plus document anchors, questions, conflicts and proposed native entity/rule/binding IDs. A comment saying a test passed is not a validation result; reference the actual returned validator report.

## Operations preflight recipe

Use catalog field names exactly. A Data Binding projects guaranteed scalar
query output into native predicates with this supported shape:

```json
{
  "id": "case-read",
  "fact_mappings": [
    {
      "predicate": "case_target_state",
      "arguments": [
        {"path": "id"}, {"path": "planId"}, {"path": "targetId"},
        {"path": "version"}, {"path": "state"}, {"path": "readAt"}
      ]
    },
    {
      "predicate": "affected_item",
      "rows_path": "items",
      "arguments": [{"root_path": "id"}, {"path": "id"}]
    }
  ]
}
```

`rows_path` iterates a returned array. Within each row, `path` selects a scalar;
`root_path` selects from the complete binding output, and `each:true` expands an
explicit scalar array. Missing, null, object or nested-array values fail or
produce no reviewed fact; do not manufacture a default. Therefore map
`verifiedAt`, `readAt` or a version only when that catalog operation guarantees
a non-null scalar for the tested state. Every native rule condition such as
`case_target_state(?case, ?plan, ?target, ?version, ?state, ?read_at)` must have
a real mapping or another documented native source for the same predicate.

Business Policies read the stored observation directly. Exact identity guards
use the persisted query output and the Action's flat parameter object:

```json
{"all":[
  {"eq":[{"fact":["binding_observations","case-read",0,"output","id"]},{"fact":["parameters","case_id"]}]},
  {"eq":[{"fact":["binding_observations","case-read",0,"output","planId"]},{"fact":["parameters","plan_id"]}]},
  {"eq":[{"fact":["binding_observations","case-read",0,"output","targetId"]},{"fact":["parameters","target_id"]}]},
  {"eq":[{"fact":["binding_observations","case-read",0,"output","version"]},{"fact":["parameters","expected_version"]}]}
]}
```

Associate that Policy both from `Action.policy_ids` and from
`Policy.action_ids`. The evaluator treats a missing fact, inactive/draft
applicable Policy or unresolved authority as `unknown`; it never turns a
source-system role or an Enact workspace role into authorization. Every
executable Action still needs a satisfied active permission Policy.

Action readback templates receive action parameters as top-level keys and the
write response under `response`. Supported examples are
`/plans/{plan_id}`, `/operations/{response.id}` and expected values such as
`{"id":"{response.id}","planId":"{plan_id}","targetId":"{target_id}"}`.
`{parameters.plan_id}` is not supported. The readback request itself is GET, or
a read-only MCP tool; a discovered POST reconciliation operation must instead
be modeled as another governed Action Binding.

After compiling the draft, use `POST /ontologies/{id}/evaluate` with labeled
synthetic `binding_observations` to exercise native `fact_mappings` and rules.
Run the applicable permitted, wrong-target, wrong-parent/plan and wrong-version
fixtures; require unwanted conclusions and action intents to be absent. This
endpoint tests native predicates, not business Policies. Test each applicable
business Policy through the same interpreter before publication with a separate
request such as:

```json
{
  "action_id": "ApprovePlan",
  "case_name": "其他案例的数据不能批准本方案",
  "parameters": {"case_id": "CASE-1", "plan_id": "PLAN-1"},
  "source_step_ids": ["fixture-case", "fixture-plan", "fixture-authority"],
  "facts": {
    "binding_observations": {
      "case-read": [{"step_id": "fixture-case", "parameters": {"case_id": "CASE-1"}, "output": {"id": "CASE-1"}}],
      "plan-read": [{"step_id": "fixture-plan", "parameters": {"plan_id": "PLAN-1"}, "output": {"id": "PLAN-1", "caseId": "CASE-1", "state": "DRAFT"}}],
      "context-read": [{"step_id": "fixture-authority", "parameters": {}, "output": {"actor": {"roles": ["Reviewer"]}}}]
    }
  }
}
```

Call `POST /ontologies/{id}/policies` separately for permitted, denied,
wrong-target, wrong-parent/plan, stale-field and missing-authority cases. Inspect
`.policy.decision`, evaluations and missing facts. The response is explicitly a
draft fixture, omits action intents and creates no execution evidence; it cannot
be used with action prepare. Supply `expected_decision` for a real check:
omitted expectations produce `passed:null` and count only as observations. Read
measured results from `GET /ontologies/{id}/policy-tests` and count only rows
whose `artifact_digest` matches the current draft. After publication, the real Policy path is
`POST /runs/{id}/query` with `{binding_id,parameters}` →
`POST /runs/{id}/policies` with
`{action_id,parameters,source_step_ids:[successful_query_step_id,...]}`; Enact
reconstructs the observations, rejects evidence older than
five minutes for actions, and returns no action intent for `deny` or `unknown`.
Exercise permitted and denied/unknown authority there as well. Keep actual run
results separate from both native-rule and business-Policy draft fixtures.

For several independent reads of one binding, retain each response under
`facts.binding_observations` with its own fixture ID; do not put unrelated
response objects into one `facts.bindings` array or flatten a response's arrays.
For example, a cross-case rule fixture can send:

```json
{
  "source_step_ids": ["fixture-case-A", "fixture-case-B"],
  "facts": {
    "binding_observations": {
      "bind.qt.case": [
        {"step_id": "fixture-case-A", "parameters": {"case_id": "CASE-A"}, "output": {"id": "CASE-A", "affectedPlants": ["AT01"]}},
        {"step_id": "fixture-case-B", "parameters": {"case_id": "CASE-B"}, "output": {"id": "CASE-B", "affectedPlants": ["CN03"]}}
      ]
    }
  }
}
```

These are synthetic authoring fixtures, not live evidence. Draft evaluation
does not persist a semantic execution step or authorize an action. Returned
proofs and intents are test results only. Operational `/runs/{id}/evaluate`
continues to resolve successful query steps from the database; it never trusts
fixture facts or fixture IDs supplied by callers.

Semantica `ValidateRequest.coverage_required` defaults to `all`: every SHACL
target must have at least one matching instance, and empty targets do not prove
conformance. Save explicitly labeled positive and negative synthetic RDF as
`test_data:{format,content}` when schema validation needs instances unavailable
from live sources. Keep those fixtures out of `native_artifact.knowledge_graph`
and every operational run. Report synthetic schema coverage separately from
live-data coverage, binding checks and observed business-question results; a
passing fixture must never be described as a live record or used to invent a
missing identifier.

Native build errors return HTTP 422 with `{error,diagnostic:{code,stage,message},finding_recorded}`. Diagnostic fields come from a static server allowlist; raw downstream exception text is never returned. `native_invalid_business_definition` means required version-2 fields, supported Attribute type, declaration reference or Relationship cardinality is invalid; every definition and five-type declaration needs nonempty `id`, `label` and `description`, and the diagnostic never echoes the dynamic ID. For version 2, `native_undeclared_entity_property` at `export` means the business property must be declared in `definition.attributes` when it is a scalar field or in `definition.relationships` when it links business objects; extraction-only annotations belong in metadata. Do not repair a version-2 request by adding `ontology.properties`. `native_extraction_work_limit` means runtime extraction needs more than its explicit model-operation budget: select exact relevant `source_ids` or `chunk_ids`, or set `max_model_operations` within the allowed limit after estimating two operations per selected chunk. When an already reviewed definition only needs technical compilation, omit runtime mode and report schema-only coverage rather than claiming new extraction. Never silently raise the budget. Preserve source anchors and replay completed model operations after the repair. `finding_recorded=true` means the active task's matching construction Issue tree received a durable finding. A failure never creates an ontology revision. The implementation is `internal/handler/semantic_native_diagnostic.go`.

ReviewPacket envelope: `{id,construction_id,gate,sequence,status,artifact_digest,review_subject_digest,packet,created_by_task_id,created_at,stale_reason?,decision?}`. Status is `pending`, `approved`, `changes_requested` or `stale`. Packet is `{title,summary,groups:[{title,items:[{label,value,classification,source_refs?,decision_id?}]}],checks:[{label,status,detail?}],unresolved,proposal}`. Groups contain at most nine items. Classification is `fact`, `recommendation`, `human_confirmation` or `unknown`; human confirmation requires a real saved decision ID. Check status is `pass`, `warning` or `fail`.

The four human gates are scope, model, operations and release, in that order. Each stores the complete artifact digest for traceability and a section digest for validity. Scope changes invalidate every gate; Entity/Attribute/Relationship changes invalidate model and later gates; Action/Policy/Binding changes invalidate operations and release; any complete release change invalidates release. Agents never call human decision or publication endpoints using another identity.

Source files: internal/handler/semantic_construction.go (real Issue flow); semantic_native.go (native pipeline); semantic_model_operation.go (persistent model operation); internal/daemon/model_operation.go (independent execution lane); pkg/agent/model_operation.go (existing Codex/Claude adapters, isolated taskless environment); internal/ontologizer/agents.go (five roles).
