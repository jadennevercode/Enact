---
name: enact-resources
description: "Use when creating, inspecting, updating, or debugging Enact workspace resources (github_repo, local_directory, knowledge_repo)."
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
  default, or `worktree`);
- `knowledge_repo` — a git repository of documents agents READ as context, with
  `resource_ref.url`, optional `ref`, optional in-repo `path`, and optional
  `delivery` (`pull_request`, the default, or `commit`).

`knowledge_repo` is the one resource type that is NOT workspace-wide. It
reaches a run only through the agent that claimed it, so attaching one to the
workspace does nothing on its own — bind it to an agent with
`enact agent knowledge add`. Everything else in this skill applies to the whole
workspace.

## CLI

```bash
enact resource list --output json
enact resource add --type github_repo --url <github-url> --output json
enact resource add --type github_repo --url <github-url> --ref <branch-or-sha> --output json
enact resource add --type local_directory --local-path <abs-path> --daemon-id <daemon-id> --output json
enact resource add --type local_directory --local-path <abs-path> --daemon-id <daemon-id> --execution-mode worktree --output json
enact resource add --type knowledge_repo --url <git-url> --output json
enact resource add --type knowledge_repo --url <git-url> --path docs/knowledge --ref main --delivery commit --output json
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

For `knowledge_repo`, `--path` narrows the repository to the subdirectory the
documents live in, so a knowledge base can share a repo with other content
without the runtime checking out and indexing all of it. It must be relative
and must not contain `..`. `--delivery` decides what an agent is told to do
with a document it writes: `pull_request` (default) leaves merging to a person,
`commit` pushes straight to the ref. Pass an empty value to either to clear it.

Binding a knowledge base to an agent:

```bash
enact agent knowledge list <agent-id> --output json
enact agent knowledge add <agent-id> --resource-id <resource-id> --output json
enact agent knowledge remove <agent-id> <resource-id> --output json
```

Removing the binding leaves the resource on the workspace; removing the
resource clears every agent's binding to it.

For `github_repo`, a non-JSON `--ref` sets `resource_ref.ref`, the default
checkout branch/tag/SHA for future tasks. A JSON `--ref '<json>'` remains the
escape hatch for full payloads or resource types not covered by the shortcuts.

## When to add a resource

Add or update a resource when the user asks for durable workspace context: "把
这个 GitHub repo 绑到 workspace 上", "以后都用这个 repo", "agent 总是拿不到这
个仓库", or "这个 workspace 要在我的本地目录里跑".

Add a `knowledge_repo` — and bind it — when the ask is about what an agent
should KNOW rather than what it should work on: "把这个知识库给 agent 用", "让
它读我们的领域文档", "agent 不知道我们的业务背景". Adding the resource without
binding it to an agent is the common mistake; the resource alone changes
nothing.

Resources are durable and affect future tasks. `enact repo checkout` is
task-local checkout state; it does not change the resource list.

## Debugging wrong context

1. `enact resource list --output json`.
2. Check `github_repo.resource_ref.url`, optional `ref`, `default_branch_hint`,
   and `local_directory.resource_ref.daemon_id`.
2b. For a knowledge base the agent cannot see, check the BINDING first
   (`enact agent knowledge list <agent-id>`), not the resource: an unbound
   knowledge base is invisible to every agent by design.
3. Updating a resource is a durable mutation. After an update, listing the
   resources is the verification path.
4. If the resources match the expected task context, inspect the runtime / repo
   checkout path next.

## Side effects

`resource add` / `update` / `remove` mutate durable workspace state and affect
future tasks. Ask before changing a `local_directory` unless the user explicitly
requested that exact local path.

More source-backed details: `references/resources-source-map.md`.

## Operational connections

For a request to connect a database, a REST system or MCP tools for ontology-backed business work, use `enact-ontology-operating` and `/api/semantic/connections`. These are available from Resources → Connections. They store encrypted, scoped credentials and are bound to published ontology operations; they are not `knowledge_repo` or filesystem resources. Ordinary connection listings never expose credentials. A server-reachable endpoint and configured network allowlist are required.

For a durable business application using those operations, use `enact-application-building` and the workspace Applications page. Preserve its pinned ontology release and source/build versions.
