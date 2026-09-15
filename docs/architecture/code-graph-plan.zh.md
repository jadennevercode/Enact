# 代码图谱（Code graph，graphify）集成规划

状态：待确认 · 日期：2026-09-14（v3：服务端构建、按仓库选择、含展示、最大化复用 graphify） · 分支建议：`feat/code-graph`

> v3 基于本机 `~/PycharmProjects/graphify`（`graphifyy` 0.9.61，2026-09-12）的源码逐模块核对。前两版依据的是远端一份 0.1.14 的旧快照，其中"输出目录不可配""无 LLM 时社区只有 Community N""MCP 无鉴权、仅 stdio""查询只是子串匹配"四个结论在 0.9.61 都不成立，本版已更正。

## 0. Phase 0 分析

### 0.1 graphify 0.9.61 的真实形态

| 部分 | 机制 | 复用价值 |
| --- | --- | --- |
| A. 代码结构抽取 | tree-sitter 本地 AST，27 个预编译语法 wheel，端到端覆盖 Python / JS / TS / Go / Rust / Java / C / C++ / Ruby / C# / Kotlin / Scala / PHP / Swift / Lua / Zig / SQL / Bash / Terraform / Vue / Svelte / Markdown 等约 40 种；`extractors/engine.py`（6.5k 行）+ `extractors/resolution.py`（3.7k 行）做跨文件符号解析，包管理清单（`go.mod` / `pyproject` / `Cargo.toml` / `pom.xml`）也进图 | **全部复用**，Enact 没有等价物 |
| B. 文档语义抽取 | 只对 docs / PDF / 图片跑 LLM；`--code-only` 完全跳过，不触碰 `graphify.llm` | **不用**，与 Semantica 重合 |
| C. 社区、分析、报告 | Leiden（`graspologic-native`，无则回退 networkx Louvain）；`label_communities_by_hub` 用最高度数节点做确定性命名，零 LLM；`god_nodes` / `surprising_connections` / `suggest_questions` / `graph_diff` / `find_import_cycles`；`report.generate` 出 `GRAPH_REPORT.md` | **全部复用** |
| 增量 | `manifest.json` 按相对路径记 mtime + SHA-256；AST 缓存按抽取器版本分目录、可移植；`build_merge` 按 `source_file` 替换与剪枝；`watch._rebuild_code` 是 `graphify update` 的实现，带 flock、收缩保护、报告与 JSON 导出 | **复用**，配合持久卷 |
| 查询 | `serve.py`：字符三元组倒排索引 + IDF 分层打分 + 种子选择 + BFS / DFS + token 预算渲染；`shortest_path`、`get_neighbors`、`get_community`、`god_nodes`、`graph_stats`、`affected`（反向影响面） | **全部复用**，Go 不再自写遍历 |
| MCP 服务 | Streamable HTTP（Starlette），`X-API-Key` / Bearer 鉴权，多项目 LRU（`GRAPHIFY_MAX_CONTEXTS`），按 mtime 自动重载图，`--stateless`；`_build_http_app()` 返回可挂载的 ASGI app；官方 Dockerfile 就是这个服务 | **复用**作为容器骨架 |
| 展示导出 | `exporters/html.py`（vis-network 9.1.6，unpkg CDN，颜色烘进节点，深色硬编码，>5,000 节点自动降为社区元图）；`tree_html.py`（D3 折叠树，模板与数据分离最好）；`callflow_html.py`（Mermaid 架构 / 调用流，按社区分节，CSS 变量主题）；`wiki.py`（每社区一篇 markdown + 枢纽节点文章 + 索引） | **复用数据与算法，不复用 HTML 外壳**（见 §2.5） |
| 安全 | `detect._is_sensitive` 跳过 `.env` / 密钥类文件；`validate_graph_path` 限制在 `graphify-out/` 内；`sanitize_label`；`check_graph_file_size_cap` 512 MiB | 复用；Enact 在外面再加工作区鉴权 |
| 依赖 | Python ≥ 3.10；核心 networkx / numpy / rapidfuzz + 语法 wheel，无 torch、无向量库；推荐 `graphifyy[mcp,leiden]` | 镜像几十 MB，无编译 |

### 0.2 与 Semantica / Ontology 的关系

| 维度 | Semantica × Enact | graphify |
| --- | --- | --- |
| 对象 | 业务本体（Entity / Attribute / Relationship / Action / Policy），OWL / SHACL，数据与行动绑定 | 代码结构：文件 / 符号 / 调用 / 导入 / 包依赖 + 社区 |
| 服务对象 | 业务调查与受治理的读写 | 写代码的 agent 与看代码的人 |
| 治理 | 四道人工闸门、不可变 release | 无，也不需要 |
| 重合 | 文档语义图（`semantic_extract` / `kg` / 去重 / 社区 / Explorer） | 仅 Part B 重合，本方案不启用 Part B |

两者零耦合、不共镜像。

### 0.3 值不值得

graphify 自己的基准：混合语料 52 文件时每次查询 token 减少 71.5 倍，6 文件的小库约 1 倍。收益随仓库规模增长，对 monorepo 与陌生仓库明显，对小仓库与单文件任务接近零。Enact 尚无按阶段拆分的 token 统计，所以 Phase 0 仍是"先量后建"的决策点。

## 1. 需求

1. 连接 GitHub 仓库时按仓库选择是否启用代码图谱，之后可在资源行改；这个选择就是开关。
2. 构建、查询、展示数据全部在 Enact 部署侧完成，用户机器零安装。
3. agent 检出已启用仓库后能拿到结构导览与结构化查询。
4. 人能在产品里看到图谱：概览、子系统、图、结构树、调用流。
5. 零模型成本；代码与图不离开部署。
6. **复用优先**：后端逻辑直接调用 graphify 库函数，前端消费 graphify 的数据产物；Enact 自己写的只有胶水、鉴权、存储元数据和渲染。
7. 与 Semantica 零耦合。

## 2. 设计

### 2.1 总体

```
连接 GitHub 勾选「构建代码图谱」→ resource_ref.code_graph = true
        │
Go 服务端：code_graph_build 队列（Postgres + lease，照 WebhookDeliveryWorker）
   触发：勾选 / GitHub push 默认分支 / 6h 轮询兜底 / 查询时发现过期
        │  POST /v1/projects/{key}/build {clone_url, ref, token(短期)}
        ▼
代码图谱容器 services/codegraph/（Starlette，graphifyy[mcp,leiden] 钉版本）
   持久卷 /data/{ws}/{resource}/{src/, graphify-out/}
   构建 = git fetch/checkout → graphify 库：detect → extract → build_merge → cluster
          → label_communities_by_hub → analyze → report.generate → to_json → to_wiki
   查询 = graphify.serve 的 _query_graph_text / _score_nodes / _find_node / affected
   展示 = 社区元图 / 社区子图 / 结构树 / Mermaid 调用流，全部由 graphify 函数产出 JSON
        │  REST（service key）
        ▼
Go 服务端 /api/code-graph/*：工作区鉴权 + 透传；Postgres 只存构建元数据与报告
        │
agent: enact graph status|report|query|path|explain|affected     人: 「代码图谱」页面
```

- **Go 不实现任何图算法**，只做鉴权代理与元数据。与 v2 相比少了 Go 侧解析 / LRU / BFS，多了容器内的 REST 层。
- **图文件留在容器卷上**，位置就是 graphify 期望的 `graphify-out/`，这样 `validate_graph_path`、AST 缓存、manifest、增量、mtime 自动重载全部原样生效。Postgres 存 `code_graph_build` 元数据、stats 与 `report_md`（小，便于 UI 快速路径与容器不可用时的降级）。
- 服务端依赖两个环境变量 `ENACT_CODEGRAPH_SERVICE_URL` / `ENACT_CODEGRAPH_SERVICE_KEY`，未配置时功能对前端呈现"此部署未启用"。

### 2.2 容器 `services/codegraph/`

`Dockerfile`（`python:3.12-slim`，`pip install "graphifyy[mcp,leiden]==0.9.61"`，非 root）、`app.py`（Starlette 路由）、`build.py`（构建编排）、`views.py`（展示数据）、`tests/`。不进 pnpm workspace，不进 Go module。

**构建 `POST /v1/projects/{key}/build`**

1. `src/` 不存在则 `git clone --depth 1 --branch <ref>`，存在则 `git fetch --depth 1 && git checkout --force <ref>`；token 只进这一次 git 子进程的 URL，日志脱敏；`.git` 保留以便 `built_at_commit` 自动写入。
2. 首次：`detect(root)` → `extract(code_files, cache_root=out, root=root)` → `build([res], root=root)`；增量：`detect_incremental(kind="ast")` → 只抽变更文件（带 `resolution_context_*`）→ `build_merge(prune_sources=deleted ∪ excluded)`。
   优先直接调用 `watch._rebuild_code(path, force=first_run, block_on_lock=True)`：它就是 `graphify update`，已含上述全部步骤加 flock、收缩保护、报告与 `to_json`；它是下划线私有 API，随镜像钉版本，升级时由 `tests/` 兜住；若某版本破坏了它，退回上面列出的公开函数组合。设 `GRAPHIFY_VIZ_NODE_LIMIT=0` 关掉它顺带写的 vis.js HTML。
3. `cluster` → `remap_communities_to_previous`（社区 id 跨构建稳定）→ `label_communities_by_hub` → `score_all` / `god_nodes` / `surprising_connections` / `suggest_questions` → `report.generate` → `to_json(..., community_labels=labels)`（`community_name` 内联进节点）→ `to_wiki`（每社区一篇）。
4. 返回 `{commit, stats:{files,nodes,edges,communities,duration_ms}, report_md, diff}`，`diff` 来自 `analyze.graph_diff(G_old, G_new)`。
5. 排除：`--code-only` 语义（不把 docs / PDF / 图片送入任何 LLM 路径）；`detect` 自带敏感文件跳过与 `.gitignore`；`max_files` 超限返回 `skipped: too_large`。

**查询（供 Go 透传给 `enact graph`）**

| 路由 | graphify 实现 |
| --- | --- |
| `POST /v1/projects/{key}/query` `{question, mode, depth, token_budget, context}` | `serve._query_graph_text` |
| `POST .../path` `{source, target, undirected}` | `serve._pick_scored_endpoint` + `networkx.shortest_path` |
| `POST .../explain` `{node}` | `serve._find_node` + `find_node_ambiguity` + 邻居枚举 |
| `POST .../affected` `{seed, relations, depth}` | `affected.resolve_seed` / `affected_nodes` / `format_affected` |
| `GET .../god-nodes`、`GET .../stats`、`GET .../communities` | `analyze.god_nodes`、`serve` 的 stats、`_communities_from_graph` |

图上下文用 `serve._GraphContextCache` 的 LRU，mtime 变化自动重载，无需构建后通知。

**展示数据（供前端）**

| 路由 | 内容 | graphify 实现 |
| --- | --- | --- |
| `GET .../report` | `GRAPH_REPORT.md` | `report.generate` 的产物 |
| `GET .../wiki/index`、`GET .../wiki/{slug}` | 社区文章、枢纽文章 | `wiki.to_wiki` 的产物 |
| `GET .../graph?level=community` | 社区元图：每社区一节点，跨社区边计数，规模、内聚度、标签 | `exporters/html.py` 的社区元图聚合逻辑（>5,000 节点时它自己走的那条路） |
| `GET .../graph?community={id}&limit=500` | 单社区子图，节点带 `source_file:line`、度数、`community_name`；边带 `relation` / `confidence` | `serve.get_community` 同源数据 |
| `GET .../graph?focus={node}&depth=2` | 以节点为中心的邻域子图 | `serve._bfs` + `_complete_induced_edges` |
| `GET .../tree?root=&max_children=200` | 文件 / 符号层级树 JSON | `tree_html.build_tree` |
| `GET .../callflow?section={id}` | 该社区的 Mermaid 源文本 + 节点说明 | `callflow_html` 的 `derive_sections_from_communities` / `select_diagram_nodes` 与 Mermaid 生成函数；若 Mermaid 字符串没有独立函数，从 `write_callflow_html` 抽出约 50 行，这是本方案唯一需要改动 graphify 代码路径的地方 |

所有响应节点数受 `limit` 约束（默认 500 节点 / 1,500 边，与 ontology-v2 验收一致），超出返回 `truncated: true` 与总数。

**可选：MCP 直出**

`_build_http_app()` 可挂到同一 Starlette 进程的 `/mcp`。v1 不对 agent 开放，因为 MCP 工具的 `project_path` 参数由调用方给出，无法在容器内做工作区隔离；将来若要开放，走 Go 的 Remote MCP broker 做每资源一个受限端点。

**运维**

`docker-compose.codegraph.yml` 可选叠加层（同 `docker-compose.semantic.yml`），卷 `codegraph_state:/data`，无公开端口；`CODEGRAPH_ALLOWED_HOSTS` 限定克隆主机；`CODEGRAPH_CONCURRENCY=1`；`GRAPHIFY_REBUILD_TIMEOUT` / `GRAPHIFY_REBUILD_MEMORY_LIMIT_MB` 直接用 graphify 的资源上限。

### 2.3 Go 服务端

- `workspace_resource.resource_ref.code_graph: boolean`（JSONB，不改 schema，走 `validateAndNormalizeResourceRef`）；仅 `github_repo` 与自定义 git URL 允许，`local_directory` 拒绝并说明。
- 新表 `code_graph_build`：`id, workspace_id, resource_id, project_key, repo_url, ref, commit, state (queued|building|ready|failed|skipped), skipped_reason, error, stats JSONB, diff JSONB, report_md TEXT, graphify_version, lease_until, attempts, created_at, finished_at`。无外键；两个索引各自独立 `CREATE INDEX CONCURRENTLY` 迁移。每资源保留最近 5 条。
- `CodeGraphBuildWorker` 照 `webhook_delivery_worker.go`；构建前签发 GitHub App installation token（1 小时、仓库级）或复用 GitLab / Forgejo provider token；公开仓库不带 token；凭据只进请求体。
- 触发：勾选 / `push` webhook（默认分支，5 分钟去抖；`github.go` 现只处理 `pull_request`）/ 6 小时 HEAD 比对 / 查询时 stale 入队。
- `/api/code-graph/*`：`capability`、`resources/{id}/status`、`.../rebuild`（owner/admin），其余 `report` / `wiki` / `graph` / `tree` / `callflow` / `query` / `path` / `explain` / `affected` 一律鉴权后透传容器；透传复用 `semanticServiceRequest` 的形态（内部 URL、service key、拒绝重定向、响应上限、超时）。
- 资源删除、取消勾选、工作区删除：同事务清理 `code_graph_build`，并调容器 `DELETE /v1/projects/{key}` 释放卷目录。

### 2.4 agent 消费

- `server/cmd/enact/cmd_graph.go`：`status`、`report`、`query`、`path`、`explain`、`affected`、`communities`；`--repo <url>` 省略时取当前目录检出的仓库；调服务端 API。
- 内置 skill `enact-code-graph`：检出后先 `status`；`ready` 则 `report` 定位子系统，`explain` / `path` / `affected` 缩小范围，然后才 grep / read；`stale` 照常用；未启用 / 构建中 / 失败按平常方式工作；INFERRED 的 `calls` 边只当线索。
- brief：`writeRepositories` 固定引导语加一句；不放随 run 变化的数据。
- 同 PR 更新 `enact-runtimes-and-repos`、`enact-working-on-issues`、`enact-resources` 的 skill 与 source map。

### 2.5 前端：复用 graphify 的数据，用 Enact 的渲染器

不嵌入 graphify 的三个 HTML 外壳：`html.py` 拉 unpkg 的 vis-network（CSP 与离线不通）、颜色烘进节点、深色硬编码；`tree_html.py` 拉 d3js.org 且无 SRI；`callflow_html.py` 拉 jsDelivr 的 Mermaid。Enact 已有 sigma + graphology（含 louvain / 最短路 / forceatlas2）和 Mermaid 渲染，`graph.json` 是 NetworkX node-link 格式，映射到 graphology 是十几行。

**入口**

- 资源行 chip 可点 → 打开该仓库的「代码图谱」页面。
- 智能中心（`intelligence_group`）新增导航「代码图谱」→ 列表页列出启用了图谱的仓库与状态；路由 `${ws}/codegraph` 与 `${ws}/codegraph/{resourceId}`，在 `packages/core/paths/paths.ts` 与 `route-icons.ts` 注册，web 与 desktop 各接一次。
- 页面在 `packages/views/codegraph/`，web 与 desktop 共享。

**仓库图谱页 `${ws}/codegraph/{resourceId}`**

```
acme/backend · a1b2c3d · 2 小时前 · 1,284 文件 · 6,902 节点 · 11 子系统        [重新构建]
┌ 概览 ─┬ 子系统 ─┬ 图谱 ─┬ 结构树 ─┬ 调用流 ┐
│ 概览：GRAPH_REPORT.md 渲染（Enact markdown），顶部 KPI 与本次 commit 变化（graph_diff）
│ 子系统：左列社区列表（标签、规模、内聚度），右侧该社区 wiki 文章 + 主要文件；点文件跳 GitHub 对应 commit
│ 图谱：默认社区元图（≤ 100 节点，sigma，节点大小 = 规模，边粗 = 跨社区边数）；
│       点社区下钻到子图（≤ 500 节点 / 1,500 边，超出显示"已截断，共 N"）；点节点显示邻域与 source_file:line；
│       搜索框走容器的 query 打分（同 agent 用的那一套）；社区颜色用 Enact 设计令牌，不用 graphify 调色板
│ 结构树：tree.build_tree 的 JSON 用折叠树渲染，叶子链到 GitHub
│ 调用流：每社区一张 Mermaid，用 rich-content 已有的 mermaid 渲染；> 18 节点 / 24 边按 graphify 的选择逻辑裁剪
└
```

- 图谱页复用 `packages/views/semantic/explorer/` 的 `graph-canvas.tsx`、行为模块与 `small-graph-layout.ts`，把 `SemanticGraph` 输入类型泛化为一个共享的 `GraphView` 类型（这是对 explorer 的唯一改动，Ontology 侧行为不变，靠现有测试钉住）。
- `packages/core/codegraph/`：`schemas.ts`（`parseWithFallback`：status、stats、node-link 图、tree、callflow）、`api.ts`、`queries.ts`（key 含 `wsId` 与 `resourceId`）、`node-link.ts`（node-link → graphology，`links` / `edges` 双兼容，`_src` / `_tgt` 旧图兼容）。

**连接时选择与资源行**

- GitHub 选择器与 `CustomRepoForm` 底部复选框「为所选仓库构建代码图谱」，默认不勾选，一句说明：服务端解析仓库结构供 Agent 与成员使用，零模型成本，代码不离开本部署。部署未启用时禁用并说明。`local_directory` 表单不出现。
- 资源行 chip：就绪 · commit · 时间 / 构建中 / 已跳过 · 原因 / 失败 · 原因 [重试]；未启用无 chip，行菜单可开启。
- Agent 详情、Runtime 页、首页引导条都不加东西。

### 2.6 边界与不做的事

- 不启用 Part B、不给社区用 LLM 命名、不引入 embedding。
- 不支持 `local_directory`。
- 不嵌入 graphify 的 HTML 导出、不对 agent 开放 MCP 端点（v2 候选）。
- 不做 `prs` / PR 影响面（依赖 `gh` CLI；Enact 已有 PR 数据，将来可用 `affected` 自己算）。
- 不做跨仓库全局图（`global_graph` / `cross_repo_calls`，v2 候选：一个工作区多个仓库时很有用）。

## 3. 实施阶段

### Phase 0 — 先量后建（3–4 h，不写 Enact 代码）

1. 用 `graphify extract <Enact 仓库> --code-only --out /tmp/x && graphify cluster-only /tmp/x` 跑一次，记录耗时、节点 / 边数、报告可读性；再改一个文件跑 `graphify update` 验证增量耗时。
2. 把 `GRAPH_REPORT.md` 提交进一个绑定给 agent 的知识库仓库（现有机制，仅作实验）。
3. 6–10 个跨子系统 Issue 有 / 无导览对比：工具调用数、探索性 read/grep 数、回合数、结果质量。
4. **决策点**。

**Phase 0 实测记录（2026-09-14，本机，graphifyy 0.9.61，对象：Enact 仓库 @ e2689220，`--code-only`）**

| 项 | 结果 |
| --- | --- |
| `graphify extract` 耗时 | 1 分 38 秒（wall），CPU 75 s |
| 规模 | 41,830 节点 · 133,523 边 · 920 社区；边 88% EXTRACTED / 12% INFERRED（INFERRED 平均置信 0.85） |
| 关系分布 | calls 44k · contains 29k · references 28k · imports 14k · imports_from 8.6k · method 5.6k · re_exports 1.7k · rationale_for 1.1k |
| 节点类型 | code 40,477 · rationale 1,126（来自注释）· concept 227 |
| 产物体积 | `graph.json` 72 MB · `cache/` 86 MB · `manifest.json` 1 MB · `GRAPH_REPORT.md` 231 KB |
| `graph.json` 顶层键 | `directed, multigraph, graph, nodes, links, hyperedges, built_at_commit`；节点含 `community` / `community_name` / `norm_label`；边含 `context` / `confidence_score` |
| `cluster-only` | 5 分 08 秒，但**误用了 LLM**：本机 PATH 上有 Claude Code CLI，graphify 自动探测到 `claude-cli` 后端为 920 个社区命名，消耗约 70 万输入 token。容器里不得出现任何 LLM 后端；生产用 `label_communities_by_hub` 的确定性命名 |

结论与对设计的修正：规模远超"≤ 100 个社区"的假设，所有投影必须依赖 `limit` 截断；`level=community` 默认只取规模最大的 100 个；每个 monorepo 级仓库在卷上约 160 MB；构建完成后要预热图缓存。第 2、3 步（导览放入知识库、6–10 个 Issue 有 / 无导览对比）需要真实 agent 运行与配额，本轮按用户指示直接进入实现，未执行，收益仍属未验证。

### Phase 1 — 容器（中高，10–12 h）

- Starlette 应用、构建编排（首次 / 增量、`_rebuild_code` 主路径与公开函数备路径）、查询 REST、展示 REST（元图、子图、邻域、树、Mermaid）、allowed hosts、脱敏、限额、`DELETE` 清理。
- 测试：以 graphify `worked/httpx/raw`（6 文件，期望 144 节点 / 330 边）做 `git init` 临时仓库跑端到端；`worked/rsl-siege-manager/graph.json`（1,886 节点）做展示接口的截断与性能夹具；拒绝非白名单主机；token 不入日志；增量只重抽变更文件。
- compose 叠加、`.env.example`。

### Phase 2 — Go 服务端（高，8–10 h，先写 handler 测试）

- `resource_ref.code_graph` 校验；`code_graph_build` 迁移 + sqlc；worker；token 签发；`push` webhook；轮询；`/api/code-graph/*` 鉴权透传；清理。
- 测试：`testutil` 驱动；假容器 `httptest.Server`；lease 回收；重试上限；`local_directory` 拒绝；跨工作区拒绝；push 去抖；透传响应上限。

### Phase 3 — CLI 与 skill（中，4–5 h）

- `cmd_graph.go`（含 `affected`）；内置 skill 与 source map；brief 引导语；既有 skill source map。

### Phase 4 — 前端（高，14–18 h）

- `packages/core/codegraph/`（schema、api、queries、node-link 转换 + 畸形响应与旧图兼容测试）。
- explorer 输入类型泛化（Ontology 测试全绿）。
- `packages/views/codegraph/`：列表页、仓库图谱页五个 tab、chip、复选框、行菜单；路由与 route-icons；web / desktop 接线；四语 locale。
- 测试：组件 happy path 与可访问性；node-link 转换 `.test.ts`（node 环境）；截断状态；Playwright 截 320 / 768 / 1024 / 1440 两主题。

### Phase 5 — 文档、部署与复测（低，3–4 h）

- `resources.mdx`、`cli.mdx`、`deployment/*`、词汇表「Code graph → 代码图谱」、`semantic-integration.md` 边界说明；同一组 Issue 复测并记录。

### 预估

| 阶段 | 复杂度 | 预估 |
| --- | --- | --- |
| Phase 0 测量 | 低 | 3–4 h |
| Phase 1 容器 | 中高 | 10–12 h |
| Phase 2 Go 服务端 | 高 | 8–10 h |
| Phase 3 CLI / skill | 中 | 4–5 h |
| Phase 4 前端 | 高 | 14–18 h |
| Phase 5 文档 / 部署 / 复测 | 低 | 3–4 h |
| 合计（若通过 Phase 0 决策点） | 高 | 42–53 h |

## 4. 风险

- **HIGH：收益未经证实。** Phase 0 决策点。
- **HIGH：依赖 graphify 私有 API。** `watch._rebuild_code`、`serve._query_graph_text` 等带下划线；镜像钉版本 0.9.61，升级是一次有意识的 PR，容器 `tests/` 对这些入口做回归；每个私有入口都写明公开函数备路径。
- **MEDIUM：容器成了有状态服务。** 卷丢失只需重建（Postgres 有元数据与报告），但需要在部署文档写明备份与容量；每资源保留一份 `src/` + `graphify-out/`。
- **MEDIUM：服务端 CPU。** 单并发、限额、`GRAPHIFY_REBUILD_*` 上限；增量后常规更新是秒级到分钟级。
- **MEDIUM：凭据经过容器。** 短期 token、只进一次请求、脱敏日志、allowed hosts。
- **MEDIUM：explorer 泛化改到 Ontology 的共享组件。** 只改输入类型，行为不动，靠既有测试。
- **MEDIUM：大仓库前端渲染。** 元图优先、子图 500 / 1,500 上限、截断明示。
- **LOW：`calls` 边 INFERRED、Go / TS 跨文件解析弱于 Python。** skill 与页面图例都写明置信度。

## 5. 后续（不在本次范围）

- agent 直连 MCP：`_build_http_app` 挂 `/mcp`，经 Go 的 Remote MCP broker 做每资源受限端点。
- 跨仓库全局图（`global_graph` + `cross_repo_calls`）。
- 用 `affected` 给 Enact 已有的 PR 数据算影响面。
- 用 Enact 已连接 Runtime 的结构化 model-operation 给社区命名（graphify 支持 OpenAI 兼容 / Anthropic 后端，可指向 Enact 的模型网关）。
- 本体 `source_refs` ↔ 代码图节点桥接。
