# Application runtime API

Wait for `enact-ready` before the first call. `window.enact.call(operation, input)` returns a Promise containing JSON or rejects with the server error. All identifiers are actual IDs returned by Enact; source code must not invent them.

| Operation | Input | Result |
| --- | --- | --- |
| `context` | `{}` | application, manifest, pinned release artifact, bindings, current user ID |
| `run.list` returns the current user’s saved runs for this application. Restore with `run.get` after reload.

`run.create` | `{question}` | persisted run; retain its `id` |
| `run.get` | `{run_id}` | run with steps, approvals and receipts |
| `query` | `{run_id,binding_id,parameters}` | step_id, status, output (operational result) |
| `query` | `{run_id,binding_id:'@ontology',query}` | read-only SPARQL result; declare `@ontology` in manifest queries |
| `evaluate` | `{run_id,source_step_ids:[...]}` | rule results derived from the run's successful query records |
| `action.prepare` | `{run_id,binding_id,parameters}` | approval with immutable parameters and status |
| `approval.decide` | `{approval_id,approve,reason}` | human confirmation result; the host presents the request |
| `action.execute` | `{approval_id}` | receipt using the stable approval-bound idempotency key |
| `receipt.get` | `{receipt_id}` | saved receipt and readback |
| `receipt.reconcile` | `{receipt_id}` | read-only verification of a pending/unknown external result |

Application manifests declare query and action binding IDs. Enact enforces these capabilities, application identity, pinned release and caller's permissions server-side. A published app may be used by workspace members, but each user's operational queries and runs retain their own source-system access.

Build manifest: `{version:1,entry:'index.html',ontology_release_id,queries:[],actions:[]}`. Assets use `{path:{content:base64,media_type}}`; maximum 512 files and 24 MiB decoded. The application package includes source revision, immutable files, manifest and author-supplied build/test evidence. A saved build is reviewable, not automatically published.

Source map: `server/internal/handler/semantic_application*.go`, `server/internal/semanticapp/bundle.go`, `packages/views/semantic/application-frame.tsx`, `packages/core/semantic/`.
