# 契约卡：模型输入

**阶段：** 数据 · **整个 runtime 的交付终点**
**平台出处：** 2.35 Model Input
- 规格：`Assets/数据智能体知识库/模版化/2.35-Model-Input.md`、`Assets/数据智能体知识库/机器可读/wide-table-schema.json`、`模版化/2.21-宽表数据集维度.md`
- 设计：`docs/agent-design/02-data-agent.md` §2.35/§3.1、`docs/agent-design/07-assumptions-log.md` A3（格式规范的补丁）、`docs/agent-design/08-product-architecture-v2.md` §2.2
- 实现：`backend/app/agents/master_data.py`、`backend/app/agents/ledger.py::indicator_ledger / funnel / model_selection`、`backend/app/agents/factor_link.py::factor_tree_verdicts`、`backend/app/agents/data.py::assemble_master_data`、`backend/app/domain/blueprint.py::d-2.6`
- 真实交付物：`reference/02.数据智能体/【MMM AI】数据智能体-model input_2.32.xlsx`（2 sheet）、`...-Data Process_2.21&2.23.xlsm` 的 `Model Data` sheet（视图 `vw_all_dataset_model_data_yyyymm` 的列定义）

**产出 Skill：** `master-data`

---

## 输入

| 来源 | 内容 | 类型 |
|---|---|---|
| 上游交付物 · OLS 预验证 | 每个 (对象, L4, 指标) 的 accept / reject 裁决；人确认的响应变量；人勾选的变量集 | 依赖 |
| 上游交付物 · 统计检验 | 统计层的淘汰名单 | 依赖 |
| 上游交付物 · 业务校验与签核 | 客户否决名单；已接受的异常处置窗口 | 依赖 |
| 上游交付物 · 数据质量评分 / 因子映射 | 质量层与映射层的淘汰名单 | 依赖 |
| 上游交付物 · 因子树 | 完整因子树（含从未被数据覆盖的行）—— 收口报告要按"当初想要什么"来结账 | 依赖 |
| 上游交付物 · 发布数据集 | 长表原料 | 依赖 |
| 人提供 · 时间颗粒度 | 月度（默认）或年度 | 原料 |

**过滤是物理的，而且只有一个来源：账本。** 模型输入表带的是账本报告为已采纳的指标，跑在人确认过的响应变量上，限制在人勾选过的变量里。**在这一步重新推导上述任何一项，就是这张表与人真正签过的那次拟合产生分歧的原因。**

---

## 构建过程

| # | 步骤 | Class | 执行者 | 说明 |
|---|---|---|---|---|
| 0 | 澄清 | H | 人 | 见下节 |
| 1 | 结算账本 | M | Tool `ledger.derive` | 六层逐指标裁决结算：映射 → 质量 → 业务签核 → 统计 → 变量选择 → 区间检验。**任一层的否决被之后每一层继承。** 主键 `(归一化 L4, 归一化指标)`，按模型对象记账 |
| 2 | 解析已采纳集合 | M | Tool | `adopted_indicators()` 是"模型建在什么之上"的**唯一答案**。**响应变量必须显式放行**——它没有账本行（没有任何一层裁决过它，因为它就是驱动要解释的东西），按已采纳键去过滤会把因变量本身滤掉 |
| 3 | 逐对象取行 | M | Tool `master.assemble` | 每个模型对象用**与拟合完全相同的行选择规则**取行。按"品牌 + 渠道类型"切看起来等价、其实不是：那样会丢掉每一条全国行（渠道为空）和每一条竞品行（这个对象不点名的品牌）——而那恰好是模型真正拟合用的共享行 |
| 4 | 透视 | M | Tool | 长表 → 宽表：一行一期，一列一个已采纳指标，**响应列排第一**，其余列按名称排序。每个指标按自己的汇总规则汇总（比例/覆盖率类跨地区**取平均**，花费与销量**求和**）。数值保留 4 位 |
| 5 | 编号 | M | Tool | 给每个入模指标分配唯一 `Variable no.` / `Metric no.`，供建模阶段引用（见"判定规则与阈值"） |
| 6 | 出三类表 | M | App `workbook` | ① 模型颗粒度参考表 ② D.Data Station 长表 ③ 每个模型对象一张宽表。**三者读同一个已采纳集合**，工作簿不可能描述一个模型没有建在其上的指标集 |
| 7 | 结算漏斗与因子树收口 | A | Skill | 每层"进来多少 / 拒了多少 / 活下来多少 / 拒的是哪几条"；因子树每一行的最终归宿与死在哪一层 |
| 8 | 锁定 | H | 人 | 锁定后要改任何上游必须先重开本关 |
| 9 | 交付验收 | H | Orchestration `close` | Skill 只说"模型输入已写好，请验收" |

---

## 澄清点

| # | 类型 | 问题 | 候选与后果 |
|---|---|---|---|
| 1 | 缺失 | **时间颗粒度** | A. 月度（推荐，平台最低颗粒度）；B. 年度（数据太短时的退路，但会把季节性彻底抹掉，建模阶段拿不回来） |
| 2 | 缺失 | **编号规则** | `Variable no.` 是整数、`Metric no.` 是 `<Variable>.<序号>`。**同一个 Variable 下挂多个 Metric 的分组依据要定**：按 L4 分组？按数据源分组？按英文机器名分组？编号一旦发给建模阶段就成了引用键，改不动 |
| 3 | 越界 | **异常处置 `cap` 在这张表里生效吗** | A. 生效（表里的响应列是缩尾后的值）—— 表与拟合完全一致；B. 不生效（表里是原值，缩尾只作用于拟合）—— 平台现状。**两种做法下建模阶段拿到的响应序列不同**，必须问并在表上标注 |
| 4 | 缺失 | **某因子全部候选指标都不达标时怎么交代** | 平台明规则：不纳入，**并在交付说明中预警该因子缺数据**。要确认预警是写进交付说明还是也进因子树收口表 |
| 5 | 岔路 | **英文机器名（`Variable`）谁来命名** | 真实交付物里有这一列（例 `NAB_All_Channel_Offtake_Value`）。A. 按规则自动生成（数据源_渠道_指标）；B. 人指定。自动生成的名字客户可能不认，人指定则要一个命名登记 |

---

## 产出格式

### 1 · Sheet 1 · 模型颗粒度参考表

复刻平台 `model input_2.32.xlsx` 的第一张表。**空白的渠道 / 区域 = 没有被选进模型**（平台约定）。

| 生意因子-Level 1 | 生意因子-Level 2 | 生意因子-Level 3 | 生意影响因子-Level 4 | 指标选择 | 角色 | 渠道 | 区域 |
|---|---|---|---|---|---|---|---|
| 生意基本盘 | 外部因素 | 品类趋势 | 市场规模 | 品类全渠道销量 | driver | 全渠道 | National |
| 生意基本盘 | 外部因素 | 品类趋势 | 市场规模 | 品类社媒声量 | driver | 全渠道 | National |
| 生意基本盘 | 外部因素 | 品类趋势 | 特定属性趋势 | 现调饮料外卖销量 | driver | 全渠道 | National |
| 消费者需求驱动 | 品牌广告/内容种草 | 品牌传播 | Digital Display | 曝光量 | driver | MT,EC | A,B,C,D |
| 消费者需求驱动 | 品牌广告/内容种草 | 社交媒体及线下路演 | 社媒 | 社媒活动声量 |  |  |  |
| KPI | Sales | Sell-out | — | 本品销量 | **response** | MT,EC,TT | A,B,C,D |

- `渠道` 取值：该指标原始行里出现的渠道类型集合；**没有具体渠道类型（全国/全渠道数据）时写 `全渠道`**。
- `区域` 取值：省份组别集合；只有全国口径时写 `National`。
- `角色`：`response` 或 `driver`。**响应变量必须出现在这张表上**——它不在因子树里（因子解释它，不声明它），漏掉它这张表就在描述一个它并不包含的模型输入。

### 2 · Sheet 2 · D.Data Station（长表，模型输入的落地形态）

平台真实交付物 22 列，逐列对齐：

```
Task name | 品牌 | 省份组别 | 省份 | 渠道类型 | 渠道 | 年 | 月 | 数据源 |
数据类型Level1 | 数据类型Level2 | 数据类型Level3 | 数据类型Level4 |
数据类型Level5 | 数据类型Level6 | 数据类型Level7 | 数据类型Level8 |
METRICS类型 | METRICS | VALUE | Variable | Variable no. | Metric no.
```

示例行：

| 列 | 值 |
|---|---|
| Task name | `NAB all channel` |
| 品牌 | `NAB` |
| 省份组别 | `National` |
| 省份 | `NA` |
| 渠道类型 | `NA` |
| 渠道 | `NA` |
| 年 | `2025` |
| 月 | `202507` |
| 数据源 | `SIA - All Channel` |
| 数据类型Level1 | `生意基本盘` |
| 数据类型Level2 | `外部因素` |
| 数据类型Level3 | `品类趋势` |
| 数据类型Level4 | `市场规模` |
| 数据类型Level5–8 | `NA` / `NA` / `NA` / `NA` |
| METRICS类型 | `value` |
| METRICS | `品类全渠道销量` |
| VALUE | `33827171917` |
| **Variable** | `NAB_All_Channel_Offtake_Value` |
| **Variable no.** | `1` |
| **Metric no.** | `1.1` |

**列语义（来自 2.21 宽表维度规则）：**

| 列 | 定义 | 规则 |
|---|---|---|
| 数据源 | — | 定位数据源 |
| 品牌 / 品类 / 产品 | 模型颗粒度 | Product 主数据表清洗出统一维度名称，不满足填 `NA` |
| 省份组别 / 省份 | 模型颗粒度 | Geo 主数据表清洗，不满足填 `NA` |
| 渠道类型 / 渠道 | 模型颗粒度 | Channel 主数据表清洗，不满足填 `NA` |
| 年 / 月 | 时间颗粒度 | Time 主数据表清洗；月为 `YYYYMM` |
| 数据类型 Level1–Level4 | 对应因子树 L1–L4 | 按因子结构树命名，**与因子树严格一致** |
| 数据类型 Level5–Level8 | 该 L4 的下钻颗粒度 | 没有就填 `NA` |
| METRICS类型 / METRICS | 指标 | 指标类型与指标名称 |
| Unit | 单位 | `percentage` / `Unit` / `Volume K` / `RMB`（`Model Data` 视图无此列，宽表数据集有） |
| VALUE | 值 | — |
| **Variable no. / Metric no.** | **建模编号** | 相对上游数据集**新增的两列**，供建模阶段引用，确保贡献度分解可回溯到具体 L4 因子 |

**每行 = 一个 (维度组合, 指标, 值)。维度对不齐就填 `NA`，不删行、不合并。**

### 3 · Sheet 3+ · 每个模型对象一张宽表（回归直接吃的形态）

```
Period  | 本品销量(响应，排第一) | 曝光量 | 花费 | KOL发帖数 | 本品标价 | 温度
2022-01 | 1250.4                | 1.80   | 320  | 45        | 5.5      | 8.2
2022-02 | 1180.9                |        | 290  | 38        | 5.5      | 10.1
...
```

- 一行一期，一列一个已采纳指标。
- **响应列排第一**，其余按名称排序。
- 缺口留空，**不补零**。
- 数值 4 位小数。
- sheet 名 = 模型对象标签（如 `MT · MIZONE`），≤31 字符，去掉 `[]:*?/\`，重名加后缀。

### 4 · 漏斗（`funnel.yaml`）

每层"进来多少 / 拒了多少 / 活下来多少 / 拒的是哪几条"，既有跨对象合计也有逐对象拆分——**同一个指标可以在一个渠道死在统计层，在另一个渠道活到最后。**

```yaml
combined:
  - {layer: mapping,     task: "因子映射",     label: "因子映射",     intake: 93, rejected: 16, survivors: 77,
     dropped: [{l4: 竞品渠道扩张, indicator: 竞品ND, reason: "无已发布数据覆盖"}]}
  - {layer: quality,     task: "数据质量评分", label: "数据质量",     intake: 77, rejected: 12, survivors: 65, dropped: [...]}
  - {layer: signoff,     task: "业务校验与签核", label: "业务签核",   intake: 65, rejected:  6, survivors: 59, dropped: [...]}
  - {layer: statistical, task: "统计检验",     label: "统计检验",     intake: 59, rejected: 28, survivors: 31, dropped: [...]}
  - {layer: selection,   task: "OLS 预验证",   label: "变量选择",     intake: 31, rejected:  9, survivors: 22, dropped: [...]}
  - {layer: range,       task: "OLS 预验证",   label: "区间检验",     intake: 22, rejected:  4, survivors: 18, dropped: [...]}
byObject:
  "MT::MIZONE": [...]
  "EC::MIZONE": [...]
```

### 5 · 因子树收口（按"当初想要什么"结账）

漏斗按数据交付了什么记账；这张表按因子树想要什么记账，**两者都要有**。

```yaml
factorTree:
  - rowId: f-0007
    l1: 消费者需求驱动
    l2: 品牌广告/内容种草
    l3: 品牌传播
    l4: Digital Display
    indicator: 曝光量
    verdict: adopted        # adopted | partial | rejected | notSupplied | notModeled
    diedAt: ""              # 最早否决它的那一层
    reason: ""
    perObject: {"MT::MIZONE": adopted, "EC::MIZONE": rejected}
summary:
  adopted: 18
  partial: 3
  rejected: 28
  notSupplied: 16
  notModeled: 4
  total: 69                 # 五个数之和必须等于因子树活跃行数；对不上就报告并停下
```

| verdict | 含义 |
|---|---|
| `adopted` | 该行的至少一个供给数据键被采纳进模型 |
| `partial` | 部分模型对象采纳，部分否决 |
| `rejected` | 数据存在但被某一层裁决否掉 |
| `notSupplied` | 从来没有已发布的数据覆盖过这一行 |
| `notModeled` | 有数据但没进任何模型（通常是自由度不够，或与兄弟因子共用一个数据键、所有权归了兄弟） |

**一个因子行只要任一供给它的数据键被采纳即为采纳，且只计一次。** 两个兄弟因子被钉到同一个数据键时（例如「买N赠N」和「赠品小样」的花费都收在「促销优惠」下），所有权只归一个，另一个报 `notModeled`——两边都计会让这张表比收口多认一个采纳因子。

### 6 · 因子级预警（交付说明内）

```yaml
missingFactors:
  - {l4: 竞品渠道扩张, reason: "全部候选指标不达标", failedAt: statistical,
     action: "该因子未纳入模型；建模阶段的结论不覆盖竞品渠道扩张"}
```

### 7 · 图表规格（由图表应用渲染）

```yaml
charts:
  - chartId: mi-funnel
    title: "指标漏斗：93 个候选 → 18 个入模"
    encoding: {kind: funnel, stages: [mapping, quality, signoff, statistical, selection, range]}
    interpretation: "每层的柱高是进来的数量，缺口是该层拒掉的。悬停出被拒指标名与理由。"
  - chartId: mi-coverage
    title: "因子树覆盖：每个 L3 有多少因子进了模型"
    encoding: {kind: stacked_bar, x: l3, series: [adopted, partial, rejected, notSupplied, notModeled]}
    interpretation: "整段是 notSupplied 的 L3 说明数据收集有缺口，不是模型的选择。"
  - chartId: mi-completeness-{object}
    title: "{label} · 模型输入完整度"
    encoding: {kind: heatmap, x: period, y: indicator, value: hasValue}
    interpretation: "空格是缺口不是零。某指标的空格连成片说明它只覆盖了部分期间。"
```

---

## 判定规则与阈值

### 从数据集收敛到模型输入的规则（平台 2.35 原文五条）

1. 仅保留**数据校验验收通过**的数据（Total = 1，或 0.5 经人决策保留）。
2. 仅保留**统计检验** Good / Acceptable 的指标。
3. 同一 L4 因子有多个候选指标时，由 **OLS 预验证**选 Contribution / ROI 最贴合业务区间的那一个（当前实现改为逐行 accept/reject，见 `ols-test.md` 备注 B1）。
4. **因子全部候选指标不达标 → 不纳入，并在交付说明中预警该因子缺数据。**
5. 为每个入模指标分配唯一 `Variable no.` / `Metric no.`，供建模阶段引用。

### 六层账本（结算顺序，不可乱）

| 顺序 | 层 | 产出它的交付物 | 否决的语义 |
|---|---|---|---|
| 1 | `mapping` | 因子映射 | 没有已发布的指标覆盖这个因子 |
| 2 | `quality` | 数据质量评分 | 数据本身不可用 |
| 3 | `signoff` | 业务校验与签核 | 客户明确否决 |
| 4 | `statistical` | 统计检验 | 指标对建模不适用 |
| 5 | `selection` | OLS 预验证 | 没进这次拟合（自由度 / 未勾选） |
| 6 | `range` | OLS 预验证 | ROI 或 Contribution 越界且被裁决拒绝 |

- **任一层的否决被之后每一层继承，不可逆流。**
- 主键 `(归一化 L4, 归一化指标)`；裁决按模型对象记账，缺省对象表示"对所有模型生效"。
- 暂定态：质量层的 `flag`、统计层的 `review` —— 这两个在人裁决前算暂定，不算最终否决。

### 编号规则

| 列 | 形式 | 示例 | 约束 |
|---|---|---|---|
| `Variable` | 英文机器名 | `NAB_All_Channel_Offtake_Value` | 全表唯一 |
| `Variable no.` | 整数 | `1`、`32` | 一个 Variable 一个号 |
| `Metric no.` | `<Variable no.>.<序号>` | `1.1`、`32.1.1` | 同一 Variable 下可挂多个 Metric |

平台真实交付物里 `Metric no.` 出现过 `1.1` 与 `32.1.1` 两种深度，说明层级不止两级。**分组依据必须在澄清点 2 定死**——编号一旦交给建模阶段就成了引用键。

### 表格上限与截断

| 限制 | 值 | 处置 |
|---|---|---|
| Data Station 展示上限 | 5000 行 | 超出**明确标注**，导出时不设上限 |
| 宽表展示上限 | 400 行 × 60 列 | 超出**明确标注，不做无声截断** |
| Excel sheet 名 | ≤31 字符 | 去掉 `[]:*?/\`，重名加 `~2` 后缀 |

### 汇总规则

- 比例类 / 覆盖率类跨地区**取平均**；花费与销量类**求和**。
- 一个指标在一个期间内有多行（L5–L8 残差路径）时，按该指标自己的汇总规则合并。
- **对比例类求和会造出一个没有意义的数**——这条在统计检验、业务校验、模型输入三处都成立。

### 红旗条件

- **响应变量不在已采纳集合里** → 表里没有因变量，整个交付作废。必须硬校验。
- **因子树收口的五个 verdict 之和 ≠ 因子树活跃行数** → 报告并停下，不猜。
- **模型输入表描述的指标集 ≠ 拟合实际用的指标集** → 这就是本步存在的意义，必须硬校验。
- **全国行按"品牌 + 渠道类型"切** → 会丢掉全国行与竞品行；必须用与拟合相同的对象行选规则。
- **超出展示上限** → 标注，不静默截断。
- **某因子全部候选不达标** → 交付说明预警。

---

## Gate

| 触发条件 | 判定者 | 候选处置 | 路由（含回流目标） |
|---|---|---|---|
| 三类表与漏斗、因子树收口都已产出，且模型输入表与拟合用的指标集一致 | **DS**（+ 客户知情） | `lock` **锁定模型输入**（推荐）：建模基于这张表 | 交付物 → confirmed。**这是 runtime 的交付终点**；下游建模与报告不在范围内 |
| 变量集合还需要再过一遍 | DS | `rework` **重审变量** | **回流到 OLS 预验证**（平台 `d-2.6.rework_task_id = 2.5`） |
| 存在缺数据的因子（全部候选不达标） | DS + BA | 知情锁定 / 回流找替代 | 回流则回到**业务理解**找替代指标；知情锁定则预警必须进交付说明 |
| 锁定之后要改任何上游 | DS | 必须先重开本关 | 锁定即冻结。不重开就改上游会被拒 |

**锁定的含义（要在 gate 呈现里说清楚）：** 锁定的是"建模将要训练在其上的那张表"。锁定时应当把已解析的选择（响应变量、变量集、排除集、参数）一并冻结成快照，建模阶段读这份快照——否则上游任何一次重跑都会让建模训练在一张与人签过的表不同的表上。

---

## 与 runtime 现状的差异

| 平台定义 | runtime 现状 | 判定 | 建议 |
|---|---|---|---|
| **`Variable no.` / `Metric no.` 两列**（`vw_all_dataset_model_data_yyyymm` 的正式列；真实交付物 `D.Data Station` 里有值 `1` / `1.1`） | **完全没有**。全仓 grep `Variable no` / `Metric no` / `variableNo` / `metricNo` 零命中 | **缺失（本卡最重要的一处）** | 补编号步骤（构建过程第 5 步）与两列；澄清点 2 定分组规则。**这是 2.35 相对上游数据集唯一新增的东西**，没有它这张表就只是上游数据集的一个子集 |
| **`Variable` 英文机器名列** | 完全没有 | **缺失** | 与编号一起补；命名规则走澄清点 5 |
| Data Station 22 列 | runtime `DATA_STATION_COLS` **19 列**，缺 `Variable` / `Variable no.` / `Metric no.` | **缺失** | 补三列 |
| Data Station 含 `省份` 列（平台 `Model Data` 视图有，`D.Data Station` 真实表无） | runtime 无 `省份` | **偏离（平台自身两份定义就不一致）** | 以 `Model Data` 视图定义为准补上，`NA` 填充 |
| 模型颗粒度参考表 8 列（含 `角色`） | runtime `granularityRef` 有 `l1..l4/indicator/adopted/role/channelScope/regionScope`，导出时也写了 `角色` 列 | **一致** | — |
| 空白渠道/区域 = 未选进模型（平台约定） | 一致 | **一致** | — |
| 响应变量显式放行（它没有账本行） | 一致（`adopted_indicators` 单独把响应加进来；`master_matches_adopted` 在无 `role: response` 时失败） | **一致** | — |
| 每个模型对象一张宽表，响应列排第一，其余按名排序，4 位小数 | 一致（`_wide_frame`） | **一致** | — |
| 逐对象用与拟合相同的行选规则（不得按品牌+渠道类型切） | 一致，且 `national_rows_scoped` 有判据 | **一致** | — |
| `national_rows_scoped` 在锁定关也复查 | manifest 里它**只在组装步出现**，`lock.md` 却声称锁定关会再跑一次 | **偏离**（skill 文档与 manifest 不一致） | 二选一：manifest 补上，或改掉 `lock.md` 的说法 |
| 六层账本与继承 | 一致（`LAYERS` 六元组，`PROVISIONAL = {quality: (flag,), statistical: (review,)}`） | **一致** | — |
| 漏斗：combined + byObject，每层带被拒名单与理由 | 一致 | **一致** | — |
| 因子树收口五 verdict + 求和校验 | 一致（`FACTOR_ADOPTED/REJECTED/PARTIAL/NOT_SUPPLIED/NOT_MODELED`），skill 要求求和不等就"报告并停止" | **一致** | — |
| 一个因子行的数据键所有权只归一个兄弟 | 一致 | **一致** | — |
| 因子级预警（全部候选不达标 → 交付说明预警） | **没有 `missingFactors` 结构**；funnel 的 dropped 列表里有指标，但没有"这个因子整体缺数据"的因子级预警 | **缺失** | 补 `missingFactors` 段，进交付说明与 gate 呈现 |
| 表格上限：Data Station 5000（导出不限）/ 宽表 400×60，超出明确标注 | 一致（`DATA_STATION_CAP = 5000`、`MAX_ROWS = 400`、`MAX_COLS = 60`） | **一致** | — |
| 汇总规则：比例取平均、花费销量求和 | 一致 | **一致** | — |
| 三类 sheet 的导出工作簿 | 一致（`模型颗粒度参考表` + `D.Data Station` + 每对象一 sheet） | **一致** | — |
| 缺口留空不补零 | 一致 | **一致** | — |
| 异常处置 `cap` 在这张表里不生效（响应列是原值） | runtime 定义了 `cap` 语义但未见在组装步应用 | **偏离（继承自平台的已知不一致）** | 走澄清点 3；无论选哪种，表上必须标注响应列是原值还是缩尾值 |
| Gate 回流目标 `d-2.6.rework → OLS 预验证` | s2.yaml 的 `d-2.6` 是 `approval`，**没有 rework 目标** | **缺失** | manifest 补回流目标 |
| 锁定时冻结已解析选择的快照（响应/变量集/排除集/参数），供建模阶段读 | **完全没有**。锁定只是一个批准 verdict | **缺失** | 锁定关产出一份 `locked-selection.yaml` 快照；这是平台自己写在待办里的补丁 |
| 锁定后改上游必须先重开 | runtime 有 `state.py reopen` 流程 | **一致** | — |
| 漏斗图 / 因子树覆盖图 / 完整度热图 | runtime 无对应图表规格 | **缺失** | 按本卡"图表规格"补三条，交给图表应用 |
| manifest 有 `templates:` 键指向产出模板 | s2.yaml 的任务条目**没有 `templates:` 键** | **缺失**（四张卡共通） | 交付物依赖图里补 `template:`，模板字段来自本卡"产出格式" |

---

## 备注

- **A1 · `Variable no.` / `Metric no.` 是 2.35 唯一的新增物，而它在两个仓库里都不存在。** 平台知识库明写："相对 2.24 多了建模编号列"；`wide-table-schema.json` 的 `modelInputColumns` 定义为"= modelDataColumns 的选定指标子集，每个 L4 因子选一最优指标，**带 Variable/Metric 编号**"；真实交付物 `D.Data Station` 里逐行都有值（`1` / `1.1`），`Data Process_2.21&2.23.xlsm` 的 `Model Data` 视图把它们列为 `vw_all_dataset_model_data_yyyymm` 的正式末两列。**但平台 backend 代码没有实现，runtime 也没有。** 编号的用途写在知识库里："对应建模中的变量索引，确保贡献度分解可回溯到具体 L4 因子"——没有它，建模阶段的贡献分解只能靠指标名字符串回溯。这是四张卡里唯一一处"平台文档 + 真实交付物都有、两边代码都没有"的缺口。
- **A2 · 2.35 的格式规范在平台原始材料里是空的。** `StatusCheckList` 只有一句"根据选定的指标生成 Model Input data"，`02-data-agent.md` §2.35 只有一句。字段级规范是从 2.21 长表 Schema 与 `2.32 6.MODEL Design` 实例反推出来的，登记在 `07-assumptions-log.md` A3（置信度：高）。A3 的原文补充假设值得照抄进来：**"按模型设计声明（模型对象 × 层级 × 变量分组）透视为建模矩阵；每个模型对象一份输入（行=时间，列=KPI + 变量），附变量-因子树映射清单与缺失值处理记录。版本与长表版本、因子树版本绑定。"** 其中"变量-因子树映射清单"与"缺失值处理记录"两项，runtime 目前也没有独立呈现。
- **A3 · `adopted_indicators()` 是"模型建在什么之上"的唯一答案，这条是平台修过的一个真 bug。** 之前三个消费方（颗粒度参考表、Data Station、导出）各自回答同一个问题，然后互相矛盾：颗粒度表在错误的键空间里连接（拿因子行声明的 `(l4, 指标)` 去匹配数据的 `(l4, metric)`，而这两者恰恰在有人做过配对时才不同——也就是有映射存在的时候）；Data Station 和颗粒度表都按账本已采纳键过滤，而**响应变量没有账本行**，于是导出的模型输入少了因变量本身——在演练案例上是 2939 行里静静少了 374 行。runtime 已继承单一答案的做法。
- **A4 · 表要与人真正签过的那次拟合一致。** 过滤是物理的，来源只有账本：已采纳的指标、人在 OLS 关确认的响应、人勾选的变量。在这一步重新推导任何一项，就是这张表与那次拟合分歧的来源。锁定时把已解析的选择冻结成快照，是平台自己识别出但尚未做完的补丁（`d-2.6` 应注册效果，把选择快照冻进裁决记录，建模阶段读快照）——runtime 应当直接做对。
- **A5 · 交付终点在这里。** 按架构宪法 D3/D9，建模与报告不在范围内，也不提取契约。本交付物锁定即 runtime 全流程结束。锁定关的 gate 呈现要把这一点说清楚：锁的不是"一个中间产物"，是"建模将要训练在其上的那张表"。
