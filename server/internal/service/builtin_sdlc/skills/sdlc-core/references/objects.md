# 对象模型

主规格 §05 定义的统一概念模型，在本 Skill 套件中的具体落地形式。名词一律沿用主规格英文原名，避免同一概念在不同环节被叫成不同名字。

## 目录

- [1. 落地对照表](#1-落地对照表)
- [2. Work Item](#2-work-item)
- [3. Execution Contract](#3-execution-contract)
- [4. Contract Amendment](#4-contract-amendment)
- [5. Change Scope（Managed Change Area）](#5-change-scopemanaged-change-area)
- [6. Evidence Event / Evidence Case](#6-evidence-event--evidence-case)
- [7. Gate Decision](#7-gate-decision)
- [8. Lesson Proposal](#8-lesson-proposal)
- [9. 记忆层级](#9-记忆层级)
- [10. 只在平台态存在的对象](#10-只在平台态存在的对象)

---

## 1. 落地对照表

| 主规格对象 | 本套件中的形式 | 对应决策 | 说明 |
|---|---|---|---|
| Space | `.sdlc/` 目录 + 项目代码库与文档 | — | 事实容器。代码库本身是权威源，`.sdlc/` 存平台原生对象 |
| Artifact | `.sdlc/` 下的每个产物文件 | — | 有稳定路径即有身份。类型看文件名，权属看模板头的编辑权限注释 |
| Revision | git commit | D9 | 内容哈希、作者、时序由 git 提供，不另建版本机制 |
| Artifact Change Proposal | `amendments/AMD-###.md` | — | 基于固定 base 提出的候选修订，含 checks 自检 |
| Merge Decision | `gates/*.yml` 中的批准记录 | D8 | 只有它能改变已批准的事实。含 `merged_revision` 与 `publish_scope` |
| Work Item | `work-items/WI-###-slug/work-item.yaml` | D4 | 唯一主记录 |
| Execution Contract | `contract.yaml` | D3 | 业务+技术+边界+发布的唯一真相。批准后不可变 |
| Capability Asset | Skill 套件自身的 references / templates / scripts | D10 | 版本即 git 历史；依赖关系见各 reference 的引用表 |
| Capability Bundle | 一次执行实际引用的模板与清单版本 | — | 由 `capability_bundle_pinned` 事件记录（见 evidence.md 动作词表） |
| AgentSpec | 每个 sdlc-* Skill 的 SKILL.md | — | 必须逐面声明九个配置面，清单见 authoring-conventions.md |
| FamilySpec | `.sdlc/family.yaml`（缺省回退内置序列） | D2 | 阶段序列、每阶段的出口产物与 Gate。由 sdlc-orchestrator 拥有 |
| Experience Pack | 各 Skill 的交互约定 + `render_review.py` 生成的 HTML | D13/D14 | 对话为主；六类 renderer 按需生成快照，不是常驻门户 |
| Context Bundle | 一次执行实际依据的文件与版本 | D6 | 由 `context_resolved` 事件记录——scope 声明时与每次范围扩大后各落一条 |
| Evidence Event | `evidence.jsonl` 的每一行 | D7 | 追加式，不修改不删除。含 `correlation` 用于跨对象串联 |
| Evidence Case | `evidence-case.md` | D7 | 面向一次 Release 决策组装 |
| Gate Decision | `gates/<name>.yml` | D8 | 受控词表 + 具名批准 |
| Lesson Proposal | `lessons/LP-###-slug/lesson.md` | D10 | 六阶段生命周期 |

---

## 2. Work Item

用户提出并被持续跟踪的一项工作。**唯一主记录**——其余产物都挂在它下面。

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | `WI-###`，脚本分配 |
| `slug` | 是 | kebab-case 短名，用于目录名 |
| `objective` | 是 | 一到两句话说明要达成什么。不是任务清单 |
| `owner` | 是 | 具名。**没有 owner 不得进入 Exploring** |
| `status` | 是 | 见 `state-machine.md` |
| `lane` | 是 | `full` 或 `quick` |
| `created` / `updated` | 是 | ISO 日期 |
| `contract_version` | 否 | 当前生效的 contract 版本号，批准后填 |
| `change_scope_version` | 否 | 当前生效的 change-scope 版本号 |
| `trigger` | 否 | 这件事因为什么发生：客户投诉 / 事故 INC-### / 路线图 / 复盘。回答"为什么是现在" |
| `dependencies` | 否 | 依赖的其他 WI 编号。与 `blocked_by` 不同——它记的是结构性先后，不是当前卡点 |
| `external_refs` | 否 | Jira/Issue 链接等。只存链接，不复制内容 |
| `blocked_by` | 否 | 阻塞说明 + 待谁处理 |
| `notes` | 否 | lane 变更理由、回退理由等 |

`objective` 写"要改变什么结果"，不写"要写哪些代码"——后者属于 Contract 和任务清单。

✅ `objective: 让导出的月度报表包含退款金额，财务对账时不用再手工补数`
❌ `objective: 修改 ReportExporter，加一个 refund_amount 字段`

---

## 3. Execution Contract

对这项工作的**可验证意图与边界**——业务与技术的全部声明都在这一份里。
它是 Build 做什么、QA 测什么、Release 凭什么决定的共同锚点。批准后不可变，要改走 Amendment。

### 四大块

| 块 | 内容 | 主要读者 |
|---|---|---|
| **业务声明** | `outcomes` / `requirements` / `criteria` / `scope` | 业务负责人、产品、QA |
| **技术设计** `design` | `approach` / `diagrams`（mermaid）/ `decisions` / `impact` / `nfr` | 架构、开发 |
| **变更边界** `boundary` | `may_change` / `must_not_change` / `allowed_actions` / `escalation` | 开发、架构 |
| **发布运维** `release` | `strategy` / `rollback` / `rollback_data_state` / `monitoring` / `support` | 运维、Release Authority |

外加横切的 `policies` 与 `open_decisions`。

### 为什么合成一份

三处此前是分开的，各自的问题都很具体：

- **design.md 是第二份手写真相。** 主规格原话「两种视图不能各自编辑形成两份真相」。
  现在只有 `contract.yaml` 手写，人类视图 `review/contract.html` 由 `render_review.py` 生成——
  生成物不会和源头漂移。
- **change-scope 由 Build 定义，等于让执行者划自己的边界。** 现在 Contract 声明意图级边界，
  Build 把它物化成文件级 change-scope，`check_scope.py` 校验后者 ⊆ 前者。
- **回退策略直到 Release 才第一次出现，太晚了。** "怎么退"是设计问题：某些方案根本回不去，
  那应该在契约阶段就影响技术选型，而不是发布前夜才发现。

### 合成一份 ≠ 给一个人读

`role_views` 声明每个角色该看哪几块，渲染器据此分标签页。
**角色既是视图也是权限**——同一套受控词表用于两处：`role_views` 决定谁看哪几块，`config.yaml` 的 `gates.<name>.require` 决定哪几个角色必须签。

两者必须对得上：签 contract-approval 的角色，其视图合起来要盖住 contract 的每一块，否则就有内容没有任何签署人看过。`coverage_stats.py --phase contract` 会检查这一点。

### criteria 的三条硬要求（QA 直接依赖它们）

1. **EARS 语法**。五种模式：
   - Ubiquitous：`系统 SHALL <行为>`
   - Event：`WHEN <事件> THEN 系统 SHALL <响应>`
   - State：`WHILE <状态> 系统 SHALL <行为>`
   - Optional：`WHERE <特性存在> 系统 SHALL <行为>`
   - Unwanted：`IF <异常前置> THEN 系统 SHALL <处理>`

2. **层级编号**（`1.1`、`2.3`）。build 的任务、qa 的 Test Intent、design 的图与决定都按这个编号回溯引用，编号是全套件的连接坐标。

3. **可独立验证**。读这条标准的人应该能说出怎样算通过。

✅ `WHEN 导出请求的时间范围超过 12 个月 THEN 系统 SHALL 拒绝并返回可读的错误说明`
❌ `系统应该有良好的性能`（无法验证，也不是 EARS）
❌ `优化报表导出逻辑`（是任务不是标准）

### 两层边界

| 层 | 在哪 | 说什么 | 谁写 |
|---|---|---|---|
| 意图级 | `contract.boundary` | 可以动哪些模块/接口，绝对不能动什么 | contract |
| 文件级 | `change-scope.yaml` | 具体动哪几个文件路径 | build |

推导不出文件级说明意图级写得太模糊——回 contract 补，不要在 build 里自己扩大解释。

---

## 4. Contract Amendment

Build 或 QA 中发现 Contract 不完整、矛盾或与现实不符时提出。**不允许在下游自行补意图**（红线 4.1）。

```markdown
# AMD-001

- 提出环节：build
- 提出时间：2026-08-21
- 基于 contract 版本：1

## 发现了什么
（具体是哪条 requirement/criterion 的什么问题，附证据：文件、报错、冲突的两处说法）

## 影响
（不解决会怎样：实现要么猜、要么做不下去、要么测不了）

## 建议处理
（改哪条、改成什么，或需要谁做什么决定）

## 处置
- 决定：accepted / rejected / deferred
- 决定人：
- 产生的 contract 新版本：

## checks（提出前自检）
- [ ] 这确实是上游缺口，不是实现难题
- [ ] 附了证据（冲突的两处说法各自在哪里 / 报错原文 / 接口实际形态）
- [ ] 说清了与同 WI 内其他 AMD/DEF 有没有因果关系
```

被拒绝的 Amendment 也保留——它是审计线索，也是 Lesson 的来源。

### Amendment 与 Defect 的分工

两者都由 QA 或 build 开出、都会让工作回退，但回退的目标完全不同：

| | Amendment（AMD） | Defect（DEF） |
|---|---|---|
| 说的是 | Contract 错了或没说清 | Contract 没错，代码没做到 |
| 归因类别 | `requirement` / `design` | `implementation` |
| 回到哪 | contract 环节，需人裁决 | build 环节，直接修 |
| WI 状态 | → `Contracted` 或 `Held` | → `Executing` |
| 模板 | `templates/amendment.md` | `templates/defect.md` |

**同一个 Work Item 里两者可以并存，但要说清它们有没有因果关系。** 把一个实现缺陷
和一个需求缺口混在一起描述，会让 build 修错地方——它可能去改代码来迎合一个
本来就该重新定义的需求。

---

## 5. Change Scope（Managed Change Area）

Build 开工前声明并确认的五类边界。可读范围宽、可写范围窄是它的核心。

```yaml
version: 1
approved_by: ""          # v1 低风险可由 owner 默认接受；扩大版本必须人工确认
read:                    # 可查询理解的范围，通常是整个项目
  - "src/**"
  - "docs/**"
read_excluded:           # 即使落在 read 内也不得读入上下文（密钥、凭据、真实个人数据）
  - "**/*.pem"           # 继承自 config.yaml 的 data_policy.never_read
write:                   # 本次允许修改/新建的具体路径
  - "src/reports/exporter.py"
  - "tests/reports/**"
protected:               # 明确不可改，即使看起来该改
  - "src/core/schema.py"
  - "infra/**"
  - ".github/workflows/**"
tool_actions:            # 允许的命令类别
  allowed: [lint, unit-test, build, vcs-commit]
  forbidden: [deploy, push, publish, network-write]
  environment: local     # 这些命令跑在哪：local | ci | staging
  credentials: none      # 可用的凭据集合；none 表示本次不需要任何凭据
escalation:              # 什么情况必须停下来找人
  - 需要修改 protected 中的路径
  - 需要新增 write 白名单外的文件
  - 需要执行 forbidden 中的动作
  - 发现 Contract 缺口（转 Amendment）
```

未显式列出的敏感区域默认按 protected 处理：共享接口、数据模型、基础设施、安全配置、CI 配置。

**`protected` 的两个来源要分开记**：继承自 `config.yaml` 的项目级保护，与本次 change-scope 自己收紧的部分。
`check_scope.py` 报违规时会指出来源层级——否则用户不知道该向谁申诉：项目策略要找平台负责人改，本次收紧找 WI owner 就行。

**`read_excluded` 优先于 `read`。** 写保护不等于读保护：一个 `.pem` 文件即使在 protected 里，
按"可读范围宽、可写范围窄"的原则仍然是可读的。密钥必须靠这一项拦住。

---

## 6. Evidence Event / Evidence Case

**Evidence Event**：`evidence.jsonl` 每行一个 JSON，追加式。最小契约（主规格 D7）：

```json
{"ts":"2026-08-21T10:22:31Z","actor":"sdlc-build","action":"file_modified",
 "input_refs":["contract.yaml#1.1"],"output_refs":["src/reports/exporter.py@a3f21c"],
 "result":"ok","notes":"新增 refund_amount 列"}
```

`actor` 写环节 Skill 名或人名；`result` 用 `ok` / `failed` / `blocked`；refs 尽量带版本（git hash 或 contract 编号）。

**Evidence Case**：面向一次 Release 决策组装的可读结果。详见 `evidence.md`。

两者的关系：Evidence Event 是完整流水（给审计和排障），Evidence Case 是为决策组织的摘要（给责任人）。**不要求任何人通读事件流来做决定**。

---

## 7. Gate Decision

见 `gates.md`。要点：受控词表 `PASS | CONCERNS | FAIL | WAIVED`，`approved_by` 必须是真人，`history` 追加不覆盖。

三个容易漏的字段：

| 字段 | 何时必填 | 为什么 |
|---|---|---|
| `merged_revision` | gate 为 PASS/CONCERNS 时 | 记录这次批准产生了哪个版本（contract v2 / git commit）。没有它就答不出"当时批准的到底是什么" |
| `publish_scope` | 同上 | 这次批准的生效范围：`task` / `project` / `domain` / `organization`。默认 `task` |
| `reentry_conditions` | gate 为 FAIL 且属于 Reject 性质时 | 允许重新进入的条件。缺了它，被拒的工作就没有复活路径 |

---

## 8. Lesson Proposal

```yaml
id: LP-001
status: observe          # observe | classify | validate | approve | publish | observed
source_evidence: [...]   # 来自哪个 WI 的什么证据
what_happened: ...
proposed_change:
  # 七类，对应主规格 §16 Classify：
  #   project-doc（Space 事实）| template | checklist | policy | eval | tool | skill
  target_kind: template
  target_path: ...
  new_asset: false       # true 表示新建资产而非修改现有；此时 target_path 是将要创建的路径
  change_summary: ...
  target_version: ...    # 批准的是目标资产的哪个版本（git hash 或 "新建"）
  adoption_scope: all    # 这条经验对谁生效：all | 本项目 | 指定 Family/环节
scope_of_validity: ...   # 什么条件下适用；说不清边界的不推进
counter_examples: ...    # 什么情况下不适用
approved_by: ""          # 只在 lesson-approval.yml 有效后填
published_version: ...   # git commit
observation: ...         # 发布后的效果，可回滚
```

被拒绝的 Lesson 保留存档。

**`new_asset: true` 是「晋升为新资产」这条路**（主规格 §08 明写「晋升为新资产**或**现有资产的新版本」）。
预检对它的要求不同：不检查 `target_path` 是否已存在，改为检查是否说明了创建理由与归属目录。

---

## 9. 记忆层级

主规格 §06 的最低功能要求之一。三档回答同一个问题：**这条内容能不能被当作事实引用？**

| 层级 | 本套件中是什么 | 引用规则 |
|---|---|---|
| `released` | `contract.status: approved`、WI 状态 `Completed`、`lesson.status: observed`（已发布且观察过） | 可以当作事实直接引用 |
| `current work` | 活跃 WI 的全部产物（exploration / contract draft / ledger / test-plan） | 可以引用，但要带 WI 编号说明它还在进行中 |
| `experimentation` | `exploration.md` §3 的假设、`open_decisions.status: accepted`、`lesson.status` 处于 observe/classify/validate | **引用时必须标注为假设，不得写成事实** |

为什么需要这一档划分：红线 4.2 拦住的是"未验证的经验自动变成标准"，但它拦不住一个更隐蔽的路径——
未验证的经验以"上次这块踩过 X"的形式，在下一个 WI 的探索阶段被当作既定事实引用。
`sdlc-intake` 和 `sdlc-explore` 在翻 `.sdlc/lessons/` 与历史 WI 时，必须先看它属于哪一档。

✅ `退款金额按订单全部退款计（假设 A1，WI-001 未经财务确认）`
❌ `退款金额按订单全部退款计`（把 experimentation 档写成了事实）

---

## 10. 只在平台态存在的对象

以下主规格对象在本套件中**不实现**，遇到时按对照关系理解即可，不要凭空创建文件：

- **Ontology / Skill / Tool / Policy / Evaluation 资产库**：本套件用 references + templates 承担同等作用，不建资产目录。
- **Context Recipe 的预算与配额机制**：本套件用"定向读取 + 记录 input_refs"替代，不做 token 计量。
- **Runtime Adapter / 多 Runtime 主备**：当前编码 Agent 会话（Claude Code、Codex，或由 Enact 管理的 Runtime）即 Runtime。
- **Experience Pack 的 renderer**：用 Markdown 产物与对话替代。
- **权限/租户/身份体系**：由 git 与文件系统权限承担。**注意它不覆盖两件事**：密钥读入上下文由 `config.yaml` 的 `data_policy` 管；资产的适用对象由 `lesson.adoption_scope` 管。
- **Intelligence Space 的事实索引 / Context Resolver**：不建跨 WI 的事实索引层。explore 每次做定向事实盘点，依据记进 `input_refs`。代价是同一项目的多个 WI 会重复考证同一批事实——这是用一致性换实现复杂度的取舍。
  **注意别和「向外同步」搞混**：不实现的是套件**内部**的事实索引层（供 explore 读）；而把交付结论**写出去**到一个外部的 Project Intelligence Space 产品是已实现的，见 §12。方向相反，治理也不同。
- **Board（看板）**：不实现。`wi_status.py` 的查询输出是 Work Item 的唯一投影，按"需要人动手的程度"组织而非按列组织。**不要新建看板文件**——Board 一旦存在就会变成需要维护的第二份记录，那正是 D13 要防的"退化成另一个 Jira"。
- **代理审批（delegated approval）**：不实现。批准人不可达时统一停在 `Held`，不设代签链。理由是"发不出去"比"发出去了但没人真正负责"便宜。
- **Mirrored snapshot（外部源只读快照）**：不实现。`external_refs` 只单向存链接。外部源被删改时证据链会断——若项目有审计或离线要求，需自行补快照。
- **Jira 状态双向同步**：不实现。`external_refs` 只存链接，不回写。
- ~~**Canvas / 可视化推理面**~~：**已实现**（2026-08-24 撤销这条偏离）。
  详见下方「可视化评审层」。

---

## 11. 可视化评审层

主规格反复指出的一个问题是：「人只能阅读大量输出再决定」。治理产物齐全并不解决它——
**读不过来的 Gate 会退化成扫一眼签字**，而那时候流程还在，责任已经没了。

`scripts/render_review.py` 从结构化产物生成**自包含 HTML**。按主规格 D14 限定六类 renderer，
不做任意低代码 UI Builder：

| renderer | 用在哪 | 视觉编码 |
|---|---|---|
| `matrix` | 追溯矩阵、覆盖热图 | HTML 表格 + 反向墨水：正常格子近乎隐形，只有缺口有墨水 |
| `graph` | WI 依赖、阻塞传播 | 手写 SVG 分层布局（确定性，可 diff、可引用） |
| `path` | 状态时间线、Gate、回退 | 横向条：**宽度=停留时长**；回退画成下方注解弧 |
| `tree` | 十维度覆盖 | CSS 缩进树 + 顶部分布条 |
| `compare` | 契约差异、声明 vs 实际 | 行内字符级 diff；集合比较用三分区不用维恩图 |
| `report` | KPI 卡、分节报告 | 大数字 + bullet 条（不用仪表盘） |

### 三条设计规则

**1. 每一层都要能降级到文字。** 只存在于 tooltip、只靠颜色、或只在 mermaid 里的信息，等于不存在——
评审者会打印、会 Ctrl+F、可能有色觉缺陷、可能离线。手写 SVG 无网可用，mermaid 只用于锦上添花。

**2. 反向墨水分配。** 正常项做到接近隐形，只有异常项有墨水。人眼扫的是墨水密度的**差**——
一张每格都有颜色的热图，信息量和全白的一样是零。缺口必须**显式填充**成 `✕` 而不是留空，
因为空白不吸引注意力，而缺口恰恰是最需要被看见的东西。

**3. 首屏回答三个问题**：能不能过、还差什么、谁要拍板。裁决横幅 + 「需要你决策的 N 件事」清单，
每条带锚点。读完这一块就能开会，其余是查证材料。

### 仍然坚持的边界（D13）

这些 HTML 是**按需生成的快照，不是要维护的门户**。改了源产物重新生成即可，不要手改 HTML，
更不要让它长成一张需要有人维护的看板——那正是「退化成另一个 Jira」。

生成物放 `WI-*/review/`（跨 WI 的放 `.sdlc/review/`），**可随时重建，不进人工编辑**。

---

## 12. 对外同步：Project Intelligence Space

交付完成后，`sdlc-learn` 可以把这一单的**业务层结论**写出到一个外部的 Project Intelligence Space
（一个独立产品，有自己的仓库、校验器与评审界面）。开关在 `config.yaml` 的 `intelligence_space`，默认关闭。

三条定义性质的边界：

| | |
|---|---|
| **方向** | 单向写出。空间**不回写** `.sdlc/`——Contract 仍是本项目唯一真相，双向同步会让它失去唯一性 |
| **层次** | 业务层过界，治理层不过界。可同步的正是 `contract.yaml` 的 `role_views.业务负责人` 那一组；WI 编号、文件路径、commit hash、Gate 批准人真名留在本仓库 |
| **Gate** | 对方仓库的**人工合并**，不在本套件手里。本套件只提 proposal，到此为止 |

它**不是**能力资产变更：改的是别人读到的关于产品的事实，不改变本套件之后怎么工作，
所以不走 Lesson 的六阶段。反过来也不成立——不得拿"要同步"当理由去改本套件的任何资产。

事件词表里对应 `intelligence_synced`（见 `evidence.md`）。协议细节在
`../../sdlc-learn/references/intelligence-sync.md`。
