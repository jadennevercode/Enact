# 契约卡：数据需求与验收

**阶段：** 业务理解（**本阶段的终点**）
**平台出处：** 1.5（生成数据需求）· 1.5d（客户签收）
· 设计文档编号 **1.23 数据准入标准及数据模板**——1.23 在代码里不存在，任务号是 1.5，见「备注 1」
· `backend/app/agents/business.py` `gen_data_request`（在应用内渲染的预览体）
· `backend/app/agents/data_request.py` `build_export_zip` / `_write_sheet` / `_granularity_label` / `_safe_sheet_title` / `_safe_file_name` / `factor_tree_by_l3` / `build_manifest` / `manifest_satisfied`（真正交给客户的工作簿 + 回收校验）
· `backend/app/domain/models.py` `DataRequestSlot` / `DataRequestManifest` / `DataSlotStatus`
· `docs/agent-design/01-business-agent.md` §3 Step 5 · `00-overview.md` §4 ⑤Data · `08-product-architecture-v2.md` §2.2（`1.23 数据需求模板 = A`）
· 实盘 `reference/01.商业智能体/【MMM AI】商业智能体-factor&data_request_1.2.xlsx` 的 12 张模板 sheet · `reference/data request template.xlsx` · `Assets/Data Request.xlsx`
**产出 Skill：** data-request

---

## 输入

| 来源 | 内容 | 类型 |
|---|---|---|
| 上游交付物 | **因子树（经访谈回写、已过 `d-1.4`）** —— 只取 `status ∈ {accepted}` 的行（平台取 `{baseline, accepted}`，见差异表）。提供 L3 / L4 / indicator / definition / unit / owner | 交付物 |
| 上游交付物 | **项目档案** —— `timeGranularity`（第一列）、`modelScope.dimensions`（维度列）、`modelScope.rows[:3]`（示例行）、`timeWindow`（README 的期间）、`brand`（Brand Coverage）、`responseMetric`（响应表） | 交付物 |
| 无 | 不读报告、不读纪要、不读知识库 | —— |

> **这个交付物只做转译，不做判断。** runtime SKILL.md 的原话："这一步是要数据，
> 不是重新解释那棵树；这里还剩下的任何判断，本该在 `d-1.21` 或 `d-1.4` 就做完了。"
> 平台侧同构：`1.5` 的 `klass: "A"`（有 schema 可机器校验的生成），不是 C。

---

## 构建过程

| # | 步骤 | Class | 执行者 | 说明 |
|---|---|---|---|---|
| 0 | 澄清 | C | Skill | 见下节。**这里能问的很少**——该问的在 1.0 / 1.21d / 1.4d 都问过了 |
| 1 | 按 L3 → L4 → 指标分组 | **M** | 确定性 | `factor_tree_by_l3()`。回退链是硬规则：`l3 = r.l3 or r.l2 or r.l1 or "—"`，`l4 = r.l4 or l3` |
| 2 | 取时间列与维度列 | **M** | 确定性 | `time_col = f"Time ({profile.timeGranularity})"`；`scope_dims = [d.name for d in modelScope.dimensions]` |
| 3 | 生成 README / 信息头 | **M** | App | 见产出格式 B/C |
| 4 | 每个 L3 一个工作簿、每个 L4 一个 sheet | **M** | App | 文件名 = L3 标签；sheet 名 = L4 标签（≤31 字符，非法字符替换，同名加后缀） |
| 5 | 排列指标列 | **M** | 确定性 | 主指标在前，备选加 `(alternate)` 后缀 |
| 6 | 写示例行 | **M** | App | 时间格用固定字面量，维度格填档案的前 3 个 scope 行，指标格**留空** |
| 7 | 单独出响应表 | **M** | App | `role: response` 的行不进因子表 |
| 8 | 核对覆盖 | **M** | Tool | 每个 accepted 行必须被请求**恰好一次**；缺 `definition`/`unit`/`owner` 的行单独列出 |
| 9 | 呈现并取签收 | **H** | Orchestration | 关卡 `d-1.5`，kind **`signoff`**（不是 approval）。**关掉业务理解阶段** |
| 10 | 导出分发 | H | 人 | 平台原有独立任务 `1.5b Export & send`，现役代码已并入导出接口 |

**Class 分布（平台 08 §2.2 原文）：** `1.23 数据需求模板 | 因子树 → L3 表/L4 sheet 模板生成 | A`。
现役代码：`1.5 = A`，`1.5d = H`。

---

## 澄清点

> **本交付物的澄清点很少，这是设计使然。** 到这一步该拍的板都拍完了。
> 剩下的只有三件"答案会改变产出"的事。

### 澄清 1 · 谁来填每一张表

- **读到：** 因子树各行的 `owner` / `team` 字段。1.21d 的复核步骤要求"为每个 accepted 行捕获 `definition`、`unit`、`owner`"。
- **为什么必须问：** **这是决定数据到底会不会到的那件事。** 一张没有 owner 的表就是一张没人负责的表。签收关卡的呈现里，"谁欠什么"是四段中的第二段。
- **候选：** A. 按 L3 指一个负责团队（推荐——工作簿是按 L3 分的，责任边界与文件边界对齐）· B. 按 L4 逐 sheet 指人（更准，但客户要指几十个人）· C. 全部交给一个数据对接人转发——**看起来省事，实际是把风险集中到一个人身上**。
- **后果：** 写进 README 的定义表和覆盖报告。

### 澄清 2 · 有指标缺 `definition` / `unit` 时发不发

- **读到：** 覆盖报告的 `counts.noUnit` / `counts.noOwner`。
- **为什么必须问：** 发出去之后再补，等于让客户填两遍。
- **候选：**
  - **A. 先回因子树补齐再发（推荐）** —— 覆盖报告已经逐行列出了缺什么。代价是一个来回。
  - **B. 带着缺口发，在表里留空让客户自己写定义** —— 会拿回一列没人知道单位的数字，**在 S2 被和不兼容的东西加起来**。
- **后果：** 这条不是格式偏好。runtime `coverage.md` 的原话："一个没有声明单位的数字，就是后面会被和不兼容的东西加起来的那一个。"

### 澄清 3 · 时间覆盖区间填多少

- **读到：** 档案的 `timeWindow`。实盘的 `Time Coverage:` 这一格在 12 张模板里**有 10 张是空的**——留给客户填。
- **候选：** A. 按档案的 `timeWindow` 预填（推荐，客户少一次决定）· B. 留空让客户填实际可得区间——**信息更真，但会拿到一堆参差不齐的区间**。
- **后果：** 选 A 时要在关卡上说明"这是我们要的，不是他们有的"，并在回收时逐表核对实际区间。

---

## 产出格式

### A. 结构规则（三份文档一致，代码实现）

> **以 L3 为表、L4 为 sheet、指标颗粒度 + 指标为列。**
> —— `00-overview.md` §4 ⑤Data，逐字

```
一个 L3  →  一个 .xlsx 文件（文件名 = L3 标签）
一个 L4  →  该文件里的一个 sheet（sheet 名 = L4 标签）
一列     →  时间列 + 模型范围维度列 + 该 L4 的每个指标
```

### B. 客户拿到的工作簿版式（`data_request.py::_write_sheet`，逐行）

```python
put(1, 1, "Data Request", font=bold_font)      # A1，加粗
put(2, 1, "Time Coverage: ")                    # A2；B2 留空给客户填
put(3, 1, "Granularity: ")                      # A3，行高 50
put(3, 2, _granularity_label(granularity, scope_dims))
put(4, 1, "Brand Coverage: ")                   # A4
put(4, 2, brand)
# 第 5 行留白
header_row = 6                                  # 第 6 行 = 带底色的表头带
headers = [time_col, *scope_dims, *indicators]
# 第 7 行起 = 示例行
```

样式常量（逐字）：

```python
_FONT_NAME = "Open Sans"
_FONT_SIZE = 11
_HEADER_FILL = "FFAFC7FE"   # periwinkle 表头带，与参考模板一致
_TITLE_COL_WIDTH = 45.3     # A 列宽
```

`Granularity:` 的值（`_granularity_label`）：

```python
return ", ".join(["By time", *[f"by {d}" for d in scope_dims]])
# → "By time, by Brand, by Channel, by Geo"
```

一张成品 sheet：

| | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| 1 | **Data Request** | | | | | |
| 2 | Time Coverage: | | | | | |
| 3 | Granularity: | By time, by Brand, by Channel, by Geo | | | | |
| 4 | Brand Coverage: | 脉动 | | | | |
| 5 | | | | | | |
| 6 | **Time (Month)** | **Brand** | **Channel** | **Geo** | **曝光量** | **花费** |
| 7 | 2023-01 | 脉动（除电解质外） | MT | 华东 | | |
| 8 | 2023-01 | 脉动（除电解质外） | MT | 华南 | | |
| 9 | 2023-01 | 脉动（除电解质外） | TT | 华东 | | |

示例行规则：时间格是**固定字面量 `"2023-01"`**；维度格来自 `modelScope.rows[:3]`（最多三行）；
指标格写空串——**那正是客户要填的地方**；没有 scope 行时只出一行，A 列 `2023-01`。

命名规则：

```python
# 文件名：非法字符 \ / : * ? " < > | → "_"；截断 80；重名加 _1 / _2
# sheet 名：非法字符 \ / ? * [ ] : → " "；截断 31；重名把后缀塞进 31 字符内
```

### C. 应用内预览体（`business.py::gen_data_request` → artifact `a-data-request`）

上限 `_MAX_REQUEST_SHEETS = 12`。

**Sheet 1 · `Template Index`** —— 列 `["L3 (one workbook each)", "L4 sheets", "Indicators"]`：

| L3 (one workbook each) | L4 sheets | Indicators |
|---|---|---|
| 品牌传播 | 5 | 10 |
| 渠道执行 | 3 | 6 |

**Sheet 2..13 · 每个 L4 一张** —— 名 `f"{l3} · {l4}"[:31]`，列 `[time_col, *scope_dims, *indicators]`。
指标为空时列名落成字面量 `"value"`。

**Sheet `Note`**（仅当被 12 张截断）：
`"Showing first 12 L4 sheets; the full workbook set has one workbook per L3."`

**Sheet `Review & Sign-off`** —— 列 `["Item", "Status"]`，三行固定：

| Item | Status |
|---|---|
| Fields & granularity | pending |
| Owners assigned | pending |
| Client sign-off | pending |

> **这三行是静态渲染，不是持久化记录。** 没有任何东西回写它，`ProjectState` 里也没有
> 数据需求签收字段。唯一持久的签收是 `d-1.5` 的 `DecisionRuntime`（`kind: "signoff"`）。
> 见「备注 3」。

### D. 实盘的 12 张模板（`factor&data_request_1.2.xlsx`）

同一骨架的 12 个实例，逐字的表头：

| Sheet | Granularity | Brand Coverage | 表头 |
|---|---|---|---|
| ` Mkt Activation Buzz 【发出】` | `By time ,by category, by channel, by format` | | `Date, category, channel, KOL, KOL type, format, Buzz, Engagement` |
| `Market dominace` | `By time,by brand, by category, by channel` | `Mizone by product` | `Date, Market\n(City/Province/National), Brand, Category, Marketing share, Penetration` |
| `salesforce` | `By time ,by category, by channel, by format,by region` | | `Date, category, channel, format, region , volume, rate` |
| `Omni-channel` | `By time ,by category, by channel, by format,by region` | | `Date, category, channel, format, region , volume, spending` |
| `竞品RSP` | `By time, by brand,  by category` | `Mizone by product` | `Date, Brand, Category, RSP, RSP change%, SKU上市个数, SKU下市个数` |
| `Media` | `By time ,by category, by channel, by format` | | `Date, category, channel, format, impression, click, GRP` |
| `线条饮料` | `By time, by brand, by category, by channel` | | `Date, brand, category, channel, volume` |
| `Price&cost` | `By time,by brand` | `Mizone by product` | `Date, Brand, CAC, AGM` |
| `Competitor Sales+Promo Template` | `By time, by brand, by category,by channel` | | `Month, Brand, Category, channel, sales volume, store execution, ND%, WD%, media spending, media engagement` |
| `Store Execution【发出】` | `By month, by brand, by product,by province, by sales channel` | `脉动&Key competitors` | `Date, Brand, category, channel, region, POSM, 扫码瓶数, Store Execution, spending` |
| `Macroeconomics Template【发出】` | `By month` | | `Date, National/Province, 天气-温度, 天气-降雨量, 高铁量/飞机航班, GDP, CPI` |
| `BHT Template【发出】` | `By time, by brand, by category` | | `Date, Brand, category, brand power, Meaningful, Difference, Salience, BHT - TOM, BHT - UBA, BHT - TBA` |

`【发出】` = 实际发给客户的四张。其中两张（`Store Execution` / `Macroeconomics`）
的 `Time Coverage:` 填了 `2022/10~ 2025/10`，其余留空。

**两点值得注意：**
1. **实盘的表不是按 L4 切的，是按数据源切的。** `Media` 一张表覆盖多个 L4，
   `Macroeconomics` 覆盖整个"宏观环境"L3。代码实现的"一个 L4 一个 sheet"是**规范化后的形态**，
   比实盘更细。规范化是对的（收数才能逐指标核对），但要预期客户会要求合表。
2. **实盘的时间格式三套并存**：`'2022-10月'`、`2022-10-01 00:00:00`、`'202207'`。
   代码统一成 `"2023-01"`。这是一次有价值的规范化，**保留**。

### E. 回收侧的校验契约（`build_manifest` / `manifest_satisfied`）

数据需求不止是发出去，它还是**回收时的核对表**：

```python
DataSlotStatus = Literal["pending", "uploaded", "incomplete", "validated", "error"]

class DataRequestSlot(CamelModel):
    l3: str
    expectedL4s: list[str] = []
    expectedIndicators: int = 0
    status: DataSlotStatus = "pending"
    fileId: str | None = None
    filename: str = ""
    coveredIndicators: int = 0
    missingL4s: list[str] = []
    missingIndicators: list[str] = []      # 形如 "L4·指标"，上限 30 条

class DataRequestManifest(CamelModel):
    slots: list[DataRequestSlot] = []
    total: int = 0
    validated: int = 0
    timeGranularity: str = "Month"
    scopeDims: list[str] = []
```

**回来的 sheet 与 L4 的匹配打分**（`_match_score`，逐字含注释）：

```python
if sheet_norm == l4_norm:      return 4
if sheet_norm.startswith(l4_norm) or l4_norm.startswith(sheet_norm):
                               return 3  # handles Excel's 31-char title truncation
if l4_norm in sheet_norm:      return 2
if sheet_norm in l4_norm:      return 1  # weakest — avoids 'tv' hijacking 'otvott'
return 0
```

归一化 `_norm`：`re.sub(r"[^0-9a-z一-鿿]", "", s.lower())` —— 只留字母数字和中日韩字符。
判定：`status = "validated" if not missing_l4 and not missing_ind else "incomplete"`。
关卡：`manifest_satisfied = (total > 0 and validated == total)`。

> **打分表第 3 档存在的理由就是 Excel 的 31 字符截断。** 一个长 L4 名发出去被截断，
> 回来时按前缀仍能配上。这是发和收之间唯一的耦合点，runtime 必须一起实现，
> 否则"按 L4 命名 sheet"这个约定在收数时会失效。

### F. runtime 载体

**产物：** `artifacts/s1/data-request/<L1-L2-L3 slug>.xlsx`（一个 L3 一个）
+ `artifacts/s1/data-request/00-response.xlsx`（响应指标）
+ `artifacts/s1/data-request/coverage.md`（覆盖报告）。
**全部由 `scripts/build_workbooks.py` 生成，不许手写工作簿、不许手改 coverage.md。**

**README sheet**（每个工作簿第一张）：

```
Data request              <L1 / L2 / L3>
（空行）
Time granularity          Month
Period                    2023-01 to 2025-12
Reported by               Brand, Channel, Geo
（空行）
One sheet per factor. Each row is one period x one combination of the dimensions
above. Leave a cell blank when the value does not exist — do not enter zero for missing.
（空行）
Factor row | L4 | Indicator | Primary | Definition / what we mean | Unit | Owner
f-0007     | Digital Display | 曝光量 | yes       | 该媒体形式的月度总曝光次数 | 次 | Media team
f-0009     | Digital Display | 花费   | alternate | 该媒体形式的月度投放金额     | 元 | Media team
```

**数据 sheet 表头：** `[<granularity>] + [<modelScope 维度名>] + [<指标列>] + ["Source system", "Notes"]`
指标列排序：`sorted(rows, key=lambda r: (not r.primary, r.indicator))` —— 主指标在前，再按字母序；
非主指标列名加 ` (alternate)` 后缀。
示例行：`PERIOD_HINT = {"Year": "2024", "Month": "2024-07", "Week": "2024-W27"}`，
维度格 `<dim>`，指标格 `<value>`，最后两格 `<system or file>` 与
`EXAMPLE ROW — delete before returning`。

**`coverage.md` 的 meta 块（`build_workbooks.py::_coverage` 生成）：**

```yaml
---
task: "1.5"
skill: data-request
mode: build
generated: "2026-08-08T17:10:00+08:00"
grounding:
  - { path: "artifacts/s1/factor-tree.yaml", chars: 11200, truncated: false }
  - { path: "artifacts/s1/project-profile.yaml", chars: 1840, truncated: false }
knowledgeRecall: none
acceptedDrivers: 87
requested: 87
missing: 0
orphanSheets: 0
responseRequested: true
counts: { workbooks: 17, noUnit: 4, noOwner: 9 }
---

# Data request coverage

Granularity **Month** · reported by Brand, Channel, Geo

| Workbook | L3 | Sheets | Indicators |
|---|---|---|---|
| 消费者需求驱动-品牌广告-品牌传播.xlsx | 品牌传播 | 5 | 10 |
| 00-response.xlsx | （响应指标） | 1 | 1 |

Every accepted factor row is requested exactly once.

## Rows the client cannot act on yet

| Row | Indicator | Missing |
|---|---|---|
| f-0031 | 社媒活动声量 | unit, owner |
| f-0044 | 冰柜投放个数 | definition |

Fix these in the factor tree, then rebuild. A number with no declared unit is the
one that gets summed with something incompatible later.
```

无响应行时插入的固定告警块（逐字）：

> **No response indicator is requested.** The tree carries no row with `role: response`,
> so the data would arrive with drivers and no dependent variable and could not be
> modeled. Fix the tree, not this file.

**四条硬规则（runtime SKILL.md）：**
1. **只请求 `accepted` 的行。**
2. **响应指标是必需的，且它不是因子** → `00-response.xlsx`；缺它 `coverage_complete` 直接失败。
3. **备选指标也要，标 `(alternate)`。**
4. **空白不等于零。**

---

## Gate

| 触发条件 | 判定者 | 候选处置 | 路由 |
|---|---|---|---|
| 工作簿生成完成 | —— | 无关卡 | 平台 1.5 无 decision；runtime 1.5 无 gate。签收在下一步 |
| 有 accepted 行**没被请求**，或被请求**多于一次** | —— | **不许过。** 回因子树修，重建 | `coverage_complete` |
| 树里**没有 `role: response`** 的行 | —— | **不许过。** | `coverage_complete`。数据会带着一堆自变量和零个因变量回来 |
| 有行缺 `definition` / `unit` / `owner` | BA | ① 回因子树补齐再发（推荐）② 带缺口发并在关卡说明 | 覆盖报告的 `## Rows the client cannot act on yet` 段。不硬拦，但必须呈现 |
| 数据需求要发给客户 | **BA + 客户对接人** | ① `signoff` 客户已签收（推荐）—— **关掉业务理解阶段**，数据采集开工<br>② `rework` 客户提了缺口 —— 修订数据需求 | 平台 `d-1.5`，kind **`signoff`**，`reworkTaskId: 1.5`。runtime 同名，`closes_stage: true` |
| 签收后有人要改 | 项目负责人 | 显式 `reopen d-1.5`；若要改的是树 → `reopen d-1.4`（会一并回退 1.4d / 1.5 / 1.5d） | gate-protocol 规则 4「签收的工作冻结」 |
| （回收侧，属 S2）某个 L3 的回文缺 L4 或缺指标 | 数据 Owner | 向客户追缺 | `slot.status = "incomplete"`；`manifest_satisfied` 要求 `validated == total` |

**签收关卡的呈现（runtime `signoff.md` 四段，与 gate-protocol 同构）：**

1. **在要什么** —— 多少个指标、多少个工作簿、什么颗粒度、什么期间、按哪些维度报。
2. **谁欠什么** —— 每张表的负责人。**这一段决定数据到底会不会来。**
3. **签收意味着承诺什么** —— 颗粒度就此对整个项目固定；不在这份需求里的因子不会进模型。
4. **还没解决的** —— 客户提出但没定的事。

`d-1.5` 是 S1 唯一的 `signoff` 类关卡，也是唯一用 `--who` 记录签收人的关卡。
按平台假设 A6：客户不登录平台，顾问在线下 Review 会拿到签收后代录，并附凭证。

---

## 与 runtime 现状的差异

| 平台定义 | runtime 现状 | 判定 | 建议 |
|---|---|---|---|
| 取 `status ∈ {baseline, accepted}` 的行 | 只取 `accepted` | **偏离（runtime 更严，且更对）** | **保留 runtime 做法。** 平台把 `baseline` 也发出去，等于把"人还没看过的模板行"当成确认过的需求。gate-protocol 规则 2 不允许中间态过关卡，`d-1.21` 之后不应再有 `baseline` 行——但如果有，它不该进客户的表 |
| 信息头四行 `Data Request` / `Time Coverage:` / `Granularity:` / `Brand Coverage:`，表头在第 6 行、示例行第 7 行起 | README sheet 用 `Data request` / `Time granularity` / `Period` / `Reported by`，格式不同 | **偏离（形态）** | **建议向平台靠**：`Time Coverage:` 是留给客户填的空格（实盘 12 张里 10 张空着），runtime 的 `Period` 是我们预填的——两者语义不同。建议两者都有：`Period (requested)` 预填 + `Time Coverage (actual)` 留空 |
| 一个 L3 一个文件，**文件名 = L3 标签** | 文件名 = `<L1-L2-L3 slug>`，截断 48 字符 | 偏离（更好） | 保留。带 L1/L2 前缀的文件名在一个目录里排序有意义，纯 L3 名会撞 |
| **sheet 名 = 原始 L4 标签**（≤31 字符），回收侧靠前缀匹配容忍截断 | `xlsx.safe_sheet_name(l4)` | **一致** | 保持。但必须**同时实现 `_match_score` 的四档打分**，尤其第 3 档（前缀匹配容忍 31 字符截断），否则收数时配不上 |
| 回收侧的 `DataRequestManifest` / `DataRequestSlot` / 四档匹配打分 | **完全没有** | **缺失** | 这一段属 S2，但**契约在这里定**：sheet 名怎么起、指标名怎么写，决定了回文能不能自动核对。建议在本卡定契约，实现放 `data-engine` |
| 列 = 时间 + 维度 + 指标 | 列 = 时间 + 维度 + 指标 + **`Source system`** + **`Notes`** | **多余（runtime 扩展，保留）** | 保留。`Source system` 是实盘"数据来源"列的收数侧落点；`Notes` 承接口径备注。两者都在 S2 有用 |
| **导出的工作簿里没有任何"定义"内容**（尽管 `how` 文案写了 "definitions"） | README 有完整定义表：`Factor row \| L4 \| Indicator \| Primary \| Definition \| Unit \| Owner` | **多余（runtime 补齐了平台的文档承诺）** | **保留，这是 runtime 胜过平台的地方。** 平台的 `blueprint.py` 逐字写了 *"granularity columns, definitions, example rows"*，但 `_write_sheet` 一个定义字段都没写 —— 见「备注 2」 |
| 主指标在前、备选加 `(alternate)` | 一致 | **一致** | — |
| 响应指标单独一表 | `00-response.xlsx` + `coverage_complete` 强制 | **多余（平台无）** | **保留。** 平台的 Y 走 `ProjectMeta.kpi` 旁路，从不出现在数据需求里 —— 那意味着**平台的数据需求根本没要因变量**。runtime 这条是实质性修正 |
| 示例行时间格固定 `"2023-01"` | `PERIOD_HINT` 按颗粒度给 `2024` / `2024-07` / `2024-W27` | **偏离（runtime 更好）** | 保留。写死 `2023-01` 在周度项目上会误导客户 |
| `Review & Sign-off` 表三行（Fields & granularity / Owners assigned / Client sign-off），静态不回写 | 无此表；签收只在 `decisions.log` | 偏离 | **保留 runtime 做法**——平台那张表是纯装饰（无任何回写）。但建议在 `coverage.md` 末尾加一段"签收状态"，由 `signoff` 模式在取到裁决后写一行（谁、何时、备注），让交付物自身可读 |
| 应用内预览封顶 12 张 sheet | 无封顶（直接出全部工作簿） | 偏离 | 无需对齐。平台的 12 张封顶是前端渲染的性能约束，runtime 出的是真文件 |
| `1.5b Export & send`（独立的导出分发任务） | 无 | 缺失（小） | 不必补任务。但 `signoff` 模式应在呈现里说清"签收之后要把工作簿发出去"，并记录发出时间 |
| 数据准入标准五项（完整性/准确性/颗粒度/波动性/一致性）作为因子树的列传递给收数 | 因子树没有这五个字段，数据需求也没带 | **缺失** | 见因子树卡。至少要把「颗粒度：daily/weekly/monthly，不接受 yearly」和「完整性：>2 年，理想 3 年」写进 README 的说明段——**这是客户唯一会读到验收标准的地方** |
| `data-request` 的 reads 白名单 | SKILL.md 含 `artifacts/s1/data-request/**`，**manifest 不含** | 偏离（runtime 内部不一致） | 对齐两处。`coverage` 模式确实要读自己的产物，manifest 应该给 |

---

## 备注

**1. 编号 1.23 在代码里不存在。**
`00-overview.md` §3 把 1.23 列为「数据准入标准及数据模板」，`01-business-agent.md` §3 Step 5
也用这个号。**现役代码的任务号是 `1.5`**（`registry.py`: `eng.register("1.5", business.gen_data_request)`），
关卡是 `1.5d` / `d-1.5`。runtime 的 manifest 已经用的是 1.5 / 1.5d，**与代码一致**。
本卡的出处栏保留 1.23 只是为了让人能顺着老文档找回来。

**2. 平台说有"定义"，代码里没有。**
`blueprint.py` 的 1.5 `how` 字段逐字：
*"AI lays out the data-request workbook (granularity columns, **definitions**, example rows)"*，
`data_request.py` 的 docstring 也提到定义。但 `_write_sheet` 从头到尾**没有写任何定义列或定义行**——
客户拿到的表里，一个指标叫什么就是它的全部说明。
runtime 的 README 定义表（`Factor row | L4 | Indicator | Primary | Definition | Unit | Owner`）
是把这个承诺兑现了。**这是 runtime 应当保持的领先，不是要拉齐的差异。**

**3. 签收记录的真实落点。**
平台的 `Review & Sign-off` sheet 三行 `pending` 是**渲染出来的字符串**，
没有任何代码往里写。`ProjectState` 里也没有数据需求签收字段
（对比 S2 的 `st.signoffs: dict[str, str]`——那才是持久化的签核记录）。
唯一持久的是 `d-1.5` 的 `DecisionRuntime.resolution`。
runtime 用 `decisions.log` 的 `signoff` 行承载，**机制上比平台更实**（append-only + 证据哈希）。
但 `coverage.md` 自身读不出"签没签"，建议补。

**4. 平台前端交互 → runtime 文本形态的降级。**

| 平台前端 | 承载的信息结构 | runtime 文本形态 |
|---|---|---|
| `Template Index` sheet 点进去看每张 L4 表 | 先总后分，可下钻 | `coverage.md` 的工作簿表 + 真实的 `.xlsx` 文件树。**runtime 更好**：文件就是文件，不用点 |
| `Review & Sign-off` 三行状态 | 三件事分别到没到位 | `coverage.md` 的三段：`## Accepted rows not requested`（字段完整性）· `## Rows the client cannot act on yet`（owner/unit）· 签收行（建议补）。**三件事一一对应** |
| `DataRequestChecklist` 面板（收数进度：待上传/待校验/已校验/缺指标/解析失败） | 每个 L3 槽位的状态 | 属 S2。`data-engine` 应输出同构的一张表：L3 \| 期望 L4 数 \| 期望指标数 \| 状态 \| 缺什么 |
| 一键导出 ZIP | 打包分发 | runtime 直接产出目录下的多个 `.xlsx`，人自己打包。信息结构不损失 |

**5. 这个交付物是阶段的闸门。**
`d-1.5` 带 `closes_stage: true`。它签收之后：
① 颗粒度对整个项目固定（改它要 `reopen d-1.0`，全链路回退）；
② 不在这份需求里的因子不会有数据，因而不会进模型；
③ 数据采集开工。
这三条后果**必须在关卡呈现的第 3 段逐条说出来**——这是 H 类步骤"要担责"的具体内容，
不是流程提示。

**6. 实盘里的脏东西。**
sheet 名 `Market dominace`（拼写）、`' Mkt Activation Buzz 【发出】'`（前导空格）、
表头 `'region '`（尾随空格）、`'Market\n(City/Province/National)'`（内嵌换行）、
`'Time Coverage: '` / `'Granularity: '` / `'Brand Coverage: '` 都带尾随空格。
代码里的 `put(2, 1, "Time Coverage: ")` **原样保留了尾随空格**——
如果 runtime 要与平台字节级对齐，这些空格得留着；如果不需要对齐，清掉并记一笔。
建议：**清掉，并在本卡记录这是一次有意的清洗**。客户看不见尾随空格，但 diff 会。
