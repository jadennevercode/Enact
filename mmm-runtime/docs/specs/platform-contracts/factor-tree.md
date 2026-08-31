# 契约卡：因子树

**阶段：** 业务理解
**平台出处：** 1.21（推导因子树与候选指标）· 1.21d（逐行确认）· 1.4d（回写访谈改动）
· 设计文档编号 1.21 因子 + **1.22 指标召回**——**1.22 在平台代码里不存在**，指标是 `FactorRow` 的一列，见「备注 1」
· `backend/app/agents/business.py` `derive_factor_tree` / `_baseline_rows_from_template` / `_ai_template_supplement` / `atomic_factor_rows` / `_factor_tree_sheet` / `accept_factor_rows` / `confirm_tree_effect` / `apply_pack_to_factor_tree`
· `backend/app/ingest/factor_tree_upload.py`（客户自有树解析）
· `backend/app/domain/models.py` `FactorRow` / `FactorTree` / `FactorTreeRow` / `KnowledgeTemplate`
· `backend/app/store/template_seed.py`（内置模板的种子解析）
· `docs/agent-design/01-business-agent.md` §3 Step 2 / Step 3 · `00-overview.md` §5.2 / §6 · `08-product-architecture-v2.md` §2.2 / §10.1.16
· 实盘 `Assets/Default Factor Tree.xlsx`（94 行）· `reference/roi- contribution-range.xlsx`（94 行 + 2 列）· `reference/01.商业智能体/【MMM AI】商业智能体-factor&data_request_1.2.xlsx` sheet `Business Factors`（19 列）
**产出 Skill：** factor-tree

---

## 输入

| 来源 | 内容 | 类型 |
|---|---|---|
| 上游交付物 | **项目档案** —— `timeGranularity`、`modelScope` 三轴（用作每行的 `dimension` 默认值）、`responseMetric`（决定哪一行是 `role: response`） | 交付物 |
| 上游（同 skill 产） | **材料索引** `materials-index.md` —— 哪些报告可用、覆盖什么期间、**`baselineChoice`**（`template` \| `client-tree`） | **internal 输入**（平台 `a-source-materials`，`internal: true`） |
| 上游（同 skill 产） | **行业知识包** `knowledge-package.md` —— 召回到的行业先例 + 品牌生意分析框架 + "什么没有行业先验"；L1/L2 骨架在这里是**抄一份备查**，它在 `materials` 那一步就随行业包定了 | **internal 输入**（平台 `a-knowledge-package`，`internal: true`） |
| 人提供 | 品牌财报、竞品研究（如 Project Aurora）、内部资料 → `inputs/industry-reference/` | **internal 输入**（平台 Project Folder 类目 `industry_reference`） |
| 人提供（条件） | **客户自有因子树** → `inputs/client-factor-tree/`，**仅当 `baselineChoice: client-tree`** | **internal 输入**（平台类目 `factor_tree`） |
| 知识库 | 行业因子树模板（L1–L4 + 指标）按 `industry{l1,l2}` 匹配 | Knowledge（平台 `KnowledgeTemplate(kind="factor_tree")`） |
| 上游交付物（第二轮） | **访谈** 产出的 `proposals-*.yaml` —— 1.4d 才读 | 交付物 |

**平台的 baseline 分支（`st.factor_tree_source`，在 1.1a 关卡上由人选）：**

```python
"choicePrompt": "How should the factor-tree baseline be built?",
"choiceOptions": [
    {"id": "template", "label": "Start from industry template",
     "detail": "AI derives L3/L4 on the standard industry factor-tree skeleton.", "recommended": True},
    {"id": "upload", "label": "Upload my own factor tree",
     "detail": "AI supplements your uploaded tree from the industry template + your materials."}],
"choiceUploadCategory": "factor_tree"
```

---

## 构建过程

### 第一轮：1.21 → 1.21d（推导与确认）

| # | 步骤 | Class | 执行者 | 说明 |
|---|---|---|---|---|
| 0 | 澄清 | C | Skill | 见下节。先读完知识包 + 材料索引 + 档案再问 |
| 1 | 载入 L1/L2 骨架 | **M** | 确定性 | 平台从知识包读。**runtime 挪到了 `materials` 那一步**：行业锚点来自 scoping，匹配到的行业包覆盖 L1–L4+指标，L1/L2 从那时起锁定 |
| 2 | 取 baseline 行 | **M** | Tool | `template` 分支：`get_templates().best_match("factor_tree", l1, l2)` → 每行 `id=ft-tpl-{i}, source=template, status=baseline`。`client-tree` 分支：`parse_factor_tree_upload()` → `id=ft-up-{i}, source=upload, status=baseline` |
| 3 | （仅 client-tree）用行业模板补客户树的缺口 | **C** | Skill | 语义去重 + 相关性判断，不是全量倒模板。产出 `source=template, status=proposed, evidence="industry template (AI-selected)"`。LLM 失败时退化为确定性 key-diff（`_keydiff_supplement`） |
| 4 | 从材料推荐补充 L3/L4 + 候选指标 | **C** | Skill | 每条必须落在**已有的 L1/L2 下面**。产出 `id=ft-ai-{i}, source=ai, status=proposed, rationale=…, evidence=<出处>` |
| 5 | 原子化（拆合并单元格） | **M** | 确定性 | 见「产出格式 F」。**runtime 有意不做**，见差异表 |
| 6 | 为每个 L4 推荐一个主指标 | **C** | Skill | 只是推荐。平台的 `ai-1.21` 取向选项（Conservative/Balanced/Aggressive）本应驱动它——**但代码从不读这个选项**，见「备注 4」 |
| 7 | 渲染视图 | **M** | App | 平台 `_factor_tree_sheet`（三张表）；runtime `apps/workbook` 生成 `artifacts/s1/factor-tree.xlsx`（四张表） |
| 8 | 统计增删比例并与阈值对照 | **M** | 规则 | 平台**未实现**；runtime 记在 `meta.delta`，工作簿「统计」表呈现，不硬拦 |
| 9 | 逐行采纳/剔除 + 定主指标 | **H** | Orchestration | 关卡 `d-1.21`，kind `approval` |

### 第二轮：1.4d（把访谈的改动写回树）

| # | 步骤 | Class | 执行者 | 说明 |
|---|---|---|---|---|
| 10 | 读访谈提案 | M | Skill | `proposals-*.yaml`，每条必须带 `evidence`（原话引用） |
| 11 | 逐条呈现改动 + 它的原话 | C | Skill | 平台前端是 diff 卡片；runtime 是变更表，见「备注 5」 |
| 12 | 逐条裁决并应用 | **H** | Orchestration | 关卡 `d-1.4`，kind `approval`。见「备注 3」 |

**Class 分布（平台 08 §2.2 原文）：**
`1.21 因子召回 | L1/L2 全量召回 ｜ L3/L4 召回 ｜ 补充建议（≤20%） ｜ 增删确认 | M ｜ M ｜ C ｜ H`
`1.22 指标召回 | 已有 L4 指标召回 ｜ 新 L4 指标补充 ｜ 确认 | M ｜ C ｜ H`

---

## 澄清点

### 澄清 1 · 因子树以什么起底

- **平台：** 在 1.1a 关卡上由人从两个选项里选。
- **runtime（2026-08-10 起）：不问，推出来。** 客户上传了树就以客户的树为基线、行业包补缺口；
  没上传但匹配到行业包就用行业包全量起底；**两头都空则停下来提醒人**——补行业，或请客户给一棵树。
  这不是省一次提问，是因为这个选择本来就没有自由度：能拿到什么就从什么起底。
- **后果：** 决定 `source` 标记的分布，也决定确认时人要读多少行。

### 澄清 2 · 这个行业有没有可召回的知识包

- **读到：** `knowledge_recall.py <工作区> --pack` 的回答，记在材料索引的 `industryPack`。
- **为什么要问：** 有没有行业背书，决定这棵树能不能声称自己站在先例上。
- **两种回答都是真答案：** 有包 → `knowledgeRecall` 记版本号 · 无包 → `knowledgeRecall: none`，
  并在确认时明确告诉人"这棵树没有行业背书"。
- **后果：** 无包时不许把 `source` 标成 `template`——那是宣称一个不存在的先例。
  没有先例但确实该有的因子走 `websearch` 或 `ai`，两者都要按各自的规矩留痕。

### 澄清 3 · 响应指标那一行怎么进树

- **读到：** 档案的 `responseMetric`。
- **为什么必须问：** Y 既要在树里（这样 1.5 才会去要它），又不能当因子（它没有候选可选、不进任何 L1–L4 分组、不参与主指标唯一性）。
- **候选：** A. 单独一行 `role: response`，不挂在任何 L1–L4 下（推荐）· B. 挂在"生意基本盘"下面当普通因子——**会导致模型把 Y 当 X**，不选。
- **后果：** 1.5 的 `coverage_complete` 谓词会检查 `role: response` 行存在且被单独请求了。

### 澄清 4 · 增删超阈值怎么办

- **读到：** 平台文档定的是 L3/L4 与指标"默认全召回，允许 10%–20% 增删"，**超阈值 → 与 Solution Team 联审**。
- **为什么必须问：** 这是一条会改变**流程**的规则——超了要不要停下来找人，还是只记一笔继续走。
- **候选：**
  - **A. 记数 + 在 `d-1.21` 上呈现，不硬拦（推荐）** —— 与平台 G1.2 的"升级联审"语义一致：这是**升级**不是**拒绝**。
  - **B. 硬拦，超阈值不许过关卡** —— 会在库不匹配的行业上永远卡死（无库时 baseline 为 0，任何增补都是 ∞%）。
- **后果：** 选 A 时，`d-1.21` 的呈现必须包含一行"新增 N 条 / 剔除 M 条，相对 baseline ±X%"。

**问不到人时：** 按推荐项走，在 `meta` 里标 `assumed: true` + 理由。

---

## 产出格式

### A. 锁定的 L1/L2 骨架（饮料包，来自 `Assets/Default Factor Tree.xlsx`，94 行）

| L1 | L2 |
|---|---|
| 生意基本盘 | 外部因素 · 内部因素 |
| 消费者需求驱动 | 品牌广告/内容种草 |
| 渠道成交驱动 | 铺货 · 渠道执行及运营 · 渠道/终端营销 · 电商平台媒体及促销 |
| 促销优惠 | 促销优惠 |

L3/L4/指标的完整基线（46 个 L4，94 条指标行）片段：

```
生意基本盘 | 外部因素 | 品类趋势   | 市场规模      → 品类全渠道销量, 品类社媒声量, 品类社媒互动量
生意基本盘 | 外部因素 | 品类趋势   | 季节性趋势    → 温度, 降水量
生意基本盘 | 外部因素 | 宏观环境   | 结构性突变因素 → 外卖大战时间点
生意基本盘 | 外部因素 | 竞争格局   | 竞品渠道扩张  → 本品相对竞品ND, 竞品ND, 本品相对竞品WD, 竞品WD
生意基本盘 | 内部因素 | 动销       | 品牌资产      → 品牌力指数, Meaningful, Difference, Salience, BHT-TOM, BHT-UBA, BHT-TBA
消费者需求驱动 | 品牌广告/内容种草 | 品牌传播 | TV        → GRP, 花费
消费者需求驱动 | 品牌广告/内容种草 | 社交媒体及线下路演 | 社媒 → KOL发帖数, 社媒活动声量, 社媒活动互动量, 花费
渠道成交驱动 | 铺货 | 铺货 | 铺货                        → 本品ND, 本品WD, 货架份额（SOS）
渠道成交驱动 | 渠道执行及运营 | 渠道执行 | 销售业代对于产品陈列的执行-位置好 → 销售业代视平线达成率
渠道成交驱动 | 渠道/终端营销 | 冰柜 | 自有冰柜               → 已投放冰柜个数, 花费
促销优惠 | 促销优惠 | 单品折扣 | PPI                        → PPI
```

**L3/L4 的定义（runtime `derive` 已有，与平台 00 §6 一致，保留）：**
- **L3 = 一族一起动、一起规划的东西**（"品牌传播"、"渠道执行"、"促销优惠"）→ 数据需求文档的**"表"**
- **L4 = 这一族里的一个具体杠杆或条件**（"TV"、"冰柜"、"PPI"）→ 数据需求文档的**"sheet"**，也是模型变量的挂载点
- **指标 = L4 怎么被量化**。一个 L4 可以有多个候选，只能有一个主指标

### B. 实盘的完整宽表（`factor&data_request_1.2.xlsx` sheet `Business Factors`，19 列 96 行）

第 1 行是**每列的出处说明带**，第 2 行是表头。表头逐字：

```
生意因子-Level 1 | 生意因子-Level 2 | 生意因子-Level 3 | 生意影响因子-Level 4 | 指标选择
| ROI range | Contribution Range (Yearly) | 时间颗粒度 | 模型颗粒度 | 下钻颗粒度
| Data | 相关业务团队 | 数据来源
| 数据完整性 | 数据准确性 | 数据颗粒度 | 数据波动性 | 数据一致性
```

> L1–L3 的表头写 `生意因子-`，L4 的表头写 `生意影响因子-`。这个不对称在原文件里就有。

**第 1 行的出处说明（决定了每列由谁填、什么时候填）：**

| 列 | 出处说明（逐字） |
|---|---|
| Level 1 / Level 2 | 行业通用 |
| Level 3 | 根据行业知识及访谈补充/校准 |
| Level 4 | 根据行业知识及访谈补充/校准\n标记哪些是重要的，哪些是不重要的（关联 ROI/CONTRIBUTION RANGE） |
| 指标选择 | 根据积累及访谈及 AI 补充/校准\n不筛选都列出来，尽量补上主要的 |
| ROI range / Contribution Range | 作为后续数据验证及模型业务先验的标准 |
| 时间颗粒度 | 若客户在访谈中表示他们大部分数据可以到周，则为 by year，by week |
| 模型颗粒度 | 根据 SOW 中的分析颗粒度为最低标准 |
| 下钻颗粒度 | 根据积累及访谈提及的策略及 AI 补充/校准 |
| Data | 根据指标选择及颗粒度生成（参考以下模板） |
| 相关业务团队 / 数据来源 | 根据积累及访谈补充 |
| 数据完整性…数据一致性（5 列） | 根据访谈结果筛选指标 |

**一行完整实例（R3）：**

| 列 | 值 |
|---|---|
| Level 1 | 生意基本盘 |
| Level 2 | 外部因素 |
| Level 3 | 品类趋势 |
| Level 4 | 市场规模 |
| 指标选择 | 品类全渠道销量 |
| ROI range | `/` |
| Contribution Range (Yearly) | `-5%~5%` |
| 时间颗粒度 | `By year, by month` |
| 模型颗粒度 | `by product/by category, by channel` |
| 下钻颗粒度 | `/` |
| Data | `Off-take from Nielsen2【发出】` |
| 相关业务团队 | `BI&CMI` |
| 数据来源 | `BI&CMI service agency like NielsenIQ,Kantar` |
| 数据完整性 | 数据时间跨度多于两年，理想状态需要 3 年最优 |
| 数据准确性 | 可被业务团队确认 |
| 数据颗粒度 | daily/weekly/monthly，不接受 yearly 数据 |
| 数据波动性 | 因子需要有变化才能估计回归系数 |
| 数据一致性 | 数据统计逻辑一致且年与年数据可比 |

**五项数据准入标准就是最后五列的值**，逐字如上。它们是 L4 组级的（只填在组的第一行），
是 1.3 数据类访谈问题的出题依据，也是 S2 数据质量打分的标准来源。

**v1.0 → v1.2 的唯一结构变化：** 旧版 15 列，把 `最细颗粒度`（值形如
`By time, by brand, by category, by channel`）**拆成了五列**：`ROI range` /
`Contribution Range (Yearly)` / `时间颗粒度` / `模型颗粒度` / `下钻颗粒度`。
前两列后来进了 `KnowledgeTemplate.factorRows` 的 `roiRange` / `contributionRange`。

### C. 平台的行结构（`models.py`，权威）

```python
FactorSource = Literal["template", "ai", "interview", "manual", "upload", "data_upload"]
FactorStatus = Literal["baseline", "proposed", "accepted", "rejected"]

class FactorRow(CamelModel):
    id: str
    l1: str = ""
    l2: str = ""
    l3: str = ""
    l4: str = ""
    indicator: str = ""
    dimension: str = ""     # 该指标按哪些维度度量，逗号分隔；默认取自档案的 modelScope
    source: FactorSource = "template"
    status: FactorStatus = "baseline"
    rationale: str = ""
    evidence: str = ""      # 原话引用 / 出处

class FactorTree(CamelModel):
    rows: list[FactorRow] = []
```

知识库模板变体（带后验区间，供 S2 OLS 判读）：

```python
class FactorTreeRow(CamelModel):
    l1: str = ""; l2: str = ""; l3: str = ""; l4: str = ""; indicator: str = ""
    roiRange: str = ""              # 如 "0.8~1.3" 或 "/"
    contributionRange: str = ""     # 如 "-5%~5%"
```

**平台的树是一张平表，没有节点对象。** 行的身份是 `(l1, l2, l3, l4, indicator)` 五元组。

### D. 平台渲染出的交付物（`_factor_tree_sheet` → `a-factor-tree`，最多三张表）

**Sheet 1 · `Dimensions`** —— 列 `["Level", "Count"]`：

| Level | Count |
|---|---|
| L1 | 4 |
| L2 | 8 |
| L3 | 17 |
| L4 | 46 |
| Indicators | 94 |
| AI proposed | 8 |

**Sheet 2 · `Factor Tree`** —— 列 `["L1","L2","L3","L4","Indicator","Dimension","Source","Status"]`，全量行（不分组、不合并）。

**Sheet 3 · `AI Recommendations`**（仅当存在 `proposed` 行）—— 列 `["L3","L4","Indicator","Rationale"]`，`rationale` 截断 120 字符。

### E. 客户自有树的解析契约（`factor_tree_upload.py`）

```python
_ALIASES = {
    "l1": ("l1", "level 1", "level1", "生意因子-level 1", "一级"),
    "l2": ("l2", "level 2", "level2", "生意因子-level 2", "二级"),
    "l3": ("l3", "level 3", "level3", "生意因子-level 3", "三级"),
    "l4": ("l4", "level 4", "level4", "生意因子-level 4", "四级"),
    "indicator": ("indicator", "指标", "指标选择", "metric"),
}
```

规则：表头必须在**前 6 行**内，且必须含 `indicator` 以及 `l1` 或 `l4` 之一；
L1–L4 **前向填充**（处理合并单元格）；行 id `ft-up-{i}`，`source="upload"`，`status="baseline"`。

### F. 原子化规则（`atomic_factor_rows`，M 类，确定性）

**每个 L1/L2/L3/L4/指标必须是单一原子值。** `TV/OTV/OOH` 不许作为一个值存在。

```python
_FACTOR_SEPARATORS = set("/、；;|")      # 注意：不含 "+" 和 "&"（"EC+O2O" 是一个渠道名）
_BRACKET_OPEN  = "（(「【[{《"
_BRACKET_CLOSE = "）)」】]}》"
_MAX_ATOMIC_EXPANSION = 60
```

两步：① **顶层切分**——只在括号深度 0 处按分隔符切；② **括号分发**——
`TV投放金额（中央台/卫视/地方台）` → 三个**完整**值 `TV投放金额（中央台）` / `TV投放金额（卫视）` / `TV投放金额（地方台）`，
括号永远配平。切完做五元组去重，一行展开成多行时 id 变 `{原id}-{i}`，总量上限 60。

### G. runtime 载体（`artifacts/s1/factor-tree.yaml`）

```yaml
meta:
  task: "1.21"
  skill: factor-tree
  mode: derive
  generated: "2026-08-08T11:20:00+08:00"
  grounding:
    - { path: "artifacts/s1/knowledge-package.md", chars: 6120, truncated: false }
    - { path: "artifacts/s1/materials-index.md", chars: 2100, truncated: false }
    - { path: "artifacts/s1/project-profile.yaml", chars: 1840, truncated: false }
  knowledgeRecall: "kb:food-bev/beverage@2026-07"     # 或 none
  baselineChoice: template                             # template | client-tree，抄自材料索引
  counts:
    baseline: 94        # 骨架带进来的
    proposed: 12        # AI/模板补充、待裁决
    accepted: 0
    rejected: 0
  delta:                # 增删阈值统计（runtime 新增；平台无）
    baselineL3L4: 46
    added: 6            # 相对 baseline 新增的 L4 数
    removed: 3          # 被剔除的 L4 数
    ratio: 0.196        # (added + removed) / baselineL3L4
    threshold: 0.20
    exceeds: false
rows:
  - id: f-0007
    l1: 消费者需求驱动          # 1.1 锁定
    l2: 品牌广告/内容种草       # 1.1 锁定
    l3: 品牌传播
    l4: Digital Display
    indicator: "曝光量"
    dimension: "Month, Brand, Channel, Geo"   # 默认取自档案 modelScope，逗号分隔
    role: driver                              # driver | response
    source: template                          # template | ai | interview | manual | upload | data_upload
    status: baseline                          # baseline | proposed | accepted | rejected
    primary: true                             # 每个 L1–L4 路径下恰好一条 accepted 行为 true（仅 driver）
    decidedBy: human                          # 人裁决后写；写了就钉住这行
    rationale: "为什么这个指标能度量这个因子——内部用，永不出现在交付给客户的文件里"
    evidence: "原话或引文；source 为 interview / upload 时必填"
    definition: "要客户给什么，用客户听得懂的话"       # 进数据需求工作簿
    unit: "次"                                        # 进数据需求工作簿
    owner: "Media team"                               # 进数据需求工作簿
    timeGrain: "By year, by month"            # 实盘"时间颗粒度"列
    modelGrain: "by product, by channel"      # 实盘"模型颗粒度"列
    drilldown: "By Platform"                  # 实盘"下钻颗粒度"列，L5–L8 的入口
    team: "Media"                             # 实盘"相关业务团队"列
    dataSource: "抖音 Ads 后台"                # 实盘"数据来源"列
  - id: f-0001
    role: response
    indicator: "售出量（件）"
    dimension: "Month, Brand, Channel, Geo"
    source: manual
    status: accepted
    decidedBy: human
    definition: "月度分渠道分区域的消费者购买量"
    unit: "件"
    owner: "BI&CMI"
    # role: response 的行不属于任何分组，没有 primary 标记
```

**字段约束（逐条可校验）**

| 约束 | 谓词 | 触发点 |
|---|---|---|
| 行身份 = `l1+l2+l3+l4+indicator`，不是路径本身 | 去重 | 1.21 |
| L1/L2 只能取知识包里锁定的值 | `l1_l2_locked`（**runtime 待补**） | 1.21 · 1.21d |
| 每个 L1–L4 值必须是原子值（无 `/、；;\|` 分隔，括号配平） | `atomic_values`（**runtime 待补**） | 1.21 |
| 无一行处于 `proposed`/`pending` | `no_undecided_rows` | 1.21d · 1.4d |
| 每个 accepted 的 L1–L4 路径下恰好一条 `primary: true` | `primary_indicator_per_l4` | 1.21d · 1.4d |
| `source ∈ {interview, upload}` 的行必须有 `evidence` | `proposals_have_evidence`（提案侧）| 1.4 · 1.4d |
| `knowledgeRecall: none` 时不得有 `source: template` 的行 | （**runtime 待补**） | 1.21 |
| 至少一条 `role: response` 行 | `coverage_complete`（在 1.5 检） | 1.5 |
| 视图与 store 同步 | `view_current` | 1.21 · 1.21d · 1.4d |

---

## Gate

| 触发条件 | 判定者 | 候选处置 | 路由 |
|---|---|---|---|
| L3/L4 + 候选指标推导完成 | BA | ① `approve` 确认因子树（推荐）—— L1–L4 与主指标定版，访谈开工<br>② `rework` 重新推导 —— 树漏了东西 | 平台 `d-1.21`，kind `approval`，`reworkTaskId: 1.21`。runtime 同名 |
| 还有行处于 `proposed` | —— | **不许过。** 每行必须变成 `accepted` 或 `rejected` | gate-protocol 规则 2「二元裁决，不留中间态」 |
| 某个 L4 下没有 `primary: true` 或有多于一个 | —— | **不许过。** | `primary_indicator_per_l4` |
| **L3/L4 或指标的增删超过 10–20% 阈值** | **Solution Team 联审**（不是 BA 独断） | ① 联审通过，记录原因<br>② 收窄增删，回到 baseline | 平台 05 §4.1 路由表：`G1.2 \| 因子增删超 10–20% 阈值 \| Solution Team 联审 \| 紧急度：中`。**平台代码未实现**；runtime 应实现为**升级呈现**而非硬拦（见澄清 4） |
| 某个 L4 下所有候选指标都不可测量 | BA + 客户 | ① 交给访谈去解（推荐，1.3 的出题来源之一）② 剔除这个 L4 并记原因 | 无独立关卡，在 `d-1.21` 上作为必答项呈现 |
| 访谈提出了因子改动 | BA | ① `approve` 接受改动写回树（推荐）② `rework` 重新消化纪要 | 平台 `d-1.4`，kind `approval`，`reworkTaskId: 1.4`。runtime 同名 |
| 提案或人要求**改 L1/L2** | BA | ① 先给一个不动骨架的替代方案（用一个新 L3 装下它）② 人仍坚持就改，明说"骨架动了"并记账 | runtime：`confirm` 与 `amend` 两步都允许，**AI 推导永远不许**。改了要把新骨架同步回知识包 |
| 树被确认后有人要改 | 项目负责人 | 显式 `reopen d-1.21` | 平台 05 §3.2：因子树版本每次关卡确认后广播，下游任务自动标记"基于过期版本"待刷新。runtime：`reopen d-1.21` 回退全部下游 |

**关卡通过的副作用（平台代码，`confirm_tree_effect` / `accept_factor_rows`）：**

```python
def accept_factor_rows(st, source_set: set[str]) -> None:
    for r in st.factor_tree.rows:
        if r.status == "proposed" and r.source in source_set:
            r.status = "accepted"

def confirm_tree_effect(st, option_id):        # d-1.21
    if option_id == "approve":
        accept_factor_rows(st, {"ai", "template"})

def confirm_interview_effect(st, option_id):   # d-1.4
    if option_id == "approve":
        accept_factor_rows(st, {"interview"})
```

**两条要点：** ① 每个关卡**只翻自己那一批** `source` 的行——`d-1.21` 不碰 `interview` 行，
`d-1.4` 不碰 `ai`/`template` 行。② 已经被人手动改成 `rejected` 的行**不会被翻回来**。
"批准"的语义是"接受我没有手动否掉的那些"。runtime 的 `apply-proposals` 必须照此实现。

---

## 与 runtime 现状的差异

| 平台定义 | runtime 现状 | 判定 | 建议 |
|---|---|---|---|
| L1/L2 由行业知识包锁定；饮料包内置 94 行 L1–L4 骨架（`Assets/Default Factor Tree.xlsx` → `KnowledgeTemplate`） | 已落库：`knowledge/industry/food-bev/beverage/factor-tree.yaml`（94 行 L1–L4+指标）+ `knowledge/methodology/factor-tree-skeleton.yaml`（跨行业的 4×8 骨架） | **一致** | 行业匹配挪到了 `materials` 那一步：行业锚点来自 scoping，匹配到的包覆盖 L1–L4+指标，L1/L2 从那时起锁定 |
| `recall()` 返回行业模板 | `shared/lib/knowledge.py::recall()` 按 anchor 在登记过的包里做关键词召回；`scripts/knowledge_recall.py` 是它的命令行入口 | **一致** | 检索方式是关键词不是向量（2026-08-10 决定：库还太小，向量的收益不抵一份要维护的索引）。换检索方式只动 `recall()` 一个函数 |
| L1/L2 锁定的强度 | **锁定，但人可以改**（2026-08-10 决定）：AI 推导永远不新增这两层；人要改，先被告知代价（数据需求分册重排、跨项目不可比、已作数的判断要重看），拍板后改并记账，且要把新骨架同步回知识包 | 偏离（有意，比平台松、比原 runtime 松） | 原来的 runtime 规则是"只有 `d-1.4` 能新增 L2、L1 永不可改"，那让一条正当的骨架修正无路可走 |
| 10–20% 增删阈值 + 超阈值升级 Solution Team 联审 | `meta.delta` 统计块 + 工作簿「统计」表的「增删幅度」分组；只呈现不硬拦 | **一致（runtime 实现了平台文档）** | **平台代码也没实现**（prompt 逐字写的是 *"recommend as many as the materials genuinely support (no fixed limit)"*）。runtime 补的是平台**文档**的规则，且按升级语义而非拒绝语义 |
| 每个指标携带：时间颗粒度 / 模型颗粒度 / 下钻颗粒度 / 相关业务团队 / 数据来源 / 五项数据准入标准（实盘 19 列） | 在 `groups` 块上，一个 L4 一条（`timeGrain`/`modelGrain`/`drilldown`/`team`/`dataSource` + `admission` 五项） | **一致** | 填在组上而不是每行重复，与实盘表一致。**下游目前只有 `owner`/`team` 有真正的读者**——其余几项是为访谈出题与 S2 下钻准备的，接线之前它们的价值靠人自觉 |
| `roiRange` / `contributionRange`（`FactorTreeRow`，S2 OLS 判读的先验区间） | 只在 `factor-ranges.json` 里，按 `(l4, indicator)` 精确查；树里不存第二份 | 偏离（位置不同，有意） | 区间是知识库的东西，不该混进项目的树。同一件事有两个权威，它们迟早不一致 |
| 原子化：`atomic_factor_rows`，确定性拆合并单元格 + 括号分发，上限 60 | **有意不做**（2026-08-10 决定） | 偏离（有意） | 不补。`TV/OTV/OOH` 这类写法在 runtime 的取数路径上不成立：客户自有树按单元格逐行解析，行业包本来就是一行一指标。留着这条规则的代价是它会去切 `品牌广告/内容种草` 这类合法类目名 |
| 客户自有树解析：表头别名表 + 前 6 行内找表头 + L1–L4 前向填充 | `skills/factor-tree/scripts/read_client_tree.py`（确定性脚本）+ `shared/lib/xlsx.py::read_workbook` | **一致（且更强）** | 平台的规则在 runtime 是代码不是散文。客户自有树现在是首选基线（行业包只补缺口），所以它必须是脚本——前向填充漏掉内层清空这种错，在几十行的表里看不出来 |
| `FactorRow` 11 字段 | runtime 行 17 字段 | **多余（runtime 扩展）** | 保留全部。`role`（driver/response）、`primary`、`decidedBy`、`definition`、`unit`、`owner` 都是平台缺的、且被下游谓词真正用到的字段。特别是 `role: response`——平台没有它，所以平台的 Y 是靠 `ProjectMeta.kpi` 旁路走的，runtime 的做法更自洽 |
| `source` 六值枚举含 `data_upload` | runtime 八值：另加 `websearch`（网络检索）与 `report`（客户报告材料） | **多余（runtime 扩展）** | 保留。2026-08-10 决定：新加的每一行都要 grounded，而三类依据的可信度不同——知识库召回、外部网页、模型自有先验必须在树上分得开，人在确认时才知道该重点看哪一批 |
| `d-1.21` 只翻 `{ai, template}` 行，`d-1.4` 只翻 `{interview}` 行，`rejected` 不回滚 | `confirm.md` 与 `apply-proposals.md` 各写了一遍自己那批 source | **一致** | — |
| 前端 `FactorTreeEditor` 逐行 Accept/Reject + Accept all + 按 source 过滤 | `artifacts/s1/factor-tree.xlsx` 四张表（因子树 / 待裁决 / 统计 / 说明），逐行确认在 Excel 上做 | 偏离（形态） | 2026-08-10 决定：给人看的形态是 Excel，不是 markdown 视图。见「备注 5」 |
| `ai-1.21` 指标选型取向（Conservative/Balanced/Aggressive） | 无 | **多余/不建议引入** | **不要抄。** 平台代码从不读这个选项（见备注 4），它是一个只在 UI 上转的旋钮。runtime 的等价物是澄清协议——真要问取向，就在澄清里问，别做成一个不影响产出的选项 |
| `1.22` 指标召回是独立任务 | 无独立任务 | **一致（都不做）** | 保持。指标是行的一列，不是另一个交付物 |
| `meta.reviewedAt` / `meta.amendedAt`（`shared/artifact-frontmatter.md` 要求"后续关卡记在自己的日期键里，不覆盖生产者戳") | `confirm.md` 写 `reviewedAt`、`apply-proposals.md` 写 `amendedAt`，两处都明写不要动 `step`/`generated` | **一致** | — |
| `derive` 的 reads 允许读 `factor-tree.yaml` 自身（重跑时接续） | manifest 与 `derive.md` 一致 | **一致** | — |
| （平台无）联网取材 | 只有 `derive` 的 reads 里有 `web:*`；网络依据要记 `{url, accessed}`，缺访问日期直接被验收挡下 | **多余（runtime 扩展）** | 2026-08-10 决定。确认与访谈回写两步不许联网——人是在他看见的那份东西上做判断的 |

---

## 备注

**1. 设计文档的 1.22 在代码里不存在。**
`00-overview.md` §3 把 1.21（因子）与 1.22（指标）列为两个任务，`01-business-agent.md` 也分了
Step 2 / Step 3。**平台代码里没有 1.22**：`registry.py` 只注册了 `1.21 → derive_factor_tree`，
指标是 `FactorRow.indicator` 这一列，跟因子在同一次 LLM 调用里一起产出。
同理 **1.23 也不存在**（数据需求是 `1.5`），**1.33 也不存在**（纪要消化是 `1.4`）。
按宪法以代码为准：因子与指标是**一个交付物**，这与 A5「一物一 skill」正好吻合。
平台前端的演进记录印证了这一点——`08 §10.1.12`（B-13）逐字写着
*"② Factor Tree（含指标候选/选型，indicator 不再单列）"*，把原来的
`a-indicator-candidates` / `a-indicator-list` 两个 artifact 合并掉了。

**2. 10–20% 阈值：三份文档说有，代码一个字都没有。**
出处齐全且一致——`01 §Step 2`（*"可补充 10%–20%"*）、`00 §5.2`（*"允许 10%–20% 增删，
每项增删需人工确认 + 记录原因；超出阈值的改动 → 升级到与 Solution Team 的联合 Review"*）、
`05 §4.1` 路由表、`08 §2.2` 打标表。但 `derive_factor_tree` 的 prompt 逐字写的是
**"recommend as many as the materials genuinely support (no fixed limit)"**，
后端 grep `10-20` / `20%` / `threshold` 全部无结果。
**这是一条被实现放弃的业务规则。** runtime 重新实现它是一次有意的"比平台更严"，
但要按平台的**升级**语义（呈现给人 + 需要联审）而不是**拒绝**语义（硬拦），
否则在没有行业包的项目上会永远卡死。

**3. L1/L2 "锁定"的真实强度。**
代码里唯一的 L1/L2 保护是两句 prompt：`assemble_knowledge` 的
*"Keep the locked L1/L2 skeleton faithful to the source."* 和 `derive_factor_tree` 的
*"Every recommendation must fit under an existing L1/L2."* ——**没有任何校验器会拒绝一个新 L1/L2 的行。**
runtime 的规则（2026-08-10 修订）分成两半，比平台严的那半更严、比平台松的那半有出口：

- **AI 永远不新增 L1/L2。** 推导只能在已有的两层下面长 L3/L4。这条比平台严。
- **人可以改，但要先看清代价。** 摆出来的代价是真的：L3 是数据需求的一册工作簿，
  它的上一层动了，整套册子重新分；L1/L2 是跨项目共用的一层，改了这个项目就和别的项目对不上。
  所以做法是先给一个不动骨架的替代方案（用一个新 L3 装下它），人仍坚持就改，
  记清楚谁在什么时候因为什么改的，并把新骨架同步回知识包。

之前的 runtime 规则是"只有 `d-1.4` 能新增 L2、L1 永不可改"。它挡住的不只是随手改，
还包括一条正当的骨架修正——而一条正当的修正无路可走时，人会把它塞进一个不合适的 L3 里，
那比改骨架更难发现。

**4. `ai-1.21` 是一个不接线的旋钮。**
`blueprint.py` 定义了 Conservative / Balanced / Aggressive 三档"指标选型取向"，
`08 §10.1.15`（B-16）还专门为它改过一版设计（从"逐个指标选"改成"整体 posture"，
理由是"逐个指标选太细"）。但 **`business.py` 从不读 `ai_options` 或 `chosen_id`**——
store 自动选中 `recommended` 并发一条 Activity 事件，产出不因此改变一个字。
这是"AI Cognitive Options"这个交互概念的产品化痕迹，不是一条业务规则。**runtime 不抄。**

**5. 平台前端交互 → runtime 文本形态的降级。**

| 平台前端 | 承载的信息结构 | runtime 文本形态 |
|---|---|---|
| `FactorTreeEditor`：可编辑树、行级 Accept/Reject、Accept all、按 source 过滤、行内编辑、手工加行 | ①每行的裁决是独立的 ②来源可见 ③可以批量 ④可以现场改字段 | `artifacts/s1/factor-tree.xlsx`「因子树」表：全量行、保持树的顺序，每行带状态、来源、理由、证据。逐行裁决就在这张表上做。批量等价物：关卡上说"接受我没有手动否掉的那些"（与平台 `accept_factor_rows` 语义完全相同）。过滤等价物：「待裁决」表 + `inspect` 模式的五问 |
| **diff 卡片**（1.4d 的访谈改动逐条采纳/驳回） | 变更 + 理由 + 证据锚点 + 采纳/驳回 | **变更表**：`kind \| targetRow \| 变成什么 \| 理由 \| 原话`，逐行裁决后写 `applied: accepted\|rejected`。**形态降级，信息结构不降级**（宪法 D6） |
| 三张 sheet（Dimensions / Factor Tree / AI Recommendations） | 先给总量、再给全表、再单列待裁决 | 工作簿的四张表：因子树（全表）· 待裁决（这一轮真正要判的）· 统计（层级计数、来源分布、增删幅度）· 说明（每列谁填）。信息顺序一致：先结论后明细。比平台多一张「待裁决」，因为 Excel 没有前端那种筛选 |
| 版本条 / 血缘条 / 过期标记 | 树的版本被广播，下游标"基于过期版本" | `state.py reopen` + 关卡证据哈希变更提示（gate-protocol 规则 3）。这是弱一些的等价物，但可见性在 |

**6. 留痕要求（StatusCheckList 原文，平台 00 §5.4 / 05 §5.2）。**
> "需要有个地方记录每个项目都因为什么补了什么，或者删了什么，后续需要以此来维护知识库。"

每次增删改要记：**内容 + 原因 + 来源（AI 推荐/报告/访谈）+ 确认人 + 时间**。
runtime 的行结构已经承载了前三项（`rationale` / `source` / `evidence`）和确认人（`decidedBy`），
**缺时间戳**。建议在人裁决时补一个 `decidedAt`，否则宪法 §4.4 的"回流评审"没有时间线可读。

**7. 实盘文件里的脏东西（照抄会中招）。**
`Business Factors` 的 L1–L4 用**空白继承**（合并单元格），解析必须前向填充——
`template_seed.py::_parse_factor_tree` 的 `carry` 数组就是干这个的，且**填充某一级时要清空它下面所有级**：

```python
for idx, val in enumerate((l1, l2, l3, l4)):
    if val:
        carry[idx] = val
        for j in range(idx + 1, 4):
            carry[j] = ""
```

漏掉那个内层清空循环，会让上一个 L4 的名字挂到下一个 L3 的第一行上。
另外实盘 workbook 里混进了一张 `2024PFME SPEND`（雀巢 HCP 的数据，另一个行业案例），
以及一个 sheet 名带前导空格 `' Mkt Activation Buzz 【发出】'`——都不属于饮料因子树，不要当输入。
