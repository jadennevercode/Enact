# 契约卡：业务校验与签核

**阶段：** 数据
**平台出处：** 2.31 指标业务校验规则（六步法）· 2.32 数据展示与趋势解读（Charting + 客户 sign-off）
- 规格：`Assets/数据智能体知识库/模版化/2.31-指标业务校验规则.md`、`Assets/数据智能体知识库/流程化/2.32-数据展示与趋势解读.md`、`Assets/数据智能体知识库/机器可读/factor-ranges.json`
- 设计：`docs/agent-design/02-data-agent.md` §2.31/§2.32/§6（G2.32）、`docs/agent-design/08-product-architecture-v2.md` §2.2、`docs/agent-design/00-overview.md` §5.3
- 实现：`backend/app/agents/data.py::business_validation / review_anomalies / _anomalies / _bv_groups / _signoff_for`、`backend/app/agents/validation_analysis.py`、`backend/app/agents/ledger.py::signoff_key / signoff_denied`、`backend/app/domain/blueprint.py::d-2.3`
- 真实交付物：`reference/02.数据智能体/【MMM AI】数据智能体-Data Analysis_2.32Charting.xlsx`（23 sheet / 375 图）、`...-Data Analysis_2.32数据趋势解读.pptx`（184 页）

**产出 Skill：** `business-validation`

---

## 输入

| 来源 | 内容 | 类型 |
|---|---|---|
| 上游交付物 · 数据质量评分 | 每个 (L4, 指标) 的质量裁决；被 0 分淘汰、被人裁决保留的名单 | 依赖 |
| 上游交付物 · 因子映射 | 因子树行 ↔ 已发布数据键的配对（决定"这张图属于哪一行、签核记在谁头上"） | 依赖 |
| 上游交付物 · 因子树（经访谈回写） | L1–L4 因子路径、每个 L4 的候选指标、L5–L8 下钻维度 | 依赖 |
| 上游交付物 · 发布数据集 | 长表：模型颗粒度 × 时间 × L1–L8 × METRICS × VALUE | 依赖 |
| 人提供 · 访谈纪要 | `inputs/interview-minutes/**` —— 异常成因假设的唯一可引证据来源 | 原料 |
| 人提供 · 行业材料 | `inputs/industry-reference/**` —— ROI / Contribution 预期区间、下钻惯例 | 原料 |
| 知识 · 因子预期区间 | `factor-ranges.json`：每个 L4 的 ROI Range / Contribution(Yearly) / 下钻颗粒度 | 知识 |
| 人提供 · 客户会评结论 | 逐图 Y/N 与每条问题的负责人、反馈 | 原料（H 步输入） |

**响应变量（Y）的解析口径是硬契约：** Y 是数据里被标了 `metric_type = Y` 的那条序列，经 `overrides.resolved_y_metric` 解析。平台曾经用关键词（`sales|offtake|GMV|箱|volume|销`）猜 Y，猜不中就把全表所有指标（RMB 花费、°C 温度、比率、指数）求和当 Y，任何非参考项目走的都是这条错路。**Y 认不出来时不许兜底求和，只许报"没有响应变量、本步不产出异常"。**

---

## 构建过程

平台六步法逐步展开。第 2 步与第 5 步在平台 backend 中**未实现**（见备注 B1/B2），但规则已定义，本卡按平台文档定义写全，并在"与 runtime 现状的差异"里标注为共同缺口。

| # | 步骤 | Class | 执行者 | 说明 |
|---|---|---|---|---|
| 0 | 澄清 | H | 人 | 见下节。答案写入本交付物的假设登记 |
| 1 | **全景概览**——整体生意是热是冷 | M | Tool `validation.series` + `validation.facts` | 画三年月度销量/销售额折线、同比增速柱状、市场份额曲线、费用 vs 销量双轴叠图、品牌搜索指数折线。每张图落一份 facts：首/末/峰/谷值及其期数、`changeFirstToLastPct`、`largestMove{from,to,delta,deltaPct}`、`longestRun{direction,from,to,periods}`、`missingPeriods`、`correlationWithResponse`。结论形态："2025YTD 销量 +3%，但 8 月骤降 12%；份额 30.5%→29%，跑输品类 (+5%)" |
| 2 | **维度拆解**——按渠道 / 产品 / 区域 / 营销活动四维拆开 | M | App `charts` + Tool | 渠道：占比 / ROI / 铺货 / SPPD；产品：Top SKU / 新品 / 包装；区域：**份额 × 增长四象限**（高份额高增长=牛眼市场维持投资；高份额低增长=成熟市场降本增效；低份额高增长=潜力市场加大铺货；低份额低增长=问题市场诊断）；**营销活动拆解是重点**，按 `by platform / by campaign / by format / by influencer tier / by event / by promotion type` 展开。结论形态："线下占 70% 但线上增速更快；抖音 ROI 1.2、天猫 2.0、线下 0.6" |
| 3 | **异常定位**——下钻到具体时间 × 维度交叉点 | M | Tool `validation.anomalies` | 触发规则见"判定规则与阈值"。触发后**沿因子树的 L5–L8 下钻维度**下钻到二级维度，不得自创下钻路径。结论形态："2025 年 8 月 抖音 × 头部达人 × 产品演示内容，ROI 2.1→1.2（-43%）" |
| 4 | **假设生成**——凭行业经验猜原因 | C | Skill（AI 起草，人裁决） | 每个异常出一张假设卡：`hypothesis`（≤25 词，只基于给定的渠道/期数/幅度，猜不出就说"未从数据中确立"，**不得凭空造事件**）+ `置信度`（高/中/低）+ `验证方法` + `涉及因子(L4)` + `proposed handling`（三选一封闭集）。证据只许引访谈纪要与行业材料 |
| 5 | **先验提取**——把猜想量化为模型参数约束 | C | Skill（AI 起草，人裁决） | 客户确认后的假设 → 数学形式。例："抖音弹性先验 Normal(0.45, 0.1) 截断 [0.3, 0.7]"、"竞品交互项 β ~ Normal(-0.15, 0.05) 截断至负"。每条先验登记四元组：**来源假设（第 4 步）→ 客户确认记录（第 6 步）→ 数学形式 → 应用变量**。优先级：客户实验/历史模型 > 客户确认的业务判断 > 行业知识典型范围 > 弱信息先验 |
| 6a | 逐图趋势解读初稿 | A | Skill（AI 叙述，facts 为准） | AI 只把计算出的 facts 改写成业务语言，**不得产出任何数字、序列、异常结论、签核结论**。有缺口就说缺口，不许插值描述。无模型时用计算版解读原样保留，并标明"这是读数不是判断" |
| 6b | **客户核对**——带着猜想与约束问客户 | H | 人（客户） | 逐图 Y/N + 每条问题的负责人与反馈。见"产出格式"的逐图签核表与沟通表 |
| 7 | 交付验收 | H | Orchestration `close` | Skill 只说"业务校验与签核已写好，请验收" |

---

## 澄清点

只列答案会改变产出的：

| # | 类型 | 问题 | 候选与后果 |
|---|---|---|---|
| 1 | 缺失 | **响应变量是哪条序列** | A. 数据里标了 Y 的那条（推荐）—— 与统计检验、OLS、模型输入四处同源；B. 人指定另一条 —— 需同时改上游标记，否则四处会各说各的 Y。**认不出 Y 时本步不产出异常，必须问** |
| 2 | 岔路 | **异常判据用哪一套** | A. 同比幅度阈值（平台文档：ROI 降幅 >30% 或销量波动 >20%）—— 与客户话术一致，但阈值是拍的；B. 稳健离群（中位数 + MAD × σ）—— 对季节性强的品类更少误报，但客户听不懂"σ"。**两套会圈出不同的异常集合，必须问** |
| 3 | 岔路 | **签核粒度** | A. 逐指标 (L4, 指标)（推荐）—— 与下游账本键空间一致，客户否掉一个指标不牵连同因子其他指标；B. 逐因子 L3 —— 会议上更快，但一个"N"会连坐该因子名下全部指标 |
| 4 | 越界 | **每个异常算真实业务波动还是数据错误** | 逐条问，三选一：`event`（结构性业务事件，窗口加 0/1 控制项）/ `cap`（成因不清，窗口内缩尾）/ `raw`（保留原值，带说明进报告）。**这是替客户担责的判断，AI 只能提名** |
| 5 | 冲突 | **ROI / Contribution 预期区间取谁的** | A. 客户行业知识包里的区间；B. 参考区间库（`factor-ranges.json`，其自述"区间为 Danone Mizone 案例示例，新项目须替换"）。**行业不是饮料/快消时，用 B 等于拿别人的带宽判这个客户，必须问** |
| 6 | 缺失 | **本轮是否做先验提取** | A. 做 —— 第 5 步产出先验登记表，交给建模阶段；B. 不做（平台当前实施标注"先不做"）—— 客户确认的假设只留在文字里，建模阶段拿不到约束 |

---

## 产出格式

### 1 · 逐图规格（图表由独立图表应用渲染，不由 Skill 现场画）

Skill 决定"生成什么图"，图表应用保证"长什么样"。每张图一条规格：

```yaml
charts:
  - chartId: c-0007
    factor:                       # 这张图属于因子树的哪一行
      l1: 消费者需求驱动
      l2: 品牌广告/内容种草
      l3: 品牌传播
      l4: Digital Display
      rowIds: [f-0007, f-0008]    # 参与签核连线的因子树行
    step: 1                       # 六步法第几步产出的图：1 全景 / 2 拆解 / 3 异常定位
    title: "Digital Display 曝光量 vs 销量"
    unit: "Million RMB (M)"       # 平台 deck 每页固定有单位行
    dataSource: "SIA - All Channel; EC Offtake Dashboard"   # 平台 deck 每页固定有 Data Source 脚注
    grain: month
    window: {from: 202201, to: 202512, compare: yoy}
    encoding:
      x: period
      yResponse:                  # 底图：响应变量，永远是完整大盘
        metric: 本品销量
        role: Y
        kind: area                # 硬规则：Y → Area
      yOverlay:                   # 叠加线：候选指标，最多 6 条
        - {metric: 曝光量, kind: bar}     # 硬规则：非花费 → Bar
        - {metric: 花费,   kind: line}    # 硬规则：spending → Line
    drilldown: "by format/type, by platform, by campaign"   # 来自因子树 L5–L8，异常触发时的下钻路径
    filters:
      appliesToOverlayOnly: [dataSource]   # 数据来源筛选只作用于叠加线，底图始终完整
      appliesToBoth: [grain, brand, channelType, provinceGroup]
```

**图表 role 是硬规则，不重新讨论：** `metric_type = Y` → Area；`spending` → Line；其余 → Bar。`channel_type` 为空的 national 因子只画一次，对所有模型对象展示。

### 2 · 逐图解读（`business-validation.md`，每图一节）

```markdown
### c-0007 · Digital Display 曝光量 vs 销量
**单位：** Million RMB (M) ｜ **数据来源：** SIA - All Channel ｜ **期间：** 2022-01 – 2025-12（月度）

**一句话结论：** 曝光量在 2024-03 见顶 4.2M 后连续 5 个月回落，同期销量跟跌 -8%，两者相关系数 +0.61。

| 字段 | 值 | 出处 |
|---|---|---|
| 首期 | 2022-01 = 1.80 | facts.drivers[0].first |
| 末期 | 2025-12 = 2.31 | facts.drivers[0].last |
| 峰 / 谷 | 2024-03 = 4.20 / 2022-07 = 0.95 | facts.drivers[0].peak / trough |
| 首末变化 | +28.3% | facts.drivers[0].changeFirstToLastPct |
| 最大单期移动 | 2024-08 较 2024-07 -1.05（-31.2%） | facts.drivers[0].largestMove |
| 最长同向连跑 | 下行 2024-03 → 2024-07，共 5 期 | facts.drivers[0].longestRun |
| 与响应的相关 | +0.61 | facts.drivers[0].correlationWithResponse |
| 缺口 | 缺 2 期（2022-02、2022-03） | facts.drivers[0].missingPeriods |

**趋势：** ①…… ②…… （2–4 条，每条点名真实期间）
**异常：** 2024-08 曝光量单期跌 31.2%，成因未从本数据确立。
**拐点：** 2024-03 由升转降，两侧期间 2024-02 / 2024-04。
**说明：** 曝光量在 2022-02、2022-03 无观测值，图上是缺口不是零。
```

**AI 只许叙述上表里的数，不许自己算、不许改精度、不许引入表外数字。** 相关系数只许引 `correlationWithResponse` 这一个。

### 3 · 异常卡（`anomalies.yaml`）

```yaml
cards:
  - id: an-003
    object: "MT::MIZONE"              # 模型对象；national 异常用 "*"
    factor: {l3: 品牌传播, l4: Digital Display}
    metric: "本品销量"
    drilldown: "抖音 × 头部达人 × 产品演示内容"   # 沿 L5–L8 下钻定位到的交叉点
    period: "2024-08"
    comparedTo: "2023-08"             # 同比 / 环比 / 自定义，与对比区间等长
    from: 2.10
    to: 1.20
    movePct: -42.9
    trigger: "roi_drop"               # roi_drop | volume_swing | robust_outlier
    hypothesis: "8 月代理更换后内容质量下降，同期竞品大促分流。"
    confidence: high                  # high | medium | low
    verification: "对比互动率、粉丝重合度、竞品花费"
    relatedFactors: [KOL发帖数, 竞品媒体花费]
    evidence: "inputs/interview-minutes/2026-03-12-ec-agency.md"
    handling: event                   # event | cap | raw | rejected
    window: {start: 202408, end: 202411}   # 人可编辑；默认取异常自身年份
    status: proposed                  # proposed → accepted / rejected（客户核对后）
```

**处置的机械效果（必须真的咬合到下游拟合，不能只是记录）：**

| handling | 效果 |
|---|---|
| `event` | 窗口内加一列 0/1 事件控制项，把冲击挡在媒体系数外面 |
| `cap` | 窗口内把响应变量缩尾到序列自身的 95/5 分位 |
| `raw` | 数据不动，作为说明带进报告 |
| `rejected` | 不做任何操作 |
| `proposed` / 空 | **一律不生效**。只有客户接受过的处置才进入拟合 |

### 4 · 先验登记表（第 5 步产出，交给建模阶段）

```yaml
priors:
  - id: pr-002
    variable: "抖音花费"
    fromHypothesis: an-003
    clientConfirmedAt: "2026-03-20"
    confirmedBy: "客户 · 数字营销负责人"
    form: "Normal(0.45, 0.10) truncated [0.30, 0.70]"
    kind: elasticity                  # elasticity | sign | contribution_band
    source: client_judgement          # client_experiment | client_judgement | industry_range | weak
    note: "客户确认 8 月代理更换，同意弹性上限 0.7"
```

### 5 · **逐图签核表**（客户签核，一等公民）

平台真实交付物里，签核是 Data Review Deck 的会议动作——184 页 deck 每页带 Sign-off Y/N 栏与 Comments 框，会后落一个状态戳。runtime 把它规范化为一张表，列结构如下：

```yaml
signoffTable:
  session: "NHS mROI Data Review — 2026-03-20"
  rows:
    - chartId: c-0007
      l1: 消费者需求驱动
      l2: 品牌广告/内容种草
      l3: 品牌传播
      l4: Digital Display
      indicator: 曝光量
      takeaway: "曝光量 2024-03 见顶后连跌 5 个月，销量跟跌 -8%"
      signoff: "Y"                    # Y | N | ""（空 = 未逐条过目，不等于否）
      signedBy: "客户 · 数字营销负责人"
      signedAt: "2026-03-20"
      note: "口径确认：曝光量含站外投放"
      status: "数据已查"               # 平台 deck 的会后状态戳
```

**签核语义（与平台实现一致，不得改）：**
- 键空间是 **(L4, 指标)**，不是因子名。平台键形态 `i:<模型对象>:<l4>|<指标>`，模型对象缺省为"全部对象"——不指名对象的一个 N 就否掉所有模型里的这个指标。
- **只有明确的 `N` 才排除。留空 ≠ 排除**——把留空当拒绝会在客户翻开 deck 之前先清空模型。
- 一个因子下多个指标签核结论不一致时，因子级只报"未定"，不折叠成 Y 或 N。
- 未签核（`N`）的指标及其数据，一路继承到统计检验、OLS、模型输入，中途任何一步不得复活。

### 6 · 数据&指标沟通表（问题 / 负责人 / 反馈）

| 问题 | 负责人 | 反馈 | 关联图 | 状态 |
|---|---|---|---|---|
| HCP 与医院覆盖数大涨，但代表数在降，是每人覆盖更多了吗？ | SFE | 2024-08 至 2024-11 销售与医学代表重组，系统追踪缺失约 10–20% | c-0021 | 数据已查 |
| Active store 增长很高但 sell-in 没有，可信吗？ | Sales | Q4 2024 门店大幅扩张 + Bamboo 项目提升门店合作数 | c-0026 | 数据已查 |
| WD 加权逻辑是按什么加权的？ | 数据 Owner | 待回 | c-0033 | Pending |

三列（问题 / 负责人 / 反馈）+ 关联图 + 状态。**未闭环的问题不阻断签核，但必须带着负责人进入下一次会评**；口径类问题（RSP 是否含折扣、SKU 定义、批发数据获取方式）闭环后回写到项目定制区的口径备忘。

---

## 判定规则与阈值

### 异常触发（第 3 步）

| 判据 | 阈值 | 出处 | 备注 |
|---|---|---|---|
| ROI 下降 | 降幅 > 30% | 2.31 文档 / `factor-ranges.json::drilldownTrigger` | 触发后自动下钻到二级维度（L5–L8） |
| 销量波动 | 幅度 > 20% | 同上 | 同上 |
| 同比幅度（平台代码实际实现） | \|YoY\| ≥ 40%，按幅度取前 8 条 | `data.py::_anomalies` | 只在 `channel_type × year` 上算，**不下钻**；与文档阈值不一致 |
| 稳健离群（runtime 现状） | \|同比差 − 中位数\| ≥ 2.5 × MAD（MAD × 1.4826），需 ≥ 16 个点，平序列（YoY 变化 < 自身水平 0.1%）跳过 | runtime `cli/tools/validation.py` | 第三套判据 |

### 维度拆解四象限（第 2 步 · 区域）

| 份额 \ 增长 | 高增长 | 低增长 |
|---|---|---|
| 高份额 | 牛眼市场（维持投资） | 成熟市场（降本增效、防御） |
| 低份额 | 潜力市场（加大铺货/营销） | 问题市场（诊断：竞品强/团队弱/产品不适） |

### 因子 ROI / Contribution 预期区间（第 5 步先验与下游 OLS 的共用判据）

来自 `factor-ranges.json`（**其 `purpose` 自述"区间为 Danone Mizone 案例示例，新项目须替换"**）。节选：

| L4 因子 | 指标 | ROI Range | Contribution(Yearly) | 下钻颗粒度 |
|---|---|---|---|---|
| 市场规模 | 品类全渠道销量 / 品类社媒声量 | / | -5%~5% | / |
| 特定属性趋势 | 现调饮料外卖销量 | / | -10%~10% | by platform |
| 季节性趋势 | 温度 | / | -5%~5% | / |
| 经济周期 | 消费者信心指数 / GDP | / | -2%~2% | / |
| 渠道变迁 | 便利店数量 | / | -10%~10% | / |
| 竞品价格变化 | 本品相对竞品标价 | / | -10%~10% | by competitor |
| 竞品产品变化 | 竞品新上市 SKU 个数 | / | -10%~10% | by competitor |
| 竞品渠道扩张 | 竞品 ND | / | -10%~10% | by competitor, by channel |
| 品牌资产 | 品牌力指数 / Meaningful / Difference / Salience / BHT-TOM / UBA / TBA | / | 3%~8% | / |
| 价格变动 | 本品标价 | / | 0%~3% | / |
| 产品吸引力 | 本品新品上市/老品下市 SKU 个数 | / | 0%~3% | / |
| 复购粘性 | 复购率 / 购买频次 / 流失率 | / | 0%~10% | / （快销品类通常无此项） |
| Digital Display | 曝光量 / 花费 | 0.8~1.3 | 0%~1.5% | by format/type, by platform, by campaign |
| 热剧 | 曝光量 / 花费 | 1.1~3.4 | 0%~1.5% | by campaign |
| TV | GRP / 花费 | 0.4~1.4 | 0%~1.5% | by campaign, by platform |
| OTV/OTT | 曝光量 / 花费 | 0.6~1.4 | 0%~1.5% | by campaign, by platform |
| OOH | 曝光量 / 花费 | 0.8~3 | 0%~3% | by format/type, by location |
| 综艺及赛事赞助 | 曝光量 / 花费 | 0.5~1.5 | 0%~2% | by campaign, by event |
| 线下路演 | 参与人数 / 花费 | 0.5~1.5 | 0%~1% | by region, by event |
| 社媒 | KOL发帖数 / 声量 / 互动量 / 花费 | 1.5~6 | 0%~5% | by platform, by campaign, by influencer tier |
| 会员积分 | 会员数 / 花费 | 0.3~2 | 0%~0.7% | by format/type, by platform, by campaign |

**行业隔离硬规则：** 上表只对饮料/快消行业开放。其他行业的因子拿不到区间时，产出"无可比区间"，**不许用这张表的带宽去判**——用别人行业的 ROI 带判一个医药或汽车因子，然后据此提议剔除，不是宽容的默认值，是把错误答案用正确答案的口吻说出来。

### 假设→先验参考模式

| 异常模式 | 可能原因（假设） | 置信度 | 验证方法 | 涉及因子 |
|---|---|---|---|---|
| 抖音头部达人 ROI 骤降 | 内容老化 / 粉丝重合 / 竞品大促 | 高 | 互动率、粉丝重合度、竞品花费 | KOL发帖数, 竞品媒体花费 |
| 华东便利店 SPPD 下降 | 竞品堆头抢占 / 冰柜位置差 / 缺货 | 中 | 实地核查、竞品铺货 | 本品ND, 竞品ND, 货架份额 |
| 大促 ROI 低于日常 | 折扣不足 / 竞争激烈 | 高 | 对比历史大promo弹性 | 促销优惠花费 by promotion type |

### 红旗条件（必须点名、不得沉默）

- 认不出响应变量 → 图无底图、异常不扫描，**明说**，不兜底求和。
- 某图存在缺口 → 说缺几期，不许把缺口描述成数值。
- 异常卡处置仍是 `proposed` → 不生效，客户签核前必须清空 proposed。
- 某 L4 因子的**全部**指标都被签核否掉 → 预警回流：回业务理解找替代指标。

---

## Gate

| 触发条件 | 判定者 | 候选处置 | 路由（含回流目标） |
|---|---|---|---|
| 逐图签核表完成（每张图有 Y/N 或明确留空理由） | **客户** | `approve` **已签核**（推荐）：客户确认；数据锁定进入统计检验 | 交付物 → confirmed，进入统计检验 |
| 同上 | 客户 | `rework` **未签核**：客户提出阻断性问题 | **回流到本交付物重做**（平台 `d-2.3.rework_task_id = 2.3`）。回流原因必须记录 |
| 某因子被标 `N` | 客户 | —（不是独立 gate，是签核表的一行） | 该 (L4, 指标) 及其数据在统计检验/OLS/模型输入中一路排除，任何下游不得复活 |
| 某 L4 因子的全部指标都被否 | 客户 + BA | `escalate` 预警 | **回流到业务理解**找替代指标（平台 05 §2.1："2.33 因子无可用指标 → 回 S1 找替代"，签核否决同理） |
| 每个异常的处置 | 客户 | `event` / `cap` / `raw` / `rejected` | 逐条裁决，不是一次性的批量答案。接受后才咬合到拟合 |

**紧急度：高**（平台 05 §4.1：G2.32 客户 sign-off 拒绝 → 数据 Task 回炉）。
**准入硬规则：** 未 sign-off 的数据不得入模。

---

## 与 runtime 现状的差异

| 平台定义 | runtime 现状 | 判定 | 建议 |
|---|---|---|---|
| 六步法第 1 步全景概览（5 类图：销量趋势 / 同比增速 / 份额曲线 / 费用×销量双轴 / 搜索指数） | 每因子一张"响应底图 + 指标叠加"，无全景组图，无份额/搜索/双轴的固定图位 | **缺失** | 图表规格里补 `step: 1` 的固定图位清单，由图表应用按位渲染 |
| 六步法第 2 步维度拆解（渠道/产品/区域/营销活动四维 + 份额×增长四象限） | **完全没有**。runtime 只按因子分组，不按业务维度拆 | **缺失**（平台 backend 同样缺，是共同缺口） | 补一组 `step: 2` 图表规格；四象限先做区域，营销活动拆解按 L5–L8 展开 |
| 六步法第 3 步异常定位**沿 L5–L8 下钻** | 异常只在 (指标 × 期数) 上算，**不下钻**，卡片无 `drilldown` 字段 | **偏离** | 异常卡加 `drilldown` 与 `trigger`；触发后按因子的 L5–L8 再算一层 |
| 异常判据 ROI 降幅 >30% / 销量波动 >20% | 稳健离群 2.5×MAD，需 ≥16 个点 | **偏离**（平台代码本身也偏离成 \|YoY\|≥40% 取前 8，三套判据互不相同） | 澄清点 2 定一套；无论选哪套，产出里必须写明 `trigger` 与判据取值 |
| 六步法第 4 步假设卡带 `置信度 / 验证方法 / 涉及因子` | 异常卡只有 `hypothesis` + `handling`，无置信度、无验证方法、无关联因子 | **缺失** | 异常卡结构补 `confidence` / `verification` / `relatedFactors` 三字段 |
| 六步法第 5 步先验提取 | **完全没有** | **缺失**（平台文档标注"先不做"，backend 也未实现） | 澄清点 6 决定是否做；做的话补 `priors` 段与四元组登记 |
| 逐图签核（deck 每页 Sign-off Y/N + Comments + 状态戳） | `signoffs.yaml` 只有 `{因子行id: yes/no}` + `notes`，**没有逐图、没有签核人、没有时间、没有状态戳** | **偏离** | 按本卡"逐图签核表"重做 `signoffs.yaml`：键改成 (L4, 指标)，补 `chartId / takeaway / signedBy / signedAt / status` |
| 签核键空间 `i:<对象>:<l4>\|<指标>` | runtime `ledger.signoff_key` 已实现同形键，但 skill 文档示例写的是 `f-0007: yes`（因子树行 id） | **偏离**（skill 文档与自家引擎不一致） | 统一到 (L4, 指标) 键；skill 模板改掉 `f-xxxx` 示例 |
| 「数据&指标沟通表」（问题/负责人/反馈三列） | **完全没有**。全仓 grep 零命中 | **缺失** | 新建 `communication.yaml`，三列 + 关联图 + 状态；未闭环问题带负责人进下一次会评 |
| 异常 handling 的机械效果：`cap` = 窗口内响应缩尾到 95/5 分位 | runtime 定义了 `cap` 语义，但平台自述"主数据表里的销量列是未缩尾的原值"——缩尾只作用于拟合 | **偏离（继承自平台）** | 明确：`cap` 只作用于拟合，模型输入表保留原值并加说明；或两处统一，二选一并登记 |
| 只有明确 `no` 才排除，留空 ≠ 排除 | runtime `signoff_per_factor` 要求**每条严格是 yes 或 no，缺项即失败** | **偏离**（更严，但含义相反：runtime 把"未过目"变成硬错误） | 保留 runtime 的严格性（强制逐条过目更好），但要在 gate 呈现里说清"留空必须补，不是默认否" |
| 图表 role 硬规则（Y→Area / spending→Line / 其余→Bar） | 一致 | **一致** | — |
| facts 字段（first/last/peak/trough/largestMove/longestRun/missingPeriods/correlationWithResponse） | 一致，字段名逐个对得上 | **一致** | — |
| AI 只叙述不算数，无模型时降级为计算读数 | 一致 | **一致** | — |
| Gate 回流目标 `d-2.3.rework → 2.3` | s2.yaml 的 gate 条目**没有 rework 目标字段** | **缺失** | manifest 的 gate 补 `rework` 目标与"回流原因"记录位 |
| 时间窗（当前区间 + 对比方式同比/环比/自定义 + 等长校验） | runtime 无时间窗概念，图表规格无 `window` | **缺失** | 图表规格补 `window: {from, to, compare}`，并校验对比区间等长 |
| 每个指标按自己的汇总规则汇总（比例类取平均、花费/销量求和） | runtime 有 `_metric_agg`，一致 | **一致** | — |

---

## 备注

- **B1 · 六步法只实现了一半。** 平台 backend 实现了第 1 步（图）、第 3 步（退化版异常）、第 4 步（假设卡）、第 6 步（签核）。第 2 步维度拆解与第 5 步先验提取都没有代码；第 5 步在 `02-data-agent.md` 里被明确标注"当前实施中标注'先不做'，但规则已定义，是 3.1 先验设置的直接上游"。本卡按文档定义写全，实现优先级由澄清点 6 决定。
- **B2 · 异常阈值三套并存。** 文档（ROI>30% / 销量>20%）、平台代码（\|YoY\|≥40% 取前 8）、runtime（2.5×MAD）互不相同，且平台代码的版本**不下钻**，与"沿 L5–L8 下钻"的规则脱节。按"文档与代码不一致以代码为准"的校对规则，代码这一版是当前实现事实，但它明显是文档规则的退化实现，不是有意的改口径——这里建议以文档为准并在 runtime 补下钻，差异登记在案。
- **B3 · 「数据&指标沟通表」在参考资料里不存在。** 真实 deck 里的等价物是每页的 Comments 自由文本框：`From <提问人>: <问题> -> <假设>` + `Reply (<部门>): <反馈>` + 中文状态戳（`数据已查` / `已更新`）。三列结构是 `02-data-agent.md` 与 `00-overview.md` §5.3 提出的规范化形态，**是对现状的升级，不是对现状的抄录**。落地时按三列做，但要接受客户会用自由文本回复。
- **B4 · 签核在真实交付物里是 deck 级会议动作。** 184 页 deck 的第 2 页写明 session 目标之一是 "Validate the accuracy of the data and sign-off on the aggregated results from all collected datasets"；全 deck 只有 7 页出现 `sign-off` 字样，21 页有 Comments 框，11 页有 Reply。**没有任何一页有名为 "Sign-off" 的表格列。** 逐图 Y/N 是平台设计文档对这个会议动作的结构化，runtime 应当承载结构化版本。
- **B5 · 参考区间库的行业隔离是平台踩过的坑。** `match_factor_range` 曾用双向子串匹配，把 `Connected TV` 匹配到 `TV`、`OOH Billboards` 匹配到 `OOH`、`价格变动率` 匹配到 `价格变动`，凭一个名字里含另一个名字就造出一条区间，因子据此被判越界、被提议剔除。现在只许精确匹配（大小写与空白归一化），且参考库只对饮料/快消开放。runtime 已继承此规则。
- **B6 · Charting 工作簿的真实规模。** 平台 `Data Analysis_2.32Charting.xlsx` 36.4MB，23 个 sheet，内嵌 375 个图表对象，底层是 `phase2_all_datasets` 的 258,078 行长表；作图区按因子层分区（`2.1KPI` / `2.2 Base` / `2.3 PFME` / `2.4 Promotion` / `2.5 Finance`）。runtime 的图表应用不必复刻工作簿形态，但"按因子层分区、每层多图"这个组织方式应当保留。
