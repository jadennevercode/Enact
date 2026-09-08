---
name: trace
description: Trace native concepts, rule results and actions back to actual evidence.
---

# Trace with native Ontologies

Inspect the saved native provenance and run Ontology Trace. Show IRIs, source snapshots and document anchors, rule premise/conclusion steps, bound data queries, approvals and readback receipts. Explain business consequences and missing evidence; do not invent model deliberation or treat documentation associations as executed actions.

Use enact-ontology-authoring and its scoped scripts/semantic.py client. Read
`shared/semantic-native.md` in this installed skill directory for exact API
payloads, source-map locations and the adapted Semantica capability toolkit.
The bundled shared/scripts/tools directories are supporting resources; native
Enact construction does not require a local ontologizer.yaml, ONTOLOGIZER_HOME
or state.py pipeline. The active Issue supplies the construction and source IDs.

Record the actual deliverable with POST /api/semantic/constructions/{id}/events
and communicate in the original Issue. Never record human acceptance using an
agent token. After delegating a child Issue, yield the task slot. Native release
is the primary artifact; Skill Package is an explicitly requested derivative.
