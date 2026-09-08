---
name: generate
description: Generate a Semantica-native ontology candidate from source snapshots.
---

# Generate with native Ontologies

Call POST /api/semantic/ontologies/{id}/native with source_snapshot_ids, extraction.mode=runtime when extraction needs a model, native classes/properties, rules and competency questions. Native RDF/OWL, SHACL, graph, provenance and validation are primary. Bind concepts to discovered data fields and declared action operations. Record the returned native digest and actual findings.

Use enact-ontology-authoring and its scoped scripts/semantic.py client. Read
`shared/semantic-native.md` in this installed skill directory for exact API
payloads, source-map locations and the adapted Semantica capability toolkit.
The bundled shared/scripts/tools directories are supporting resources; native
Enact construction does not require a local ontologizer.yaml, ONTOLOGIZER_HOME
or state.py pipeline. The active Issue supplies the construction and source IDs.

Before delivering or reporting a blocker, refresh the latest Issue comments
and the triggering comment thread using the authoring skill's bounded reads.
New readiness updates are not hot-injected into a running CLI task. Verify
current capability through a bounded authorized API call; do not require an
invented deployment event or another approval for already authorized work.

Record the actual deliverable with POST /api/semantic/constructions/{id}/events
and communicate in the original Issue. Never record human acceptance using an
agent token. After delegating a child Issue, yield the task slot. Native release
is the primary artifact; Skill Package is an explicitly requested derivative.
