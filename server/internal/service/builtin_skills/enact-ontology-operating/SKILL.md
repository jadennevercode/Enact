---
name: enact-ontology-operating
description: Investigate a natural business question through an assigned published Enact Ontology, durable business plans, Entity/Relationship context, governed Action/Policy evaluation, reports, human action review, execution and readback.
---

# Operate through a published Ontology

Start from the user's business question, not an internal ID. Use the Ontology
release assigned to the active Agent; a Skill does not assign an Ontology and
must not bypass an absent or disabled assignment. Resolve Chinese names,
aliases, time context and ambiguous business objects before an operation depends
on them. Ask one to three concise clarification questions only when the answer
changes the investigation.

Follow this durable sequence:

1. Start or resume the semantic run on the current Issue and assigned release.
   Prefer the existing same-goal draft. If several drafts could apply, show the
   business difference and ask which to resume.
2. Call `POST /runs/{id}/context` with the natural question and only resolved
   optional `entity_ids` or `hops`. Read the returned Entity/Attribute context,
   Relationship paths, Action, Policy, binding references, ambiguities and gaps.
   Never hard-code IDs from an example or another release. If the natural
   question produces no useful match, inspect the pinned release's published
   labels, aliases and source-grounded descriptions, select the supported Entity
   types as `entity_ids`, and query context again. Explain the match in ordinary
   user language; do not ask the member for IDs or internal model terms, and do
   not claim vector search was used.
3. Save a business plan with `POST /runs/{id}/plan` using
   `{summary,steps:[{label,purpose,object_ids,binding_ids}],questions}`. The plan
   explains what will be checked and why in business terms. On resume or retry,
   restore the latest saved plan with `GET /runs/{id}/plan`; update it only when
   real discoveries change the next useful step.
4. Query declared data bindings with actual resolved parameters. Retain every
   successful `step_id`, source time and object version. Documentation, model
   structure and caller-supplied facts are not operational observations.
5. Evaluate rules from persisted `source_step_ids`. Call
   `POST /runs/{id}/policies` with `{action_id,parameters,source_step_ids}` before
   preparing a v2 action. The service persists the policy evaluation and exact
   `action_intents`; unknown, conflicting, denied or stale evidence cannot
   authorize a write.
6. Save discoveries through `POST /runs/{id}/report` with
   `{summary,findings:[{label,detail,classification,evidence_step_ids,object_ids}],next_steps,limitations}`.
   Classification is `fact`, `inference`, `recommendation` or `unknown`.
   `GET /runs/{id}/report` returns JSON; `?format=html` and `?format=jsonl`
   derive from the same record. HTML is the human report and JSON/JSONL is the
   machine log; neither may invent model thoughts or unsupported evidence.
   When the same investigation must appear in a persistent Site, pass this run
   and its report formats to the existing application work and follow
   `enact-application-building`. Keep the application pinned to the same release
   and use the saved report as its evidence source; do not invent a Site route or
   paste a second, unaudited version of the findings into application source.
7. Prepare the exact returned intent through the existing action endpoint using
   its `evaluation_step_id`, `intent_id`, binding and unchanged parameters.
   Present the target objects, proposed change, applicable policy, evidence age
   and limits. Use the Action's declared `identity_parameters` to recognize the
   same business target. A 200 response with `resumed:true` and
   `existing_draft:true` means continue that prior draft, including its receipt
   when present. A 409 means another same-target draft exists; only a member may
   explicitly request another with `create_another:true` and a nonempty
   `repeat_reason`. The resulting pending approval is the human Action Review.
   Agents never call the human decision endpoint or describe a pending action as
   approved.
   Once the member accepts exact evidence text or other action parameters, keep
   that payload unchanged. On continuation, load the known run and its approvals
   first and resume the matching pending, superseded or receipted draft. Do not
   rewrite a title or report body and prepare a second `CreateEvidence` action;
   its identity may include the complete reviewed text.
   Action-review preparation is latency-sensitive. In one bounded tool call,
   re-query only every binding required by that Policy, collect the returned
   `step_id` values, evaluate the Policy with the unchanged payload, and prepare
   its exact intent. Do not scan files, re-read the full run, or rewrite the
   report between those operations. When prepare returns pending, immediately
   explain the business scope and wait for the member. Lead member review and
   final replies with the business title, readable target, content summary,
   proposed change and current result. Keep full hashes and approval or step
   UUIDs in the unchanged Action parameters, machine log or technical details;
   never make the member interpret them.
8. When the coordinator resumes after the member decision, reload the same
   Issue and run with `python3 scripts/semantic.py review <run_id> <approval_id>`,
   which returns only the current approval, its receipt, supersession fields,
   Policy decision and source-query timestamps; never expand the full run or
   source outputs into model context. If the approval is valid
   and its evidence is still inside the Policy freshness window, execute
   immediately with a stable idempotency key. Read
   the receipt and independent readback. If the outcome is uncertain, reconcile
   the same receipt; do not create another action or key. Report completion only
   when readback confirms the expected source-system state. After execution and
   independent readback, first update the same run's durable business report with
   the final result, remaining unknowns, and any preserved failure history, then
   export and attach its HTML and JSONL forms. Only then send the final reply and
   move the Issue to review. This reporting step must not repeat the Action,
   refresh Policy evidence, reopen the investigation, or rewrite reviewed
   evidence text. A failed continuation
   does not undo the saved member decision; the member may repeat that exact
   decision and reason to retry delivery without creating another comment.
   A failed execution receipt is different. After independent readback confirms
   that it wrote nothing, only a member may explicitly create and approve a new
   draft with `create_another:true` and a truthful `repeat_reason`. Preserve the
   failed receipt and the exact reviewed parameters and text, then use a new
   stable idempotency key for the new approval; never reuse the consumed key,
   clear the old receipt, call `create_another` yourself, or self-approve. When a
   member then mentions the Agent, narrowly reload the same run and select its
   latest applicable approved draft, including one created by that member within
   the same originator and run scope; an older approval in task context is not
   proof of current state.
   If source timestamps are already stale, do not try the old approval first.
   Preserve the exact reviewed parameters and text, use one bounded tool call to
   re-query the same Policy bindings, re-evaluate, and prepare the replacement;
   report its pending scope immediately for a new member decision. Never approve
   it yourself or weaken the five-minute freshness check. Treat
   `[action_evidence_stale]` with no receipt as this refresh path, not a platform
   outage. Stop and report the observed error when a conflict is unclassified.

Never set `create_another` or invent a repeat reason for the member. When an
Action has no identity declaration, rely on the server's exact-parameter
deduplication and do not guess a business key.

Readback templates receive the Action's original parameters as top-level keys
and the write result under `response`. Thus `{case_id}` and `{response.id}` are
valid while `{parameters.case_id}` is not. If a pinned release declares an
unsupported placeholder, stop before execution and report that release defect;
do not reinterpret the template or call the source system directly.

Re-read context, policy and observations when the source is disconnected, the
principal changes, the release is unavailable, or evidence is older than the
policy window. Keep proposed, pending, denied, executing, uncertain, failed and
verified states distinct. Preserve the Issue, run, release, plan, source steps,
policy evaluation, report, decision and receipt as one trace.

Read [references/semantic-api-source-map.md](references/semantic-api-source-map.md)
for exact fields and [references/operating-example.md](references/operating-example.md)
for a parameterized sequence. Read
[references/semantica-capabilities.md](references/semantica-capabilities.md) for
the supported query, reason, provenance, change, temporal and causal methods.
