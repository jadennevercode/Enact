# Semantic API source map

The command helper is `scripts/semantic.py` relative to this skill. It sends
Bearer auth, `X-Workspace-ID`, and injected task/agent headers. It rejects HTTP
redirects and never retries an operation automatically.

For `call POST /api/semantic/ontologies/{id}/native`, the helper may print an
allowlisted diagnostic code, stage and static repair instruction after HTTP
422. It ignores arbitrary response messages and all other error bodies. Native
build failures may appear as findings in the matching active Family construction;
they do not create artifact revisions. Repair the identified schema/evidence
contract and reuse completed model operations before retrying extraction.

| Command | API | Result to retain |
| --- | --- | --- |
| `ontologies` | `GET /api/semantic/ontologies` | Ontology IDs |
| `ontology ID` | `GET /api/semantic/ontologies/{id}` | Canonical draft and business context |
| `releases ONTOLOGY_ID` | `GET /api/semantic/ontologies/{id}/releases` | Immutable artifact, version/digest, `binding_config` |
| `start --release-id ID --question TEXT [--issue-id ID]` | `POST /api/semantic/runs` | Run ID |
| `run ID` | `GET /api/semantic/runs/{id}` | Steps, approvals and receipts |
| `query RUN --binding-id ID --params-file FILE` | `POST /api/semantic/runs/{id}/query` | Successful data query `step_id` and `output` |
| `query RUN --sparql-file FILE` | Same route with `query` | Ontology SELECT/ASK result |
| `evaluate RUN --source-step ID [--source-step ID]` | `POST /api/semantic/runs/{id}/evaluate` | Recorded rule evidence and proposed action intents |
| `prepare RUN --binding-id ID --params-file FILE` | `POST /api/semantic/runs/{id}/actions` | Exact action approval ID/state |
| `execute APPROVAL --idempotency-key KEY` | `POST /api/semantic/approvals/{id}/execute` | Receipt ID/state |
| `receipt ID` | `GET /api/semantic/receipts/{id}` | Result and readback |
| `reconcile ID` | `POST /api/semantic/receipts/{id}/reconcile` | Readback after an uncertain outcome |
| `call METHOD /api/semantic/... --body-file FILE` | Scoped native API request | Exact native graph, trace, snapshot or construction result |

Parameters are JSON files, not shell-interpolated JSON. The `prepare` helper
also accepts `--evaluation-step-id` and `--intent-id` for a recorded rule-derived
intent. Preserve both IDs as returned by the service.

Enact constructs rule facts from persisted source steps under
`bindings[binding_id]` and `steps[step_id]`. Rules may use an explicit path array
such as `{fact: [bindings, bind.qt.cases, rows, 0, status]}`; this preserves
binding IDs containing dots. Calling the Python evaluator with fabricated
facts is not the operational path.

Read-only source-map references in the Enact repository:

- `server/internal/handler/semantic.go`: route registration, workspace/user checks.
- `server/internal/handler/semantic_ontology.go`: draft, compile, validation and release persistence.
- `server/internal/handler/semantic_run.go`: run ownership and query/evaluation steps.
- `server/internal/handler/semantic_action.go`: preparation, human decision, receipt, readback and reconcile.
- `server/internal/semantic/`: connection adapters and binding contracts.

Agents do not call `/approvals/{id}/decide`: the backend requires a human
decision. Operational permissions come from Enact and the connected system;
Ontology access-scope declarations and skill instructions grant no new access.

Native authoring uses `POST /ontologies/{id}/native` with immutable
`source_snapshot_ids`, optional native `ontology`, `rules`, `competency_questions`
and `extraction: {mode: runtime}`. Read `artifact.native_artifact` from releases,
and `bundle.native_artifact` from drafts. `candidate.yaml` is not a second source
of truth. Native methods are implemented in `semantic_native.go`; Family state
in `semantic_construction.go`; structured model callbacks in
`semantic_model_operation.go` and `internal/daemon/model_operation.go`.
