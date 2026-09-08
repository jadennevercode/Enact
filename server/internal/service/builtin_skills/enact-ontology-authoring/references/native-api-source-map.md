# Native construction API source map

All paths below have prefix `/api/semantic`. The API checks workspace membership, actual task identity and human originator. Source access is resolved with that human's credentials.

| Route | Payload / behavior |
| --- | --- |
| GET /constructions/{id} | Durable construction, Issue, tasks, model_operations and events. |
| POST /constructions/{id}/events | Active descendant Family task only. {stage,kind,message,data}. Stage: scope/evidence/model/review/release. Kind: artifact/handoff/review_requested/validation/finding. Include actual artifact digest, source IDs, measured finding IDs and child Issue IDs in data. |
| POST /constructions/{id}/revise | Human only. {message,decision:accept/revise,stage?}. Posts a real Issue comment, dispatches the Family follow-up and records the decision. |
| GET /connections/{id}/snapshots | Immutable source snapshots available to the current principal. |
| POST /ontologies or PUT /ontologies/{id} | Save name, canonical bundle and optional binding_config/test_data. Explicit binding_config must be an object with structurally valid binding fields; incomplete draft bindings are allowed. Omit binding_config to retain it on update, use {} to clear it intentionally, and never send null or redact its authorization mode/roles. Invalid field shapes return 400 before changing any draft state. |
| POST /ontologies/{id}/native | {source_snapshot_ids:[],ontology?:{uri,name,version,classes,properties},rules?:[{rule_id,conditions,conclusion}],competency_questions?:[{id,question,query,expected_boolean?,expected_rows?}],extraction?:{mode:runtime}}. Native response includes ontology, artifact, stages, review_required, findings, graph. |
| POST /ontologies/{id}/preview | Compile and validate saved native artifact and current binding configuration. Retain validation results. |
| POST /ontologies/{id}/query | {query: SPARQL}. Query actual native RDF. |
| POST /ontologies/{id}/evaluate | {facts:{bindings:{binding_id:output},binding_observations?:{binding_id:[{step_id,parameters,output}]}},source_step_ids?:[]}. Evaluate draft rules against explicitly labeled fixture outputs. Optional evidence IDs must be an array of at most 100 distinct nonempty strings; null is invalid. Only this draft operation accepts source_step_ids. There is no /draft/evaluate route. |
| POST /ontologies/{id}/graph | Native concept graph for interactive review. |
| GET /ontologies/{id}/releases | Immutable native artifacts and binding snapshots. |
| POST /ontologies/{id}/releases | Human publication only; inspect the current API's version/digest requirements. Agents prepare the proposal, not approval. |

Post evidence artifacts as construction events: source_snapshot_ids plus document anchors, questions, conflicts and proposed native entity/rule/binding IDs. A comment saying a test passed is not a validation result; reference the actual returned validator report.

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

Native build errors return HTTP 422 with `{error,diagnostic:{code,stage,message},finding_recorded}`. Diagnostic fields come from a static server allowlist; raw downstream exception text is never returned. For example, `native_undeclared_entity_property` at `export` requires declaring the property in `ontology.properties` or moving extraction-only annotations into metadata. Preserve source anchors and replay completed model operations after the repair. `finding_recorded=true` means the active task's matching construction Issue tree received a durable finding. A failure never creates an ontology revision. The implementation is `internal/handler/semantic_native_diagnostic.go`.

The eight decision records are scope_and_boundary, evidence_sufficiency, semantic_review, competency_questions, candidate_selection, access_scope_review, patch_or_version and release_authorization. create_pull_request is a separate optional Git export decision. Agents never call the human decision or publish endpoints using another identity.

Source files: internal/handler/semantic_construction.go (real Issue flow); semantic_native.go (native pipeline); semantic_model_operation.go (persistent model operation); internal/daemon/model_operation.go (independent execution lane); pkg/agent/model_operation.go (existing Codex/Claude adapters, isolated taskless environment); internal/ontologizer/agents.go (five roles).
