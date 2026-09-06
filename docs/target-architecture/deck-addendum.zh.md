# 牌子增补 —— 四页

一题一页，共 4 页。下面每条论断都落在当前代码库上，出处写在段末，可逐条复查。
现有牌子 26 页，重叠处在每页末尾标出。

---

## 第 1 页 · 集成与扩展：身份、能力、算力是三件事

**主标题建议**：Identity, capability and compute are three separate things

### 上区 —— 六层绑定关系

承重结构是这个分离：**智能体**是一份可复用配置（职责、指令、模型、skill、本体、Access）；**运行时**是执行它的那台机器加那个 AI 编码工具；**task** 是一次执行记录。换运行时不改变这个智能体是谁，换智能体也不改变它跑在哪。

| 层 | 是什么 | 何时绑定 |
| --- | --- | --- |
| 智能体 | 身份、职责、指令、模型偏好 | 配置时 |
| skill / 本体 | 某类工作怎么做；领域语义 | 挂到智能体上 |
| MCP 服务 | 可以调什么工具 | 每次运行解析 |
| 运行时档案 | 用哪个协议族、哪个二进制 | 工作区级 |
| 运行时 | 已注册机器及其并发与健康度 | 守护进程注册时 |
| task | 一次运行，带受限凭据与完整记录 | 派发时 |

**23 个协议族**可作为自定义运行时档案的底座：claude、codex、copilot、cursor、opencode、openclaw、hermes、pi、kimi、qwen、qwenpaw、grok、kiro、antigravity、qoder、qoderclicn、traecli、codebuddy、deveco、reasonix、dsh、mcode、dim。白名单强制两遍 —— Go 里一遍，`runtime_profile.protocol_family` 的 `CHECK` 约束一遍 —— 工作区只能在官方支持的后端之上建自定义档案。

### 中区 —— MCP 分四层解析，活的那层赢

工具权限不在一个地方配置，四层合并成交给某一次运行的配置：

| 层 | 作用范围 | 谁管 |
| --- | --- | --- |
| 工作区 MCP 服务 | 工作区内所有智能体 | admin |
| 智能体 MCP 服务 | 单个智能体 | 智能体所有者 |
| 单次运行 overlay | 一次运行 | 派发时实时解析 |
| 插件桥接 MCP | 插件贡献的工具 | admin 授权 + 审批 |

合并契约刻意做浅：在 `mcpServers` 下**按名字**合并，重名时**overlay 赢** —— 它带的是实时的用户级会话凭据，已保存的那条要么过期要么是共享占位。overlay 格式错误时，已保存的服务原样下发：静默停掉团队现有工具是更糟的失败。

### 下区 —— 三条给安全评审的性质

- **远程 MCP 凭据由 broker 按连接现取**，密钥不落进 task 记录。
- **插件 MCP 审批钉在 schema 摘要上** —— 工具改了 schema，原审批就对不上，必须重新授权。工具无法在批准之后悄悄扩大它做的事。
- **插件扩展按能力授权，不按信任授权。** scope 出自封闭词表（`issues:*`、`comments:*`、`tasks:*`、`agents:read`、`members:read`、`storage:user|workspace`），外加唯一参数化形式 `net:<domain>`；其余解析期拒绝。`net:` 不是说明性的：iframe 的 CSP `connect-src` 白名单与 hook 传输的主机校验都由它派生。面只能挂 `issue_panel`／`sidebar_panel`／`modal`，钩子触发方式只有 `ui`／`manual`／`agent`／`event`，传输只有 `http`／`mcp`。

*出处：`server/pkg/agent/agent.go`；`migrations/120`；`internal/handler/mcp_overlay.go`；`internal/daemon/remote_mcp_broker.go`、`runtime_mcp.go`；`pkg/plugincontract/manifest.go`；migration 046/128/315/319–326/369。*

> **重叠**：17 页列集成品类，18 页列五种扩展面；本页讲底下的机制与治理性质，不重复清单。

---

## 第 2 页 · 全流程覆盖：八个阶段，五道模型不能签的闸门

**主标题建议**：Eight stages, five gates a model may not sign

### 上区 —— 阶段 · 智能体 · skill · 产物 · 闸门

每个新建工作区自动预置 9 个系统智能体与一个由编排者带队的交付 squad，带版本号，在工作区创建时和服务启动时各对账一次。方法论不是文档，是**十个可执行的 skill**。

| 阶段 | 智能体 | skill | 出口产物 | 出口闸门 |
| --- | --- | --- | --- | --- |
| Intake | SDLC Intake | `sdlc-intake` | `work-item.yaml` | 必须有具名 owner |
| Explore | SDLC Explorer | `sdlc-explore` | `exploration.md` | 自检清单 |
| Design & Contract | SDLC Contract | `sdlc-contract` | `contract.yaml` | **contract-approval · 人工** |
| Build | SDLC Builder | `sdlc-build` | `change-scope.yaml`、`ledger.md`、`build-evidence.md` | **scope-expansion + build-review · 人工** |
| QA | SDLC QA | `sdlc-qa` | `test-plan.yaml`、`qa-report.md` | 覆盖自检 |
| Release | SDLC Release | `sdlc-release` | `evidence-case.md` | **release · 人工** |
| Operate | SDLC Operator | `sdlc-operate` | `incident.md` | 事故关闭自检 |
| Learn | SDLC Learner | `sdlc-learn` | `lesson.md` | **lesson-approval · 人工** |
| 横切 | SDLC Orchestrator | `sdlc-orchestrator` | *不产出交付物* | — |
| 共享地基 | — | `sdlc-core` | 对象模型、状态机、模板、校验脚本 | — |

### 中区 —— 三条红线，与它们买到的职责分离

```
没有人工批准记录就没有过闸
测试预期不得从实现反推
不得写入已批准变更范围之外
```

- **闸门是两段式**：先确定性预检，后具名人工授权，顺序不能倒。LLM 收集证据、解释证据、指出缺口、给出建议结论 —— **它不签字**。批准只有来自 `.sdlc/config.yaml` 中具名 approver 的明确表态才算数；智能体、工作区 owner、沉默、状态变化，都不算。
- **QA 独立**：Test Intent 在**读实现之前**依据已批准 Contract 冻结（落 `test_intent_frozen` 事件），QA 与 Builder 上下文隔离，不修业务代码，只开 Defect 或 Amendment。
- **Build 有界**：发现 Contract 有缺口时不得在代码里"补上意图"，只能提 Amendment；范围扩大必须停下等具名批准。
- **Operate 向上游归位**：事故诊断不顺手改业务代码，缓解与修复转为新 Work Item。
- **签署角色**出自五项受控词表（业务负责人／架构／开发／QA／运维），由 `phase_review` 配置派生，不在两处各声明一遍。

### 下区 —— 状态机、两条通道、三层产物

**Work Item 状态机**带明确的转入条件与**回退规则**：`Proposed → Exploring → Contracted → Planned → Executing → Verifying → Decision → Completed`，另有 `Held` 与 `Cancelled`。回退是一等公民 —— `Verifying → Executing`（实现缺陷，留 Defect）、`Verifying → Contracted`（需求缺陷，留 Amendment）、`Decision → Exploring`（Reject 但改了还能回来，Gate 里写明 `reentry_conditions`）、`Decision → Cancelled`（这件事不该做）。最后这条出口是刻意留的：没有它，一个"不该做"的判断只能被写成永远回不来的 Exploring。

**两条通道**：`full` 与 `quick`。热修可以把探索压成几句事实确认、Contract 压到两条验收标准 —— 但**仪式随任务缩放，审批闸门从不缩放**。省的是篇幅，不是责任链。

**产物分三层**，且三层都要有：快速评审层（有人要读完做判断）、机读层（脚本要解析）、备查证据层（出事才翻）。同一内容需要两层时**手写一份、生成另一份**，两份手写视图必然漂成两份真相。

全部状态是 `.sdlc/` 下的文件 —— 可 `git diff`、可在 pull request 里评审、可离线审计。不依赖数据库，不依赖会话记忆。

*出处：`internal/service/sdlc_defaults.go`；`builtin_sdlc/skills/sdlc-core/SKILL.md` 及 `references/{redlines,gates,state-machine,evidence,artifacts}.md`。*

> **重叠**：11 页目前一行一阶段地介绍这套流程，本页取代它。

---

## 第 3 页 · 权限、安全与管控：边界画在哪，以及诚实地讲清楚

**主标题建议**：Where the boundary actually sits

### 上区 —— 四层授权，逐层收窄

| 层 | 管什么 | 关键性质 |
| --- | --- | --- |
| 工作区成员资格 | 每条查询都按 workspace 过滤 | 跨工作区 ID 保持不可区分的 404 |
| 组织角色 | `owner` / `admin` / `member` | 只管设置与团队管理，**不等于资源可见性** |
| 逐资源 Access | `private` / 允许名单 | admin 保留管理与查看，**不能绕过 Access 去调用** |
| 主体类型 | 人类 vs 机器 | 敏感端点要求人类主体 |

### 中区 —— 凭据分级与管控面

| 凭据 | 绑定到 | 生命周期 |
| --- | --- | --- |
| 会话 JWT（HttpOnly + CSRF） | 人 | 会话 |
| `enact_` 个人访问令牌 | 人 | 可撤销 |
| `mat_` task 令牌 | 人 + 智能体 + task + 工作区 | 随本次运行结束 |
| `mcn_` 云节点令牌 | 云运行时节点 | 由 Fleet 校验 |
| 守护进程令牌 | 一台执行机 | 配对建立 |
| 插件令牌 | 一个插件安装 | 可轮换、可撤销 |
| 签名能力 URL | 单个附件／头像 | 时限 HMAC |

task 令牌**以所属人的身份**认证 —— 这是有意的，让智能体能像本人一样评论、推进工作。也正因如此，计费类端点挂了显式的人类主体守卫：**智能体读不到、也动不了其所有者的账户**。密钥按集成分别封装在认证加密盒里（`ENACT_{LARK,SLACK,WECOM,DINGTALK,TELEGRAM,VCS,PLUGIN}_SECRET_KEY`），插件配置提供专门的 `secret` 字段类型，插件永不自渲染凭据表单。

### 下区 —— 诚实的那一段（这是加分项，不要软化）

**Enact 不承诺文件系统沙箱，并且把理由写在文档里。** 因为智能体无人值守运行，审批提示会被自动应答；默认路径上 Codex 跑 `danger-full-access`、Claude Code 跑 `--permission-mode bypassPermissions`。Linux 上原先的 `workspace-write` 已被**移除** —— 它让宿主 CLI 在任务内失去配置，而且只限制写入，从来拦不住任务读取并外泄凭据。任务继承守护进程用户的真实 `HOME`，这正是 `gh`、`aws`、`kubectl`、`gcloud` 能在任务里照常工作的原因，也意味着那个 home 底下的一切都够得着。

**所以真正的边界是守护进程所属的操作系统用户。** 平台提供的是缩小爆炸半径的东西，不是对抗性安全边界：

- 每个 task 一个 git worktree —— 智能体看得见你的改动，永不写你的目录，永不丢弃未提交的工作
- 每个 task 独立的工具状态与临时目录
- 受限的 task 凭据，无法冒充任何人
- 准备阶段在隔离进程组内进行，带多层看门狗

**给客户的建议是三档隔离**：专用系统用户（基线）／容器（中）／虚拟机（强）。凡是那个环境够得着的凭据，都要当作智能体可能会用到的凭据来对待。

**数据边界在云端与自托管完全一致**：工作区、任务、评论、状态、智能体配置、运行记录留在 Enact；AI 编码工具及其凭据、代码目录与本地文件、实际的文件改动与命令执行留在你的机器。唯一例外：智能体自定义环境变量存在 Enact 服务端，执行时下发给运行时。

*出处：`internal/middleware/{auth,workspace,ratelimit}.go`；`internal/handler/{actor_guards,agent_access}.go`；`internal/util/secretbox/`；`internal/daemon/execenv/local_worktree.go`；`apps/docs/content/docs/security-model.mdx`、`how-enact-works.mdx`。*

> **重叠**：22 页讲数据边界、23 页讲凭据与授权、24 页讲真正的边界。若本页上，建议把 23 与 24 合并进来，净减一页。

---

## 第 4 页 · 知识管理与沉淀：接得进来，写得回去，沉得下来

**主标题建议**：Read the enterprise's facts, propose changes back, promote what proved out

### 上区 —— 与 Intelligence Space 的对接：一个只读 MCP 面

Intelligence Space 是企业事实的载体：**同一份来源，三个视图**。`projects/<slug>/data/*.yaml` 与 `content/**.md` 是权威源，一个 loader 同时喂给 Next.js 站点（人读）、`machine/` 导出（机读）、MCP server（智能体读）。

智能体侧走 stdio MCP，**八个工具、两个资源，全部只读**：

| 工具 | 拿到什么 |
| --- | --- |
| `list_spaces` | 有哪些 Space、各自多大、源在哪 |
| `get_manifest` | 一个 Space 的地图：产物类型与 ID 前缀、导航树、ID 正则、每个集合的源文件 |
| `list_artifacts` | 按类型／前缀／状态／grounding 层／子串过滤，分页 |
| `get_artifact` | 单个产物全文：字段、来源、正文、正反双向引用、参与的追溯链 |
| `get_document` | 单个内容页全文与其引用的产物 |
| `search` | 跨 Space 关键词检索，精确 ID 与标题优先 |
| `get_trace` | 端到端追溯链，每一步解析到产物标题 |
| `validate_space` | 内容完整性校验 |

资源：`intelligence-space://catalog`、`intelligence-space://<slug>/manifest`。用 `INTELLIGENCE_SPACE_SPACES` 可把某个客户端限定到指定 Space，工具 schema 随之只暴露这些、拒绝其余。MCP server 与站点共用同一个 loader 并在文件变化时重读，所以**连着的智能体看到的永远是当前工作树**，不是某个过期快照。

`machine/` 导出是**地图而不是正文副本**：产物正文留在 YAML，导出告诉智能体存在什么、怎么互相链接、下一个该打开哪个文件。契约以 JSON Schema 写在 `schema/`，校验器每次运行都比对。

### 中区 —— 回写机制：提案是一个分支，批准是一次合并

**MCP 面是只读的。** 回写走的是普通 git，而不是给智能体开一个写接口：

```
npm run proposal:new -- <name>     建分支 proposal/<name> + 独立 worktree
（智能体在 worktree 里改源文件）
git commit                          pre-commit 钩子重生成 machine/ 并跑校验
/proposals                          在运行中的站点里看 diff 与提交，批准或驳回
```

四条设计性质值得讲：

- **独立 worktree**，所以主检出 —— 站点渲染的那份 —— 不会在你脚下换分支。
- **pre-commit 是内容完整性闸门**：只要提交触及内容、类型注册表或 loader，就重生成机读导出并校验。站点渲染不了的内容、与源漂开的 `machine/` 导出，**提交不进去**。这是把"人读视图和机读视图不得成为两份真相"变成机器强制的地方。
- **批准即合并**：`git merge --no-ff` 进主干后删分支；工作树不在主干上、或有未提交改动，一律拒绝；合并失败自动 `merge --abort`。**驳回即删分支**，提交仍在 reflog 里，可恢复。
- **写能力默认关闭**：需要 `INTELLIGENCE_SPACE_ALLOW_WRITES=1` **且**请求来自 loopback，否则答 404 而不是 403 —— 部署出去的副本不该暴露这个端点存在。

**这里要诚实**：项目自己的文档写明，这是**本机可用性开关，不是授权边界** —— 它挡得住只有 MCP 的智能体，挡不住能起 shell 的。真正的授权边界仍然是仓库权限与评审。

### 下区 —— Lesson Learn：经验只能由决定变成标准

平台侧的知识资产（指令、skill、本体、项目资源、任务时间线、证据记录）解决"知识存在哪"。`sdlc-learn` 解决更难的那个问题：**什么时候可以把一次经验固化成之后所有工作都要遵守的标准。**

**三档记忆层级**决定什么可以被当作事实引用：

| 层级 | 是什么 | 引用规则 |
| --- | --- | --- |
| `released` | 已批准 Contract、已完成 Work Item、已发布 lesson | 可直接当事实引用 |
| `current work` | 活跃 Work Item 的产物 | 可引用，但要带 Work Item 编号 |
| `experimentation` | 假设、已受理的未决问题、未验证 lesson | **必须标注为假设** |

它拦的是一条很隐蔽的路径：未验证的经验通常不是靠"被提升为标准"变成标准的，而是靠在下一个 Work Item 的探索阶段里，以"上次这块踩过 X"的形式被当成既定事实引用而变成标准的。

**固化走六阶段**，决定点上有一个具名责任人：
`Observe → Classify → Validate → Approve → Publish → Observe again`，由 **lesson-approval 闸门**把关。

**分类按影响半径**，把"这个改动能波及多远"写死：

| 目标 | 波及范围 |
| --- | --- |
| `project-doc` | 只有本项目 |
| `template` | 之后所有同类产物 |
| `checklist` | 之后所有走该清单的环节 |
| `policy` | 之后所有边界 —— 保护路径、数据策略、测试策略 |
| `eval` | 之后所有能力变更的验证基准 |
| `tool` | 之后所有调用该脚本的环节 |
| `skill` | **之后所有工作、所有项目**，且整个会话常驻 |

Validate 不是走过场：对**改动后的资产**重跑结构校验，解析出所有引用点（删段落尤其危险），并分开问两个权限问题 —— 谁有资格批准，以及改完之后**谁被允许使用**（`adoption_scope`）。git 权限能回答第一个，回答不了第二个。批准人是具名的 Capability Steward；新建一份资产同样走完整六阶段，因为一份没人评审过的新 reference，对之后每次运行的影响和悄悄改一份现有的一样大。

*出处：`ProjectIntelligenceSpace/README.md`、`mcp/server.mjs`、`mcp/space-api.mjs`、`scripts/proposal.mjs`、`lib/proposals/{git,gate}.ts`、`.githooks/pre-commit`；`builtin_sdlc/skills/sdlc-learn/SKILL.md`、`sdlc-core/references/objects.md` §9。*

> **重叠**：无。知识管理在现有牌子里完全缺席。

---

## 汇总

| 页 | 主题 | 与现有牌子的关系 |
| --- | --- | --- |
| 1 | 集成与扩展 | 新增；17／18 页讲品类，本页讲机制 |
| 2 | 全流程覆盖 | **取代 11 页** |
| 3 | 权限、安全与管控 | 建议**合并 23／24 页**进来 |
| 4 | 知识管理与沉淀 | 新增；现有牌子完全缺席 |

净效果：26 页 → 28 页（新增 4，退役 2）。
