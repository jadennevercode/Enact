# Ontology consumption and execution

## User journey

A normal Chinese Issue starts from a part failure, not a case UUID. The Agent resolves aliases and ambiguity, explains an investigation plan, follows Entity/Relationship paths, retrieves related Action/Policy, reads bound facts, reports discoveries and missing evidence, prepares a concrete action for human review, executes once and independently verifies the result. Follow-up tasks and the Site stay on the same Issue/run.

## Runtime contracts

An Agent has explicit assignments to published releases; installed Skills are instructions, not assignments. Assignments are managed by workspace admins. New runs require active assignments for agents; already-created runs retain immutable release identity and existing delegation semantics. Claim context includes the release catalog and the operating Skill instructions. Hidden/revoked data never leaks through catalog, context, counts or exports.

Context resolution returns task-relevant Entity/Attribute, Relationship paths, Action, Policy and binding references plus ambiguity and gaps. Policies evaluate recorded successful query observations and trusted execution identity. Caller-provided facts cannot replace observations. Unknown operators/fields, conflicting rules or missing evidence do not allow a write. Prepare/execute independently enforce policy and platform authorization.

Plans and reports are durable business records linked to native step IDs. Report HTML is escaped, readable and based on the same immutable record exported as JSON/JSONL. A statement without tool evidence is labelled proposed/unverified. Technical evidence stays in secondary views. Reports describe external execution evidence, never invented model thoughts.

A prepared action displays affected objects, scope, changes, applicable policy and limits. Confirmation and execution are separate. Expected object version and reviewed parameters are bound to the decision. Unknown execution reconciles the same receipt; a new evaluation does not imply a new action. Existing same-goal drafts default to resume; another draft requires explicit choice and a reason.

## Acceptance

A08-A11 and A13 from the parent SPEC. Required cases: Chinese alias and ambiguity, multibatch/multiplant and vehicle stages, disconnected source, stale or conflicting facts, deny/approval/unknown/obligation, no permission, expired release, cross-workspace and cross-Issue isolation, report/trace consistency, rejected action with zero writes, uncertain readback, and duplicate recovery across tasks/evaluations.

## Review continuation and refreshed evidence

A member decision is saved before the Agent is scheduled. Approve and reject both continue the original Issue and investigation; rejection explicitly prohibits execution. The response exposes `coordinator_resume` as queued, coalesced, deferred, failed or not_applicable. Retrying the identical decision and reason by the same decision member retries delivery without creating another decision or comment. A task identity cannot call the member decision endpoint.

Preparation deduplicates within the requesting member and semantic business target. Same investigation and exact parameters resume the existing draft; a different investigation or changed parameters reports the existing draft unless a member explicitly requests another with a reason. Fresh Policy evidence, changed configuration or an expired review creates a new pending review version for the same draft. `supersedes_approval_id` and `superseded_by` retain the chain; original status, decision member, reason and continuation remain available. Neither the UI nor server transfers approval to a newer version.

A receipt means the operation may already have reached the system. Preparation must return that receipt, including executing, failed or unknown outcomes, instead of refreshing it into another dispatch. Old versions can still expose an existing receipt; old versions without a receipt cannot execute after replacement.

Acceptance adds: concurrent refresh creates one new review; a five-minute evidence timeout recovers via a new observation, Policy evaluation and member review; old decisions remain readable; unknown receipts do not create another action; selecting the newer version cannot submit the old confirmation against its ID.
