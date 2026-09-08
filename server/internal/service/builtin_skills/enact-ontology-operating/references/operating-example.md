# Query, reason, prepare, then verify

For "Which batches are affected by this quality case, and can we contain them?",
first discover the exact release, IDs, parameters and operation contracts.
The names below are example shell variables, not hard-coded business bindings.

```sh
python3 scripts/semantic.py ontologies
python3 scripts/semantic.py releases "$ONTOLOGY_ID"
python3 scripts/semantic.py start --release-id "$RELEASE_ID" --question "Which batches are affected by CASE-001, and can we contain them?"
python3 scripts/semantic.py query "$RUN_ID" --binding-id "$CASE_QUERY_BINDING" --params-file case-query.json
python3 scripts/semantic.py query "$RUN_ID" --binding-id "$BATCH_QUERY_BINDING" --params-file batch-query.json
python3 scripts/semantic.py evaluate "$RUN_ID" --source-step "$CASE_STEP_ID" --source-step "$BATCH_STEP_ID"
python3 scripts/semantic.py prepare "$RUN_ID" --binding-id "$ACTION_BINDING" --params-file containment.json
```

`case-query.json` and `batch-query.json` follow the release's declared input
contracts. Do not guess query parameters or convert schema descriptions into
batch quantities. Match the action parameters to the recorded intent when a
rule proposes it, using `--evaluation-step-id` and `--intent-id` when applicable.

Present the prepared target batches, change and approval state in Enact.
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
