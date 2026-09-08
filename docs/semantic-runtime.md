# Semantic runtime control plane

The Go server owns workspace authorization, connections, immutable ontology releases,
execution steps, approvals and operation receipts in PostgreSQL. Semantica is a
scoped native ingestion/ontology/query/reasoning service with persistent graph and provenance checkpoints. Neither the browser nor an
agent receives connection credentials or the internal Semantica service key.

See [semantic-integration.md](semantic-integration.md) for the product entry points
and application source/build/preview/publishing workflow.

## Server configuration

Apply the repository migrations with `cd server && go run ./cmd/migrate up` using
the intended `DATABASE_URL`. The semantic tables begin at migration 454; migrations
471–477 add application/run scope, recovery, delegation and saved authoring inputs; 478–486 add source catalogs, snapshots, native revisions and run presentations; 500–505 add model operations and Family constructions.
There are no new foreign keys. Every new index is a separate concurrent migration;
the migration runner cleans invalid interrupted indexes before retrying.

| Environment variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Enact PostgreSQL persistence, using the existing server configuration |
| `ENACT_SEMANTIC_SECRET_KEY` | Base64 encoding of a stable 32-byte AES-256-GCM key; store in the deployment secret manager |
| `ENACT_SEMANTIC_SERVICE_URL` | Internal Semantica HTTP service base URL, for example `http://127.0.0.1:8766` |
| `ENACT_SEMANTIC_SERVICE_KEY` | Internal service key sent as `X-Semantic-Service-Key` |
| `ENACT_SEMANTIC_ALLOWED_ORIGINS` | Comma-separated exact connector origins, including scheme and non-default port |

For the local reference service, an example allowlist is
`http://127.0.0.1:18180,postgres://127.0.0.1:5432`. Empty configuration denies every
connector origin. An endpoint may include a base path but cannot contain embedded
credentials, query or fragment. Redirects are refused. PostgreSQL primary and
fallback hosts must match the approved endpoint.

Native reads connect **from the Semantica service**; governed system writes connect **from the Enact server**. A private ERP, database
or MCP endpoint must be reachable from that server. This implementation does not
provide a daemon connector tunnel, remote network agent, OAuth authorization flow
or automatic OAuth refresh. The application builder can run in a daemon task; it
does not change the network location of semantic queries and actions.

The secretbox format currently uses one master key. Replacing that key without
decrypting and re-encrypting existing records makes their credentials unavailable.
Updating an individual connection's `secret` through its API is supported, and
invalidates approvals prepared against the previous credential revision.

## Connections and business subjects

All API routes below use the existing Enact authentication and `X-Workspace-ID`.
Membership is checked on every request. Connection creation, updates, testing and
disable require a human workspace owner/admin; responses never include `secret`.

```json
{
  "name": "Quality reference",
  "kind": "rest",
  "endpoint": "http://127.0.0.1:18180",
  "capabilities": ["data", "actions"],
  "config": {"openapi_path": "/openapi.json"},
  "secret": {
    "user_credentials": {
      "ENACT_USER_UUID": {
        "headers": {"Authorization": "Bearer SOURCE_SYSTEM_TOKEN"},
        "roles": ["QualityEngineer"]
      }
    }
  }
}
```

Source roles are configured by an administrator inside the encrypted credential
mapping. A caller cannot supply a business role header to gain that role. The
source system independently authenticates the selected token and enforces its
factory, supplier and operation permissions. A missing entry in an existing user
mapping is denied, including for an Enact workspace administrator.

For PostgreSQL, use `secret.user_credentials[USER_ID].dsn`. A flat `secret.headers`
or `secret.dsn` supports shared reads. Shared writes additionally require
`config.credential_mode="service"`, `service_actions_allowed=true` and an explicit
`service_roles` list of Enact workspace roles. Prefer individual source credentials
when the business system has individual users.

| Route under `/api/semantic` | Behavior |
| --- | --- |
| `GET/POST /connections` | List safe connection metadata / create encrypted configuration |
| `PUT /connections/{id}` | Update; omitted secret retains ciphertext; `enabled:true` re-enables |
| `POST /connections/{id}/test` | Actual REST discovery request, PostgreSQL schema query or MCP handshake + tool discovery |
| `POST /connections/{id}/disable` | Stops new queries, writes and reconciliation through the connection |

REST data bindings use GET. PostgreSQL queries run in a read-only transaction with
a ten-second statement timeout and a maximum of 1,000 returned rows. Native SQL templates use named parameters such as `:batch_id`; legacy PostgreSQL releases retain their ordered `arguments` convention. Clients do not submit raw SQL at runtime. PostgreSQL actions are unsupported.

## Native Sources and Family

| Route under `/api/semantic` | Behavior |
| --- | --- |
| `GET /connectors` | Native connector capabilities, dependency and adapter availability |
| `POST /connections/{id}/discover`, `GET .../catalog` | Principal-scoped immutable schema/tool discovery; credential changes invalidate catalog visibility |
| `POST /connections/{id}/preview` | Bounded read of a discovered entry; system actions cannot be previewed as reads |
| `POST/GET /connections/{id}/snapshots` | Versioned source documents with source commit, hashes and source identity |
| `POST /ontologies/{id}/native` | Source snapshots, optional native model/extractions/rules/competency questions and extraction config → native artifact and immutable revision |
| `GET /ontologies/{id}/revisions` | Native construction revisions, stages and findings |
| `POST/GET /ontologies/{id}/constructions` | Start/list actual five-role Family construction Issues |
| `GET /constructions/{id}` | Actual Issue tree, role tasks, model operations and construction events |
| `POST /constructions/{id}/revise` | Human feedback recorded on the existing Issue and construction |
| `POST /model-operations` | Task-scoped, schema-constrained model sub-operation using its Runtime |
| `GET /runs/{id}/trace` | Graph of recorded queries, exact fact/rule derivations, approvals and receipts |

Native bindings pin `catalog_entry_id`, `catalog_digest`, optional catalog revision and `ontology_iri`. Publication compares the authored artifact bindings with the saved configuration and revalidates the actual source catalog. Native data queries reject catalog drift before reading. Business writes retain the existing exact action/credential/idempotency/readback contract below.

`POST .../native` preserves source snapshots, native ontology, existing extracted graph, rules and competency questions on partial edits. A fresh runtime extraction can explicitly select source/chunk IDs and a model-operation budget; partial coverage is returned in the artifact. Source evidence is never silently dropped or reported as complete.

If extraction completed but a later pipeline stage failed, use
`extraction: {"mode":"replay","source_ids":["SOURCE_ID"],"model_operation_ids":["COMPLETED_OPERATION_UUID"]}`
with the original source selection and omit `extractions`. Enact retrieves the
completed operations from its own store; caller-supplied results or callback
credentials are never trusted. Agent replay is limited to its current task and
agent. The human business principal can recover their own completed operations
across tasks. Semantica requires an exact prompt and response-schema match,
reuses each recorded response once, and reports zero new model operations.
Replay preserves validation failures and ambiguous source spans for review; it
does not turn an intermediate artifact into a publishable release.

`ENACT_SEMANTIC_MODEL_API_URL` is the callback base configured in Enact and must match Semantica's `SEMANTIC_ENACT_ORIGIN`. `ENACT_SEMANTIC_ALLOWED_PATHS` authorizes local source roots; those paths must exist in both containers. Model callbacks use the active task identity rather than a new recursive Issue.

## Authoring, publication and bindings

`POST/PUT /ontologies[/{id}]` accepts `{name,description,bundle,binding_config,test_data}`.
`bundle.native_artifact` is the native primary draft, containing ontology, OWL/SHACL, knowledge graph, rules, source manifest, provenance and validation. Legacy candidate/process/evidence/alignment envelopes remain supported for existing releases only.
Omitted `binding_config` and `test_data` retain their saved values on update.
Editors should pass `expected_updated_at` from the loaded draft when saving; a
concurrent author's change then returns HTTP 409 instead of being overwritten.
Members and agents can author drafts; publishing requires a human owner/admin.

| Route | Behavior |
| --- | --- |
| `GET /ontologies`, `GET /ontologies/{id}` | Load workspace drafts |
| `POST /ontologies/{id}/preview` | Compile the stored draft and validate supplied or saved `test_data`; returns `{artifact,validation,incomplete}` |
| `POST /ontologies/{id}/query` | Draft-only SPARQL SELECT/ASK via `{query,data?}` |
| `POST /ontologies/{id}/evaluate` | Pure draft rule test via `{facts}`; performs no source writes |
| `POST /ontologies/{id}/graph` | Graph projection of the stored draft |
| `GET/POST /ontologies/{id}/releases` | List immutable releases / publish `{version,binding_config?,test_data?}` |
| `POST /releases/{id}/retire` | Human owner/admin retires a release with `{reason}` |

Preview without test data explicitly returns an incomplete, non-passing report.
Publication requires real binding discovery, compiler output, explicit
`validation.valid=true` and `validation.conforms=true`, and no unsupported item
with severity `error`. The Python service checks SHACL target coverage, so empty
data cannot pass simply because no constraints were exercised. Publication locks
and rechecks all saved authoring inputs after compilation to reject concurrent
draft changes. Existing releases are never overwritten. CapHub is not required.

A REST action binding looks like:

```json
{
  "id": "bind.qt.action.approve",
  "connection_id": "CONNECTION_UUID",
  "method": "POST",
  "path": "/api/v1/plant-actions/{actionId}/approve",
  "required_parameters": ["actionId", "expectedVersion", "justification"],
  "body_parameters": ["expectedVersion", "justification"],
  "authorization": {"mode": "role", "roles": ["PlantManager"]},
  "readback": {
    "path": "/api/v1/plant-actions/{actionId}",
    "expected": {"status": "approved"}
  }
}
```

`body_parameters:[]` sends `{}`. Omitting the field sends parameters other than
path placeholders. The complete original parameters remain part of the approval
digest and are available to readback. Readback placeholders can reference the
operation response, for example `{response.operation.id}`. Every write requires
explicit readback completion conditions. Connection-relative paths cannot escape
the configured base endpoint.

MCP supports streamable HTTP JSON and bounded SSE responses with initialization,
session IDs and tool discovery. Data and readback tools must declare
`readOnlyHint=true`. MCP actions additionally require `idempotentHint=true`, an
`idempotency_parameter` present in the discovered input schema, and a separate
readback tool with explicit completion conditions. Publication stores tool schema
digests; runtime rediscovery refuses schema drift. A readback tool uses
`{tool,arguments,expected}`, where an argument can be a response placeholder such
as `{response.structuredContent.id}`. Tool annotations are a source-server
contract; the source remains responsible for actual idempotent behavior and
authorization. Stdio MCP, arbitrary MCP writes without this contract, persistent
stream resumption and automatic tool pagination are not provided.

## Runs, delegation and recovery

`POST /runs` accepts `{release_id,question,issue_id?}`. Runs pin a release and are
private to the business principal. Workspace administrators do not automatically
gain access to another member's source data. Each factory user can operate a
separate run over the same source-system case. App runs also pin an immutable
application build; their manifest applies to direct agent API calls as well as
iframe bridge calls.

Task tokens identify the runtime owner, which may differ from the requesting
business user. A human can explicitly delegate an existing run through
`POST /runs/{id}/delegate {issue_id}`. The task must belong to that issue and carry
the same authenticated `originator_user_id` as the run owner. It then uses that
owner's source credentials, with agent/task identity recorded on steps, approvals
and receipts. A task creating a new run must likewise have a current human
originator in the workspace. When that new run names the task's own Issue,
Enact records Issue continuation so a later task from the same human and Issue
can resume after confirmation. Naming another Issue is rejected. A task cannot
use its runtime owner's business roles as an implicit substitute. For a
human-created run, create an unassigned `todo` issue, delegate the run, then
assign/start the task to avoid dispatching before delegation is saved.

| Route | Behavior |
| --- | --- |
| `GET /runs`, `GET /runs/{id}` | Own runs and persisted steps/approvals/receipts; task clients access their explicitly supplied run IDs |
| `POST /runs/{id}/query` | `{binding_id,parameters}` queries real data; `{query,data?}` queries the ontology |
| `POST /runs/{id}/evaluate` | `{source_step_ids}` evaluates facts reconstructed only from this run's successful data-query steps |
| `POST /runs/{id}/steps/{stepID}/resume` | Re-executes a failed read/pure inference step, or a running step after a 90-second lease; preserves step ID and increments attempt |
| `POST /runs/{id}/actions` | Prepare exact `{binding_id,parameters,evaluation_step_id?,intent_id?}` |
| `POST /approvals/{id}/decide` | Human decision `{approve,reason}` |
| `POST /approvals/{id}/execute` | Execute authorized operation; requires `Idempotency-Key` |
| `GET /receipts/{id}` | Load the executing principal's durable receipt |
| `POST /receipts/{id}/reconcile` | Independent readback; never replays a possibly dispatched write |

Runtime evaluation ignores client-supplied facts. Native releases use `fact_mappings`, `native_rules` and actual derivations. `binding_observations[BINDING_ID]` retains each selected read as `{step_id,parameters,output}`, so querying several stocks through the same binding preserves each stock and its own provenance. Requests accept up to 100 distinct successful source steps. Legacy rules retain `bindings[BINDING_ID]` (the last selected result), `binding_step_ids` and `steps[STEP_ID]`. Use array paths for dotted IDs,
for example `{fact:["bindings","bind.qt.case.snapshot","status"]}`. Agent action
preparation requires a successful persisted evaluation and an exact matching
`intent_id`, binding and parameter object. Humans can independently prepare an
operation and review it under the binding's authorization policy.

Within a native fact mapping, `path` reads the current `rows_path` row and
`root_path` reads the same observation's original output. Add `each:true` only
for an explicitly declared scalar array; empty arrays produce no facts. For
example, projecting `affectedPlants` with arguments `[{"root_path":"id"},
{"path":""}]` preserves the case ID in every plant fact. Projecting
`affectedMaterials` with `[{"root_path":"id"},{"path":"materialNumber"},
{"path":"batchNumbers","each":true}]` covers every explicitly listed batch.
Rules must join case-scoped facts by case ID. The service retains query, row and
array-item provenance and rejects oversized expansion rather than truncating it
into misleading evidence.

`allow` actions are explicitly pre-authorized by the release policy. `confirm`
requires the requester, unless explicit business roles delegate confirmation.
`role` creates a pending approval and requires one of the configured source roles.
Agents cannot submit human decisions. Approvals expire after 15 minutes and bind
the release, action, parameters, connection configuration and credential revision.
The actual executing human or delegated business principal selects the credential.

Receipts are inserted before dispatch, unique per approval and workspace
idempotency key. Repeating execute returns the existing receipt without a second
write, including after a process restart. HTTP 202, a network failure, a 5xx or
failed readback produces `unknown`, never success. A definitive 4xx produces
`failed`. Reconciliation needs explicit completion conditions and the original
connection configuration. A source-system reconciliation command is a separate
bound, authorized action; the Enact receipt reconciliation itself is read-only.
Retirement blocks new execution but keeps existing records readable and permits
readback of an already dispatched operation.

Read and inference steps persist before work and persist completion independently
of a disconnected browser. An attempt guard prevents a late old process from
overwriting a resumed step. There is no background scheduler replaying unfinished
steps: a user or agent explicitly resumes them. Semantic table cleanup participates
in workspace deletion; write transactions lock the parent workspace to fence
concurrent deletion.

## Verification

Focused tests use an isolated PostgreSQL database. Supply its DSN, never a shared
development or production database, when running:

```sh
cd server
go test ./internal/semantic ./internal/semanticapp ./internal/handler \
  -run 'TestSemantic|TestValidateApplicationBuild|TestSourceSnapshot|TestWorkspaceDeletionManifest|TestDeleteWorkspace_OwnerSucceeds|TestDeleteWorkspace_PreservesOtherWorkspaceData' -count=1 -v
```

Set `ENACT_SEMANTIC_TEST_POSTGRES_DSN` to explicitly exercise actual parameterized
PostgreSQL reads and rejection of DDL by the read-only transaction. REST and MCP
unit tests use real local HTTP transports with deterministic source fixtures.
Handler tests cover per-user credential selection, different runtime-owner
delegation, forbidden cross-user/task access, source-body projection, durable
idempotency, HTTP 202 reconciliation, recovery, draft scope and retirement.

`TestSemanticQualityTraceabilityEndToEnd` is opt-in and uses the actual Semantica
HTTP service, Enact PostgreSQL and an isolated seeded QT runtime. Set
`ENACT_QUALITY_E2E=1`, `ENACT_QUALITY_E2E_URL`,
`ENACT_QUALITY_E2E_FIXTURES` (the QT `runtime/ontology` directory), and the semantic
service URL/key above. This mode fails if PostgreSQL is unavailable instead of
silently skipping. It exercises canonical publication, empty-coverage rejection,
real queries/rules, two-plant containment, pending-operation recovery, source
approvals, restoration, CAPA verification and independent critical-case closure.
Business operations in this opt-in test are not mocked. Use a fresh QT database
for each run because it deliberately changes case and actuator state.

## Site presentation of an existing Issue

The bridge `context` returns `requested_run_id` when the caller supplied it. `run.attach` verifies the current principal and release, then creates a scoped presentation for that app/build without replacing the original run. `run.get` and `run.trace` filter historical queries and derived evidence to the manifest. A Site cannot evaluate hidden source steps or use an undeclared action. The Issue remains the natural-language investigation entry; the Site resumes that run through `?app=APPLICATION_ID&investigation=RUN_ID`.
