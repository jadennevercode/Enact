# mmm-runtime 架构与构建方法论

**状态：v2 定稿（2026-08-08）** —— D1–D9 全部裁决完毕，见 §7。
**定稿后效力：** 后续所有工作（平台契约提取、逐项 diff、Orchestration 重构、按契约重塑、应用化）只执行本文档，不再回头议架构。修订本文档需要一次显式的拉齐会话。

**上游依据：** `AgenticMMM0612 V2/docs/agent-design/`——00（体系）、05（项目管控智能体）、08（产品架构 v2）。平台文档与其代码不一致时，以代码实现为准。

---

## 1. 六条设计公理（前四条从平台继承，后两条为本轮所加）

| # | 公理 | 平台出处 | runtime 转译 |
|---|---|---|---|
| A1 | **任务按 M/A/C/H 分类**：机械 / 可自动 / 认知 / 人专属。标签决定执行者、呈现形态与审计要求 | 08 §2 | M→Tool/App 执行；A/C→Skill 内的步骤；H→Gate，由 Orchestration 呈现为选择题 |
| A2 | **AI 永不直接改状态**：AI 的一切产出都是草案，状态变更只走唯一写入通道 | 08 §3 Proposal→Apply | 产出型 Skill 只写 artifact 草案；`state/progress.yaml`、`decisions.log`、gate verdict 只有 Orchestration 写 |
| A3 | **编排集中**：业务智能体不互调，一切跨组件流转经过管控层；管控层不产出业务 artifact | 05 全篇 | orchestrator skill = 项目管控智能体的 runtime 化身，独占状态机 + Gate 路由 + 审计 + 知识回流触发 |
| A4 | **内部语言与用户语言隔离**：架构词汇只许出现在文档与代码里，对话和产出物只说业务语言 | 08 §7.3 | Skill 话术规范 + 禁用词表（§6），check_suite 可静态检查产出模板 |
| A5 | **交付物驱动，无任务编号**：流程的单位是交付物，层级 = 阶段 → 交付物 → 构建它的步骤；"流程本质都服务于 Artifacts" | 08 §10.1.7（B-8 Artifacts-Driven 重构）· 用户裁决 | 一个 Skill 执行一件事 = 产出一个交付物；状态机、gate、依赖全部挂在交付物上；runtime 的 1.0a–2.6 与平台的 1.0–4.1 编号体系一并废除，平台编号只作契约卡的出处引用 |
| A6 | **澄清优先**：动手前先问清楚，问题必须是"答案会改变产出"的问题；澄清结论登记留档，不重复问 | 07-assumptions-log（平台的假设登记表）· 用户裁决 | 每个 Skill 的第一步固定是澄清步（§4.0），答案写进交付物的假设登记，Orchestration 的 audit 检查"未澄清即开工" |

---

## 2. 组件分类法

### 2.1 判定规则（按序问，第一个"是"即归类）

对任何一个能力单元：

1. **同样输入必然同样输出、执行中零判断？** → **Tool**（M 类）
2. **有固定产出形态（图表页/工作簿/文档），职责是把多个 Tool 的 payload 组装成这个形态？** → **App**（M 类组装线）
3. **内容靠生成、但产出有 schema 或规则可机器校验？** → **Skill 内的 A 步骤**（草案直接呈现，人抽检）
4. **需要认知判断、没有客观对错？** → **Skill 内的 C 步骤**（必须呈现：建议 + 证据 + 候选，等人裁决）
5. **需要担责（客户承诺、口径拍板、验收）？** → **Gate**（H 类），Skill 不得自答，由 Orchestration 呈现
6. **是跨项目可复用的事实/规则/区间/模板？** → **Knowledge**
7. **是约束所有组件的硬规则（provenance、gate 协议、文件所有权）？** → **机制**（`shared/`），改动需 selftest 红→绿

一个平台任务通常拆出多个类（平台原生案例：2.11 打分是 M，0.5 分处置是 H）。Skill 是 A/C 步骤的**编排容器**，不是能力单元本身。

### 2.2 所有权矩阵（谁可以写什么）

| 写入对象 | 唯一写入者 | 其他组件 |
|---|---|---|
| `state/progress.yaml`、`decisions.log`、gate verdict | Orchestration | 只读 |
| `artifacts/**`（store 类草案） | 产出型 Skill | Orchestration 只验收不代写 |
| computed 类 payload、`state/tool-runs.jsonl` | Tool（经 CLI 落盘 + 落 trace） | 模型不得手写数字，机制照旧 |
| 图表页 / 工作簿 / 交付文档 | App | Skill 决定"生成什么"，App 保证"长什么样" |
| `knowledge/`（库沉淀区） | 知识回流通道（人过 gate 后） | Skill 只 recall，不直写 |
| workspace `metadata/`（项目定制区） | 对应 Skill + 人 | 带留痕 |
| `shared/` 机制文件 | 仅经拉齐会话修订 | 所有组件遵守 |

### 2.3 现有组件初判归类（Phase 2 逐项复核，此处只定方向）

- **12 个 Skill**：按 A5 重切为"一个 Skill 一个交付物"——多模式多产出的 skill（如 scoping 产 3 个 artifact）拆开或把次要产出降级为交付物的内部输入（平台 B-13 的做法：材料索引、知识包都是 internal 输入，不是交付物）；全部砍掉"Finishing a mode"自行收尾段（违反 A2/A3）；`data-intake` 与 `data-engine` 职责重叠，Phase 2 合并裁决
- **25 个 CLI tool**：全部补上独立表达（§4.2，`tools/catalog/<id>.yaml`）。住在 Skill 里的脚本（build_workbooks）迁进 `apps/workbook/`。
  **`render.html` 与 `export.xlsx` 复核后保留为 Tool**——它们已经完整遵守 Tool 契约（产物落盘、有界摘要、一行运行记录），迁到 App 层只会制造改动而不解决任何问题。§4.3 的 App 标准是用来判断"该不该新建一个 App"，不是用来把已经干净的 Tool 搬家的。这条初判被证据推翻，记在此处备查。
- **engine（mmm_engine）**：降级为 Tool/App 共享的纯计算库，不再是对外身份
- **`scripts/gate_check.py`、`state.py`**：Orchestration 的内部工具，其他 Skill 不再直接调用
- **`knowledge/`**：现状只读，缺"项目定制区→沉淀区"的回流通道（§4.4 补）

---

### 2.4 交付物清单（A5 落地：产品的完整表面）

**11 个交付物，两个阶段，一物一 Skill。** 这份清单取代原来的任务表，是 `deliverables.yaml` 与契约卡的目录。

| 阶段 | 交付物 | 产出 Skill | 依赖 | 人工确认 |
|---|---|---|---|---|
| 业务理解 | 项目档案 | scoping | — | 确认（口径锁定） |
| | 因子树 | factor-tree | 项目档案 | 确认（逐行采纳/剔除） |
| | 访谈 | interview | 项目档案 · 因子树 | 确认（回写因子树的改动） |
| | 数据需求与验收 | data-request | 因子树（经访谈回写） | 确认（发出前） + 客户签收 |
| 数据 | 发布数据集 | data-engine | 数据需求与验收 | 确认（清洗逻辑与发布） |
| | 因子映射 | factor-map（原 data-intake 改名） | 发布数据集 · 因子树 | 确认（待定行逐条裁决） |
| | 数据质量评分 | data-quality | 因子映射 | 确认（0.5 分项处置） |
| | 业务校验与签核 | business-validation | 数据质量评分 | **客户签核**（每图） |
| | 统计检验 | stat-screening | 业务校验与签核 | 确认（边缘分值取舍） |
| | OLS 预验证 | ols-test | 统计检验 | 确认（区间反常识判读） |
| | 模型输入 | master-data | OLS 预验证 | 确认（锁定，交付终点） |

**内部输入（非交付物，不单独立卡）：** SOW / 立项说明、客户报告与行业材料、行业知识包、目标 schema 与枚举、客户交付的原始数据文件。它们参与血缘与证据引用，但不作为交付物出现在流程上——这是平台 B-13 的做法（`internal=true`）。

**范围终点：** 模型输入锁定。建模与报告不做，也不提取契约（D3）。

## 3. 目标架构

```
┌─ 对话层 ─────────────────────────────────────────────┐
│  话术规范 + 禁用词表：结论先行，只说业务语言                  │
├─ Skill 层（薄）──────────────────────────────────────┤
│  产出型 Skill：编排 A/C 步骤，写 artifact 草案，调 Tool/App   │
│  不写状态，不关 gate，不收尾                                │
├─ Orchestration 层（唯一状态写入者）───────────────────────┤
│  状态机 · gate 呈现与 verdict 记录 · 审计日志 · 回流触发       │
│  audit：状态与磁盘对账                                     │
├─ Tool / App 层（确定性执行）──────────────────────────────┤
│  Tool：一次计算一份 payload + 一行 trace（tool.yaml 独立表达） │
│  App：图表页 / 工作簿等固定形态的组装线                        │
│  底下是共享计算库（原 engine），无对外身份                     │
├─ 存储层 ────────────────────────────────────────────┤
│  workspace 文件（store/computed/view，file-kinds 照旧）      │
│  knowledge 库（沉淀区）+ workspace metadata（项目定制区）      │
└─────────────────────────────────────────────────────┘
```

### 3.1 交付物状态机（取代任务状态机）

流程的机器可读形式从"任务清单"改为**交付物依赖图**（`shared/manifests/deliverables.yaml`）。每个交付物一条记录：

```yaml
- id: factor-tree              # 交付物名即身份，无编号
  stage: s1
  owner: factor-tree           # 产出它的唯一 Skill
  requires: [project-profile]  # 依赖的上游交付物
  inputs: [inputs/industry-reference/**]   # 人提供的原料（internal，非交付物）
  gate: confirm                # 需要的人工确认类型；none 表示无 gate
  template: templates/factor-tree.yaml
  platform_ref: "1.21/1.22"    # 平台契约卡出处，仅引用用
```

交付物生命周期（沿用平台 B-8 的 DeliverableState）：
`locked（依赖未齐）→ queued → building → needs-you（等人裁决/输入）→ ready → confirmed`。
`state/progress.yaml` 记录的就是每个交付物的状态与凭证，不再有任务号。

### 3.2 Orchestration 职责（对应平台管控智能体四职责的 runtime 版）

| 平台职责 | runtime 模式 | 说明 |
|---|---|---|
| 推进进程、控制节点 | `status` / `next` | 改读交付物依赖图：哪些 confirmed、哪个 building、哪个 needs-you、卡在哪 |
| 协调拆解与上下文同步 | 按 `owner` 路由到 Skill | 血缘由 artifact meta 承载 |
| 质量管控触发人工介入 | **`gate`（新增）** | 呈现 gate（候选 + 推荐 + 后果 + 证据），收 verdict，落 `decisions.log`，流转交付物状态 |
| 记录项目发展 | **`close`（新增）** + `audit` | `close`：跑 predicates、`ready`/`confirmed` 流转——Skill 交付后唯一的收尾入口；`audit`：状态与磁盘对账 |
| （项目收尾）知识回流 | **`promote`（新增）** | 交棒给 `retrospect`，它交回复盘报告后按常规开 `retrospective/promote` 签核、记裁决、验收。汇总、卡片、落库都不在编排层——那是干活，不是编排 |

产出型 Skill 的收尾协议改为一句话：**"交付物 X 已写好，请验收"** → Orchestration `close`。selftest 增加对抗断言：产出 Skill 试图直接调 `state.py` 流转状态 / 写 verdict 必须被拦。

### 3.3 保持不动的机制

`shared/gate-protocol.md`（五条 gate 规则）、`shared/numbers-provenance.md`（computed_by_tool / view_derived_from）、`shared/file-kinds.md`、grounding 预算与 reads 白名单——**语义全部不变，只挪执行者**。这是本次重构的红线：机制变弱即失败。

---

## 4. 构建方法论（每类组件的标准制作规程）

### 4.0 澄清协议（A6，所有 Skill 的第一步）

**为什么是机制而不是习惯：** 不澄清就动手 → 只能靠猜 → 猜出来的东西必须用大量限定、铺垫、免责的话来包装 → 这就是"废话多、听不懂"的根源。澄清一次，后面每句话都能说得短而肯定。

**先读后问（硬性）。** 澄清前必须读完该交付物 reads 白名单内的全部输入。**输入里已经回答的问题不许问**——问了就是没读，这是最伤信任的一种废话。

**只问会改变产出的问题。** 自检：这个问题的两个答案会导出同一份交付物吗？会 → 不问，按默认走并在假设登记里记一句。四类值得问的：

| 类型 | 什么时候问 | 例子 |
|---|---|---|
| 缺失 | 输入里没有、又是下游硬依赖的 | SOW 没写时间颗粒度，而它是全链路契约 |
| 冲突 | 两份材料互相矛盾 | 财报口径营收 100M vs 营销收数 87M |
| 岔路 | 有多条合理路径且成本不同 | 因子树以行业模板起底 vs 以客户自有树起底 |
| 越界 | 要替客户担责的判断 | 这个异常算真实业务波动还是数据错误 |

**问的形式：选择题 + 推荐 + 后果**，与 gate 呈现同构（禁止开放式填空题）：

```
【澄清 1/3】时间颗粒度
读到：SOW 只写"月度汇报"，没有定义建模颗粒度。
  A. 月度（推荐）—— 与汇报节奏一致；媒体投放周内波动会被平滑掉
  B. 周度 —— 能捕捉促销脉冲；要求客户按周提供全部因子数据，收数难度上一个台阶
```

**一次问完。** 同一交付物的澄清点批量提出（按影响面排序），不要挤牙膏式追问。

**登记留档。** 每条澄清的问题、答案、决定人、时间写进该交付物的假设登记（workspace 的变更账本内）。已登记的事项，任何 Skill 不得重问；人改主意时走一次显式修订并留痕。

**问不到人时。** 用户不在场则按推荐项走，并在交付物 meta 标 `assumed: true` + 理由——**假设是登记出来的，不是沉默滑过去的**（同 §5 有意放弃登记表的逻辑）。

### 4.1 Skill

**结构：**
```
skills/<name>/
  SKILL.md          ≤100 行中文操作规程
  references/       每模式一份执行细则
  templates/        每个产出物一份模板（骨架 + 占位符 + 一段填写说明）
```

**SKILL.md 必含且只含：** 一句话定位（产出哪个交付物）→ **第 0 步：澄清（§4.0，列出本交付物的固定澄清点）** → 构建步骤（编号顺序，每步标注 M/A/C/H；M 步写"调哪个 tool"，C 步写"呈现什么候选"，H 步写"交 Orchestration 开 gate"）→ 产出物模板引用 → reads 白名单表。**不含：** 设计理由、平台历史、机制原理（这些属于 `shared/` 和 docs）。一个 Skill 仍可有辅助动作（如 factor-tree 的 inspect、apply-proposals），但它们都作用于同一个交付物——作用于别的交付物就该是别的 Skill。

**产出物一律照 templates/ 填空**，模板字段来自平台契约卡（§5）。模型不得自创文档结构。

**话术规范（六条，写进每个 SKILL.md 尾部）：**
1. 结论先行：先说结果，再说依据，不铺垫
2. 只说业务语言，禁用词表（§6）词汇不出口
3. 每步三句话内交代：我做了什么 / 结果是什么 / 需要你什么
4. 需要人裁决时永远给选择题：候选 + 推荐 + 每项后果，不给开放问答
5. 数字必须报出处（哪次 tool run），说不出出处的数字不说
6. 拿不准就问，别用模糊措辞蒙混——"大致""可能""建议进一步确认"这类词往往是该问没问的痕迹（§4.0）

### 4.2 Tool

每个 tool 一份独立表达，`tools/catalog/<id>.yaml`：

```yaml
id: data.conform          # 与 CLI id 一致
kind: data
purpose: 一句话：这个工具判定什么
when: 哪些任务的哪一步调它（引用契约卡任务号）
inputs: [路径或 payload 引用]
output: payload 路径模板 + 字段说明
stdout: 有界摘要给什么（示例三行）
example: 一条完整命令行
```

契约照旧：payload 落 `--out`、stdout 有界、一行 trace、空结果带原因。`check_suite` 校验 catalog 与 CLI 注册表一一对应——catalog 缺一个已注册 tool 即失败。Skill 引用 tool 时引 catalog，不再散文描述。

### 4.3 App

**立项标准（三条全满足才立 App）：** ① 产出有固定形态（页面/工作簿/文档）；② 形态需要跨 Skill 复用或对客户交付；③ 内容全部来自 computed payload；**App 不做判断**。App 可以对 payload 做**声明式归约**——口径由 payload 指定、归约集合封闭、且与 Tool 的同一归约逐位比对通过（见 D10 与 `shared/fold-contract.md`）。

③ 这条原本写作"App 自己不算数、不判断"，2026-08-11 按 D10 收窄到"不判断"。界线划在**判断**上而不是**算术**上：一个把 payload 里的数按 payload 里指定的口径加起来的页面，没有任何分支能对同一份输入给出两个答案；一个决定哪些行在范围内、哪个指标该求和该取平均的页面才是越权。前者要的是逐位可验证，后者要的是禁止。

**结构：** `apps/<name>/`，入口一条命令（吃 payload 路径 + 模板参数，吐成品文件），产出登记 trace（同 Tool），模板内文案遵守禁用词表。首批两个：`apps/charts/`（图表页，接管 `render.html` + 平台 2.32 Charting 的职责）、`apps/workbook/`（工作簿，接管 `export.xlsx`、`build_workbooks.py`、`render_tree.py`）。

### 4.4 Knowledge（双分区 + 回流，平台 00 §8 / 05 §5.2 的 runtime 版）

| 分区 | 位置 | 内容 | 写通道 |
|---|---|---|---|
| 沉淀区 | `knowledge/`（插件内） | 跨项目：L1/L2 骨架、行业包、校验规则、话术模板 | 仅 `promote` 通道 |
| 项目定制区 | workspace `metadata/` | 本项目因子增删、口径备忘、客户特定定义 | 对应 Skill + 人，带留痕 |

**留痕：** 因子/指标/口径的每次增删改记录（内容 + 原因 + 来源：AI 推荐/报告/访谈 + 确认人 + 时间）——这是平台 StatusCheckList 的原文要求，落在 workspace 的变更账本里。
**回流：** 项目收尾 → 编排层交棒给 `retrospect` → 它汇集定制区留痕，逐条呈现"是否升级进沉淀区"（H 类，选择题）→ 通过的写入 `knowledge/` 并在 `index.yaml` 登记，带来源戳（项目/gate/时间），整批经 `retrospective/promote` 签核。AI 可以提名，**不能自行入库**。项目没到终点只汇报，不落库。

**第二个方向：** 回流不只有"项目 → 知识库"。用户在过程中的纠正与习惯记进 `metadata/skill-feedback.jsonl`（`state.py record-feedback`），收尾时同一道门里逐条拍板，批准的直接改 `skills/` 下对应的文件——**这是插件唯一被写的两个地方**，边界与四道约束见 `shared/workspace-layout.md`。一个只会往知识库沉淀、却永远不改自己做法的系统，会把同一个被纠正过的毛病带进下一个项目。
**引用：** 现有两模式照旧（prose recall 记 `knowledgeRecall`；keyed lookup 供数字），行业包按目录锚定的隔离机制不变。

### 4.5 机制

`shared/` 下每份机制文件的修订流程：先在 selftest 写出会失败的对抗断言（红）→ 改机制 → 断言过（绿）。没有对抗断言的机制改动不接受。

---

## 5. 与平台的契约关系

**契约卡**（Phase 1 的产出，`docs/specs/platform-contracts/`），**每个交付物一份**（不是每个平台任务一份——平台任务号只在出处栏出现）：

```
交付物名称 · 所属阶段
平台出处：对应的平台任务号与源文件（仅引用）
Class 拆解（照 08 §2.2 打标表，按构建步骤标注）
输入：依赖哪些上游交付物、人提供哪些原料
构建过程：编号步骤（文档定义 × 代码实现校对后的定稿）
产出：字段级格式样例（即 Skill templates/ 的直接来源）
Gate：触发条件、候选处置、路由（照 05 §4.1 路由表）
```

**校对规则：** 文档与 `backend/app/` 实现不一致以实现为准，差异记入卡片备注。
**有意放弃登记表**（`docs/specs/deliberate-omissions.md`）：每条记"平台有什么 / 为什么不要 / 什么条件下重审"。已知候选：双平面协作 Workspace、Insight Engine、Copilot 常驻面板、SLA/周计划调度、交互式数据 grid。放弃是登记出来的决定，不是沉默。

---

## 6. 禁用词表（初版，随契约提取追加）

对话与产出物中不得出现：**gate、predicate、manifest、grounding、provenance、computed/store/view、artifact（对客户时）、orchestrator、payload、trace、workspaceVersion、召回/recall（对客户时）、M/A/C/H**。
对应说法：待确认 / 需要你的决定、检查项、任务清单、依据材料、数据来源、交付物、项目状态、计算结果、运行记录。
落点：Skill templates 与话术规范受 `check_suite` 静态检查；SKILL.md 正文（工程内部文档）不受限。

---

## 7. 决策记录

**已裁决（2026-08-08）：**

| # | 问题 | 裁决 |
|---|---|---|
| D1 | 任务编号体系 | **废除编号，交付物驱动**（→ A5） |
| D2 | Skill 粒度 | **一个 Skill 一个交付物**（→ A5） |
| D3 | 建模 / 报告阶段是否入界 | **不做**；契约卡也不提取（范围止于数据交付） |
| D4 | `data-intake` vs `data-engine` 重叠 | **改判：不合并，改名。** 早先"重叠"的判断只凭名字；读过两者定义后确认是两个交付物——`data-engine` 是"客户文件→发布长表"，`data-intake` 是"因子树↔已发布数据的配对"。按 A5 一物一 skill，保留两个，把误导性的 `data-intake` 改名为 `factor-map` |
| D5 | 产出物语言 | 跟 workspace `language` 字段走；对话一律中文 |
| D6 | 平台前端交互（选择题 Gate、diff 呈现）如何降级 | 文本形态完整继承：gate = 候选+推荐+后果+证据；diff = 变更表。**形态降级，信息结构不降级** |
| D7 | S1 是否补 KBQ | **不做 KBQ**。S1 = 4 个交付物：项目档案 / 因子树 / 访谈 / 数据需求与验收 |
| D8 | 澄清是否机制化 | **是** → A6 + §4.0 澄清协议 |

| # | 问题 | 裁决（续） |
|---|---|---|
| D9 | "S3 不做"的边界 | **止于模型输入锁定。** 业务校验（含客户签核）、统计检验、OLS 预验证、模型输入四项保留在范围内；不做的是建模与报告。无 skill 删除 |

**已裁决（2026-08-11）：**

| # | 问题 | 裁决 |
|---|---|---|
| D10 | 业务校验的图表页能不能在浏览器里聚合数据 | **能，且这是本轮有意推翻的一条旧决定。** 原设计是"所有切法预先算好、页面只换视图、页面自己不做算术"（`apps/charts/interact.py`、`apps/charts/README.md`）。业务方要求的筛选器（时间粒度 × 品牌 × 渠道 × 区域 × 数据来源子集 × L4–L8 下钻路径 × 指标子集）的状态空间是组合爆炸的，预先算好等于同样的算术做 10⁶ 次再塞进页面。**改法不是放宽标准，是加机制**：归约口径写进 `shared/fold-contract.md`；`mmm_engine/charts/fold.py` 与 `apps/charts/js/fold.js` 是同一份契约的两个实现；`validation.panel` 按规则枚举 400 个状态的黄金结果，生成页面前用 node 重放 JS 内核逐位比对，不一致就拒绝写文件；页面另内嵌 32 个状态在首屏绘制前自检，不一致就不画图。§4.3 ③ 相应收窄到"不判断"。`docs/specs/deliberate-omissions.md` 里"让 `validation.series` 一次性输出几种预置切法"那条同时作废。 |
