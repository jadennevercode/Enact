---
name: review
description: Independently review native ontology semantics, source support and bindings.
---

# Review with native Ontologies

Inspect native RDF/OWL, shapes, rules, provenance, graph and binding catalogs. Compare definitions with source evidence, distinguish domain/range from required properties, and identify unsupported causal or operational claims. Record concrete findings and ask for semantic review only on unresolved decisions.

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
