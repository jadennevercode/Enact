# Gate protocol

A gate is a human checkpoint that a file on disk has to earn. This file is the
whole rule set; skills do not add gate logic of their own.

## The five rules

**1. File as evidence, predicate as verdict.**
Every gate names an evidence path and a predicate in `shared/stage-manifest.yaml`.
The gate closes when `scripts/gate_check.py` evaluates that predicate true.
Verification is a script, never an assessment. "The tree looks complete" is not a
gate closing; `no_undecided_rows` passing is.

**2. Binary verdicts only.**
No row may survive a gate in a middle state. `proposed`, `pending`, `review`,
`unsure` — each must become `accepted` or `rejected` before the gate closes.
A review whose undecided rows are silently kept is not a review.

**3. A human verdict pins the row.**
Re-running a mode recomputes its recommendation and shows it, but never
overwrites a row whose `decidedBy: human`. Overwriting on refresh silently
reverts the reviewer, and nothing in the artifact records that it happened.

This one is a **convention, not a check**. Nothing compares a row's status across
runs, because the flow has a legitimate reason to change a human verdict —
`apply-proposals` does exactly that when an interview overturns an earlier
decision. What is checkable is *visibility*: `decide` records a hash of the
evidence, and a full `gate_check.py <engagement>` prints a note for every gate
whose evidence changed after its verdict. Read those notes; they are the only
signal that a pinned row moved.

**4. Signed-off work freezes.**
Once a gate is signed off, the artifacts it ruled on are read-only to the suite
*except* through a later gate that is designed to change them — `1.4d` amends the
tree `d-1.21` ruled on, and that is the flow working. Anything else requires an
explicit reopen: `state.py reopen <gate>` appends a `reopen` line, sets the
affected tasks back to `pending`, and the flow is re-run forward.

Also a convention rather than a check, for the same reason: nothing can tell a
sanctioned edit from an unsanctioned one by looking at the file. The evidence-hash
notes are what make an unsanctioned one visible.

**5. Every verdict is logged.**
Append to `decisions.log` **before** running the gate check, because approval and
sign-off gates carry a `signed_off:` predicate that fails until the line exists.
The log is the audit trail; the state file is an index into it.

Only these words close a gate: **`approve`**, **`signoff`**, **`accept`**.
`rework`, `reject` and `reopen` record a decision without closing anything.
`state.py decide` refuses any other word and any gate id the manifest does not
carry — the log is append-only, so a typo would otherwise be permanent, and it
would surface later as the false message "no standing verdict".

## Presenting a gate to the user

Show, in this order:

1. **What is being decided** — the gate question from the manifest.
2. **The evidence** — the artifact path, and a summary the user can act on
   (counts by status, the rows that changed, what is new since last time).
3. **What is undecided** — every row still in a middle state, listed
   individually. This is the gate's real content: rule 2 means the user must
   resolve all of them.
4. **What follows** — which task unblocks, and what becomes frozen (rule 4).

Then ask for the verdict. Do not recommend "approve" as a default when
undecided rows remain; resolve those first.

## Gate kinds

| Kind | Meaning | Closes when |
|---|---|---|
| `intake` | the human owes input | the declared files exist and parse |
| `approval` | the human confirms AI output | predicate passes **and** the user says approve |
| `signoff` | the client confirms externally | predicate passes **and** a signoff line is logged |

`intake` gates never auto-satisfy from a fallback source. If the SOW was not
uploaded, the profile is not produced from something else that happened to be
lying around — the deliverable simply is not produced yet. Substituting a
convenient input for the missing one is how a project ends up modeling another
client's business.

**When an input genuinely does not exist** — no competitor research was ever
commissioned, the client will not grant interviews — the escape is to say so, not
to fake a file. Put a single `NONE.md` in the intake category stating who
confirmed it and why, and the gate passes on that. `orchestrator status` surfaces
it as a problem for the rest of the engagement, which is the correct outcome: the
work continues and the gap stays visible.

## Rework

Every `approval` gate has a rework path: the user rejects, the owning task goes
back to `pending`, and the mode re-runs with the user's reason recorded in
`decisions.log`. Rework is normal; a gate that has never been sent back is
usually a gate nobody read.
