# Query, reason, prepare, then verify

For "Which batches are affected by this quality case, and can we contain them?",
first discover the exact release, IDs, parameters and operation contracts.
The names below are example shell variables, not hard-coded business bindings.

```sh
python3 scripts/semantic.py ontologies
python3 scripts/semantic.py releases "$ONTOLOGY_ID"
python3 scripts/semantic.py start --release-id "$RELEASE_ID" --question "Which batches are affected by CASE-001, and can we contain them?"
python3 scripts/semantic.py call POST "/api/semantic/runs/$RUN_ID/context" --body-file context-request.json
python3 scripts/semantic.py call POST "/api/semantic/runs/$RUN_ID/plan" --body-file investigation-plan.json
python3 scripts/semantic.py query "$RUN_ID" --binding-id "$CASE_QUERY_BINDING" --params-file case-query.json
python3 scripts/semantic.py query "$RUN_ID" --binding-id "$BATCH_QUERY_BINDING" --params-file batch-query.json
python3 scripts/semantic.py evaluate "$RUN_ID" --source-step "$CASE_STEP_ID" --source-step "$BATCH_STEP_ID"
python3 scripts/semantic.py call POST "/api/semantic/runs/$RUN_ID/policies" --body-file policy-review.json
python3 scripts/semantic.py call POST "/api/semantic/runs/$RUN_ID/report" --body-file investigation-report.json
python3 scripts/semantic.py prepare "$RUN_ID" --binding-id "$ACTION_BINDING" --params-file containment.json --evaluation-step-id "$POLICY_STEP_ID" --intent-id "$INTENT_ID"
```

`case-query.json` and `batch-query.json` follow the release's declared input
contracts. Do not guess query parameters or convert schema descriptions into
batch quantities. Match the action parameters to the recorded intent when a
rule proposes it, using `--evaluation-step-id` and `--intent-id` when applicable.

`context-request.json` contains the natural question and only optional object
IDs resolved from the current release. `investigation-plan.json` contains
business labels and purposes plus the returned object and binding IDs.
`policy-review.json` contains the selected action, exact parameters and
successful source step IDs. `investigation-report.json` classifies each finding
as fact, inference, recommendation or unknown and cites its evidence step IDs.
Do not copy IDs from this example into another release.

Context, plan, query, evaluation, policy and report POSTs return a durable step
envelope: retain `step_id`, check `status`, and read the business result from
`output`. `GET /plan` returns the latest step with the plan in `output`; default
`GET /report` returns the report in `report` and the visible trace in `run`.
Policy intents are in the policy step's `output.action_intents`. An unknown,
conflicting or denied decision has no usable intent.

If the first natural-language context has no useful match, read the pinned
release's published labels, aliases and source-grounded descriptions, resolve
the supported Entity types, and repeat context with those `entity_ids`. Do not
ask the user to supply internal IDs, and do not describe this exact matching as
vector retrieval.

Present the prepared target batches, change and approval state in Enact.
If prepare resumes an exact draft in the same run, continue its approval or
receipt instead of starting another evaluation. If the matching target belongs
to another run or has different parameters, prepare returns a conflict with the
existing draft; show that draft to the member. Do not add `create_another` or
write a repeat reason on the member's behalf.
After the required human decision, or an already authorized binding's approved
state, execute and inspect the result:

```sh
python3 scripts/semantic.py execute "$APPROVAL_ID" --idempotency-key "$EXISTING_OPERATION_KEY"
python3 scripts/semantic.py receipt "$RECEIPT_ID"
python3 scripts/semantic.py run "$RUN_ID"
```

If the result is uncertain, use `reconcile "$RECEIPT_ID"` to read back source
state. Reuse the existing operation identity; a fresh key can create another
business operation. Keep missing data, unsupported rules and failed actions
visible so the user can complete the next step from the run page.

If the member has already accepted exact text for a case-evidence action, reload
this run and reuse its existing approval before preparing anything. Keep title,
content and other identity parameters byte-for-byte stable. To show the same
investigation in a persistent Site, hand its saved report to
`enact-application-building` and keep the Site pinned to this release; do not
invent a semantic Site endpoint or duplicate the findings as uncited static copy.
