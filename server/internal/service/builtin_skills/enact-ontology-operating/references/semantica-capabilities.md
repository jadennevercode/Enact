# Semantica capabilities through Enact

Adapted from Semantica's maintained `plugins/skills/*/SKILL.md` sources. The product bundle does not depend on a user's installed plugin cache. Native SDK calls run in the Semantica service; agents use the current task's scoped Enact endpoint. Do not import a fresh ContextGraph or hard-code a local SQMP path.

| Source skill | Reused behavior and task boundary |
| --- | --- |
| ingest | Selected source snapshots preserve document IDs, paths, commit and content hashes. Read scoped connection snapshots; do not bypass Connection permissions. |
| extract | Native extraction returns entities, relations, events and validation; request extraction.mode=runtime to use the controlled model callback under the active task. |
| deduplicate | Review native normalization/deduplication candidates and preserve entity IDs and conflicting evidence. Never merge solely because labels resemble one another. |
| ontology | Inspect actual RDF classes, restrictions, domain/range and SHACL. Domain/range is not property cardinality. Native RDF remains canonical. |
| query | SPARQL uses predicates/IRIs actually in the selected native release. Documentation graphs are specifications; cases, lots and quantities require data bindings. |
| reason | Invoke recorded evaluation from successful source_step_ids; retain rule IDs, derivations and unknowns. A described business rule is not an executable rule. |
| validate | Native schema, graph, SHACL and competency checks retain target-instance coverage, errors and warnings. Zero targeted instances is not business validation. |
| provenance | Inspect source snapshot/document/hash/commit links and actual query/receipt references; keep reviewed inference distinct from source assertions. |
| explain | Explain recorded rule premises, conclusions, missing data and their business consequences. Do not invent a private reasoning transcript. |
| visualize | Enact adapts Semantica Explorer's Sigma/Graphology interaction and layout code to display native RDF graph projections and persisted run traces. Python visualization dashboards are not an Enact runtime endpoint. Business topology nodes come from bound operational data. |
| decision | Enact persists approvals/receipts and native ContextGraph proof records. A separate decision/precedent lifecycle endpoint is not exposed to Enact tasks; do not invent one. Approval authority remains Enact's. |
| causal | Explain only documented causal edges and recorded proof evidence. Causal intervention/counterfactual APIs are not exposed to Enact tasks. Correlation, a graph path and physical batch genealogy are different claims. |
| temporal | Preserve source observation times and immutable release/snapshot identity. The private native service has temporal inspection support, but no task-facing historical-query endpoint is wired yet. Do not substitute today's state for a historical answer. |
| change | Compare immutable native releases and their binding catalog revisions; report breaking changes and downstream impact before release. |
| embed | The private native service can search attributed, supplied vectors using Semantica VectorStore. Embedding generation and a task-facing vector-search endpoint are not wired; do not fabricate scores or bypass the Enact gateway. |
| policy | Enact membership, role, task originator, source credentials and declared action capabilities enforce scope; ontology policies grant no new authorization. |
| export | Export selected native RDF, graph, provenance and validation. A requested Skill Package is a derivative with the native release ID/digest, never the primary publication. |

Only invoke capabilities exposed by the selected native endpoint and returned manifest. An absent scoped endpoint must be reported; do not replace it with an invented HTTP path, a remote system call, or a new private ContextGraph. Native authoring pipeline results include measured stages, findings and graph; operational runs preserve query/evaluation/action receipts separately.
