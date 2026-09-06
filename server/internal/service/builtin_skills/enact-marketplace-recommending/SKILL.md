---
name: enact-marketplace-recommending
description: "Use when advising a workspace on what to install from the Marketplace: the setup checklist's capability step, a member asking what to add, or judging whether a listing fits this project and what to change after installing it."
user-invocable: false
allowed-tools: Bash(enact *)
---

# Advise on what to install

The server already ranks the directory against this workspace's project
profile. Your job is not to rank it again — it is to judge the ranking, say
which of it is worth the member's attention, and say what has to change after
an install to make the copy fit this project.

## The ranking is not the recommendation

```bash
enact marketplace recommend --output json
```

Every result carries `matched` and `reasons`. Read both before you repeat
anything to anyone:

- `matched: true` means at least one reason came from this workspace's own
  profile, and each such reason names the value that matched and the field it
  matched in. "Matched your stack: go, in the listing's tags" is checkable.
- `matched: false` means the result is not about this workspace at all. It
  surfaced because it is official, featured, or widely installed. Say so.
  Presenting it as a fit is the one failure this whole surface exists to avoid.
- `profile_empty: true` means there was nothing to rank against. Do not
  recommend. Establish the profile first — the `enact-workspace-profile` skill
  is how — and come back.

A high score is not an argument. Read what the listing actually says before you
endorse it:

```bash
enact marketplace get <listing-id> --output json
```

That returns the manifest: for a skill the SKILL.md body, for an agent template
its instructions, model and the skills it carries, for an Agent Family every
member agent in full. Recommend from what you read there, not from the score.

## Say no out loud

A ranking of six where two fit is a better answer than six endorsements. For
each one you are not recommending, one clause is enough: it matched on a tag
but the skill is about a workflow this team does not have.

The member can act on that:

```bash
# Not this one. Scoped to the version they were shown — a new version comes back.
enact marketplace list --kind skill --output json    # to find the id again
```

Dismissal is a member's action in the app, not yours. Point at it; do not
perform it on their behalf.

## What installing actually does

An install is a **copy**, not a subscription. A later version of the listing
changes nothing in this workspace until someone installs it again. Never
describe an installed thing as synced.

By kind:

- **skill** — one skill in this workspace, editable like any other.
- **mcp** — one entry in the workspace MCP library, bound to no agent. Adding
  it to an agent is a separate step. Installing one is admin-only.
- **agent** — the agent, the skills it carries, and the MCP servers it expects,
  in one transaction. Needs `--runtime-id`.
- **squad** (an Agent Family) — every member agent, each one's skills and MCP
  servers, and the family that binds them, in one transaction. Needs
  `--runtime-id`. See `enact-squads` for the rest.

## Read the prerequisites before recommending, not after

A listing may declare `prerequisites`: things that must be true on the
installing side before the copy works — host tooling, a plugin, a directory
layout. Nothing checks them, because the condition is on a machine the server
cannot see.

An Agent Family whose skills shell out to an engine installed on the
publisher's host arrives describing commands this machine does not have. If a
listing declares prerequisites, name them in your recommendation and say who
has to do them, before the member installs anything.

## Say what to change after installing

This is the half a directory cannot give them, and it is most of the value of
asking you rather than browsing. For each thing you recommend, say what will
not fit as published:

- **Instructions** written for the publisher's conventions. Name the sentences
  that contradict this workspace's `constraints` or its stack.
- **The repository binding.** A template names no repository; an installed
  agent needs this workspace's resources to be useful.
- **The model and effort level.** A template written for another provider
  arrives with fields this runtime does not support left unset.
- **Visibility.** Every installed agent starts private to whoever installed it,
  because the template's own permission targets named another workspace's
  members. A family whose leader is private still routes work for its owner,
  but nobody else in this workspace can `@` it. Say which members should be
  reachable and that changing it is a separate step.
- **The runtime, for a family.** One runtime binds every member on install.
  Splitting them across machines afterwards is `enact agent update`, and worth
  mentioning only when the members do genuinely different work.

## Preview and confirm before installing anything

Installing creates durable workspace objects, and an Agent Family creates
several at once. Show what it will create, what it will be named, and what you
intend to change afterwards. Then ask one confirmation question.

On a clear yes:

```bash
enact marketplace install <listing-id> --runtime-id <runtime-id> --output json
```

Names already taken in this workspace are suffixed rather than replaced, for
the agent, its skills and its MCP servers. Nothing existing is overwritten.

The install is all-or-nothing. If it fails, nothing was created — do not tell
the member to clean up half a family, and do not re-run hoping for a partial
result.

## Then close the loop

Installing or dismissing closes the setup checklist's capability step by
itself; do not also close the issue.

Report what now exists, by name, and what you changed on it. Offer one next
action: give an agent the visibility its team needs, or put the first real
piece of work through it. Do not promise to follow up — your turn ends when
this reply is sent.
