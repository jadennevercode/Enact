---
name: enact-skill-importing
description: "Use when asked to import or install a specific skill into this Enact workspace from a URL or slug. Not for choosing which skill the user needs; never treat a local installer such as `npx skills add` as the final install."
user-invocable: false
allowed-tools: Bash(enact *)
---

# Importing skills into Enact

Use this skill when the user already provided a skill URL, slug, or a clear intent
to import a specific skill into the current Enact workspace.

Do not use this skill to decide which skill the user needs. If the user only
describes a capability and no URL is known, external search may produce candidate
URLs, but this import skill starts only once a URL or concrete import target is
known.

Every claim below is traced to source in
`references/skill-importing-source-map.md`. When in doubt, read that file.

## The invariant

A skill is installed for Enact only when it exists in the current workspace's
skill database. Two supported paths put it there.

The first is the workspace import endpoint, for a skill that lives outside
Enact. It accepts either a hosted URL or an uploaded local archive
(`.skill` / `.zip`), driven by this CLI:

```bash
enact skill import --url <url> --output json              # hosted source
enact skill import --file <path-to.skill> --output json   # local archive
```

The CLI defaults to `--on-conflict fail`. A URL import sends:

```text
POST /api/skills/import
Content-Type: application/json
body: { "url": "<url>", "on_conflict": "fail" }
```

A `--file` import hits the same route as `multipart/form-data` with a `file`
part (the `.skill` / `.zip` bytes) and an `on_conflict` field. `--url` and
`--file` are mutually exclusive; exactly one is required.

The second is the Marketplace, for a skill another workspace in this deployment
has already published. See "Installing from the Marketplace" below; it is a
different endpoint with a different conflict envelope, and a Marketplace listing
id is not a URL the import endpoint accepts.

Do not finish with `npx skills add`. That installs into an external/local skill
environment, not the Enact workspace DB, so Enact cannot manage or bind it.

## Supported URL source families

`detectImportSource` accepts these hosts (and `www.` variants). Pass any of these
forms to `enact skill import --url <url> --output json`:

```bash
enact skill import --url clawhub.ai/owner/skill --output json
enact skill import --url skills.sh/owner/repo/skill --output json
enact skill import --url github.com/owner/repo --output json
enact skill import --url github.com/owner/repo/tree/main/path/to/skill --output json
enact skill import --url github.com/owner/repo/blob/main/path/to/SKILL.md --output json
```

- `clawhub.ai`, `skills.sh`, `github.com` are the recognized hosts.
- A GitHub URL may be a bare `owner/repo`, a `/tree/{ref}/...` directory, or a
  `/blob/{ref}/.../SKILL.md` file.
- A bare ClawHub slug (no host) is accepted and routed to ClawHub.
- Any other host is rejected with a 400 naming the supported sources.

## Local archive import (`.skill` / `.zip`)

`enact skill import --file <path> --output json` imports a skill from a local
archive instead of a hosted URL. A `.skill` file is a standard zip — the format
Anthropic's skill-creator `package_skill` produces — and a plain `.zip` of a
skill folder works too. The server:

- accepts the upload as `multipart/form-data` (a `file` part plus an optional
  `on_conflict` field) on the same `POST /api/skills/import` route;
- decompresses it and roots on the shallowest `SKILL.md`, so both a root-level
  `SKILL.md` and the nested `my-skill/SKILL.md` wrapper layout are accepted;
- takes the name/description from `SKILL.md` frontmatter, falling back to the
  wrapper directory name and then the uploaded filename;
- carries the supporting files — dropping any `SKILL.md`, dotfiles, `__MACOSX`,
  license files, and binary assets — under the same per-file (1 MiB),
  per-bundle (8 MiB), and file-count (256) caps as URL imports, and rejects path
  traversal (zip-slip);
- returns the same structured result envelope and honors the same
  `--on-conflict` strategies as URL imports.

The upload itself is capped at 16 MiB (compressed). Any source that is not a
local archive still goes through `--url`.

## Direct URL flow

1. When the request contains a concrete URL, the import endpoint can be called
directly; search is not required by the API:

```bash
enact skill import --url <url> --output json
```

2. Treat the response as the source of truth. Current CLI imports use the
structured import result envelope:

```json
{
  "status": "created|updated|conflict|skipped|failed",
  "reason": "...",
  "skill": { "...": "SkillWithFilesResponse when created/updated" },
  "existing_skill": { "id": "...", "name": "...", "can_overwrite": true }
}
```

For `created` / `updated`, `skill` is a workspace `SkillWithFilesResponse`: it
embeds the standard `SkillResponse` and adds the supporting `files` array. Report
the relevant fields:

- `status` and `reason` when present.
- `skill.id` / `skill.name` / `skill.description`.
- `skill.config.origin` (provenance: which source the skill was imported from —
  set only when the source supplied an origin, so treat it as possibly absent).
- `skill.files` / files count.
- `skill.created_at` / `skill.updated_at`.
- `existing_skill.id` / `existing_skill.name` when status is `conflict`,
  `skipped`, or `failed` due to an existing skill.

Because the response is structured, read these returned fields instead of guessing
whether the import succeeded.

3. Agent-skill binding is a separate mutable operation. `add` preserves existing
assignments and appends the new id:

```bash
enact agent skills add <agent-id> --skill-ids <skill-id> --output json
enact agent skills list <agent-id> --output json
```

After the final `enact agent skills list <agent-id> --output json`, verify the
target skill id is present before claiming the skill is available to that agent.

## Additive add vs replace-all set

`enact agent skills add` is additive: the server inserts the assignments without
clearing existing ones (`AddAgentSkills`).

`enact agent skills set` is replace-all: the server clears every current
assignment, then re-adds exactly the ids you pass (`SetAgentSkills`).
`set` is the replacement path. Passing only one id to `set` leaves the agent with
only that one skill and drops every previous assignment.

## Reserved SKILL.md supporting file

A skill's primary content is its `SKILL.md`. That filename is reserved: the daemon
writes the primary content to `SKILL.md` itself when preparing the execution
environment, so a *supporting* file may not also be named `SKILL.md`
(`IsReservedContentPath`; the check cleans the path and is case-insensitive, so
`./SKILL.md` and `sub/../SKILL.md` are caught too).

Practical effect when importing or creating a skill: if the manifest lists a
supporting file named `SKILL.md`, the server silently drops it — the import still
succeeds, but that entry will be absent from the returned `files`. So if a
supporting file you expected is missing, check whether it was named `SKILL.md`;
rename it to a non-reserved path. (The hard `400` rejection — "SKILL.md is reserved
for the primary skill content" — only fires on the dedicated single-file endpoint
`PUT /api/skills/{id}/files`, not on import.)

## Installing from the Marketplace

The Marketplace holds capability published by workspaces in this deployment:
skills, agent templates, and MCP server entries. Installing one copies it into
the current workspace, where it becomes an ordinary skill that can be edited and
bound like any other.

```bash
enact marketplace list --kind skill --output json
enact marketplace get <listing-id> --output json
enact marketplace install <listing-id> --output json
```

Four things to know before reporting a Marketplace install:

- **A listing id is not a URL.** `enact skill import --url` rejects it; the
  install route is `POST /api/marketplace/listings/{id}/install`.
- **An install is a copy, not a subscription.** A later version of the listing
  changes nothing until someone installs it. `enact marketplace list` reports
  `installed_version` next to `latest_version`, which is how you tell whether an
  update exists. Do not describe an installed skill as "synced".
- **`--on-conflict` means the same four things it does for import** and is
  resolved the same way, so the same reasoning applies to both paths.
- **A skill installed this way is not refreshable.** Its `config.origin.type` is
  `marketplace`, which `POST /api/skills/{id}/refresh` deliberately refuses: an
  update is an install of a chosen version, not a re-fetch of whatever a URL
  serves today. Install the newer version instead.

`enact marketplace install` returns the same envelope shape as skill import,
plus `entity_kind` and `entity_id` naming what was created:

```json
{
  "status": "created|updated|conflict|skipped|failed",
  "reason": "...",
  "entity_kind": "skill|agent|mcp",
  "entity_id": "...",
  "skill": { "...": "SkillWithFilesResponse for an installed skill" },
  "existing_skill": { "id": "...", "name": "...", "can_overwrite": true }
}
```

Two flags exist for the non-skill kinds and are not needed for a skill:
`--runtime-id` is required to install an agent template, because a template
names no machine; `--secret path=value` supplies a value the publisher withheld,
whose paths the listing's manifest lists under `required_secrets`. Read the
manifest with `enact marketplace get` before installing one of those.

There is no `enact marketplace publish`. Publishing is an admin decision about
what leaves the workspace, and the server refuses it for agent actors.

## Same-name conflicts: `--on-conflict`

Default behavior is safe: `enact skill import --url <url>` is equivalent to
`--on-conflict fail`. If the imported skill name already exists, the command
prints a structured `conflict` result and exits non-zero; no skill is created or
updated.

Choose an explicit strategy only when the user asked for it or the intent is
clear:

- `--on-conflict fail` (default): do nothing on conflict; report `status:
  conflict` with a reason that suggests overwrite or rename.
- `--on-conflict overwrite`: update the existing same-name skill in place, but
  only if the current user is the skill's original creator. This preserves the
  skill ID, `created_by`, `created_at`, and agent-skill bindings; it replaces
  description, content, provenance config, and supporting files. Non-creators get
  `status: failed`.
- `--on-conflict rename`: create a new skill with an automatic suffix such as
  `-2` / `-3`; the existing skill is untouched.
- `--on-conflict skip`: leave the existing skill untouched and report `status:
  skipped`.

Concrete examples:

```bash
# Safe default. Fails with status=conflict if review-helper already exists.
enact skill import --url https://skills.sh/acme/repo/review-helper --output json

# Replace the existing same-name skill, preserving its ID and agent bindings.
enact skill import --url https://skills.sh/acme/repo/review-helper --on-conflict overwrite --output json

# Keep the existing skill and import a copy such as review-helper-2.
enact skill import --url https://skills.sh/acme/repo/review-helper --on-conflict rename --output json

# Batch-friendly behavior: leave the existing skill alone and mark it skipped.
enact skill import --url https://skills.sh/acme/repo/review-helper --on-conflict skip --output json
```

Legacy compatibility: clients that do not send `on_conflict` keep the old
contract. A duplicate import returns `409` and the body carries the existing
workspace skill identity:

```json
{
  "error": "a skill with this name already exists",
  "existing_skill": {
    "id": "<skill-id>",
    "name": "<skill-name>"
  }
}
```

Current CLI normalizes that legacy shape into `status: conflict` and exits
non-zero for the default `fail` strategy. Treat `existing_skill.id` and
`existing_skill.name` as the source of truth, then fetch details if needed:

```bash
enact skill get <skill-id> --output json
```

Older servers may return a `409` whose body is only a string like `a skill with
this name already exists`, with no `existing_skill` key. Recover by finding the
existing workspace skill yourself:

```bash
enact skill list --output json
enact skill get <skill-id> --output json
```

Then report that the skill already exists and include its `id` / `name`. Do not
retry in a loop, and do not create a second skill under a different name just to
dodge the conflict.

## Updating an already-imported skill: `enact skill refresh`

When the goal is to pull the latest version of a skill that is already in the
workspace, prefer `refresh` over re-typing the import URL:

```bash
enact skill refresh <skill-id> --output json
```

It sends `POST /api/skills/{id}/refresh` (empty body). The server re-downloads
the bundle from the provenance stored in the skill's `config.origin`
(`github`, `skills_sh`, or `clawhub` with its `source_url`) and overwrites the
skill in place:

- Preserved: skill ID, `created_by`, `created_at`, agent-skill bindings, and
  labels — agents keep the skill without re-adding it.
- Replaced: name (an upstream rename is adopted), description, `SKILL.md`
  content, provenance config, and the full supporting-file set.
- Permission: the skill's creator or a workspace `owner`/`admin` — broader than
  `import --on-conflict overwrite`, which stays creator-only.

The success response is the plain `SkillWithFilesResponse` (same shape as
`enact skill get`), not the import result envelope. Failure modes to report
instead of retrying in a loop:

- `422`: the skill has no refreshable provenance (created manually, imported
  from a local archive, or copied from a local runtime). Re-import instead.
- `409`: the upstream renamed the skill and another workspace skill already
  uses that name; nothing was changed.
- `403`: caller is neither the creator nor a workspace admin.
- `502` / `503` / `504` / `413`: upstream fetch failed (gone, unavailable,
  timed out, or now exceeds import caps); the skill is left untouched.

## Incorrect → correct

Incorrect (bypasses Enact):

```bash
npx skills add https://skills.sh/owner/repo/skill
```

The skill may exist locally, but Enact cannot manage it as a workspace skill.

Incorrect agent binding for a normal add (replaces every existing assignment):

Using `set` with only the new skill id wipes the agent's other skills. For an add,
use `add`.

Correct import:

```bash
enact skill import --url https://skills.sh/owner/repo/skill --output json
```

Agent binding after import, when the caller intentionally wants to mutate that
agent's skill assignments:

```bash
enact agent skills add <agent-id> --skill-ids <skill-id> --output json
enact agent skills list <agent-id> --output json
```

## References

- `references/skill-importing-source-map.md` — every behavior above mapped to
  `file:line` in `server/`, plus the verification command to re-derive the lines.
