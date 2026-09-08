---
name: package
description: Export an explicitly requested compatibility Skill Package from a native release.
---

# Package with native Ontologies

Use only when the user requests a compatibility Skill Package. Read the selected published native artifact and digest, export a derivative with provenance and binding references, and label it a compatibility export. Never create candidate.yaml as a second truth or report package creation as native publication. Existing standalone package scripts may be used only for a compatible explicitly requested export input.

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
