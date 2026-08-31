# 契约卡：项目档案

**阶段：** 业务理解
**平台出处：** 1.0a（提供 SOW）· 1.0（框定档案）
· `backend/app/domain/blueprint.py` TASKS/ARTIFACTS（`a-sow` / `a-scope`）
· `backend/app/agents/business.py` `_profile_from_materials` / `_profile_sheet` / `frame_profile`（L45–L186）
· `backend/app/domain/models.py` `ProjectProfile` / `ModelScope` / `ModelScopeDimension` / `ProjectMeta`
· `docs/agent-design/01-business-agent.md` §3 Step 1 · `09-business-understanding-flow.md` §4 步骤 0 · `00-overview.md` §4 ①Scope
· 实盘样例 `Assets/Model Scope.xlsx`
**产出 Skill：** scoping

> **本卡只覆盖"项目档案"这一个交付物。** scoping 在平台上还承担 1.1a / 1.1 两步，产出
> `materials-index`（材料索引）与 `knowledge-package`（行业知识包）——平台把它们标为
> `internal: true`，不是交付物，是因子树的输入。它们的格式记在因子树卡的「输入」栏。

---

## 输入

| 来源 | 内容 | 类型 |
|---|---|---|
| 人提供 | 已签署 SOW + 立项简报（`inputs/project-background/`；平台 Project Folder 类目 `project_background`） | **internal 输入**（平台 artifact `a-sow`，`internal: true`） |
| 人提供 | 客户品牌名 / 行业锚点（L1/L2/L3）/ 响应指标默认值 | 建项目时录入（平台 `ProjectMeta`，非本交付物产出） |
| 上游交付物 | 无。这是流程的起点 | — |

**硬性：** 平台 1.0a 是 `requiresUpload: True` 的 intake 关卡，1.0 的处理器在读不到
`project_background` 文本时**不产出任何档案**，而是登记一条 flag（`_unreadable_upload_finding`）。
LLM 调用失败时同样**不落空档案**（`_parse_failed_finding`：*"No scope was inferred, so nothing
was produced rather than a misleading empty scope."*）。没有 SOW 就没有档案，不许用别的材料顶替。

---

## 构建过程

| # | 步骤 | Class | 执行者 | 说明 |
|---|---|---|---|---|
| 0 | 澄清 | C | Skill | 见下节。**先读完 `inputs/project-background/**` 再问**；SOW 里已写的不许问 |
| 1 | 收 SOW 与立项简报 | H | 人 | 平台 intake 关卡 `in-1.0a`，`category: project_background`，`requiresUpload: True`。空 → 交付物不产出 |
| 2 | 解析上传文件为文本 | M | Tool | 平台 `app/ingest/extract.py`，支持 pdf/pptx/docx/xlsx/xlsm/csv/txt/md，记录 `parsed` / `parseChars` / `parseError` |
| 3 | 抽取档案字段 | C | Skill | 单次结构化 LLM 调用，输出固定 JSON：`{intro, timeGranularity, dimensions[], rows[]}`。见「产出格式」 |
| 4 | 归一时间颗粒度 | M | 确定性映射 | `_TIME_GRANULARITIES = {"year": "Year", "month": "Month", "week": "Week"}`；无法识别一律落 `Month` |
| 5 | 构建模型范围矩阵 | M | 确定性拼装 | 维度固定三轴（见 BIZ-001）；`rows` 是 SOW 明确列为 in-scope 的组合，**不是叉乘全集** |
| 6 | 校验范围硬约束 | M | 规则 | **平台文档定义了三条硬约束，平台代码没有实现任何一条**——见「备注」。runtime 必须补 |
| 7 | 呈现并锁定 | H | Orchestration | 关卡 `d-1.0`，kind `approval`。批准 → 档案锁定，颗粒度对全链路生效 |

**Class 分布（平台 08 §2.2 打标表）：** 1.0 Scope = `A → H`（AI 起草 + 约束校验 → 人确认）。
平台代码把 1.0 标成 `klass: "C"`，1.0a 标成 `klass: "H"`——**代码比文档更保守（C 而非 A）**，
因为抽取模型范围没有客观对错判据。以代码为准：1.0 是 C 类。

---

## 澄清点

开工前一次问完，按影响面排序。每条：**读到什么 / 缺什么 / 候选 + 推荐 + 后果**。

### 澄清 1 · 建模时间颗粒度

- **读到：** SOW 说的是汇报节奏还是建模颗粒度，常常分不开。SOW 只写"月度汇报"时，这一项是缺失的。
- **为什么必须问：** `timeGranularity` 是全链路契约——数据需求的第一列、因子树的 `dimension`
  默认值、S2 面板的时间轴，全部读它。改它等于重走 1.0。
- **候选：**
  - **A. Month（推荐）** —— 与绝大多数客户的收数与汇报节奏一致；代价是周内促销脉冲被平滑掉。
  - **B. Week** —— 能捕捉促销与上新脉冲；代价是要求客户按周提供**全部**因子数据，收数难度上一个台阶，媒体以外的因子经常给不出周度。
  - **C. Year** —— 只在多年趋势型委托里成立；样本量通常不足以识别系数。
- **后果：** 选定即锁定。1.5 生成的工作簿第一列直接是 `Time (<颗粒度>)`。

### 澄清 2 · 模型范围矩阵的三个轴取什么值

- **读到：** SOW 通常写了产品线与渠道，但地区/平台的分组几乎总是缺的，或者把"平台"和"地区"混成一列。
- **为什么必须问：** 每个 scope 行后面要落一个模型。列了数据支撑不了的值 = N 个空模型。
- **候选：**
  - **A. 按 SOW 字面列（推荐）** —— 只收 SOW 明确写"在范围内"的组合。
  - **B. 按维度叉乘全集** —— 覆盖全，但会把客户从没承诺给数据的格子带进来。
- **必须单独确认的两件事：**
  1. **产品线**：平台规则是"1 条产品线或 1 个产品线组"。哪些 SKU 被**排除**？（实盘案例：`除脉动电解质外所有`——排除项写进档案，否则收数时才发现。）
  2. **地区 vs 平台**：平台有一条带日期的客户要求（BIZ-001，2026-07-16）：**Geo 必须是干净的地理维度，不许拿 Platform 顶替，也不许把 Platform 并进 Geo。** 线上平台是渠道内的细分，不是地区。

### 澄清 3 · 响应指标（Y）是什么口径

- **读到：** SOW 一般写"提升销量"，不写口径。
- **为什么必须问：** Y 定错，整个模型答的就是另一个问题；而且 1.5 的数据需求要把 Y 单独成表并**排除出因子表**。
- **候选：** A. 售出量（sell-out volume，推荐——MMM 的常规响应）· B. 售出金额（sell-out value）· C. 出货量（sell-in）——只有在客户只能给出货数据时才选，代价是模型解释的是渠道压货而不是消费者需求。
- **后果：** 平台把它存在 `ProjectMeta.kpi`（默认 `"Sell-out Volume"`），不在档案里；runtime 存在档案的 `responseMetric`。

### 澄清 4 · 建模时间窗

- **读到：** SOW 常只写项目周期，不写数据回溯区间。
- **候选：** A. 三年（推荐，行业数据准入标准的理想值）· B. 两年（准入下限；季节性只有两个周期，季节项与趋势项容易混）· C. 客户能给多少给多少——**这个选项等于把风险推到 S2**，不推荐。
- **后果：** 写进 `timeWindow.{from,to}`，1.5 工作簿的 README 直接引用它。

**问不到人时：** 按推荐项走，在档案里标 `assumed: true` + 理由。假设是登记出来的，不是沉默滑过去的。

---

## 产出格式

### A. 平台的结构（权威，来自 `models.py`）

```python
TimeGranularity = Literal["Year", "Month", "Week"]

class ModelScopeDimension(CamelModel):
    name: str
    values: list[str] = []

class ModelScope(CamelModel):
    dimensions: list[ModelScopeDimension] = []
    rows: list[list[str]] = []      # 每行按 dimensions 顺序对齐

class ProjectProfile(CamelModel):
    projectIntro: str = ""
    timeGranularity: TimeGranularity = "Month"
    modelScope: ModelScope
    sourceOrigin: str = ""          # 'uploaded files' | 'reference case'
```

关联记录（建项目时录入，非本交付物产出）：

```python
class IndustryRef(CamelModel):
    l1: str; l2: str; l3: str

class ProjectMeta(CamelModel):
    id: str; name: str; brand: str
    industry: IndustryRef
    kpi: str = "Sell-out Volume"     # ← 响应指标住在这里
    createdAt: str; updatedAt: str | None
```

### B. 平台的 LLM 抽取契约（`_profile_from_materials`，逐字）

```
- intro: a 2-3 sentence project introduction (objective, brand/category, what the
  model should answer)
- timeGranularity: one of Year / Month / Week (the modeling time grain)
- dimensions: the model-scope dimensions, each {name, values:[...]}. The model
  scope is fixed to exactly three dimensions: Brand, Channel, Geo. Geo is a clean
  geographic dimension (region/province) — do NOT use Platform in place of Geo, and
  do NOT merge Platform into Geo.
- rows: the IN-SCOPE combinations as a list of rows; each row is a list of values
  aligned to the dimensions order (only the combinations the SOW lists as in scope).
Return JSON: {"intro":str,"timeGranularity":str,
  "dimensions":[{"name":str,"values":[str]}],"rows":[[str]]}
```

固定三轴（`business.py:48`，带注释编号 **BIZ-001**）：

```python
# BIZ-001: the model scope is fixed to Brand × Channel × Geo. "Platform" must NOT
# stand in for Geo, and Geo must be a clean geographic dimension (not merged with
# platform). Client requirement (2026-07-16 shared table #1, 49:06–49:18).
_SCOPE_DIMENSIONS = ["Brand", "Channel", "Geo"]
```

### C. 平台渲染出的交付物（`_profile_sheet` → artifact `a-scope`，两张表）

**Sheet 1 · `Project Overview`** —— 列 `["Field", "Value"]`，五行固定：

| Field | Value |
|---|---|
| Brand | 脉动 |
| Project intro | （≤400 字符，截断） |
| Time granularity | Month |
| Model granularity | `12 scope rows across 3 dimensions` |
| Source | uploaded files |

**Sheet 2 · `Model Scope`** —— 列 = 维度名（最多渲染 60 行）：

| Brand | Channel | Geo |
|---|---|---|
| 脉动（除电解质外所有） | MT | 便利店 |
| 脉动（除电解质外所有） | MT | 加油站 |
| 脉动（除电解质外所有） | TT | A |
| 脉动（除电解质外所有） | AFH | B |

> 实盘 `Assets/Model Scope.xlsx` 的表头是 `Product / Channel / Platform & Region`（14 行）。
> **平台代码已经把它改成 `Brand / Channel / Geo` 并明确禁止 Platform 顶替 Geo。**
> 实盘文件是改判前的样子，不是当前契约。

### E. 三条硬约束的原文出处（`reference/01.商业智能体/【MMM AI】商业智能体-Scope_1.0.xlsx`）

该文件单表 7 行，第 1 行是一条合并单元格的指令横幅，逐字：

> (a) 为了聚焦项目的时效，建议模型中进行如下选择：① 选择 1 条产品线或一个产品线组；② 关注核心渠道，
> 渠道数不超过 4 个，选择 1 个线上渠道（线上渠道包括多个平台，如：天猫、京东、拼多多、抖音、快手等）、
> 3 个线下渠道（MT-现代商超渠道、TT-传统流通渠道、AFH-新兴渠道）；③ 选择不超过 6 组地区和平台数量，
> 其中，地区数针对线下渠道，指的是将线下的各省市分为不超过 6 组，平台数针对线上渠道，
> 包括天猫、京东、拼多多、抖音、快手等

第 3 行是表头 `['渠道', '地区和平台', '产品']`，第 4–7 行是实盘的四行：

| 渠道 | 地区和平台 | 产品 |
|---|---|---|
| MT | 便利店，加油站，零食店，xxx | 除脉动电解质外所有（为一组） |
| TT | A, B, C, D | 除脉动电解质外所有（为一组） |
| AFH | A, B, C, D | 除脉动电解质外所有（为一组） |
| EC+O2O | EC, O2O, 社区团购 | 除脉动电解质外所有（为一组） |

> **实盘只有 4 行渠道**——这就是"渠道 ≤4"这条约束落地后的样子：1 个线上（EC+O2O）+ 3 个线下（MT/TT/AFH）。
> "地区和平台"一列在线下装地区分组、在线上装平台名——**这正是 BIZ-001 后来要拆开的那个混装**。
> 约束的业务理由写在横幅里：**"为了聚焦项目的时效"**，即工期，不是模型质量。这个理由要在关卡上说给人听。

### D. runtime 载体（文本形态，`artifacts/s1/project-profile.yaml`）

```yaml
meta:
  task: "1.0"
  skill: scoping
  mode: profile
  generated: "2026-08-08T10:02:00+08:00"
  grounding:
    - { path: "inputs/project-background/sow.pdf", chars: 24180, truncated: false }
  knowledgeRecall: none
  status: draft                     # draft → locked，只有人过了 d-1.0 才能写 locked
profile:
  projectIntro: "两三句话，用客户自己的说法框定这个项目。"
  objective: "模型必须回答的那个生意问题。"
  responseMetric: "售出量（件），月度"        # 这是 Y，不是因子；平台存在 ProjectMeta.kpi
  timeGranularity: Month                    # Year | Month | Week
  timeWindow: { from: "2023-01", to: "2025-12" }
  brand: "脉动"                              # 平台 ProjectMeta.brand
  industry: { l1: food-bev, l2: beverage, l3: sports-functional }
  modelScope:                                # 固定三轴：Brand × Channel × Geo（BIZ-001）
    - { name: Brand,   values: ["脉动（除电解质外）"] }
    - { name: Channel, values: [MT, TT, AFH, EC+O2O] }
    - { name: Geo,     values: [华东, 华南, 华北, 华中, 西部, 东北] }
  scopeRows:                                 # 只列 SOW 明确在范围内的组合，不叉乘
    - ["脉动（除电解质外）", MT, 华东]
    - ["脉动（除电解质外）", MT, 华南]
    - ["脉动（除电解质外）", TT, 华东]
  constraints:                               # 平台文档的三条硬约束，代码未实现，runtime 补
    productLines: 1                          # 1 条产品线或 1 个产品线组
    channelsMax: 4                           # 1 线上 + MT / TT / AFH 三线下
    geoGroupsMax: 6                          # 线下按地区分组，线上按平台分组
    check: pass                              # pass | violated，violated 必须在关卡上说清
  deliverables: ["分渠道 ROI", "预算再分配情景"]
  outOfScope: ["2023 年以前的线下贸易促销"]
  assumptions:                               # §4.0 澄清登记
    - { question: "建模时间颗粒度", answer: "Month", decidedBy: "客户 BA", at: "2026-08-08", assumed: false }
  openQuestions: ["O2O 是算独立渠道还是并进 EC？"]
```

**字段约束（逐条可校验）**

| 字段 | 约束 | 谁检查 |
|---|---|---|
| `timeGranularity` | ∈ {Year, Month, Week}；无法识别落 Month | M 步归一 |
| `modelScope` | 恰好三个维度，名字为 Brand / Channel / Geo | 规则（BIZ-001） |
| `modelScope[Geo].values` | 不得含线上平台名（天猫/京东/抖音…） | 规则（BIZ-001） |
| `scopeRows[*]` | 长度 = 维度数，取值必须出现在对应维度的 `values` 里 | 规则 |
| `constraints.channelsMax` | `len(Channel.values) ≤ 4` | 规则（runtime 新增） |
| `constraints.geoGroupsMax` | `len(Geo.values) ≤ 6` | 规则（runtime 新增） |
| `responseMetric` | 非空。1.5 要拿它单独建响应表并把它排除出因子表 | 规则 |
| `meta.status` | 只有 `d-1.0` 有 approve 记录后才能是 `locked` | `profile_locked` |

---

## Gate

| 触发条件 | 判定者 | 候选处置 | 路由 |
|---|---|---|---|
| `inputs/project-background/` 为空或全部解析失败 | 人 | ① 补传 SOW/简报（推荐）② 确认确实没有 → 放一份 `NONE.md` 写明是谁确认的、为什么 | intake 关卡 `g-1.0a`。**不许拿别的材料顶替**——顶替就是拿另一个客户的生意在建模 |
| 档案草案完成 | BA（+ 客户，见 A6：v1 客户不登录，顾问代录 + 附凭证） | ① `approve` 锁定档案（推荐）—— 颗粒度与模型范围就此对全链路生效，因子树开工<br>② `rework` 退回重框 —— 改渠道、分组或时间窗 | 平台 `d-1.0`，kind `approval`，`reworkTaskId: 1.0`。runtime 同名 `d-1.0` |
| 三条范围硬约束任一被突破（渠道 >4 / 地区平台组 >6 / 多于 1 条产品线组） | BA | ① 收窄范围（推荐）② 客户书面认可超范围并接受工期与模型质量后果 | 平台**未实现**此触发；runtime 新增，在 `d-1.0` 呈现时作为必答项 |
| 档案锁定后有人要改 | 项目负责人 | 显式 `reopen d-1.0` | 平台 05 §3.2：*"Scope 约束是项目级常量，变更需重走 G1.0"*。runtime：`state.py reopen d-1.0`，回退全部下游 |

**呈现顺序（照 gate-protocol）：** ① 在决定什么 → ② 证据（档案路径 + 与 SOW 的对照）→
③ 还没定的（`openQuestions` 逐条列出）→ ④ 批准之后什么被冻结。
`openQuestions` 非空时不许把 `approve` 报成默认推荐。

---

## 与 runtime 现状的差异

| 平台定义 | runtime 现状 | 判定 | 建议 |
|---|---|---|---|
| 模型范围固定三轴 `Brand × Channel × Geo`（BIZ-001，带日期的客户要求） | `modelScope` 是自由维度列表，样例写的是 `Channel / Product / Region` | **偏离** | 采纳 BIZ-001：把三轴固定为 Brand / Channel / Geo，并加一条"Geo 里不得出现平台名"的校验。这是带日期的客户裁决，不是风格问题 |
| 三条范围硬约束（1 产品线组 / 渠道 ≤4 / 地区平台组 ≤6） | **完全没有** | **缺失** | 补 `profile.constraints` 块 + 校验，并在 `d-1.0` 呈现。注意：**平台代码也没实现**，runtime 补的是平台文档的定义，属于"比平台更严"，要在卡里记明 |
| `sourceOrigin` 记录档案来自上传还是参考数据 | 无此字段 | **缺失** | runtime 只有一条路（必须上传），可以省。但建议保留一个 `sourceOrigin: uploaded` 以便审计 |
| `ProjectMeta.brand` / `industry{l1,l2,l3}` / `kpi` | brand / industry 在 `mmm.yaml`，`responseMetric` 在档案里 | **一致（位置不同）** | 保持。但档案里应冗余一份 brand / industry，因为知识包锚定与因子树召回都读它，跨文件读会让 grounding 白名单变复杂 |
| 无 | `objective` / `timeWindow` / `deliverables` / `outOfScope` / `openQuestions` | **多余（平台无对应）** | **保留全部**。这五项都是"答案会改变产出"的东西：`timeWindow` 被 1.5 的 README 直接引用，`openQuestions` 是澄清协议的落点。平台没有不代表不该有 |
| 无 | `meta.status: draft \| locked` + `profile_locked` 谓词 | **多余（runtime 独有机制）** | 保留。平台靠 `ArtifactState` 走 `draft→proposed→confirmed→frozen`，runtime 用 `status` 是等价降级 |
| `_TIME_GRANULARITIES` 兜底落 `Month` | 未见兜底规则 | **缺失** | 补：无法从 SOW 判断时落 Month + `assumed: true`，不许留空 |
| `ArtifactState: draft \| proposed \| confirmed \| frozen` | 只有 `draft \| locked` | 偏离（简化） | 可接受。runtime 的 `progress.yaml` + `decisions.log` 承担了 confirmed/frozen 的信息 |
| 1.0 的 `klass: C` | 清单里也是 `C` | **一致** | — |
| 上传解析失败必须 flag、不许落空档案 | SKILL.md 未写这条 | **缺失** | 补一条硬规则到 scoping SKILL.md：解析失败 → 报告 + 不产出，不许生成"看起来像档案的空档案" |
| `metadata/granularity.yaml` 由 scoping 在档案锁定时写一次（`shared/workspace-layout.md` 所有权表） | 没有任何 scoping 模式写它 | **缺失（runtime 内部不自洽）** | 要么让 `profile` 模式在锁定时写它，要么从所有权表里删掉。悬空的所有权声明比没有更糟 |

---

## 备注

**1. 文档说有、代码没有：三条范围硬约束。**
`01-business-agent.md` §3 Step 1、`00-overview.md` §4 都逐字写了"渠道数 ≤4：1 个线上渠道 +
3 个线下渠道（MT/TT/AFH）；地区和平台 ≤6 组；1 条产品线或 1 个产品线组"，
`blueprint.py` 的 `how` 也写了 *"against the hard limits"*。但 `_profile_from_materials` 的
prompt **一个字都没提这三条**，后端也没有任何 scope 校验函数（`grep` 无结果）。
按宪法"文档与代码不一致以代码为准"，平台的**实际**契约里这三条不存在。
但这三条来自 StatusCheckList 的原始业务规则、有明确的工期理由，runtime 应当实现它——
这是一次**有意的"比平台更严"**，写在这里备查。

**2. 代码已推翻的实盘样例：模型范围三轴。**
`Assets/Model Scope.xlsx` 的表头是 `Product / Channel / Platform & Region`，
`09-business-understanding-flow.md` §4 也照抄了这个说法。代码里 BIZ-001 带日期
（2026-07-16 客户会议 49:06–49:18）明确改成 `Brand / Channel / Geo` 并禁止 Platform 混入 Geo。
**以 BIZ-001 为准**，实盘文件与 09 文档都是改判前的状态。

**3. 平台前端交互 → runtime 文本形态的降级。**

| 平台前端 | 承载的信息结构 | runtime 文本形态 |
|---|---|---|
| `ProfileEditor` 的**维度矩阵构建器**（填维度值 → 叉乘生成 scope 行 → 逐行改/删） | 维度定义与实例行是两层，人先定轴再挑格子 | YAML 分成 `modelScope`（轴 + 取值）与 `scopeRows`（挑出来的格子）两块。呈现时先列三轴取值，再列被选中的行数与被排除的组合数，让人在文本里也能看见"叉乘全集 vs 实际选中"的差 |
| 时间颗粒度下拉（Year/Month/Week） | 三选一 | 澄清 1 的选择题，候选 + 推荐 + 后果 |
| `PUT /profile` 落库后**重渲染** `a-scope` | 改数据即刷新视图 | runtime 没有服务器。约定：改 `project-profile.yaml` 后必须重跑 `gate_check.py 1.0`，视图一致性由 `view_current` 类谓词兜 |
| 决策页的 `d-1.0` 选择题卡片 | 候选 + 推荐 + 后果 + 证据锚点 | `shared/gate-protocol.md` 的四段式呈现。**形态降级，信息结构不降级** |

**4. `ProjectMeta.kpi` 与 `profile.responseMetric` 是同一件事的两个位置。**
平台把响应指标放在项目注册记录上（建项目时选，默认 `"Sell-out Volume"`），
不在档案里。runtime 放在档案里更合理——因为 1.5 的 `coverage_complete` 谓词要检查
"响应行被单独请求了"，那是档案与因子树之间的契约，不该跨到工作区配置去读。差异保留，理由记此。

**5. 客户不直接参与（平台假设 A6）。**
平台 v1 客户不登录，`d-1.0` 的"客户确认"由顾问在线下 Review 会拿到后代录，
并上传凭证（会议纪要/邮件截图）作为关卡证据。runtime 同构：`state.py decide` 的
`--who` / `--note` 就是这个凭证位。`d-1.0` 是 `approval` 不是 `signoff`——档案由 BA 担责，
真正要客户签字的是 `d-1.5` 数据需求。
