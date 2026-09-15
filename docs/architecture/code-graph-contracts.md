# Code graph — wire contracts

Companion to `code-graph-plan.zh.md`. Three components are built in parallel against this file: the
codegraph container (`services/codegraph/`), the Go server + `enact graph` CLI, and the shared
frontend (`packages/core/codegraph`, `packages/views/codegraph`). Any change here must be applied to all
three. Field names are snake_case on every wire.

## Identity

- **Project key**: `{workspace_id}--{resource_id}` — two UUIDs joined by `--`. Regex
  `^[0-9a-f-]{36}--[0-9a-f-]{36}$`. It is the only path segment the container ever accepts; it never
  appears in the browser.
- **Container layout**: `${CODEGRAPH_DATA_DIR}/{project_key}/src/` (git checkout, kept between builds)
  and `${CODEGRAPH_DATA_DIR}/{project_key}/graphify-out/` (graphify's own output layout: `graph.json`,
  `GRAPH_REPORT.md`, `manifest.json`, `cache/`, `.graphify_analysis.json`, `.graphify_labels.json`,
  `wiki/`).
- **graphify version** is pinned in `services/codegraph/pyproject.toml` (`graphifyy==0.9.61`) and echoed
  in every `stats` object.

## Environment

| Where | Variable | Meaning |
| --- | --- | --- |
| Go server | `ENACT_CODEGRAPH_SERVICE_URL` | internal base URL, e.g. `http://codegraph:8767`; empty disables the feature |
| Go server | `ENACT_CODEGRAPH_SERVICE_KEY` | sent as `X-Codegraph-Service-Key` |
| container | `CODEGRAPH_SERVICE_KEY` | must equal the above; empty refuses every request |
| container | `CODEGRAPH_DATA_DIR` | default `/data` |
| container | `CODEGRAPH_ALLOWED_HOSTS` | comma-separated clone hosts, default `github.com` |
| container | `CODEGRAPH_MAX_FILES` | default `20000`; above → `skipped` / `too_large` |
| container | `CODEGRAPH_BUILD_TIMEOUT_S` | default `900` |
| container | `GRAPHIFY_VIZ_NODE_LIMIT=0` | set by the Dockerfile; graphify's vis.js HTML is never written |

## Container REST (`services/codegraph`, port 8767)

Every route requires `X-Codegraph-Service-Key`. JSON in, JSON out. Errors are
`{"error": "<snake_code>", "message": "<human text>"}` with status `400` (bad input), `401`, `404`
(`not_built` — project has no `graph.json`), `409` (`busy` — a build is running), `413`
(`too_large`), `500`.

### Lifecycle

`GET /healthz` → `{"ok": true, "graphify_version": "0.9.61"}` (no key required).

`POST /v1/projects/{key}/build`
```json
{"clone_url": "https://github.com/acme/backend.git", "ref": "main", "token": "ghs_…", "max_files": 20000, "timeout_s": 900}
```
`token` is optional and is used exactly once in the git subprocess URL; it is never logged or persisted. `ref` is optional too: omit it for a repository nobody pinned to a branch and the container resolves the remote's default branch, reporting it back as `ref` in the response.
Synchronous; the caller uses a 15‑minute HTTP timeout. Only one build runs per container
(`CODEGRAPH_CONCURRENCY=1`); a concurrent call returns `409 busy`.

Response `200`:
```json
{
  "state": "ready" | "skipped" | "failed",
  "commit": "a1b2c3d4…40 hex",
  "ref": "main",
  "skipped_reason": "too_large" | null,
  "error": null | "clone_failed: …",
  "stats": {"files": 1284, "nodes": 6902, "edges": 15310, "communities": 11,
            "duration_ms": 48213, "graphify_version": "0.9.61", "incremental": true},
  "diff": {"added_nodes": 12, "removed_nodes": 3, "added_edges": 40, "removed_edges": 9} | null,
  "report_md": "# Knowledge Graph Report\n…"
}
```
`failed` and `skipped` still return `200` with `state` set; only transport/auth problems are non‑200.

`DELETE /v1/projects/{key}` → `204`. Removes `src/` and `graphify-out/`. Idempotent.

`GET /v1/projects/{key}/status` → `{"built": true, "commit": "…", "built_at": "RFC3339", "stats": {…}}`
or `{"built": false}`.

### Read models

`GET /v1/projects/{key}/report` → `{"report_md": "…"}`

`GET /v1/projects/{key}/stats` → the `stats` object above.

`GET /v1/projects/{key}/communities` →
```json
{"communities": [{"id": 0, "label": "handler", "size": 412, "cohesion": 0.83,
                  "top_nodes": [{"id": "…", "label": "Handler", "source_file": "server/internal/handler/handler.go",
                                 "source_location": "L41", "degree": 87}]}]}
```
Sorted by `size` desc. `top_nodes` ≤ 8 per community.

`GET /v1/projects/{key}/god-nodes?top=10` →
`{"nodes": [{"id", "label", "source_file", "source_location", "degree", "community_id", "community_name"}]}`

`GET /v1/projects/{key}/graph` — one of three projections, all returning **GraphView**:

| query | projection |
| --- | --- |
| `level=community` | one node per community; edges = cross‑community edge counts (graphify's `to_html` aggregation) |
| `community={id}&limit=500` | induced subgraph of that community |
| `focus={node_id}&depth=2&limit=500` | BFS neighbourhood (`serve._bfs` + `_complete_induced_edges`) |

GraphView:
```json
{
  "level": "community" | "code",
  "nodes": [
    {"id": "c:0", "kind": "community", "label": "handler", "size": 412, "community_id": 0, "cohesion": 0.83},
    {"id": "server_handler_Handler", "kind": "code", "label": "Handler", "file_type": "code",
     "source_file": "server/internal/handler/handler.go", "source_location": "L41",
     "community_id": 0, "community_name": "handler", "degree": 87}
  ],
  "edges": [
    {"source": "c:0", "target": "c:3", "relation": "cross_community", "weight": 143},
    {"source": "…", "target": "…", "relation": "calls", "confidence": "INFERRED", "confidence_score": 0.85, "weight": 1.0}
  ],
  "truncated": false, "total_nodes": 412, "total_edges": 1203
}
```
`limit` caps nodes (default 500, max 2000); edges are capped at `3 × limit`. When capped, nodes are
kept by degree desc and `truncated=true`. Community node ids are prefixed `c:` so they never collide
with code node ids.

`GET /v1/projects/{key}/tree?max_children=200` → pass‑through of `graphify.tree_html.build_tree`:
`{"name": "<project>", "total_count": N, "children": [{"name", "total_count", "children"?, "kind"?, "source_file"?, "source_location"?}]}`.
Clients treat every field except `name` as optional.

`GET /v1/projects/{key}/callflow?lang=auto|en|zh` →
```json
{"lang": "en", "overview_mermaid": "flowchart LR …",
 "sections": [{"id": "handler", "name": "handler", "node_count": 412, "edge_count": 1203, "mermaid": "flowchart LR …"}]}
```
Built with `callflow_html.derive_sections_from_communities`, `classify_edges`,
`generate_overview_graph`, `generate_section_flowchart` (defaults `max_sections=15`,
`max_diagram_nodes=18`, `max_diagram_edges=24`). Nothing else from that module is used.

`GET /v1/projects/{key}/wiki` → `{"index_md": "…", "articles": [{"slug", "title", "kind": "community" | "god_node", "community_id"?}]}`
`GET /v1/projects/{key}/wiki/{slug}` → `{"slug", "title", "markdown"}`. Produced by `graphify.wiki.to_wiki` at build time.

### Agent queries (text, token‑budgeted, produced by `graphify.serve`)

| route | body | response |
| --- | --- | --- |
| `POST …/query` | `{"question", "mode": "bfs"\|"dfs", "depth": 3, "token_budget": 2000, "context": ["call"]}` | `{"text": "…"}` |
| `POST …/path` | `{"source", "target", "undirected": true}` | `{"text": "…", "path": ["id", …]}` (`path` empty when none) |
| `POST …/explain` | `{"node"}` | `{"text": "…", "matches": ["id", …], "ambiguous": false}` |
| `POST …/affected` | `{"seed", "depth": 2, "relations": ["calls", …]}` | `{"text": "…"}` |

## Go server (`/api/code-graph`, existing auth + `X-Workspace-ID`, membership checked)

Task (agent) tokens may call everything except `rebuild`, which requires a human owner/admin.

| route | response |
| --- | --- |
| `GET /capability` | `{"enabled": bool, "graphify_version": "0.9.61" \| null}` |
| `GET /status` | `{"statuses": {"<resource_id>": BuildStatus}}` for every enabled repo in the workspace (chips) |
| `GET /resources/{resourceID}/status` | BuildStatus |
| `POST /resources/{resourceID}/rebuild` | `202 {"build_id": "uuid"}` — owner/admin |
| `GET /resources/{resourceID}/report` | `{"report_md"}` served from Postgres (`code_graph_build.report_md`) |
| `GET /resources/{resourceID}/{communities,god-nodes,graph,tree,callflow,wiki,wiki/{slug},stats}` | pass‑through of the container response, same shapes |
| `POST /resources/{resourceID}/{query,path,explain,affected}` | pass‑through |

BuildStatus:
```json
{"enabled": true, "queued": false, "stale": false,
 "build": null | {"id": "uuid", "state": "queued"|"building"|"ready"|"failed"|"skipped",
                  "commit": "…", "ref": "main", "skipped_reason": null, "error": null,
                  "stats": {…}, "diff": {…} | null, "graphify_version": "0.9.61",
                  "created_at": "RFC3339", "finished_at": "RFC3339" | null}}
```
`build` is the most recent row; `stale=true` when the latest `ready` commit differs from the default
branch HEAD known to the server (webhook or poll). `enabled=false` when `resource_ref.code_graph` is not
`true`; the container is not consulted in that case.

Errors: `{"error": "<message>"}` with `404` when the resource is not in the workspace or code graph is
disabled for it, `409` when the build is not `ready`, `503` when `ENACT_CODEGRAPH_SERVICE_URL` is empty
or the container is unreachable.

### Resource ref

`github_repo` `resource_ref` gains `"code_graph": true|false` (optional, default false). Also accepted on
custom git URL repos. Rejected with `400` on `local_directory` and `knowledge_repo`
("code graph needs a remote repository"). Setting it `true` enqueues a build; setting it `false` or
deleting the resource deletes `code_graph_build` rows in the same transaction and calls
`DELETE /v1/projects/{key}` best‑effort.

### Table `code_graph_build`

```
id uuid pk, workspace_id uuid, resource_id uuid, project_key text, repo_url text, ref text,
commit text null, state text check in (queued,building,ready,failed,skipped), skipped_reason text null,
error text null, stats jsonb null, diff jsonb null, report_md text null, graphify_version text null,
lease_until timestamptz null, attempts int default 0, created_at timestamptz, finished_at timestamptz null
```
No foreign keys. Two indexes in two separate `CREATE INDEX CONCURRENTLY` migrations:
`(workspace_id, resource_id, created_at desc)` and `(state, lease_until)`. Keep the newest 5 rows per
resource.

### Triggers

1. `resource_ref.code_graph` flips to `true` → enqueue.
2. GitHub App webhook `push` on the default branch of an enabled repo → enqueue, debounced 5 min per resource.
3. Poll every 6 h: compare default‑branch HEAD via the provider API; enqueue on change.
4. Any status read whose latest `ready` commit ≠ known HEAD marks `stale=true` and enqueues once.

## CLI `enact graph`

```
enact graph status   [--repo <url>]
enact graph report   [--repo <url>]
enact graph query    "<question>" [--repo <url>] [--dfs] [--depth N] [--budget N] [--context C]...
enact graph path     "<A>" "<B>"  [--repo <url>] [--directed]
enact graph explain  "<node>"     [--repo <url>]
enact graph affected "<node>"     [--repo <url>] [--depth N] [--relation R]...
enact graph communities [--repo <url>]
```
`--repo` omitted → the repository checked out in the current working directory (git remote `origin`),
matched against workspace resources by normalized URL. Output is plain text for agents; `--json` on
`status` and `communities`. Exit code 2 with a one‑line reason when the graph is disabled, not built,
or the deployment has no container — never a stack trace.

## Frontend

Routes (workspace‑scoped, `packages/core/paths/paths.ts` + `route-icons.ts`):
`codeGraphs: () => \`${ws}/codegraph\``, `codeGraph: (resourceId) => \`${ws}/codegraph/${resourceId}\``.
Navigation group: Intelligence (`intelligence_group`), label 「代码图谱 / Code graph」.

`packages/core/codegraph/`: zod schemas for every response above via `parseWithFallback`; query keys
`["code-graph", wsId, …]`; `useCodeGraphCapability(wsId)`, `useCodeGraphStatuses(wsId)`,
`useCodeGraphStatus(wsId, resourceId)`, `useCodeGraphReport`, `useCodeGraphCommunities`,
`useCodeGraphView(wsId, resourceId, projection)`, `useCodeGraphTree`, `useCodeGraphCallflow`,
`useCodeGraphWiki`, `useCodeGraphWikiArticle`, `useRebuildCodeGraph` (mutation, invalidates status).
`node-link.ts` converts GraphView → graphology `Graph` (tolerates `links` as an alias of `edges` and legacy
`_src`/`_tgt`).

Glossary: Code graph → 代码图谱; community → 子系统 (UI) ; god node → 关键枢纽; call flow → 调用流.
