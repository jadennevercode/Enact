---
name: enact-ontology-operating
description: Use a published Enact Ontology to answer operational questions with connected data, evaluate rules, and carry actions through preparation, human decisions, execution and readback. Use for Ontology consumption; candidate authoring belongs to the Ontologizer Agent Family.
---

# Operate through a published Ontology

Use the injected `ENACT_SERVER_URL`, `ENACT_TOKEN`, and `ENACT_WORKSPACE_ID` with
`scripts/semantic.py`. Credentials belong to the active task; never copy them
into a document, generated app, command argument or graph. No internal Semantica
service key is needed. The helper uses Python's standard library.

## Follow the business question into evidence

1. List Ontologies and read the selected release's canonical `artifact`
   (`bundle.native_artifact` on a draft), including `native_ontology`, RDF,
   `knowledge_graph`, `native_rules`, `source_manifest`, provenance and the
   release's `binding_config`. State the selected release and the
   user's decision to be supported. Resolve ambiguous business objects before
   an operation depends on them.
2. Start a semantic run on the user's original Issue for that release and question. The helper uses ENACT_ISSUE_ID when present; otherwise pass --issue-id explicitly. Query the
   Ontology for meaning and select a declared data binding for actual cases,
   batches, quantities or system state. Documentation and schema counts are not
   operational observations. Run each bound query with actual entity IDs and
   parameters; retain its `step_id`, source and time context.
3. Evaluate using the successful data query `source_step_ids`. Enact reloads
   their recorded outputs; do not construct authoritative `facts` from chat.
   A rule's `unknown` result identifies missing data. A documented constraint
   without executable semantics cannot authorize an action. Explain the rule,
   observed values and business consequence in the run's step context.
4. Prepare a declared action with its concrete target and parameters. For a
   rule-derived action, reference its recorded evaluation and returned intent.
   Show the user the affected objects, planned change and supporting evidence.
   Respect the returned authorization state: a pending decision is completed
   by the human in Enact; the agent cannot call the human decision endpoint.
   A binding that already permits the authorized operation can proceed using
   the returned approved state without asking for redundant confirmation.
5. Execute an approved action once with a stable idempotency key, then read its
   receipt and readback. Report success only when the receipt confirms the
   expected source-system state. On timeout or an uncertain receipt, inspect
   the same run/receipt and reconcile; do not manufacture a fresh operation.

Return the business conclusion with the relevant query/evaluation/receipt IDs
and the run entry for the interactive application. Keep `proposed`, `pending`,
`executing`, `failed`, and verified completion distinct. A graph edge, HTTP 200,
or proposed action is not an execution receipt.

For exact commands and wire fields, read [references/semantic-api-source-map.md](references/semantic-api-source-map.md).
For the runnable query-to-action sequence, read [references/operating-example.md](references/operating-example.md).

Use Semantica's query, reason, provenance, explain, decision, causal and temporal
methods through the scoped Enact APIs. Read [references/semantica-capabilities.md](references/semantica-capabilities.md)
for the full capability map. Inspect the run's Ontology Trace before answering:
show selected concepts and IRIs, rule IDs, observable inputs, recorded derivation
steps, source queries and action receipts. These are execution evidence; do not
present private model deliberation as an audited trace. Link the same run into
the business application so its topology, map and step detail remain attached
to the user's Issue and authorization.
