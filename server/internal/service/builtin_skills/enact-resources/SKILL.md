---
name: enact-resources
description: "Use when creating, inspecting, updating, or debugging Enact workspace resources (github_repo, local_directory), or when listing the workspace's artifacts."
user-invocable: false
allowed-tools: Bash(enact *)
---

# Enact Resources

## Quick start

Resources are durable workspace context. A resource attached to the workspace
affects every future agent task in it.

```bash
enact resource list --output json
```

Resources are mutated through the `enact resource` commands / the
`/api/resources` endpoints. Issue comments do not create durable resources.

## Core model

A resource is not display metadata; it is context later injected into task
briefs and written to `.enact/project/resources.json` in the agent's working
directory. (The on-disk path keeps its historical `project` segment — installed
agents already read it there.)

Resources live on the workspace, not on any smaller container. There is one
list per workspace, and every task in that workspace sees all of it.

Resource types:

- `github_repo` — durable GitHub repo context, with `resource_ref.url`, optional
  checkout `ref`, and optional prompt-only `default_branch_hint`;
- `local_directory` — daemon-local path context, with `resource_ref.local_path`,
  `daemon_id`, optional label, and optional `execution_mode` (`in_place`, the
  default, or `worktree`).

## CLI

```bash
enact resource list --output json
enact resource add --type github_repo --url <github-url> --output json
enact resource add --type github_repo --url <github-url> --ref <branch-or-sha> --output json
enact resource add --type local_directory --local-path <abs-path> --daemon-id <daemon-id> --output json
enact resource add --type local_directory --local-path <abs-path> --daemon-id <daemon-id> --execution-mode worktree --output json
enact resource update <resource-id> --execution-mode in_place --output json
enact resource update <resource-id> --url <new-github-url> --output json
enact resource update <resource-id> --ref <branch-or-sha> --output json
enact resource remove <resource-id> --output json
```

`--execution-mode` decides how tasks share a `local_directory`. `in_place`
(default) runs the agent in the user's directory, one task at a time; a second
task waits in `waiting_local_directory`. `worktree` gives each task its own git
worktree of that repo, so tasks run concurrently and each delivers its work as
an `agent/<agent>/<task>` branch in the user's repo instead of editing the
working copy. `worktree` requires the path to be a git repository with at least
one commit; tasks fail with an explicit error otherwise. The gate is the
`local-worktree-v1` capability the daemon advertises — not its version string —
and it is checked twice: at save time, and again against the daemon that claims
each task, so a machine whose runtime cannot do worktrees gets its tasks
cancelled rather than run in place. Saving `worktree` is also refused (HTTP 422,
code `daemon_version_unsupported`) while the daemon on that machine does not
advertise the capability — the fix is updating the Enact app there, then
retrying. Pass an empty value to clear it back to the default.

One workspace holds at most one `local_directory` resource per daemon. Adding a
second is refused with HTTP 409; remove the existing one first.

For `github_repo`, a non-JSON `--ref` sets `resource_ref.ref`, the default
checkout branch/tag/SHA for future tasks. A JSON `--ref '<json>'` remains the
escape hatch for full payloads or resource types not covered by the shortcuts.

## When to add a resource

Add or update a resource when the user asks for durable workspace context: "把
这个 GitHub repo 绑到 workspace 上", "以后都用这个 repo", "agent 总是拿不到这
个仓库", or "这个 workspace 要在我的本地目录里跑".

Resources are durable and affect future tasks. `enact repo checkout` is
task-local checkout state; it does not change the resource list.

## Artifacts

`GET /api/artifacts` lists every file the workspace produced — issue
attachments and chat uploads alike — newest first, as one flat list. The client
derives folders and version grouping from the owner issue and the filename.

Each row carries `owner_issue_id` / `owner_issue_number` /
`owner_issue_identifier` / `owner_issue_title` when the file came from an issue.
A file uploaded in chat has no owning issue, so those four fields are absent and
the client files it under an unfiled group. `?limit=` caps the listing (default
500, max 2000); the response's `truncated` flag says the cap was hit and the
listing is a prefix of the truth.

## Debugging wrong context

1. `enact resource list --output json`.
2. Check `github_repo.resource_ref.url`, optional `ref`, `default_branch_hint`,
   and `local_directory.resource_ref.daemon_id`.
3. Updating a resource is a durable mutation. After an update, listing the
   resources is the verification path.
4. If the resources match the expected task context, inspect the runtime / repo
   checkout path next.

## Side effects

`resource add` / `update` / `remove` mutate durable workspace state and affect
future tasks. Ask before changing a `local_directory` unless the user explicitly
requested that exact local path.

More source-backed details: `references/resources-source-map.md`.
