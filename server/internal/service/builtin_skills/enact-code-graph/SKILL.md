---
name: enact-code-graph
description: "Use when locating code in a checked-out repository — which subsystem owns a behaviour, what calls or depends on a symbol, how two parts connect. Not for editing code or for knowledge-base documents."
user-invocable: false
allowed-tools: Bash(enact *)
---

# Enact Code Graph

## Quick start

After checking a repository out, ask whether it has a graph before you start
reading files:

```bash
enact graph status
```

`ready` means there is a structure map of this repository you can query.
Anything else means work the way you normally would.

## What the graph is

A deterministic parse of the repository: files, classes and functions as
nodes; `contains`, `imports`, `inherits` and `calls` as edges; nodes grouped
into subsystems by connection density, each named after its most connected
member. It is built on the server from the repository's own source — no model
reads your code to produce it, and it costs no tokens to query.

It is a map, not the territory. Use it to decide WHERE to read, then read the
files. Never answer a question about behaviour from the graph alone.

## The commands

```bash
enact graph status                        # is there a graph, and at which commit
enact graph report                        # subsystems, key hubs, surprising links
enact graph communities                   # the subsystem list alone
enact graph query "how does login work"   # the part of the graph that matches
enact graph explain "TaskService"         # everything touching one symbol
enact graph path "Handler" "TaskQueue"    # how two symbols connect
enact graph affected "parseUUID"          # what depends on a symbol
```

Add `--repo <url>` when the working directory is not the repository you mean;
otherwise the `origin` remote is used. `query` takes `--dfs` to follow one
chain deeply instead of the neighbourhood, and `--depth` / `--budget` to widen
or narrow the answer.

## The order that works

1. `enact graph status`. Not `ready` → skip the rest of this skill.
2. `enact graph report` to learn the subsystems and the hub files. This is
   the cheapest orientation available for an unfamiliar repository.
3. `enact graph query "<the task in your own words>"` to get the candidate
   region, or `explain` / `path` / `affected` when you already have a symbol.
4. THEN open the files it named and read them. Grep from there.

Going straight to grep on a large repository is the failure this skill exists
to prevent; so is reading the graph and reporting from it without opening a
file.

## Reading the answers

Nodes carry `source_file:line` — go there. Edges carry a confidence:

- `EXTRACTED` — the relationship is written in the source (an import, a
  direct call).
- `INFERRED` — a resolver matched a name. `calls` edges are mostly these, and
  cross-file call resolution is strongest in Python and weaker in Go and
  TypeScript. Treat an INFERRED edge as a lead to verify in the file.
- `AMBIGUOUS` — uncertain; verify before relying on it.

**"Not in the graph" never means "not in the code."** A missing call edge is
the resolver's limit, not evidence. Say "I did not find it in the graph" and
grep, never "this function has no callers" on the graph's word alone.

## States other than ready

| status says | what it means | what you do |
| --- | --- | --- |
| `not enabled` | the workspace did not switch a graph on for this repo | work as usual; do not ask for one mid-task |
| `queued` / `building` | first build has not finished | work as usual — **never wait or poll for it** |
| `ready … (stale)` | the graph is a few commits behind | use it; re-check exact line numbers in the file |
| `skipped` | the repository is past a build limit (e.g. too many files) | work as usual; report the reason if asked |
| `failed` | the last build errored | work as usual; the reason is in `status` |

The command exits 2 for every one of these. That is an answer, not an error to
retry or work around.

## Boundaries

This skill is read-only and about code structure. For the repository's
documents and prose, use the knowledge base an agent is bound to
(`enact-resources`). For checking a repository out in the first place, see
`enact-runtimes-and-repos`. For business ontologies and governed system
actions, use `enact-ontology-operating` — a code graph carries no business
meaning, no bindings and no permissions.

More source-backed details: `references/code-graph-source-map.md`.
