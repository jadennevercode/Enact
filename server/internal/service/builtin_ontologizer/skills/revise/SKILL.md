---
name: revise
description: Revise the native ontology candidate using concrete review findings.
---

# Revise with native Ontologies

Restore the saved native artifact and current findings. Preserve IRIs, source evidence and binding IDs. Make a new native candidate through the native endpoint, inspect validation and graph changes, and link each resolved finding. The reviewer re-tests the result independently.

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
