---
name: initiate
description: Establish scope and competency questions from selected source snapshots.
---

# Initiate with native Ontologies

Read immutable snapshots, summarize business goals, bounded context, actors and lifecycle. Propose competency questions with expected observations and source anchors. Present only unresolved scope choices to the human and record a scope artifact.

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
