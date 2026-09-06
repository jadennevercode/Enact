# 知识库（Knowledge base）实施规划

状态：待确认 · 日期：2026-09-05 · 分支建议：`feat/knowledge-base`

## 1. 需求

1. 工作区可绑定一个或多个「知识库」git 仓库，独立于代码仓库。
2. 知识库按 agent 选择注入：绑定了的 agent 每次运行时**直接能读到**，不靠它自己决定去 checkout。
3. 复盘（Retrospect）agent 学到的东西写回知识库仓库，走 git 提交或 PR。

## 2. 设计

### 2.1 存储：git 仓库，复用资源表

- 新增 `workspace_resource.resource_type = 'knowledge_repo'`。
- `resource_ref = { url, ref?, path?, delivery? }`：`path` 是仓库内子目录（默认根）；`delivery` 为 `pull_request`（默认）或 `commit`。
- 不改 schema。资源表本来就是自由类型加 JSONB，注释明确“加类型不需要改 schema”。
- 为什么是 git：版本化、可 PR 评审、人和 agent 都能改、可迁走；复盘 agent 本来就会写 markdown 提 PR。

### 2.2 绑定：agent 级选择

- 新表 `agent_resource(agent_id, resource_id, created_at)`，无外键（仓库规则），`resource_id` 二级索引单独 migration 用 `CREATE INDEX CONCURRENTLY`。
- 语义：agent 主动选择的资源。今天只有 `knowledge_repo` 走这条路；代码仓库仍然工作区全量注入。
- 绑不绑知识库就是开关，不加第二个 toggle（与复盘 agent 的开关原则一致）。

### 2.3 读取：预检出 + 索引

- daemon 准备工作目录时，把该 agent 绑定的知识库从本机 bare 缓存派生一个只读检出到 **daemon 自有的任务目录**下 `.enact/knowledge/<slug>/`，只 sparse 检出 `path`，按 `ref`。绝不写进用户的 `local_directory`。
- 扫描 `path/` 下 markdown 的 front-matter（`title`、`description`），在 brief 里渲染 `## Knowledge` 段。
- agent 用普通文件工具打开，和读代码一样。

### 2.4 渐进式加载：三层，正文永不整体进上下文

| 层 | 进上下文的是什么 | 什么时候进 | 体积 |
| --- | --- | --- | --- |
| 1. 索引 | 每篇一行：标题 · 一句 description · 相对路径 | 每次运行，随 brief 常驻 | 60 篇上限，超出只列目录名 |
| 2. 单篇正文 | agent 用文件工具打开的那一篇 | agent 判断与任务相关时 | 一篇 |
| 3. 按需检索 | `grep` / 搜索命中的片段 | agent 不确定该读哪篇时 | 命中的几行 |

- 只有第 1 层被“塞进”上下文，它是目录不是内容。第 2、3 层由 agent 触发，一次只读需要的部分。
- 与 Claude Code / Codex 的 skill 机制同一思路（description 常驻、正文按需），但用文件形式，Claude、Codex、OpenClaw 三种 provider 通用。
- brief 措辞沿用现有资源段：“资源是指针，任务相关时才打开”，并明确“先看索引再开单篇”。
- 边界：第 1 层每次运行约一两千 token。知识库超过百篇后，目录本身变大，才需要下一步（pgvector 按任务检索，只把相关几篇的索引条目放进 brief）。B 的文件结构与 front-matter 就是那一步的输入。
- 已知不可硬保证：模型可能自发通读目录。skill 机制同样如此，只能靠索引质量与措辞把默认路径引对。

### 2.5 写回

- 复盘 agent 对知识库跑 `enact repo checkout <url>`，得到可写分支的 worktree，写文档、commit，按 `delivery` 直接 push 或开 PR。
- 复盘指令改为：brief 里有知识库就写进去；没有才退回今天的 `docs/knowledge/` 与附件兜底。
- 一个 agent 可绑多个知识库，复盘按主题选，选不出写进第一个。

### 2.6 知识库约定

- 一篇一个主题，lower-kebab-case 文件名。
- front-matter 必填 `title`、`description`；`updated`、`source`（issue id）沿用复盘指令现有要求。索引质量决定第 2 层触发得准不准。

## 3. 实施阶段

### Phase 1 — 后端：资源类型、绑定表、claim 注入（先写 handler 测试）

- `server/internal/handler/workspace_resource.go`：`validateKnowledgeRepoRef`（复用 `isValidGitRepoURL`；`path` 必须是相对路径且不含 `..`；`delivery` 枚举）；`applyWorkspaceResourcesToClaim` 跳过 `knowledge_repo`；`workspaceRepos` 只返回代码仓库；删资源时同事务清理 `agent_resource`。
- migration 两个文件：`agent_resource` 建表；`resource_id` 索引单独文件 `CREATE INDEX CONCURRENTLY`。`server/pkg/db/queries/agent_resource.sql` 后 `make sqlc`。
- `RepoData` 加 `kind`（`code` | `knowledge`）；`RepoContextForEnv`、daemon `types.go` 同步。
- 新增 `applyAgentKnowledgeToClaim(ctx, resp, agentID)`：查绑定，把知识库以 `kind=knowledge` 加进 `resp.Repos`（daemon 借此同步缓存与放行白名单），另填 `resp.KnowledgeSources`（url、ref、path、delivery、label）。`daemon.go` 的 issue、chat、autopilot 三条 claim 路径都调用。
- `server/internal/handler/agent.go`：agent 响应加 `knowledge_sources`；端点 `GET /api/agents/{id}/knowledge`、`POST`（body `resource_id`）、`DELETE /{resourceId}`；删 agent 时清理绑定。
- 测试：非法 ref、path 越界、绑定/解绑、claim 只带绑定的知识库、`knowledge_repo` 不出现在通用资源列表、删资源后绑定消失、三条 claim 路径各一条。

### Phase 2 — Daemon：预检出、索引、brief

- 开头先做真机验证：`enact repo checkout` 产出的 worktree 能否 `git push origin`。`createOrUpdateIsolatedCheckout` 接收 `repoURL`，remote 应在，但要跑通一次；不通则给 knowledge 检出显式补 remote。
- `server/internal/daemon/daemon.go`：`repoAllowlist` 与 `syncWorkspaceRepos` 一并处理 `kind=knowledge`；`convertKnowledgeForEnv` 填 `TaskContextForEnv.KnowledgeSources`。
- `server/internal/daemon/execenv/knowledge.go`（新）：在 `Prepare`（跑在 `PrepareIsolated` 辅助进程中）里用 repocache 独立检出建 `.enact/knowledge/<slug>/`，sparse 检出 `path`，按 `ref`；扫描 front-matter 生成 `KnowledgeIndex`（60 篇上限，超出列目录）；全部路径记进 sidecar manifest。检出失败降级为 brief 只留 URL 与 checkout 提示，不让任务失败。
- `runtime_config_sections.go`：新增 `writeKnowledge`，不再在 Workspace Resources 里列出；`.enact/project/resources.json` 一并写入知识库条目。
- 测试：front-matter 解析与索引上限（node 环境 `.test`）；brief 快照；`repoAllowlist`；manifest 回滚覆盖 `.enact/knowledge/`。

### Phase 3 — CLI、复盘指令、内置技能、文档

- `server/cmd/enact/cmd_resource.go`：`--type knowledge_repo --url --ref --path --delivery`。
- 新增 `enact agent knowledge list|add|remove <agent-id>`。
- `server/internal/service/builtin_agents/retrospect/INSTRUCTIONS.md`：「Writing a knowledge document」改为知识库优先，写明 front-matter 必填项、`delivery` 行为、“先看索引再开单篇”。
- 同 PR 更新 `builtin_skills/enact-resources`、`enact-runtimes-and-repos`、`enact-creating-agents` 的 `SKILL.md` 与 `references/*-source-map.md`。
- 文档四语：`resources.mdx`、`retrospect.mdx`、`agents.mdx`、`cli.mdx`；`developers/conventions.mdx` 与 `.zh.mdx` 词汇表加「Knowledge base → 知识库」。

### Phase 4 — 前端（Phase 1 完成后可与 2、3 并行）

- `packages/core`：`types/resources.ts` 加 `knowledge_repo` 与 `KnowledgeRepoResourceRef`；zod schema 走 `parseWithFallback`；`useAgentKnowledgeSources` 与 attach/detach mutation（key 含 `wsId`）；畸形响应测试。
- `packages/views/settings/components/resources-tab.tsx`：「添加知识库」按钮，复用 GitHub picker 与 `CustomRepoForm`；新增 `KnowledgeRepoRow`（url / ref / path / delivery）。
- `packages/views/agents/components/tabs/knowledge-tab.tsx`（新，照 `ontologies-tab`）：列工作区知识库并勾选绑定；`agent-overview-pane.tsx` 注册 `knowledge` tab。
- 四语 locale `resources.json`、`agents.json`；旧桌面端未知类型走现有 `UnknownResourceRow`。

### 预估

| 阶段 | 复杂度 | 预估 |
| --- | --- | --- |
| Phase 1 后端 | 中 | 5–7 h |
| Phase 2 daemon | 中高 | 6–8 h |
| Phase 3 CLI/指令/文档 | 中 | 3–4 h |
| Phase 4 前端 | 中 | 5–6 h |
| 合计 | 中 | 19–25 h |

## 4. 风险

- **HIGH：push 链路。** 凭据靠 daemon 环境透传的 `gh` credential helper；Phase 2 开头验证，不等到最后。
- **MEDIUM：`Prepare` 在隔离辅助进程里。** 检出拉长准备时间；靠 sparse 检出 `path` 控制，索引扫描限制在 `path` 内。
- **MEDIUM：`local_directory` 场景。** 检出落在 daemon 自有目录，brief 用绝对路径；in_place 模式下用户目录一个字节都不多写。
- **MEDIUM：三条 claim 路径与无外键清理。** 用 Phase 1 测试钉住。
- **LOW：brief 体积。** 只放索引不放正文，60 篇上限。
- **工作树。** main 上有未提交的 marketplace / ontologizer 改动，先提交或在 `feat/knowledge-base` worktree 上做。

## 5. 后续（不在本次范围）

- 知识库超过百篇：pgvector 按任务检索，只注入相关几篇的索引条目。
- Agent Family 级绑定。
