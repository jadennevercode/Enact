# Team roles

A **team role** (中文：角色) says what kind of judgement a person gives —
business owner, architect, QA, ops. A **permission** (中文：权限) says what they
may do: `owner` / `admin` / `member`. The two are separate concepts with
separate storage, and the Chinese UI keeps separate words for them; see
`apps/docs/content/docs/developers/conventions.mdx` for the glossary.

Holding a role grants no access. Roles exist so work can be routed to the right
reviewer.

## Where each piece lives

| Piece | Location |
| --- | --- |
| Catalog (define, rename, recolor, reorder, archive) | Settings › Roles, `packages/views/settings/components/team-roles-tab.tsx` |
| Assignment (who holds what) | Members page row menu, `packages/views/members/components/members-roster.tsx` |
| Storage | `team_role`, `member_team_role` (migrations 566-575) |
| API | `/api/team-roles*`, `PUT /api/workspaces/{id}/members/{memberId}/team-roles`, `server/internal/handler/team_role.go` |
| Client cache | `packages/core/team-roles/` |

Editing the catalog and assigning roles are owner/admin actions. Reading is open
to every member, because every roster renders roles.

## Rules worth knowing before changing this

- **Keys are immutable.** `team_role.key` is what the CLI filter and the
  AI-SDLC config reference. Renaming a role changes its display name only.
- **Archiving keeps holders.** A retired role leaves the picker and matches
  nobody in routing, but the assignment survives so restoring the role restores
  who held it. A save from the picker carries only active roles, so it never
  drops an archived assignment.
- **Assignments die with the membership.** `revokeAndRemoveMember` deletes them
  in the same transaction, so a re-invited person starts with no roles.
- **Member payloads denormalize role name and color.** Anything that renames a
  role must refresh the member list too — `team_role:changed` invalidates both.

## Routing a review

The roster is the lookup:

```sh
enact workspace team-role list --output json          # roles and who holds them
enact workspace member list --team-role qa --output json
```

An archived role matches nobody, and a role with no holders returns an empty
list rather than being omitted — "nobody is responsible for this kind of review"
is an answer, and it is the one that explains why a gate cannot be signed.

## AI-SDLC

The built-in suite maps each phase to the roles that review it, in
`.sdlc/config.yaml` under `phase_review`, and resolves the people from this
catalog through the CLI (`sdlc-core/scripts/_common.py`, `role_holders`). The
suite's five roles are created by the **Import AI-SDLC roles** button, whose
keys are the contract between the two sides:

`business_owner` · `architect` · `developer` · `qa` · `ops`

`TestAISDLCPresetMatchesSuiteRoleKeys` fails if either side renames one without
the other. `.sdlc/config.yaml` no longer carries a `roles:` block; a project may
also route a phase to any role key its workspace defines.

When the CLI cannot be reached, the scripts report every role as unstaffed
rather than assuming it is covered — an unsigned gate is the safe failure.

## Tests

| What | Where |
| --- | --- |
| API, permissions, set semantics, cleanup | `server/internal/handler/team_role_test.go` |
| Preset ↔ suite key contract, preset localization | `server/internal/handler/team_role_preset_contract_test.go` |
| CLI filter and columns | `server/cmd/enact/cmd_workspace_team_role_test.go` |
| Role resolution in the suite's scripts | `server/internal/service/testdata/sdlc/test_common.py`, run by `TestSDLCRoleScripts` |
| Catalog UI | `packages/views/settings/components/team-roles-tab.test.tsx` |
| Roster chips and the picker | `packages/views/members/components/members-page.test.tsx` |
| Schema drift | `packages/core/api/schemas.test.ts` |
| End to end | `e2e/team-roles.spec.ts` |
