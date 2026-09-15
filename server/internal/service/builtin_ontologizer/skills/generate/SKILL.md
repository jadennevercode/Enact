---
name: generate
description: Generate a Semantica-native ontology candidate from source snapshots.
---

# Generate with native Ontologies

Build the single authoritative `definition` described by enact-ontology-authoring: schema version 2 with Entity, Attribute, Relationship, Action and Policy collections plus Data Binding and Action Binding. Call `POST /api/semantic/ontologies/{id}/native` with that definition, selected source snapshots, rules, the business questions used for validation, and `extraction.mode=runtime` when extraction needs a model. A version-2 request always omits `ontology`; that field belongs only to the independent legacy branch for an old saved artifact with no definition. Semantica compiles RDF/OWL, SHACL, graph, provenance and validation from the definition. Do not author native classes/properties as a competing source of truth or treat a compiled format as the editable primary. Bind concepts to discovered data fields and declared action operations, then record the returned digest and measured findings.

For a source-grounded definition already produced by the Family, compile it through the provided/schema-only path first at the model gate. Use runtime extraction only when new source instances are actually needed, after selecting exact relevant sources or chunks; never treat ontology construction as a reason to rerun NER across the whole knowledge base. A schema ASK check proves only that the compiled vocabulary can express the question. It does not replace business-data observations for the scope questions, and SHACL with no target instances remains unfinished coverage that cannot support publication.

Before handing off the model, compare every required query and action contract with the candidate graph. Keep separately identifiable or governed wholes, detail items and execution targets as distinct business objects when their identity or lifecycle differs. Check that each object definition covers its full confirmed lifecycle instead of defining the object as one temporary state. Reject Attribute descriptions that merely repeat their labels; require business meaning and, when applicable, source authority, unit, observation time and the consequence of missing data.

Before the operations handoff, run the main authoring Skill's operations
preflight and the short recipe in its native API source map. In particular,
require symmetric Action↔Policy applicability, a permission Policy for every
executable Action, exact target/parent/version guards, real Data Binding
`fact_mappings` for every operational rule premise, and a GET/read-only-tool
readback for each write. Derive expected Policy outcomes from that Action's
actual input schema, applicable Policies and confirmed rules. Choose only the
necessary positive and applicable negative cases; do not invent version,
target, parent or other inputs that the Action does not accept, or generate a
Cartesian matrix. Treat Policy `allow` separately from Enact's platform human
review, use a null expectation for unresolved exploration, and never weaken
business authority just to make fixtures pass. Do not count predicates supplied
only by synthetic fixtures as connected live rules, and do not treat a POST
reconciliation operation as a readback.

Use enact-ontology-authoring and its scoped scripts/semantic.py client. Read
`shared/semantic-native.md` in this installed skill directory for exact API
payloads, source-map locations and the adapted Semantica capability toolkit.
The main authoring Skill and its `references/native-api-source-map.md` own the
exact current payload; do not reconstruct it from an older wrapper example.
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
is the published Ontology package compiled from the authoritative definition;
a Skill Package is an explicitly requested derivative.
In member-facing prose, describe business concepts, evidence, gaps and “本轮需要确认的内容”; keep definition keys, RDF formats, packet names and digests in tool records or technical details.

When this specialist deliverable is complete, save findings and a construction
handoff, post the readable result on its child Issue, then finish the task.
Enact resumes the coordinator from that saved handoff after task completion;
`in_review` is valid for a child whose work requires review. Do not send a
second parent mention or ask the member to route the Family. Pending human
review still stops advancement, and no handoff counts as approval.
