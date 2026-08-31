# OLS 预验证 —— 重构规格

> 状态：**已实现**（2026-08-18）。下面的设计稿保留原样，
> 实现过程中被推翻或简化的地方在文末「实现纪要」里逐条记下来了——
> 一份与代码不符的规格比没有规格更坏。
> 目标：把 `ols-test` 从「一次拟合 + 逐行区间裁决」重构成
> 「**方案 → 参数 → 多次拟合 → 报告 → 因子建议**」的五步交互流程。
> 前置评审见 `docs/specs/platform-contracts/ols-test.md` 与本轮发现的 8 处实现缺陷。

---

## 0 · 为什么要改

现状的三个结构性问题：

1. **建模维度写死。** 模型对象恒为（渠道类型, 品牌），只在澄清里问一句「要不要换粒度」，
   而换粒度需要重跑整条链且没有可行性依据。客户无法参与「什么数据入模」这个最该由他定的决策。
2. **参数不可见。** `ols-config.yaml` 由 `ols.propose` 写出、SKILL.md 明令「没人手改它」。
   adstock 衰减、饱和形态、趋势、季节项、单价——这些直接决定系数的东西，客户从未过目。
   而「拟合失配先减控制项」这条硬规矩，实际上没有给人调控制项的入口。
3. **只有一次拟合，且结果只以 YAML + Markdown 呈现。** 无法比较不同方案，
   没有可交付给客户的正式报告，也没有把结论回馈给因子树的通路。

**同时必须守住的东西**（现状设计里最有价值的部分，重构不得破坏）：

- 不搜索、不把变量集合调向基准（SKILL.md:11-18）
- 人的裁决压过重拟合；被拒的行不许消失
- 拟合失配先减控制项，不走剔除指标那条路
- 不可复议：上一层已裁过的不参与本步
- 每个数都来自一次真实的工具运行

---

## 1 · 新流程总览

```
                ┌── 上游：统计检验已确认，selection.json 已推导 ──┐
                ▼
  ① plan     H  建模方案：什么数据入模、切成几个模型          [门] → ols-plan.yaml
  ② params   H  入模参数：变换与控制项，默认可接受            [门] → ols-config.yaml
  ③ fit      M  按方案拟合，可多次，每次留痕                       → ols-runs/*.json
  ④ factors  C+H 跨运行综合 → 因子入模建议                    [门] → ols-scorecard.yaml
                                                                  + ols-factors.xlsx
  ⑤ report   A  建模报告（Markdown / HTML / Word 按需）             → ols-report.docx
```

步骤全称即进度键：`ols-test/plan`、`ols-test/params`、`ols-test/fit`、
`ols-test/factors`、`ols-test/report`。

**三道人工确认门**（现状只有一道）。这是本次重构的核心：
把「什么数据入模」和「用什么参数」从工具的默认值，提升成客户签字的决策。

**③ 可循环。** `fit` 允许多次执行，每次产生一个带 `runId` 的运行记录。
④ 综合的是**被采纳的那些运行**，不是最后一次。

---

## 2 · 步骤 ① `plan` —— 建模方案（H，带门）

### 2.1 它回答什么

> 这次建模用哪些数据、切成几个模型、每个模型覆盖什么。

### 2.2 工具：`ols.plan`（新增）

```bash
~/.local/bin/mmm tool ols.plan --workspace <工作区>
```

它**不做选择，只算可行性**。枚举候选切分方案，对每个方案算出决策所需的全部事实：

| 输出字段 | 含义 | 为什么客户需要它 |
|---|---|---|
| `scheme` | 切分方案 id | — |
| `objects[]` | 该方案下的模型对象清单 | 看得见会建几个模型 |
| `months` | 每个对象的可用月数 | 决定能带几个变量 |
| `affordableDrivers` | `max(1, 月数 − 控制项数 − 1 − 10)` | **最关键的数**：能识别几个驱动 |
| `survivingDrivers` | 该对象存活的驱动数 | 与上一列的差 = 会被留出多少 |
| `heldOutCount` | 会因自由度留出的变量数 | 切得越细，留出越多 |
| `responseCoverage` | 该对象响应占全量响应的比例 | 切分后是否还覆盖住生意 |
| `skippedObjects[]` | 缺响应或缺驱动、会被跳过的格子 | 避免「跑完才发现少了一半」 |
| `feasibility` | `ok` / `tight` / `infeasible` | 汇总判断 |

候选方案（按粒度从粗到细）：

| id | 切分 | 典型适用 |
|---|---|---|
| `total` | 不切，全体数据一个模型 | 月数少、只要总量结论 |
| `by-brand` | 按品牌 | 多品牌、渠道结构相近 |
| `by-channel` | 按渠道类型 | 单品牌、渠道行为差异大 |
| `by-region` | 按地区 | 区域投放差异大 |
| `channel-x-brand` | 渠道 × 品牌（**现状默认**） | 默认推荐 |
| `custom` | 人指定的对象子集 | 只关心几个重点格子 |

方案清单受 `artifacts/s1/project-profile.yaml` 的**模型范围矩阵**约束——
不在范围矩阵里的维度不得出现为候选。

### 2.3 时间窗也在这一步定

同一个 `plan` 里附带：

- `window`: 建模时间窗（起止），默认取发布数据集的全窗
- `excludedPeriods[]`: 明确排除的时段（新品上市前、极端事件段），**每段必须写理由**
- 排除时段与业务校验里已接受的 `event` / `cap` 异常卡片的关系要显式声明：
  **`event` 是加控制列，`excludedPeriods` 是删数据**——两者不能对同一段同时生效

### 2.4 产出：`artifacts/s2/ols-plan.yaml`（store）

```yaml
meta:
  step: ols-test/plan
  skill: ols-test
  generated: ""
  grounding: [...]
  dataSource: project          # project | reference

# 工具算出来的全部候选与可行性——不许删，客户看的是对比
candidates:
  - scheme: channel-x-brand
    recommended: true
    feasibility: ok
    objectCount: 4
    objects:
      - object: ""
        label: ""
        months: 0
        survivingDrivers: 0
        affordableDrivers: 0
        heldOutCount: 0
        responseCoverage: 0.0
    skippedObjects:
      - { object: "", reason: "" }     # reason: no-response | no-driver | months<12
    note: ""

# 人定的那个
chosen:
  scheme: ""
  decidedBy: ""                 # human | assumed
  at: ""
  rationale: ""                 # 必填。为什么是这个粒度
  customObjects: []             # scheme=custom 时必填

window:
  from: ""
  to: ""
  months: 0
excludedPeriods:
  - { from: "", to: "", reason: "", conflictsWithAnomaly: false }

assumptions: [...]
```

### 2.5 门

```yaml
gate:
  kind: approval
  question: >
    这次建模用哪些数据、切成几个模型。切得越细，每个模型能识别的驱动越少；
    切得越粗，不同产品的系数会被平均成一个数。选定之后参数与拟合都跟着它走。
  evidence: artifacts/s2/ols-plan.yaml
  rework: stat-screening/review
```

### 2.6 检查项（新增）

| id | 严重度 | 说什么 |
|---|---|---|
| `plan_scheme_chosen` | block | 选定的方案在候选清单里，且写了理由 |
| `plan_within_scope_matrix` | block | 切分维度不超出项目档案的模型范围矩阵 |
| `plan_feasibility_disclosed` | block | 选定方案的每个对象都报了月数与可负担驱动数 |
| `excluded_periods_justified` | block | 每个排除时段都有理由，且不与已接受的异常窗口冲突 |

---

## 3 · 步骤 ② `params` —— 入模参数（H，带门）

### 3.1 参数分两档 —— 这是本步最重要的设计

| 档 | 谁能改 | 包含 | 理由 |
|---|---|---|---|
| **结构参数** | **客户可选** | adstock 衰减、饱和形态与半饱和点、趋势、季节项与阶数、控制项预算、单价 | 这些是对生意的假设，客户比我们懂 |
| **判据参数** | **固定，不开放** | 显著性阈值 `\|t\|≥2`、最少残差自由度 10、设计矩阵共线剔除线 100、红灯线 30% | 判据一旦可调，「过了检验」就失去意义 |

**判据参数必须在产出里列出来但标 `locked: true`**——让客户看见有哪些线是不动的，
比让他发现自己能动它要好。唯一例外：`redDeviation` 允许项目级调整，但要写理由并进 assumptions。

### 3.2 结构参数清单

```yaml
params:
  # ── 变换 ──
  adstock:
    mode: global                # global | per-l3 | per-l4
    default: 0.5                # 0 ≤ decay < 1
    overrides:                  # mode ≠ global 时生效
      - { scope: "", value: 0.0, rationale: "" }
    decidedBy: default          # default | human
  saturation:
    form: hill                  # hill | none
    hillHalf: 1.0               # 半饱和点 = 变换后均值 × 此系数
    slope: 1.0
    decidedBy: default
  # ── 控制项 ──
  trend: linear                 # linear | none
  seasonality: none             # none | fourier | dummies  ← 注意：现状默认就是 none
  fourierK: 2
  controlBudget: auto           # auto | manual
  # ── 口径 ──
  pricePerUnit: null            # 响应是销量时必须有，否则 ROI 不做区间检查
  responseUnit: volume          # money | volume
  contributionBasis: auto       # auto（花费类→0，非花费→窗口最小值）| zero | min

locked:                         # 判据参数，展示但不可改
  significantT: 2.0
  minResidualDf: 10
  maxDesignVif: 100.0
  redDeviation: 30.0
```

### 3.3 必须修掉的一处文档与默认值背离

`OlsParams` 的默认 `seasonality = "none"`（引擎注释记了原因：34 个月的序列上
趋势 + 2 阶傅里叶 = 5 列与约 12 个驱动争 34 个观测，基线曾到 250%），
但 `references/fit.md:49` 写「趋势 + 傅里叶季节项 + 月度哑变量」，
`clarify.md:78` 把「月数<24 关季节项」当推荐项 A ——**描述的是一个默认就没开的东西**。

重构后：`ols.propose` 必须把**实际默认值**渲染进 `ols-config.yaml`，
文档不再复述参数默认值，只解释每个参数的业务含义。

### 3.4 产出：`artifacts/s2/ols-config.yaml`（store，**改为人可编辑**）

现状 SKILL.md 说「没人手改它」。重构后它是客户签字的参数表。
每个参数带 `decidedBy: default | human` 与 `rationale`。
流程定义里为它保留 `computed_by: ols.propose`（工具负责铺默认值），
但**不加 `computed_by_tool` 检查**——那条检查会禁止人工编辑。

### 3.5 门

```yaml
gate:
  kind: approval
  question: >
    这些参数决定每个渠道的钱多久见效、投多了会不会边际递减、
    以及有多少销量算在"本来就会发生"的基线里。默认值可以直接用；
    改了哪个，报告里会写明是你定的。
  evidence: artifacts/s2/ols-config.yaml
  rework: ols-test/plan
```

### 3.6 检查项（新增）

| id | 严重度 | 说什么 |
|---|---|---|
| `params_confirmed` | block | 每个结构参数都有 `decidedBy`，非默认值必须有理由 |
| `locked_params_untouched` | block | 判据参数与引擎常量一致（`redDeviation` 例外但要有理由） |
| `price_declared_when_volume` | advise | 响应是销量却没给单价时，明确记录「本轮不做 ROI 区间检查」 |

---

## 4 · 步骤 ③ `fit` —— 多次拟合（M）

### 4.1 运行身份

```bash
~/.local/bin/mmm tool ols.fit --workspace <工作区> --purpose "<为什么跑这一次>" [--settle]
```

**`--purpose` 必填。** 这是防搜索的第一道闸：
每次拟合必须先声明目的，再看结果。事后补写的目的不算。

每次运行产生 `runId = r-0001` 递增，写：

- `data/derived/ols-runs/<runId>.json` —— 该次运行的完整结果（computed）
- `data/derived/ols-fit.json` —— 运行索引 + 采纳指针 + 每次运行的摘要（computed）

### 4.2 `ols-fit.json` 新结构

```json
{
  "schemaVersion": 4,
  "adopted": ["r-0002"],
  "runs": [
    {
      "runId": "r-0001",
      "purpose": "基线：按方案与默认参数跑第一次",
      "planSha": "…", "paramsSha": "…", "selectionSha": "…",
      "generated": "2026-08-17T…+08:00",
      "adopted": false,
      "supersededBy": "r-0002",
      "supersedeReason": "基线占比 118%，按硬规矩减控制项重跑",
      "summary": { "objects": 4, "fitted": 4, "failed": 0,
                   "misfitObjects": 1, "medianR2": 0.71 }
    }
  ]
}
```

单次运行的 payload（`ols-runs/<runId>.json`）保持现状 `models[] / excluded / flagged`
的形状，另加 `plan` / `params` 的**快照**——运行必须自解释，
否则日后配置改了就再也说不清那次跑的是什么。

### 4.3 防搜索的硬规矩（新增，最重要的一节）

多次运行天然带来一个风险：**跑很多次然后挑最好看的那次，就是被删掉的那个 96 次搜索换了层皮。**
必须写死：

> **1. 先声明目的，再看结果。** 每次运行的 `purpose` 在拟合前写入，事后不可修改。
>
> **2. 所有运行都进报告，不许只报采纳的那次。** 被弃用的运行连同弃用理由一起呈现。
>
> **3. 采纳理由不得是「拟合优度最高」或「最贴合行业区间」。** 合法的采纳理由只有三类：
>    - **修正了拟合失配**（基线占比回到 0–100%、付费驱动符号转正）
>    - **方案或参数变更本身是客户决策**（客户改了粒度 / 改了 adstock）
>    - **修复了数据或口径错误**（分母借错了、单价补上了）
>
> **4. 一次运行不许因为某个因子的结果不好看而重跑。** 那是把基准当成调向目标。
>    因子层面的处置属于步骤 ④ 的逐行裁决，不属于重拟合。

对应新增检查项 `runs_are_declared`（block）与 `adoption_reason_is_legal`（block，
后者对采纳理由做关键词与结构校验，命中「R²/拟合优度/更贴合/更接近区间」直接拒）。

### 4.4 多运行与账本的关系（必须想清楚）

下游 `model-input` 经 `ledger.derive` 读 `ols_scorecard`，六层账本里 ols-test 占两层：

| 层 | 现状语义 | 多运行后的新语义 |
|---|---|---|
| `selection` 变量选择 | 没进**这次**拟合 | **没进任何一次被采纳的运行** |
| `range` 区间检验 | 越界且被裁决拒绝 | 步骤 ④ 综合裁决为 `exclude` |

即：**账本读的是步骤 ④ 的综合结论，不是任何单次运行。**
这样「采纳哪次运行」就不会隐式地决定入模变量集合，防搜索的边界更牢。

### 4.5 顺带修掉的现有缺陷

- `cli/tools/ols.py:171` 加 `by_alias=True`（现在落盘全是 snake_case，
  导致 `human_verdicts_preserved` 这条 block 检查从未检查过任何一行）
- `cli/tools/ols.py:187-196` 的 `recommendation` / `value` / `band` 三个字段
  在 `OlsRangeRow` 上不存在，红灯行的 stdout 永不打印——改用 `autoVerdict` / `rangeSeverity`
- `predicates_s2.py:1129` 的 `against` 计数恒为 0，同因

---

## 5 · 步骤 ④ `factors` —— 因子入模建议（C + H，带门）

### 5.1 它回答什么

> 综合全部被采纳的运行，每个因子该不该进正式模型。

### 5.2 跨运行综合的方法（技术上最需要小心的地方）

**不同切分方案下的贡献度不可直接平均。** 全国模型里某因子贡献 8%，
渠道×品牌模型里它在 EC 贡献 15%、在 TT 贡献 2%——把这三个数平均没有意义。

所以综合**只用无量纲证据**，量纲证据只报区间不做聚合：

| 综合维度 | 怎么算 | 是否跨运行聚合 |
|---|---|---|
| `inModelRate` 入模率 | 进模型的（运行 × 对象）数 / 总数 | ✅ |
| `signConsistency` 符号一致性 | 主导符号的占比 | ✅ |
| `significanceRate` 显著率 | `\|t\|≥2` 的占比 | ✅ |
| `contributionObserved` | `min ~ max`，**逐运行分组列出** | ❌ 只报范围 |
| `roiObserved` | 同上 | ❌ |
| `rangeSeverity` | 取**最差**的那一档（red > yellow > green > none） | ✅ 取最差 |
| `heldOutReasons` | df-limit / collinear 的分布 | ✅ |

### 5.3 因子建议状态机

```
入模建议 recommendation ∈ {
  include       建议入模    符号一致 ≥ 0.8、显著率 ≥ 0.5、无红灯
  conditional   有条件入模  仅在部分对象成立 —— 必须写明适用对象
  watch         保留观察    进模型但弱或不稳，不剔除，报告里标注
  exclude       建议剔除    符号持续反常 / 红灯 / 判读 implausible 且有带
  insufficient  不足以判断  从未进任何运行（自由度或共线）
}
```

沿用现状的**不可复议**三态，它们不进本步裁决：
`notMapped`（映射层未覆盖）、`dropped`（质量/签核/统计层已拒）。

### 5.4 无带时的处置 —— 已定的设计决策

真实工程 `yuanli-sports` 实测 18 行**全部** `noBenchmark`，红黄绿灯一次未触发，
而 8 条变量的剔除全部由 `aiVerdict: implausible` 单独决定。这与「不自动选指标」冲突。

**重构后：`status == noBenchmark` 时，`implausible` 不再自动 `exclude`，
降级为 `watch` 并进入必须逐条过目的分组。**

理由与 `review.md:44` 自身的边界声明一致：AI 的判定「与算出来的状态**并列，永不取代它**」。
无带意味着没有算出来的状态可以并列，AI 就不该独自作出剔除动作。

实现上不破坏 `range_verdicts_binary`（离开时只能 accept/reject）这条不变量：
`recommendation` 是**建议**（五态），`disposition` 仍是**裁决**（二态）。
无带 + implausible 的行 `recommendation: watch`、`disposition` 留待人填，
在门上单列成「需逐条过目」分组。

### 5.5 产出 A：`artifacts/s2/ols-scorecard.yaml`（store）

在现状 4 个顶层块的基础上补齐——**现状模板声明了 4 块，工具只写出 2 块**
（`models` / `summary` / `assumptions` 从未落盘，行字段 `roiUnit` / `roiBasis` /
`contributionBasis` 在模型上根本不存在）。重构后全部补上，并新增 `factors` 块：

```yaml
meta: {...}                  # 加 runsIncluded: [r-0002, r-0003]

factors:                     # 【新增】一因子一行，跨运行综合，客户审的就是它
  - treeRowId: f-0043
    l1/l2/l3/l4/indicator/metric: ""
    inModelRate: 0.0
    signConsistency: 0.0
    dominantSign: ""         # + | - | mixed
    significanceRate: 0.0
    contributionObserved:    # 逐运行分组，不平均
      - { runId: "", object: "", value: 0.0 }
    roiObserved: [...]
    roiUnit: money           # money | volume/spend  ← 现状缺失
    roiBasis: ""             # 借用分母时必须说       ← 现状缺失
    contributionBasis: ""    # vs zero | vs its lowest month  ← 现状缺失
    rangeSeverity: none      # 取最差
    rangeSource: ""
    recommendation: ""       # include|conditional|watch|exclude|insufficient
    conditionalScope: []     # recommendation=conditional 时必填
    aiVerdict: ""            # consistent|questionable|implausible|noBenchmark
    aiRationale: ""          # ≤30 词
    disposition: accept      # 人的裁决，二态
    decidedBy: ai            # ai | human —— human 钉住，重拟合不覆盖
    note: ""

rows: [...]                  # 逐（运行 × 对象 × 因子）明细，保留现状形状
models: [...]                # 【补齐】逐（运行 × 对象）拟合概况，含 misfit / heldOut
summary: {...}               # 【补齐】各状态计数
assumptions: [...]           # 【补齐】
```

### 5.6 产出 B：`artifacts/s2/ols-factors.xlsx`（view）

FactorTree 形状的因子审阅表。**是 view，不可手改**——
渲染自 `factor-tree.yaml` + `ols-scorecard.yaml`，带 `sourceHash`。

| Sheet | 内容 | 给谁看 |
|---|---|---|
| `因子建议` | 一行一因子，L1–L4 + 指标 + 全部证据列 + 建议 + 裁决 | 客户主表 |
| `逐对象明细` | 一行（运行 × 对象 × 因子），系数/t/p/贡献度/ROI | 想往下钻的人 |
| `模型概况` | 一行（运行 × 对象），n/R²/MAPE/DW/基线占比/红旗 | 技术评审 |
| `过滤漏斗` | 六层账本各剔了多少、剩多少 | 「我给的数据去哪了」 |
| `方案与参数` | plan + params 快照 | 复现依据 |
| `说明` | 列定义、状态含义、怎么标 | 必备 |

**因子状态在主表用颜色 + 文字双编码**（不能只靠颜色，打印和色觉障碍都会失效）：

| 建议 | 底色 | 文字标记 |
|---|---|---|
| include | 绿 | 建议入模 |
| conditional | 青 | 有条件入模（见适用对象列） |
| watch | 黄 | 保留观察 |
| exclude | 红 | 建议剔除 |
| insufficient | 灰 | 数据不足以判断 |
| dropped / notMapped | 深灰 + 删除线 | 上游已裁，不复议 |

**回写通路**：Excel 是 view，客户在上面的批注不会自动回到 yaml。
两个选项，建议选 B：

- A. Excel 只读，裁决一律在 `ols-scorecard.yaml` 里填 —— 简单，但客户习惯在 Excel 上批
- B. **新增 `ols.factors-import`**，读客户另存的副本，校验 `sourceHash` 血缘后回写
  `disposition` / `note` / `decidedBy: human` 到 yaml。血缘对不上直接拒，
  防止拿一份过期的表回写。

### 5.7 门

```yaml
gate:
  kind: approval
  question: >
    每个因子该不该进正式模型。标"建议剔除"的会从模型输入表里消失；
    标"保留观察"的会进模型但在报告里带注记。你的裁决会被钉住，
    后面每次重拟合都不会覆盖它。
  evidence: artifacts/s2/ols-factors.xlsx
  rework: business-validation/page
```

`rework` 保持指向业务校验——数字是症状，怎么读数据才是病因，这条不变。

---

## 6 · 步骤 ⑤ `report` —— 建模报告（A）

### 6.1 三种载体

| 产出 | 何时生成 | 类型 |
|---|---|---|
| `artifacts/s2/ols-test.md` | 每次 | view |
| `artifacts/s2/ols-test.html` | 每次 | view |
| `artifacts/s2/ols-report.docx` | **客户要求时** | view |

**Word 不新增工具，沿用已有的报告应用**（原稿写的 `export.docx` + `python-docx` 是错的，
runtime 已经有一条 Word 管线，照抄它）：

```bash
~/.local/bin/mmm app report ols-test --workspace <工作区> [--out <路径>]
```

`apps/report/__main__.py` 的 `REPORTS` 表加一个 `"ols-test": ols_test` 条目，
新模块 `apps/report/ols_test.py` 照 `project_profile.py` 的形状实现
`TOOL` / `DELIVERABLE` / `default_out(root)` / `build(root) -> (model, notes)`。

分工是现成的、也是刻意的：**内容留在 Python，Word 格式交给 `render_docx.js`（npm `docx`）**。
`sourceHash` 必须由 Python 端的 `gate_check.source_hash()` 算好后放进模型再落盘——
在 JS 里重写一遍 YAML 写出器只会得到第二个说法。写完之后 `verify()` 会把文件重新打开、
确认它真的是一份能打开且非空的 Word，并带着来源指纹。

依赖：Node + `npm install`（`package.json` 已声明 `docx ^9.7.1`）。
**这台机器现在缺 `docx` 包**，`~/.local/bin/mmm doctor` 报
`stage 1 · docx MISSING — BLOCKED`。缺件时正确反应是报错说清楚，不是降级成 Markdown。

所有图表先由 `apps/charts/` 渲成 PNG 再嵌入——不在 Word 里画图。

### 6.2 Word 报告结构（这是你要我规划的部分）

```
封面
  项目 / 客户 / 建模范围 / 报告日期 / 版本
  ⚠️ 数据源声明：跑的是项目数据还是参考数据集

1  摘要
   1.1 这次建了什么模型（一句话）
   1.2 主要发现（3–5 条，每条带数字与出处）
   1.3 需要客户决策的事项（若门未关，列在最前）
   1.4 本报告的口径边界（ROI 单位、是否做了区间检查）

2  建模方案
   2.1 切分方案与理由            ← ols-plan.yaml chosen.rationale
   2.2 模型对象清单              表：对象 / 月数 / 存活驱动 / 可负担驱动 / 响应覆盖
   2.3 时间窗与排除时段          每段排除写理由
   2.4 被跳过的对象及原因        「空也是结论」

3  入模参数
   3.1 结构参数表                参数 / 取值 / 默认值 / 谁定的 / 理由
   3.2 变换的业务含义            adstock 与饱和的白话解释，给非技术读者
   3.3 固定判据                  标 locked，说明为什么不开放

4  数据基础
   4.1 六层过滤漏斗              图：桑基或漏斗，各层剔除数
   4.2 进入本步的因子清单        按 L1/L2 汇总
   4.3 继承自上游的弃用          「这里不重新打分」

5  拟合结果（逐模型对象，每对象一节）
   5.1 拟合概况                  n / R² / adjR² / MAPE / DW / 基线占比
   5.2 实际 vs 拟合              时序折线图
   5.3 贡献度分解                堆叠面积图 + 瀑布图
   5.4 驱动明细                  表：系数 / t / p / 显著 / 贡献度 / ROI / 区间 / 状态
   5.5 被留出的变量              原因（自由度 / 共线），**明确写"不是对指标的判决"**
   5.6 红旗与处置                基线>100% 或付费反号 → 写明减了哪些控制项

6  跨对象比较
   6.1 同一因子在不同对象的表现  热力图：因子 × 对象，填系数符号与显著性
   6.2 不一致点                  ← fit.md 说这是「最有用的一段」
   6.3 全国共享变量的影响

7  多次运行对比（有多次时）
   7.1 运行清单                  runId / 目的 / 方案差异 / 参数差异 / 是否采纳
   7.2 采纳理由                  ⚠️ 必须是三类合法理由之一
   7.3 被弃用的运行              连同弃用理由，**不许省略**

8  因子入模建议
   8.1 建议分布                  五态计数 + 图
   8.2 建议明细表                与 Excel 主表同源
   8.3 需客户逐条过目的行        无带 + implausible 的那一组
   8.4 客户已裁决的行            标出与系统建议相反的

9  假设与局限
   9.1 澄清登记                  assumptions，含 assumed: true 的
   9.2 无可比区间的因子          「这是没跑这项检查，不是超出区间」
   9.3 数据不足的对象
   9.4 方法局限                  OLS 的固有局限、未做的检验

附录
   A  完整因子清单（含上游已剔除的，标明在哪一层剔的）
   B  术语表                     贡献度 / ROI / adstock / 饱和 / 基线，白话
   C  方法说明                   最小二乘、变换、分解恒等式
   D  数据出处                   grounding 清单 + payload 哈希
```

### 6.3 报告的硬规矩

- **每个数逐字抄自计算结果**，不四舍五入、不换单位、不心算、不重算
- **图表由 `apps/charts/` 渲染**，不在报告里现算
- 元信息块声明 `generatedFrom` + `payloadHash`（`.docx` 存进 `docProps/custom.xml`）
- **ROI 单位不是货币时，全报告不出现与行业带的比较**，并在摘要里明说
- 客户裁决与系统建议相反的行必须出现在 8.4，不许静默合并

---

## 7 · 架构变更清单

### 7.1 工具

| 工具 | 变更 | kind |
|---|---|---|
| `ols.plan` | **新增** —— 枚举切分方案与可行性 | model |
| `ols.propose` | 改 —— 输出带 `decidedBy` / `locked` 的参数表 | model |
| `ols.fit` | 改 —— `--purpose` 必填，按 runId 累积 | model |
| `ols.factors` | **新增** —— 跨运行综合出因子建议 | model |
| `ols.scorecard` | 并入 `ols.factors`，或保留为其别名 | model |
| `ols.factors-import` | **新增（可选）** —— Excel 回写 yaml，校验血缘 | model |
| `export.docx` | **新增** —— Word 报告 | export |
| `export.xlsx` | 扩展 —— 新增 `--card factors` | export |

### 7.2 领域模型（`domain/models.py`）

新增 `OlsPlan` / `OlsPlanCandidate` / `OlsRun` / `OlsRunIndex` / `OlsFactorRow`；
`OlsRangeRow` 补 `roiUnit` / `roiBasis` / `contributionBasis`；
`OlsRangeScorecard` 补 `models` / `summary` / `assumptions` / `factors`。

### 7.3 文件与归属

```
artifacts/s2/ols-plan.yaml         store   ols-test   【新增】
artifacts/s2/ols-config.yaml       store   ols-test   【改为人可编辑】
artifacts/s2/ols-scorecard.yaml    store   ols-test   【扩展】
artifacts/s2/ols-factors.xlsx      view    ols-test   【新增】
artifacts/s2/ols-report.docx       view    ols-test   【新增】
artifacts/s2/ols-test.{md,html}    view    ols-test
data/derived/ols-fit.json          computed           【改结构 v4】
data/derived/ols-runs/<runId>.json computed           【新增】
```

`shared/workspace-layout.md` 的唯一写者表要同步扩表。

### 7.4 检查项

新增 9 条：`plan_scheme_chosen` · `plan_within_scope_matrix` · `plan_feasibility_disclosed` ·
`excluded_periods_justified` · `params_confirmed` · `locked_params_untouched` ·
`runs_are_declared` · `adoption_reason_is_legal` · `factor_recommendations_complete`

修 3 条：`human_verdicts_preserved`（字段名 bug）· `fit_matches_selection`（适配多运行）·
`fit_is_fixed_point`（改为对采纳的运行判定）

### 7.5 Skill 文件

```
skills/ols-test/
  SKILL.md                   ≤150 行（现 101 行，新增 3 步后要压缩）
  references/plan.md         【新增】
  references/params.md       【新增】
  references/fit.md          改：多运行、防搜索、去掉与默认值背离的描述
  references/factors.md      【新增】（替代 review.md）
  references/report.md       【新增】Word 报告怎么写
  references/clarify.md      改：澄清点从 5 个重排，plan/params 的问题上移到各自步骤
  templates/ols-plan.yaml    【新增】
  templates/ols-config.yaml  【新增】
  templates/ols-scorecard.yaml  扩展
```

⚠️ `scripts/check_suite.py` 的静态约束要守住：SKILL.md ≤ 150 行、
正文禁用 `predicate`/`payload`/`manifest`/`artifact` 字样、必须含「澄清」与「说话的规矩」、
references 里禁止手抄检查项清单、不得出现 `state.py close|decide|reopen`。

### 7.6 迁移

现有 4 个 engagement 的 `ols-scorecard.yaml` 是 snake_case 且缺 3 个顶层块，
`ols-fit.json` 是 v3 单运行结构。`scripts/migrate_workspace.py` 需要：
snake→camel 改名、补空的 `models`/`summary`/`assumptions`、
把单个 fit 包成 `r-0001` 并标 `adopted: true`、`purpose` 填「迁移自单运行结构」。

---

## 8 · 分期建议

| 期 | 内容 | 为什么这个顺序 |
|---|---|---|
| **P0** | 修 3 处静默失效的 bug（`by_alias`、字段名、`against` 计数） | 与重构无关的纯 bug，现在检查项在空转 |
| **P1** | 步骤 ① `plan` + ② `params` + 两道门 | 用户价值最高、且不动拟合与账本 |
| **P2** | 步骤 ③ 多运行 + 防搜索规矩 + 账本语义调整 | 动数据结构与下游，风险最大 |
| **P3** | 步骤 ④ 因子综合 + Excel | 依赖 P2 的多运行结构 |
| **P4** | 步骤 ⑤ Word 报告 | 纯呈现层，最后做不阻塞任何人 |

**P2 是风险集中点**：它改 `ols-fit.json` 结构、改账本两层语义、改 3 条现有检查项，
且下游 `model-input` 的 lock 门回流目标是 `ols-test/fit`。建议 P2 单独一个 PR，
并先补一个「落盘带 `decidedBy: human` 且裁决被冲掉的评分卡，断言检查项拒绝它」的真用例——
目前这个用例若存在也是假通过。

---

## 9 · 待你拍板的事

| # | 问题 | 我的建议 |
|---|---|---|
| 1 | Excel 是否支持回写 | 支持（方案 B，校验 sourceHash 血缘） |
| 2 | 多个运行能否同时采纳 | 能，但账本只读步骤 ④ 的综合结论 |
| 3 | `redDeviation` 是否开放给客户 | 开放但要写理由并进 assumptions；其余判据固定 |
| 4 | adstock 是否支持按 L3/L4 分别设 | 支持（TV 与 Digital 衰减本就不同），默认 global |
| 5 | Word 报告是否需要中英双语 | 跟 `mmm.yaml:outputLanguage`，不单独做 |
| 6 | `report` 步是否要门 | 不要。报告是呈现，决策在 ④ 已经做完 |

---

# 10 · 实现纪要（2026-08-18）

规格里有四处在落地时被证明是错的或多余的，照实记下来。

## 10.1 推荐规则错了 —— 已改

原稿 §2.2：「全部 tight 时推荐按住最少的那一档」。实测在 yuanli-sports 上推荐出 `total`，
而 `total` 恰恰是唯一对任何单个渠道都说不出话的切法，出现在一个整个目的就是分渠道读数的步骤里。

根因：`totalHeldOut` 跨切法**不可比**。4 个模型各按住 2 个（共 10）并不比 1 个模型按住 4 个更差，
因为前者回答 4 个问题、后者只回答 1 个。

改成：**推荐可行的最细那一档**，代价（逐格 `heldOutCount` 与 `allTight`）如实摆出来，
要不要往粗里走由人定。

## 10.2 账本不需要改 —— 原稿 §4.4 是多余的

原稿要把 `selection` / `range` 两层的语义改成「读综合结论」。落地时查证：
**账本只读 store（`ols_config`、`ols_scorecard`、各评分卡、签核），从不读 `ols-fit.json`。**
所以多运行对账本完全透明，两层语义原样不动即可。下游 `model-input` 也不受影响。

## 10.3 Word 管线是 Node 不是 Python —— 已改

原稿 §6.1 写「基于 `python-docx`，新增 `export.docx` 工具」。runtime 已经有一条 Word 管线：
`apps/report/render_docx.js`（npm `docx`）+ 每份报告一个 Python 模块出内容。
照抄它，新增 `apps/report/ols_test.py`，走 `~/.local/bin/mmm app report ols-test`。

分工是刻意的：内容留 Python，格式交 JS，`sourceHash` 必须 Python 端算好——
在 JS 里重写一遍 YAML 写出器只会得到第二个说法。

## 10.4 Excel：渲染沿用现成实现，回写按方案 B 做了

渲染不必新建工具：`apps/workbook/builders/scorecard.py` 是一份代码吃三种评分卡的通用实现，
加字段表就多出「因子建议」「模型概况」两张表。

回写按原稿 §5.6 **方案 B** 实现为 `ols.factors-import`：读客户另存的那一份，
校验来源指纹血缘，只回写「人工判定」「备注」两列。三条规矩：
指纹对不上直接拒（照旧工作簿回写会把中间的改动往旧的方向盖）；
只有真的改过的行才标 `decidedBy: human`（在工作簿里出现过就标人工，
等于伪造一次没发生的评审，而人工裁决一旦标上后面每次重拟合都会保护它）；
系数一类算出来的列不可导入——客户改不了一个系数，只能改对它的判定。

## 10.6 回写把两个更深的缺陷炸了出来

做回写的验收时发现：客户的否决写进 YAML 之后，**重跑 `ols.scorecard` 会把它冲掉**，
而 `human_verdicts_preserved` 报「6 项检查通过」。两个原因叠在一起：

- `workspace.load_state` 只读评分卡的 `rows`，**`factors` 在加载时就被丢掉**，
  于是钉住人工裁决的那段代码永远在跟一张空表比对；
- `human_verdicts_preserved` 也只看 `rows`，所以因子层被冲掉它看不见。

这与 P0 那个缺陷是同一个形状：**看不见的东西被读成"没有要保护的"，然后通过**。
两处都已修，并各配了会真红的用例。

## 10.7 迁移漏写运行体

`migrate_workspace` 把历史拟合标成 `adopted: ["r-0001"]`，却没写
`data/derived/ols-runs/r-0001.json`。因子表于是静默出空——而**空的因子表读起来
和「没有因子合格」一模一样**。修法是两条：迁移补写运行体；`load_bodies` 遇到
索引声称采纳、磁盘上却没有的运行时**直接报错**，不再跳过。

## 10.5 顺带修掉的、原稿没预料到的

- `ols.propose` 也漏了 `by_alias=True`（P0 只修了 `ols.scorecard`），这是同一个缺陷的第四处。
- `workspace.py::_plain()` 带着一句「by field name, not alias」的注释故意不用别名，
  理由是「camelCase 写出去 `load_state` 会读成空」。实测该前提为假——
  所有 store 模型都是 `CamelModel`，`populate_by_name` 让两种拼法都能读回来。
  它当时无人调用，但会让任何一个改用 `save_store` 的人把 P0 修好的检查项重新打回空转。已修。
- 模型对象 id 需要能表达「这一维不切」。用 `*` 通配而不是加方案前缀，
  因为变更账本、配置、人已签的确认都在逐字引用这个 id——同一个格子必须只有一个写法。
