---
name: evaluate
description: Test native ontology constraints and competency questions with recorded evidence.
---

# Evaluate with native Ontologies

Run preview and SPARQL against the actual candidate. Report SHACL target-instance coverage and negative cases, competency question results and binding schema checks. Zero targeted instances does not prove business correctness. Operational claims require successful bound data steps and verified action receipts.

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
