# Real Semantica → Enact → QualityTraceability integration

`internal/handler/semantic_quality_integration_test.go` exercises real HTTP calls
to Semantica and the QT reference system, with durable Enact PostgreSQL state.
Use an isolated development QT database: the test creates a Critical case, freezes
stocks and stops lines in AT01/CN03, restores both through newly approved plans,
records six subsequent-lot inspections, verifies CAPA and closes with independent
PlantManager and SupplierQualityManager decisions. Only reference actuator fault
configuration and inspection-fixture insertion use QT development endpoints.
Every business mutation goes through the Enact connection/action gateway.

Required running components:

- Enact PostgreSQL with current migrations applied; configure `DATABASE_URL`.
- Semantica: from its repository, set `SEMANTIC_SERVICE_API_KEY` to a local test
  key and run `.venv/bin/python -m semantica.semantic_service --port 18766`.
- QT: from `QualityTraceability/runtime`, set `QT_DEV_MODE=1`,
  `QT_SEED_ON_START=1` and `QT_DATABASE_URL` to a separate disposable persistent
  PostgreSQL or SQLite database, then run
  `.venv/bin/python -m uvicorn sqmp_runtime.api:app --host 127.0.0.1 --port 18182`.
  Do not share this database with an interactive demonstration or production.

From `Enact/server`, with the values injected into the shell environment:

```sh
export ENACT_QUALITY_E2E=1
export ENACT_QUALITY_E2E_URL=http://127.0.0.1:18182
export ENACT_QUALITY_E2E_FIXTURES=/absolute/path/QualityTraceability/runtime/ontology
export ENACT_QUALITY_APPLICATION_BUNDLE=/absolute/path/QualityTraceability/runtime/build/application-build.json
export ENACT_SEMANTIC_SERVICE_URL=http://127.0.0.1:18766
# ENACT_SEMANTIC_SERVICE_KEY must match the semantic service's local test key.
go test ./internal/handler -run '^TestSemanticQualityTraceabilityEndToEnd$' -count=1 -v
```

The test creates an isolated workspace, distinct Enact user identities and runs,
an encrypted REST connection with each caller's own reference credential, and a
published release from the four canonical fixture documents plus complete SHACL
test data. The release rejects empty coverage. Query evidence comes from actual
recorded binding results. HTTP 202 stays `unknown` until a separately approved
source reconciliation and independent gateway readback confirm completion.
The first plan consumes the unchanged complete recorded rule intent; replacing
its case parameter is rejected. A human-authored second plan extends containment
to the remaining stock and production lines.
Duplicate execute requests must return the original receipt without a second
system write. Reloading through a fresh handler proves run history is durable.

Enact test records are removed by the existing DB fixture cleanup. QT keeps its
new closed case and audit history; target stock/line states are restored by the
new approved plan. A failed test can leave reference work unfinished, so use the
isolated database and inspect receipts before rerunning. It is safe to recreate
that dedicated development database externally when deliberately starting over.

For agent consumption, use the installed
`enact-ontology-operating/scripts/semantic.py` helper with Enact's injected task
identity. Authoring uses `tools/semantic/adapter.py` inside the assembled
Ontologizer runtime. Neither helper accepts the internal service key.
