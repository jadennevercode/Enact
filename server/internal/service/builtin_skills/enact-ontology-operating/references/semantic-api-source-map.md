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
| `call POST /api/semantic/runs/{id}/context` | `{question,entity_ids?,hops?}` | Step envelope; context is in `.output` |
| `call POST /api/semantic/runs/{id}/plan` | `{summary,steps:[{label,purpose,object_ids,binding_ids}],questions}` | Step envelope; `GET /plan` returns the latest step and its plan in `.output` |
| `query RUN --binding-id ID --params-file FILE` | `POST /api/semantic/runs/{id}/query` | Successful data query `step_id` and `output` |
| `query RUN --sparql-file FILE` | Same route with `query` | Ontology SELECT/ASK result |
| `evaluate RUN --source-step ID [--source-step ID]` | `POST /api/semantic/runs/{id}/evaluate` | Step envelope; rule result is in `.output` |
| `call POST /api/semantic/runs/{id}/policies` | `{action_id,parameters,source_step_ids}` | Step envelope; decision and exact intents are in `.output`, with intents at `.output.action_intents` |
| `call POST /api/semantic/runs/{id}/report` | `{summary,findings:[{label,detail,classification,evidence_step_ids,object_ids}],next_steps,limitations}` | Step envelope; default GET is `{report,run,release_id,run_id,issue_id}`, and `?format=html\|jsonl` derives other formats |
| `prepare RUN --binding-id ID --params-file FILE` | `POST /api/semantic/runs/{id}/actions` | Top-level approval object; new is 201, exact same-run draft is 200 with resume flags |
| member decision | `POST /api/semantic/approvals/{id}/decide` with `{approve,reason}` | Human-only; returns the updated top-level approval plus `coordinator_resume:{status,message,comment_id?}` |
| `execute APPROVAL --idempotency-key KEY` | `POST /api/semantic/approvals/{id}/execute` | Receipt ID/state |
| `receipt ID` | `GET /api/semantic/receipts/{id}` | Result and readback |
| `reconcile ID` | `POST /api/semantic/receipts/{id}/reconcile` | Readback after an uncertain outcome |
| `call METHOD /api/semantic/... --body-file FILE` | Scoped native API request | Exact native graph, trace, snapshot or construction result |

The Agent run-list response is intentionally empty. Retain the `id` returned by
start in durable Issue/task context; a later task on that same Issue can load the
known run with `GET /runs/{id}`. The API does not discover a prior run by natural
question or Issue for the Agent.

Parameters are JSON files, not shell-interpolated JSON. The `prepare` helper
also accepts `--evaluation-step-id` and `--intent-id` for a recorded rule-derived
intent. Preserve both IDs as returned by the service.

V2 actions always enter human review. Prepare them from a current persisted
policy evaluation and its exact intent. The server rechecks principal, facts,
parameters and evidence freshness at execution; a prior evaluation or an Agent
message is not an approval.

An Action decision resumes the preparing Agent on the approval's verified Issue
and run. `coordinator_resume.status` is `queued`, `coalesced`, `deferred`,
`failed`, `not_applicable` or `superseded`. A failed dispatch does not roll back
the human decision: the member may repeat the exact `approve` value and trimmed
reason to retry the same durable comment. A different repeated decision or
reason returns 409. If refreshed evidence supersedes a review, decide and
execute return 409 with `superseded_by`; follow that replacement review instead
of continuing the old one. An existing receipt remains readable.

V2 Action definitions may declare `identity_parameters`, naming top-level
fields in `input_schema.properties` that identify the business target. Prepare
deduplicates for the same requesting member by Action, connection and those
exact values across evaluations and runs. An exact request in the same run resumes with HTTP 200,
`resumed:true` and `existing_draft:true`; it may already contain a receipt. A
request for the same target from another run, or with different parameters,
returns 409 and identifies the existing draft. Only a human request may use
`{create_another:true,repeat_reason:"..."}`; an Agent must resume or surface the
conflict. Without identity parameters the server uses the complete exact
parameter digest and neither server nor Skill guesses a business identifier.

Enact constructs rule facts from persisted source steps under
`bindings[binding_id]` and `steps[step_id]`. Rules may use an explicit path array
such as `{fact: [bindings, bind.qt.cases, rows, 0, status]}`; this preserves
binding IDs containing dots. Calling the Python evaluator with fabricated
facts is not the operational path.

Action readback expands original action parameters as top-level values and the
write result below `response`: use `{case_id}` or `{response.id}`, never
`{parameters.case_id}`. A consumer must not repair or reinterpret a malformed
published binding while executing it.

After a member accepts exact `CreateEvidence` text, preserve that exact action
payload. Reload the known run and its approvals on continuation and reuse the
pending approval or receipt. Since a definition may include title and content in
`identity_parameters`, reformatting either field can intentionally identify a
different draft and must not be used as a retry.

For a persistent business Site, use the installed `enact-application-building`
Skill with the same pinned release. Feed it the saved run report's JSON, HTML or
JSONL contract as appropriate; no separate semantic Site-write endpoint exists.
The application remains a view of the durable run rather than another source of
facts.

Read-only source-map references in the Enact repository:

- `server/internal/handler/semantic.go`: route registration, workspace/user checks.
- `server/internal/handler/semantic_ontology.go`: draft, compile, validation and release persistence.
- `server/internal/handler/semantic_run.go`: run ownership and query/evaluation steps.
- `server/internal/handler/semantic_action.go`: preparation, human decision, receipt, readback and reconcile.
- `server/internal/semantic/`: connection adapters and binding contracts.

Agents do not call `/approvals/{id}/decide`: the backend requires a human
decision. Operational permissions come from Enact and the connected system;
Ontology access-scope declarations and skill instructions grant no new access.

V2 native authoring uses `POST /ontologies/{id}/native` with one authoritative
`definition`, immutable `source_snapshot_ids`, optional `rules`,
`competency_questions` and extraction settings. Do not send `ontology` beside a
V2 `definition`. The legacy branch accepts `ontology` only when `definition` is
absent; the two branches must not be mixed. Read `artifact.native_artifact` from
releases and `bundle.native_artifact` from drafts. `candidate.yaml` is not a
second source of truth. Native methods are implemented in `semantic_native.go`;
Family state in `semantic_construction.go`; structured model callbacks in
`semantic_model_operation.go` and `internal/daemon/model_operation.go`.
