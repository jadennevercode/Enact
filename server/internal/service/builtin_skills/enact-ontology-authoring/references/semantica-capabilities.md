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
| visualize | Native graph analysis and projections power concept topology, source links, paths and the run Ontology Trace; business map nodes come from bound operational data. |
| decision | Read/write scoped durable ContextGraph decisions and precedents through the semantic service; keep workspace/release/principal/time filters. Approval authority remains Enact's. |
| causal | Use causal hypotheses and documented causal edges with evidence; correlation, a short graph path and physical batch genealogy are different claims. |
| temporal | Preserve as_of, source observed time and graph snapshots. Do not answer a historical question using today's state without identifying that mismatch. |
| change | Compare immutable native releases and their binding catalog revisions; report breaking changes and downstream impact before release. |
| embed | Native text/node embeddings support semantic retrieval and similarity; do not fabricate scores or treat an embedding neighbor as a proven equivalent concept. |
| policy | Enact membership, role, task originator, source credentials and declared action capabilities enforce scope; ontology policies grant no new authorization. |
| export | Export selected native RDF, graph, provenance and validation. A requested Skill Package is a derivative with the native release ID/digest, never the primary publication. |

Only invoke capabilities exposed by the selected native endpoint and returned manifest. An absent scoped endpoint must be reported; do not replace it with an invented HTTP path, a remote system call, or a new private ContextGraph. Native authoring pipeline results include measured stages, findings and graph; operational runs preserve query/evaluation/action receipts separately.
