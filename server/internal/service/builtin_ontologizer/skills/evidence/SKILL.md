---
name: evidence
description: Extract and organize source-grounded evidence for native ontology construction.
---

# Evidence with native Ontologies

Use the selected source snapshots and native extraction results. Retain document IDs, paths, hashes, commits and textual anchors. Keep facts, assumptions, conflicts, temporal applicability and authority explicit. Record gaps before model generation.

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
