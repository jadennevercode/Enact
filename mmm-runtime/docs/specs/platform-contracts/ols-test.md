# 契约卡：OLS 预验证

**阶段：** 数据
**平台出处：** 2.34 指标筛选 —— OLS 快速验证
- 规格：`Assets/数据智能体知识库/流程化/2.34-指标筛选OLS.md`、`Assets/数据智能体知识库/机器可读/factor-ranges.json`
- 设计：`docs/agent-design/02-data-agent.md` §2.34/§6（G2.34）、`docs/agent-design/07-assumptions-log.md` A2（量化判据的补丁）、`docs/agent-design/05-project-control-agent.md` §2.1（回流路径）
- 实现：`backend/app/agents/ols_review.py`、`backend/app/agents/ols_scorecard.py`、`backend/app/agents/ols_benchmark.py`、`backend/app/agents/data_rules.py::build_range_index / RangeIndex / match_factor_range`、`backend/app/mmm/{engine,ols,transforms,pivot}.py`、`backend/app/domain/blueprint.py::d-2.5`

**产出 Skill：** `ols-test`

---

## 输入

| 来源 | 内容 | 类型 |
|---|---|---|
| 上游交付物 · 统计检验 | 每个 (L4, 指标) 的 `disposition`（`drop` 的一律不进拟合）+ `cv / pearson / vif` 三个数（用于告警注记） | 依赖 |
| 上游交付物 · 业务校验与签核 | 客户否决名单；已接受的异常处置（`event` 窗口 → 控制列；`cap` 窗口 → 响应缩尾） | 依赖 |
| 上游交付物 · 数据质量评分 / 因子映射 | 更上游的淘汰名单，逐层继承 | 依赖 |
| 上游交付物 · 发布数据集 | 长表 —— 拟合矩阵的原料 | 依赖 |
| 上游交付物 · 因子树 | 完整因子树，用于把拟合结果投影回每一行（含没进模型的行） | 依赖 |
| 人提供 · 行业知识包 | `knowledge/industry/**`：每个 (L4, 指标) 的 ROI Range / Contribution Range —— **权威区间来源** | 原料 |
| 知识 · 参考区间库 | `factor-ranges.json` —— **兜底区间，且只对饮料/快消行业开放** | 知识 |
| 人提供 · 单价 | 响应是销量时的 `price_per_unit`，没有它就算不出货币 ROI | 原料 |

---

## 构建过程

平台 2.34 的定位是"模型前的模型"——**低成本验证业务层级 sense 与数据的一致性，目的是选变量，不是最终模型。**

| # | 步骤 | Class | 执行者 | 说明 |
|---|---|---|---|---|
| 0 | 澄清 | H | 人 | 见下节 |
| 1 | 枚举模型对象 | M | Tool | 一个模型对象 = 一个 (渠道, 产品) 格子。N 渠道 × M 产品 = N×M 个回归。有响应但无驱动数据的格子建不了模型，**逐个点名**，其余照跑 |
| 2 | 组候选变量 | M | Tool `ols.propose` | 每个对象把**它全部存活的驱动变量一次性放进同一个模型**。没有搜索，没有预选。平台明确废掉了旧的按 L4 逐因子搜指标的坐标下降（最多 96 次试拟合）——**区间是用来检验结果的，绝不能用来调变量集合** |
| 3 | 定控制列 | M | Tool | 趋势 + 傅里叶季节项 + 月度哑变量 + 每个已接受的 `event` 异常窗口一列 0/1。控制列按可用观测数缩放（见"判定规则与阈值"）。恒定的控制列剔除 |
| 4 | 自由度与共线性预筛 | M | Tool | 超出该对象月数所能识别的驱动位，**不勾选但保留在表上并写明理由**——那是自由度限制，不是对指标的判决。设计矩阵 VIF > 100 的驱动逐个剔除，控制列永不剔除 |
| 5 | 变换 | M | Tool | 几何 adstock（`a[t] = x[t] + decay·a[t-1]`，`0 ≤ decay < 1`）+ Hill 饱和（`x^slope / (x^slope + half^slope)`），随序列长度缩放 |
| 6 | 拟合 | M | Tool `ols.fit` | 最小二乘 + 截距。输出 `coef / se / t / p / R² / adjR² / MAPE / Durbin-Watson / VIF / 残差`。`n ≤ p+1` 直接报错，不产出假结果。**一个对象拟不出来只报它自己的错，另外 N×M-1 个照走** |
| 7 | 算 Contribution 与 ROI | M | Tool | 见"判定规则与阈值"。基准位、分母、单位三件事都要在产出里说清楚 |
| 8 | 取区间 | M | Tool `knowledge.range` | 优先级：行业知识包精确 (L4, 指标) → 行业知识包仅 L4 → 参考库兜底（**仅饮料/快消**）。取不到就是"无可比区间"，不是"通过" |
| 9 | 区间判定 | M | Tool | `in` / `out` / `none`。ROI **只在货币口径下**才做区间检查 |
| 10 | AI 逐因子判读 | C | Skill（AI 判断，人裁决） | 四选一判定 + ≤30 词理由，**每个数都是上游算好的，AI 只许引用不许重算、不许改精度、不许新增**。判定与计算出的状态**并列**，永不取代它 |
| 11 | 逐因子采纳/拒绝 | H | 人（DS + BA） | 逐行 accept / reject。**人的裁决压过重拟合**；被拒的行即使在下一次拟合里消失也要留住 |
| 12 | 交付验收 | H | Orchestration `close` | Skill 只说"OLS 预验证已写好，请验收" |

---

## 澄清点

| # | 类型 | 问题 | 候选与后果 |
|---|---|---|---|
| 1 | 缺失 | **响应是货币还是销量；销量的话单价是多少** | 没有单价，ROI 的单位是"销量/花费"（例如 箱/元），**与行业 ROI 带（货币比率）完全不可比，不许拿去判越界**。有单价才能做区间检查 |
| 2 | 冲突 | **区间取行业知识包还是参考库** | A. 行业知识包（推荐）—— 是这个客户这个行业的带宽；B. 参考库 `factor-ranges.json` —— 自述"Danone Mizone 案例示例，新项目须替换"。**行业不是饮料/快消时选 B 等于用别人的带宽判这个客户的因子并据此提议剔除**。取不到就报"无可比区间"，这是诚实状态 |
| 3 | 岔路 | **模型对象怎么切** | 渠道 × 产品是平台默认。切太细每个格子月数不够，自由度撑不住；切太粗会把行为完全不同的渠道混在一起。**格子数直接决定几个模型、每个模型能带几个变量** |
| 4 | 越界 | **区间反常识的因子怎么办** | 三条路：① 认为区间过时 → 保留该因子并记理由；② 认为拟合有问题 → **先减控制项**再重跑（见红旗"拟合失配"）；③ 认为业务假设有问题 → **回流到业务校验重审假设**。这是替客户担责的判断 |
| 5 | 缺失 | **控制项预算** | 月数少时趋势 + 完整傅里叶会把真实销量吸进基线（基线份额 > 100%、付费驱动系数为负）。A. 按观测数自动缩放（推荐）；B. 人指定 |
| 6 | 岔路 | **本步是"选变量"还是"看结果"** | 平台定位是**选变量**：同一个 L4 有多个候选指标时，选 Contribution / ROI 最贴合业务区间的那一个。但平台实现已改为**全变量一次进模型、只报告每个变量做了什么**，不再按区间挑指标（见备注 B1）。两种做法的产出不同，必须问 |

---

## 产出格式

### 1 · 拟合配置（`ols-config.yaml`）

```yaml
dataSource: project           # project | reference（跑的是参考数据集时必须说）
params:
  trend: true
  seasonality: fourier
  fourierK: 2                 # 观测数不足时降到 1 或整段关掉
  monthDummies: false
  adstock: {decay: 0.5}
  hill: {slope: 1.0}
objects:
  - object: "MT::MIZONE"
    label: "MT · MIZONE"
    y: 本品销量
    months: 46
    controls: [trend, fourier_sin_1, fourier_cos_1, fourier_sin_2, fourier_cos_2, event_202408_202411]
    x: [曝光量, 花费, KOL发帖数, 本品标价, 温度]
    heldOut:
      - {metric: 社媒活动声量, reason: df-limit,  r: 0.12, note: "对象月数不足以估计，勾选可动用剩余自由度"}
      - {metric: 竞品ND,      reason: collinear, vif: 143.2}
```

### 2 · 拟合结果（每模型对象一张卡）

```yaml
models:
  - object: "MT::MIZONE"
    label: "MT · MIZONE"
    yMetric: 本品销量
    roiUnit: money            # money | volume/spend —— volume/spend 不得与货币 ROI 带比较
    nObs: 46
    drivers: 5
    dfRemaining: 34
    r2: 0.912
    adjR2: 0.887
    mape: 8.4
    durbinWatson: 1.92
    baselinePct: 61.3         # 基线 + 各驱动贡献 = 100%（恒等式）
    redFlags: []
    controls: [trend, fourier_sin_1, ...]
    aiSummary: "……"          # AI 写的模型读法，≤ 一段
    aiKeyDrivers: [花费, 曝光量]
    error: ""                 # 拟不出来时这里写原因，其余字段留空
```

### 3 · 因子树投影（每行 = 因子树的一行，含没进模型的行）

```yaml
tree:
  - key: "MT::MIZONE|digital display|曝光量"
    object: "MT::MIZONE"
    treeRowId: f-0007
    l1: 消费者需求驱动
    l2: 品牌广告/内容种草
    l3: 品牌传播
    l4: Digital Display
    indicator: 曝光量
    mapped: true
    inModel: true
    droppedBy: ""             # "" | mapping | quality | signoff | statistical | range
    # ── 拟合结果 ──
    coef: 0.0341
    tValue: 3.12
    pValue: 0.0032
    significant: true         # |t| ≥ 2.0
    roi: 1.15
    contribution: 1.20        # 百分点
    roiBasis: "÷ Digital Display spend (花费)"      # 借用分母时必须说；自身即花费时留空
    contributionBasis: "vs zero"                     # vs zero | vs its lowest month (x)
    # ── 区间 ──
    roiRange: "0.8~1.3"
    contributionRange: "0%~1.5%"
    rangeSource: knowledge    # knowledge | reference | ""
    roiStatus: in             # in | out | none
    contributionStatus: in
    # ── 判定 ──
    status: inRange           # notMapped | dropped | notInModel | noBenchmark | review | inRange
    flagReason: ""
    aiVerdict: consistent     # consistent | questionable | implausible | noBenchmark
    aiRationale: "ROI 1.15 sits mid-band and the coefficient is significant (t=3.12)."
summary:
  total: 93
  inModel: 18
  inRange: 12
  flagged: 4
  noBenchmark: 2
  notInModel: 31
  dropped: 28
  notMapped: 16
```

### 4 · 区间裁决表（`ols-scorecard.yaml`，人逐行裁决的那张表）

```yaml
rows:
  - id: "MT::MIZONE|digital display|曝光量"     # object|norm_l4|norm_indicator
    object: "MT::MIZONE"
    treeRowId: f-0007
    l1: 消费者需求驱动
    l2: 品牌广告/内容种草
    l3: 品牌传播
    l4: Digital Display
    indicator: 曝光量
    metric: 曝光量
    coef: 0.0341
    tValue: 3.12
    pValue: 0.0032
    significant: true
    roi: 1.15
    contribution: 1.20
    roiRange: "0.8~1.3"
    contributionRange: "0%~1.5%"
    roiStatus: in
    contributionStatus: in
    rangeSource: knowledge
    status: inRange
    flagReason: ""
    aiVerdict: consistent
    aiRationale: "……"
    autoVerdict: accept        # accept | reject —— AI 的提名
    autoReason: "ROI and contribution sit inside their industry band."
    disposition: accept        # 人的裁决；离开时只能是 accept 或 reject
    decidedBy: ai              # ai | human
    note: ""                   # 人改判时必填
```

**合并规则（两条，都出过事）：**
1. **人的裁决压过重拟合。** 重拟合会刷新每一个计算字段和 AI 的提名；带 `decidedBy: human` 的行**保留人的处置与备注**。
2. **被拒的行不许消失。** 拒绝会把该指标排除，下一次拟合就没有它的记录，新树上也不会提到它。把树里不再提到的行删掉，等于删掉那条把它移走的裁决本身，指标会无声地走回来。所以：**只有 `reject` 的行被延续，`accept` 的行不再出现就随之消失**（那通常是它的渠道丢了数据，不该留成一条过期的采纳）。
3. 拒绝按模型对象记账。同一个因子可以在一个渠道越界、在另一个渠道正常。

### 5 · 图表规格（由图表应用渲染）

```yaml
charts:
  - chartId: ols-fit-{object}
    title: "{label} · 实际 vs 拟合"
    encoding: {x: period, series: [{metric: actual, kind: line}, {metric: fitted, kind: line}]}
    interpretation: "R² {r2} · MAPE {mape}% · DW {durbinWatson}"
  - chartId: ols-resid-{object}
    title: "{label} · 残差"
    encoding: {x: period, y: residual, kind: bar}
    interpretation: "残差应无明显自相关；DW 落在 1.5–2.5 之外时点名。"
  - chartId: ols-contrib-{object}
    title: "{label} · 贡献分解"
    encoding: {kind: stacked_bar, x: period, series: [baseline, ...drivers]}
    interpretation: "基线 {baselinePct}% + 各驱动贡献 = 100%。基线超过 100% 说明控制项在过度吸收销量。"
  - chartId: ols-range-{object}
    title: "{label} · ROI vs 行业区间"
    encoding: {kind: dot_with_band, y: l4, x: roi, band: roiRange}
    interpretation: "落在带外的因子进入逐行裁决。无带的因子用空心点，不判越界。"
    note: "roiUnit 不是货币时，本图不画区间带。"
  - chartId: ols-response-{object}-{driver}
    title: "{label} · {driver} 响应曲线"
    encoding: {kind: line, x: spend_grid, y: incremental}
    grid: {points: 12, maxMultiple: 2.0}     # 0 .. 2 × 均值
```

---

## 判定规则与阈值

### Contribution（贡献分解）

```
基准位 ref_c：花费类指标 → 0；非花费类 → 窗口内最小值（最小值 ≤ 0 时仍取 0）
contribution_c = Σ_t coef_c · (x_c[t] - ref_c)  /  Σ_t 实际 Y      （× 100 得百分点）
```

- 基准位以下的部分归入基线。
- 控制列（趋势 / 季节）整体折进基线。
- **恒等式必须成立：`baselinePct + Σ contributionPct = 100%`。** 不成立就是分解错了，不是舍入。
- 产出必须写明 `contributionBasis`（`vs zero` 或 `vs its lowest month (x)`）——同一个系数在两种基准下贡献差很多。

### ROI

```
incremental = coef_c · Σ_t (变换后的 x_c[t])
Y 是货币          → incremental 直接是增量收入
Y 是销量 且有单价 → incremental × 单价
Y 是销量 无单价   → ROI 单位 = 销量/花费，roiUnit = "volume/spend"
分母：该指标自身是花费指标 → 用自身花费（basis.source = own）
      否则                 → 用该 L4 的花费序列（basis.source = l4，产出里写明借了谁的分母）
```

**硬规则：`roiUnit != money` 时，`roiStatus` 恒为 `none`。** 行业 ROI 带是货币比率，一个"箱/元"的比值和它不可比，拿它去判越界然后提议剔除，是把错误答案用正确答案的口吻说出来。

### 区间来源与优先级

```
1) 行业知识包 · 精确 (L4, 指标) 配对          → rangeSource: knowledge
2) 行业知识包 · 仅 L4（先精确，再归一化子串） → rangeSource: knowledge
3) 参考区间库 factor-ranges.json              → rangeSource: reference
   ★ 仅当项目行业 = (food-bev, beverage) 时开放；其他行业直接返回"无区间"
4) 都取不到                                    → status: noBenchmark
```

**参考库的 L4 匹配只许精确（大小写与空白归一化后相等）。** 平台曾用双向子串匹配代替真正的查表，凭空造出从来不在库里的基准：`Connected TV` 匹配到 `TV`、`OOH Billboards` 匹配到 `OOH`、`Digital Display Ads` 匹配到 `Digital Display`、`价格变动率` 匹配到 `价格变动`。每一个都造出一条 ROI 带，因子据此被判、被标记、并可能在 gate 上被剔除——全都源于一个名字里含着另一个名字。**一条基准要么是**这个**因子的基准，要么比没有基准更糟。**

区间取值表见 `business-validation.md` 的"因子 ROI / Contribution 预期区间"一节（同一份 `factor-ranges.json`）。

### 区间判定

```
_range_status(value, rng):
    rng 为空 / value 为空 / value 是 NaN  → "none"
    rng[0] ≤ value ≤ rng[1]              → "in"
    否则                                  → "out"
```

### 状态分级（优先级从上到下，第一个命中即定）

| status | 条件 | 含义 |
|---|---|---|
| `notMapped` | 在映射层被拒 | 上游数据覆盖问题：从来没有已发布的指标覆盖过这个因子 |
| `dropped` | 在质量 / 签核 / 统计 / 区间层被拒 | 对**已存在的数据**做出的筛选裁决 |
| `notInModel` | 未被淘汰但没进这次拟合 | 通常是自由度不够 |
| `noBenchmark` | 进了模型但没有可比区间 | 诚实状态，不是通过 |
| `review` | ROI **或** Contribution 越界 | 进入逐行裁决 |
| `inRange` | 两者都在带内 | — |

`notMapped` 与 `dropped` 必须分开：前者是"上游没给数据"，后者是"对数据做了判断"。混在一起会让一个数据稀疏的项目看起来像是模型把什么都扔了。

**不可复议：** `dropped` / `notMapped` / `notInModel` 三种状态不参与本步的逐行裁决——上一层已经裁过的事不许再摆出来当悬案。

### AI 判读（四选一）

| aiVerdict | 判据 |
|---|---|
| `consistent` | 结果对这个因子是可信的：在带内，或者出带但数字自身支持这个出带 |
| `questionable` | 出带；或在带内但系数很弱（`\|t\| < 2`）；或区间是远距离匹配来的 |
| `implausible` | 结果与这个因子可能的行为相矛盾：付费驱动系数为负、贡献远超其带、ROI 不可能为真 |
| `noBenchmark` | 没有带，只判系数的符号与显著性，并说明这一点 |

无模型时按计算状态生成模板理由（出带 → questionable；带内但 `|t| < 2` → questionable；无带 → noBenchmark；其余 → consistent），**这一列永不留空、永不假装**。

### AI 提名 → 处置

```
status == "review"                → reject（理由 = flagReason）
aiVerdict == "implausible"        → reject（即使没有带：noBenchmark 在算术上不可证伪，
                                    如果模型说这个系数不可信，那就是仅有的信号）
aiVerdict == "questionable"       → accept（算术过了。把一句保留意见变成拒绝，
                                    会剔掉没有人决定要剔的变量）
status == "noBenchmark"           → accept（没有行业带可比，也没有任何东西与拟合矛盾）
其余                               → accept
```

### 红旗条件（`redFlags`，必须点名）

| 条件 | 阈值 | 含义 |
|---|---|---|
| 基线份额为负 | `baselinePct < 0` | 分解崩了 |
| **基线份额超过 100%** | `baselinePct > 100` | **拟合失配**：趋势/季节控制项吸收的销量超过了全部实际销量 |
| **付费驱动系数为负** | `coef < 0` 且该指标是花费类 | **拟合失配**（同上） |
| 拟合优度不足 | `r² < 0.85`（目标带 0.85–0.95） | — |
| 预测误差超界 | `MAPE ∉ (5.0, 15.0)` | — |
| 残差自相关 | `Durbin-Watson ∉ (1.5, 2.5)` | — |
| 驱动列严重共线 | `VIF > 10`（取最大者报出） | — |
| 设计矩阵不可解 | `VIF > 100` | 该驱动在拟合前被逐个剔除，控制列永不剔除 |

**拟合失配的处置顺序是硬规则：** 基线超 100% 或付费驱动反号时，**先减控制项**（减少傅里叶阶数或关掉趋势），**再谈剔除被标记的指标**。是拟合而不是数据在产生那些落在每一条区间之外的疯狂贡献；这时候剔指标是治错了病。

### 自由度与控制项预算

| 常量 | 值 | 作用 |
|---|---|---|
| `SIGNIFICANT_T` | 2.0 | `\|t\| ≥ 2.0` 视为显著（≈ 中等自由度下双侧 5%） |
| `MIN_RESIDUAL_DF` | 10 | 拟合必须留下的残差自由度；每个变量花掉 1 |
| 可负担驱动数 | `max(1, 月数 − 控制项数 − 1 − 10)` | 超出的驱动位不勾选但保留在表上并写明"这是自由度限制，不是对指标的判决" |
| `MIN_OBS_FOR_SEASONALITY` | 24 | 低于此值整段关掉季节控制项 |
| `MIN_OBS_FOR_FULL_FOURIER` | 36 | 低于此值傅里叶阶数封顶 K=1 |
| `MIN_MONTHS` | 12 | 进入建模的最低月数 |
| `MAX_DRIVERS` | 12 | 一个现实模型的宽度上限（与统计检验的 VIF 设计矩阵同源） |
| `MAX_DESIGN_VIF` | 100.0 | 超过则该驱动在拟合前剔除 |
| `MIN_ABS_PEARSON` | 0.1 | 低于此值的变量信号很弱 —— **只作告警注记，不再决定勾选** |
| `MAX_VIF` | 10.0 | 高于此值与其余变量共线 —— 同上，只作注记 |

### 反常识判据（本卡的核心判据，平台 07-assumptions-log A2）

平台原始材料对 2.34 只有一句话，量化判据是在假设登记里补的：

1. **弹性 / 贡献落入行业知识典型范围**（媒体 0.1–0.5、促销 0.5–1.2 等）；
2. **与业务校验阶段形成、并经客户核对的业务假设方向一致**。

偏离按红黄绿灯：**偏离 < 30% 黄灯，≥ 30% 红灯。红灯指标回业务校验重审假设或弃选。**

反常识的三种典型形态，各自的正确动作不同：
- **符号反了**（付费驱动为负）→ 先查拟合失配，不是先剔指标；
- **量级离谱**（贡献远超其带若干倍）→ 查基准位与分母，再查区间是否过时；
- **方向与客户确认的假设相反** → **回流到业务校验重审假设**。

---

## Gate

| 触发条件 | 判定者 | 候选处置 | 路由（含回流目标） |
|---|---|---|---|
| 每个入模因子都带上了 accept / reject 提名 | **DS + BA** | `confirm` **确认裁决**（推荐）：被采纳的因子进入模型输入 | 交付物 → confirmed；模型输入正好由这些因子组装 |
| 存在越界因子（ROI 或 Contribution `out`） | DS + BA | `rework` **重审假设**：越界因子需要重新想 | **回流到业务校验与签核**（平台 `d-2.5.rework_task_id = 2.3`）。**这就是"2.34 反常识 → 回 2.31"的落地，是本阶段唯一一条跨交付物回流边** |
| 逐行 | DS + BA | `accept` / `reject` | **逐行裁决才是生效的那一层**，不是对整个集合的一次性回答。拒绝按模型对象记账 |
| 拟合失配（基线 > 100% 或付费驱动反号） | DS | 先减控制项重跑 | **不走剔除路径**。控制项过度吸收销量才是把贡献推出带外的原因 |
| 某模型对象拟不出来 | DS | 知情继续 / 调整对象切法 | 该对象报自己的错，其余对象照常。对象切法要改则回澄清点 3 |
| 跑的是参考数据集而非项目数据 | DS | 必须知情 | 产出与 gate 呈现都要明说"这次拟合跑的是参考数据集" |

**紧急度：中**（G2.34 指标选型确认；红旗类如基线为负 / 系数反号在平台 G3.3 里是"红旗即停、紧急度高"）。
**锁定效应：** 本 gate 一旦签署，上游的质量 / 统计 / 本步裁决就锁死；要改上游必须先重开本 gate。

---

## 与 runtime 现状的差异

| 平台定义 | runtime 现状 | 判定 | 建议 |
|---|---|---|---|
| N 渠道 × M 产品 = N×M 个回归，全变量一次进模型，无坐标下降搜索 | 一致（`OBJECT_SEP = "::"`，明确取消了旧的最多 96 次试拟合） | **一致** | — |
| 最小二乘 + 自实现 t 分布 p 值、DW、VIF；`n ≤ p+1` 直接报错 | 一致（`mmm/ols.py`） | **一致** | — |
| adstock / Hill / standardize | 一致（`mmm/transforms.py`） | **一致** | — |
| Contribution 基准位（花费→0，非花费→窗口最小值）与恒等式 | 一致（`_reference_level` / `_decomposition`） | **一致** | — |
| ROI 分子分母与 `roiUnit`；非货币时不做区间检查 | 引擎有 `roi_money` 判断；**skill 文档未把"非货币不判越界"列为硬规则** | **偏离** | SKILL.md 与 gate 呈现里明写这条，否则会拿"箱/元"去判行业带 |
| 区间优先级：知识包精确对 → 知识包仅 L4 → 参考库（仅饮料/快消） | 一致（`build_range_index` / `REFERENCE_INDUSTRY`），并已禁止子串匹配 | **一致** | — |
| 六种 status 分级与优先级 | 一致（`_classify`） | **一致** | — |
| AI 四选一判读（consistent / questionable / implausible / noBenchmark）+ ≤30 词理由 + 无模型时模板兜底 | runtime 引擎有 `aiVerdict` 字段与 `recommend()` 的消费逻辑，但**没有对应的 AI 判读步骤与 prompt 契约** | **缺失** | 在 SKILL.md 里补第 10 步（C 类），明确"只许引用不许重算"的三条禁令 |
| 裁决表字段（`roi/contribution/roiRange/contributionRange/roiStatus/contributionStatus/rangeSource/status/flagReason/aiVerdict/aiRationale/autoVerdict/autoReason`） | skill 示例写的是 `value / band / rangeStatus / recommendation` —— **这四个字段在引擎的 `OlsRangeRow` 里根本不存在**（引擎把 ROI 与 Contribution 拆成两套） | **偏离**（skill 文档与自家引擎不同源） | 按本卡"区间裁决表"重写 skill 模板 |
| 人的裁决压过重拟合；被拒行不许消失；拒绝按对象记账 | 引擎 `build_scorecard` 三条都有；`human_verdicts_preserved` 判据存在 | **一致** | — |
| 红旗：基线 < 0 / 付费反号 / r²<0.85 / MAPE∉(5,15) / DW∉(1.5,2.5) / VIF>10 | 一致（`_red_flags`） | **一致** | — |
| **红旗：基线 > 100% → 拟合失配，先减控制项再谈剔除** | runtime `_red_flags` 只判 `baseline_pct < 0`，**没有 > 100% 的判据，也没有"先减控制项"的处置指引** | **缺失** | 补 `baselinePct > 100` 红旗与配套处置文案；这是平台专门为此写过一段的坑 |
| 自由度：`max(1, 月数 − 控制项 − 1 − 10)`；`MIN_OBS_FOR_SEASONALITY = 24`；`MIN_OBS_FOR_FULL_FOURIER = 36` | 一致 | **一致** | — |
| 反常识判据：红黄绿灯（<30% 黄 / ≥30% 红），红灯回业务校验 | **完全没有**。runtime 只有二值的 `in / out` | **缺失** | 区间判定补第三档：`out` 且偏离 < 30% → 黄（`questionable`，进裁决但推荐保留）；≥ 30% → 红（推荐 reject 并提示回流） |
| 反常识判据：与客户确认的业务假设**方向一致** | **完全没有**。runtime 不消费业务校验产出的先验/假设 | **缺失** | 依赖业务校验补先验登记表（那张卡的第 5 步）；本步读取并做方向比对 |
| Gate 回流目标 `d-2.5.rework → 业务校验` | s2.yaml 的 `d-2.5` 是 `approval`，**没有 rework 目标，也没有回流原因记录位** | **缺失** | manifest 补回流目标；gate 呈现改为 `confirm` / `rework` 两候选 + 推荐 + 后果 |
| 跑的是参考数据集时必须明说 | 引擎有 `cfg.data_source == "reference"` 的提示 | **一致** | — |
| 响应曲线（0 .. 2×均值，12 点） | 一致（`RESPONSE_GRID_*`） | **一致** | — |
| 拟合/残差/贡献分解/区间点图/响应曲线五类图 | runtime `charts/result.py` 有对应函数，但**这些图属于建模阶段的结果图，本步的图表规格未在 skill 里定义** | **缺失** | 按本卡"图表规格"在 skill 里列出五条，交给图表应用 |
| 2.34 的定位是**选变量**（同一 L4 多候选选最贴合区间的那个） | runtime 与平台实现一致：全变量进模型、只报告，不按区间挑 | **偏离（与平台文档不一致，与平台代码一致）** | 见备注 B1，走澄清点 6 |

---

## 备注

- **B1 · "选变量" vs "看结果"，是本交付物的定位分裂。** 平台文档（`2.34-指标筛选OLS.md`、`00-overview.md`）说得很清楚：一个 L4 常有多个候选指标，即便都过了统计检验，仍需决定入模用哪个，**判据是哪个指标跑出来的 Contribution / ROI 落在业务预期区间内**。平台实现在 2026-07-27 把这套做法整个删掉了——原来的按 L4 坐标下降最多试 96 次拟合、留下让最多因子落进区间的那套变量分配。删掉的理由写在代码注释里：**"一条基准是用来比对结果的，绝不能是变量集合被调向的目标。"** 现在的问题是"每个变量对 Y 做了什么"，不是"哪个指标组合读起来最好"。按校对规则以代码为准，但这确实改变了本步的产品定位：**它从"选指标的关卡"变成了"报告结果并逐行裁决的关卡"**。选指标的动作实际落在了逐行 accept/reject 上。这条要在客户口径上说清楚。
- **B2 · 平台的区间检查曾经完全失效过一次。** `match_factor_range` 用双向子串匹配当查表，制造了库里从来没有的基准；`RangeIndex` 又对任何行业无条件套用 Danone 饮料案例的区间。两个问题叠加的结果是：任何非饮料项目的因子，都在拿别人行业的 ROI 带被判，并据此在 gate 上被提议剔除。修法是两条：只许精确匹配，参考库只对它自己那个行业开放。runtime 已继承。
- **B3 · 区间裁决必须是存储下来的状态，不能是每次重新推导。** 拒绝会把指标排除，下一次拟合就没有它的记录，"树上没提到"被读成"没有东西越界"，指标就走回了模型——平台早期靠在 gate 回答的那一刻给被剔名单拍照来堵这个洞（`freeze_range_drops`）。把裁决写下来之后拍照就不需要了：**一条拒绝之所以持续有效，是因为它被写下来了，不是因为某个 gate 给它拍了照。**
- **B4 · AI 在本步的边界。** 每个数（`roi` / `contribution` / `roiStatus` / `contributionStatus` / `tValue`）都是上游算好的事实，AI 可以引用，**不许换个说法重述、不许改精度、不许产生新的**。产出是一个判定加一句 ≤30 词的理由，**与算出来的状态并列，永不取代它**。不许推荐动作，不许断言数字没显示的业务成因。一次请求最多 30 行——把 200 个因子塞进一个 prompt 既不可靠、失败了也救不回来。
- **B5 · 平台 05 §4.1 的路由表里没有 G2.34 这一行。** 这条回边只出现在 `02-data-agent.md` §6 的 gate 表、`05` §2.1 的回流路径段落（"回流路径是一等公民（不是异常）…… 2.34 反常识 → 回 2.31…… 状态机必须显式支持这些回边并记录回流原因"）以及 `blueprint.py::d-2.5.rework_task_id = "2.3"`。**回边是实在的，只是路由表本身不完整。** runtime 不要照抄那张表的缺口。
- **B6 · 平台 `d-2.5` 曾有第三个选项"剔除越界指标"，已删。** 剔除现在是因子树上的逐行裁决，不是对 gate 的一次批量回答。已归档项目通过遗留兜底保留旧行为。runtime 的 gate 应当只有 `confirm` / `rework` 两个候选，剔除下沉到逐行。
