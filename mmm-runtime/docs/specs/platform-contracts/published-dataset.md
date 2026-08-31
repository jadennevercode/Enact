# 契约卡：发布数据集

**阶段：** 数据
**平台出处：** 2.21 宽表数据集维度 · 2.22 数据处理（37 Task）· 2.23 数据字典 ODS→DW · 2.24 数据集与 ModelData
· `Assets/数据智能体知识库/模版化/2.21-宽表数据集维度.md`
· `Assets/数据智能体知识库/流程化/2.22-数据处理流程.md`
· `Assets/数据智能体知识库/模版化/2.23-数据字典.md`
· `Assets/数据智能体知识库/模版化/2.24-数据集与ModelData.md`
· `Assets/数据智能体知识库/机器可读/wide-table-schema.json`
· `Assets/数据智能体知识库/流程化/00-数据智能体流程总览.md`
· 代码：`backend/app/dataeng/{sources,profile,duck,preview,assets,indicators,validation_query}.py`、`backend/app/agents/{data,dataset_cache,reconcile}.py`
· 实盘：`reference/02.数据智能体/【MMM AI】数据智能体-Data Process_2.21&2.23.xlsm`、`Data Process_2.22.xlsx`、`Data Process_2.24.xlsx`、`Data Process Task Sample/task21.sql`

**产出 Skill：** `data-engine`

---

## 输入

| 来源 | 内容 | 类型 |
|---|---|---|
| 上游交付物 · 数据需求与验收 | 每个 L3 一册、每个 L4 一页的收数模板，含颗粒度列、定义、示例行；客户签收记录 | 交付物 |
| 上游交付物 · 因子树（经访谈回写） | L1–L4 路径 + 每个 L4 的指标声明 + 下钻维度 L5–L8 + 每行的定义与责任人 | 交付物 |
| 上游交付物 · 项目档案 | 锁定的时间颗粒度、模型颗粒度矩阵（品牌 × 渠道 × 省份组别）、响应指标 | 交付物 |
| 人提供的原料 | 客户交付的原始数据文件，按交付批次成folder（`inputs/data/<yyyy-mm-dd-label>/`），一批一目录 | internal 输入 |
| 人提供的原料 | 主数据对照表：Product / Geo / Channel / Time 四张，外加销售渠道、EC 渠道、产品组拆分、产品线、UPC、Social 品类、地域、Media 品类、省份城市等映射表 | internal 输入 |
| 声明（本交付物第 1 步产出，非上游） | 目标 schema 与枚举：列清单、类型、必填、闭/开枚举、粒度键 | internal 输入 |

**血缘要求（平台 05 §3.2）：** 每份产出带 `version + 产出它的步骤 + 所依赖的上游版本`。上游因子树改版后，本交付物自动标记"基于过期版本"，必须刷新才能继续。

---

## 构建过程

Class 说明：**M** 机械（确定性规则，零判断）· **A** 可自动（AI 生成、有 schema 可校验）· **C** 认知（需判断、无客观对错）· **H** 人专属（需担责）。

| # | 步骤 | Class | 执行者 | 说明 |
|---|---|---|---|---|
| 0 | **澄清** | C→H | Skill 提问，人回答 | 见下节。先读完 reads 白名单，再一次问完 |
| 1 | 声明目标 schema 与枚举 | H | 人（Skill 起草） | 产出 `metadata/schema/target-schema.yaml` + `metadata/schema/enums/*.yaml`。**必须在数据到达之前声明**——数据到齐后才写的 schema 不可能失败，不可能失败的检查是装饰。逐枚举决定 `closed`（越界值即违规、阻断发布）还是开放（新值上报评审）。渠道类型与指标角色一律闭；品牌、省份在名册明确前通常开放。`nullMeans: national` 是声明的一部分，不是缺失值 |
| 2 | 自检 schema | M | Tool `schema.check` | 每个 `enum:` 能解析到文件；每个粒度键是已声明列；粒度与项目档案锁定的颗粒度一致；`source` 列存在 |
| 3 | **Gate：口径锁定** | H | 人 | 见 Gate 表第 1 行 |
| 4 | 接收客户交付 | H | 人 | 文件落 `inputs/data/<批次>/`。**任何工具不得写入该目录**——工具写入即是在制造它待会儿要被检验的输入 |
| 5 | 抽取 | M | Tool `data.extract` | 每个 sheet / CSV 逐字落 parquet，不做任何清洗。SQL 不安全的标识符（中文 sheet 名）改名并上报改名结果；同名冲突加后缀；混合类型列降为 text |
| 6 | Profile | M | Tool `data.profile` | 每列输出：列名、dtype、空值率、distinct 数、是否 looksNumeric、min/max/mean、topValues。**这是模型唯一的 grounding**——模型看列画像，永远不看行 |
| 7 | 近似拼写聚类 | M | Tool `data.cluster-enum` | 对指定原始列提出近似重复拼写的合并建议，一律 `status: proposed`（惰性，不生效）。跨语言同义词（`现代渠道` vs `Modern Trade`）它找不到，那属于枚举声明里的 `aliases` |
| 8 | **起草清洗 SQL** | C | Skill（人可改） | 每个 asset 一条 `SELECT`/`WITH`，输出目标 schema 的列，落 `data/clean/<asset>/clean.sql`。这是本交付物**唯一属于模型的一步**，也是"这批交付是怎么被解读的"的书面记录。平台侧对应 2.23 数据字典里列级 ETL 逻辑的**五个封闭动词**（`Comments` 列）：`Hardcode`（常量，如 `'EC' AS 渠道类型`）/ `Direct`（原样取源列）/ `Mapping`（主数据表映射，如 `dim_md_channel_mapping`）/ `Transform`（如 `LEFT(Period,4)`、`if(Manufacture='DBC','KPI','Base')`）/ `Calculation`（如 PPI = 促销零售价合计 ÷ 原零售价合计、按比例拆分金额） |
| 9 | 沙箱执行 | M | Tool `data.clean` | 在 DuckDB 沙箱跑 `clean.sql`：只读、单语句、无文件与网络访问、有超时与行数上限。`{{enum:<枚举>:<原始列>}}` 令牌先展开成 CASE，来源是枚举声明的 `aliases` **加上**本 asset 已 accepted 的 `enum-map.yaml` 条目；其 `ELSE` **有意保留原值**，好让未声明值活着走到一致性检查那一步 |
| 10 | 一致性检查（形） | M | Tool `data.conform` | 见「打分与判定规则 · 一致性检查」 |
| 11 | 对账（量） | M | Tool `data.reconcile` | 见「打分与判定规则 · 对账不变量」 |
| 12 | **审查违规与未映射值** | C→H | Skill 呈现，人裁决 | 人审的是**违规与未映射值，不是行**。平台此处是交互式数据网格逐行审查，runtime 有意放弃（见备注） |
| 13 | 发布长表 | M | Tool `data.publish` | 把每个**已通过一致性检查**的 asset union 进 `data/published/long.parquet`，并写 `manifest.yaml` 记录每个来源实际贡献了什么。未通过的 asset 被拒收并点名。半成品资产不得进入长表 |
| 14 | 归属声明 | M | Tool `data.claim` | 把每个已发布指标挂到它供给的因子行上，写 `data/published/coverage.yaml`。**行身份 = L1–L4 路径 + 指标，绝不是路径本身**——一棵树在同一路径下常带多行（一个因子同时声明花费和门店数），只按路径查找会把指标绑到任意一个兄弟行上。报告三类：claimed / orphans（`treeRowId: ""`，树没要过的真实数据）/ unsupplied（树声明了、无人供给） |
| 15 | 登记数据字典 | A | Skill（人校对） | 每个 source sheet 一行，记录来源系统、物理位置、颗粒度、服务于哪个 L4、ETL 逻辑、时间范围、X/Y、目标 ODS 表名、归口部门、提供方。**runtime 现状缺失**，见差异表 |
| 16 | **Gate：发布** | H | 人 | 见 Gate 表第 3 行 |

**37 个 Task 怎么落进这 16 步：** 平台 2.22 的 37 个数据 Task 不是 37 个流程步骤，而是 **step 5–11 的 37 次迭代**——**一个 Task = runtime 里的一个 asset**。平台的 TaskLog（17 列：`优先级 | NO | TASKNAME | 数据来源 | 数据逻辑对接人 | 数据问题(till 1224) | 数据反馈 | 数据处理 | LOG | PROCESSING LOGIC（1225）| PROCESSING LOGIC（1230）| PROCESSING LOGIC（0104）| Source_Table | Task_Summary | 处理进度 | Owner | 备注`）在 runtime 里由 `data/clean/<asset>/asset.yaml` + `clean.sql` 的版本历史承载。

**37 个 Task 的实名清单**（源：`Data Process_2.22.xlsx` sheet `B1.TaskLog`；DW 表名源：`2.21&2.23.xlsm` 各 `TaskN` sheet）。优先级 1–4 是**排期装置**，runtime 无对应物，但"先做哪个 asset"沿用它是合理的。

| 优先级 | Task | 名称 | 来源 | DW 表 |
|---|---|---|---|---|
| 0 | Task0 | Market segmentation | — | 无（支撑分析） |
| 1 | Task5 | Media competitor spending | Manual-德勤 | `dw_task5_mkt_media_competitor_yyyymm` |
| 1 | Task16 | Media Mizone spending & impression | Manual-德勤 | `dw_task16_mkt_media_mizone_spending_yyyymm` |
| 1 | Task7 | Social buzz | Manual-德勤 | `dw_task7_ci_brand_social_yyyymm` |
| 1 | Task15 | Campaign social buzz | Manual-德勤 | **无字典页（唯一缺口）** |
| 1 | Task32 | Activation spending | Manual-德勤 | `dw_task32_activation_spending_yyyymm` |
| 1 | Task10 | Sell-out GT&MT | OSS | `dw_task10_sales_sellout_yyyymm` |
| 1 | Task22 | TTS National spending | OSS | `dw_task22_trade_marketing_anp_tts_yyyymm` |
| 1 | Task29 | ANP National spending | Manual-德勤 | `dw_task29_trade_anp_national_yyyymm` |
| 2 | Task1 | EC smartpath sales | Manual-德勤 | `dw_task1_ec_data_yyyymm` |
| 2 | Task3 | EC spending | Manual-德勤 | `dw_task3_marketing_spending_yyyymm` |
| 2 | Task4 | EC GMV | Manual-德勤 | `dw_task4_marketing_gmv_yyyymm` |
| 2 | Task8 | O2O Sales | Manual-OSS | `dw_task8_o2o_sales_tracking_data_yyyymm` |
| 2 | Task9 | O2O 投流 Spending | Manual-OSS | `dw_task9_o2o_spending_impression_click_yyyymm` |
| 2 | Task31 | O2O 消费者促销 spending | Manual-OSS | `dw_task31_o2o_Consumer_promotion_spending_yyyymm` |
| 3 | Task23 | Base-Nielsen offtake by province | Manual-德勤 | `dw_task23_sia_offtake_nielsen1_sales_province_yyyymm` |
| 3 | Task24 | Base-Nielsen offtake by channel | Manual-德勤 | `dw_task24_sia_offtake_nielsen2_sales_channel_yyyymm` |
| 3 | Task25 | Retail price | Manual-德勤 | `dw_task25_sia_retail_price_yyyymm` |
| 3 | Task26 | Store execution | Manual-德勤 | `dw_task26_sia_store_execution_yyyymm` |
| 3 | Task27 | BHT & MDS | Manual-德勤 | `dw_task27_sia_bht_yyyymm` |
| 3 | Task28 | Base-macro | Manual-德勤 | `dw_task28_sia_macroeconomics_yyyymm` |
| 3 | Task30 | IP/celebrity 花费 | Manual-德勤 | `dw_task30_anp_brand_equity_spending_yyyymm` |
| 3 | Task33 | BGM-share of TDP | Manual-德勤 | `dw_task33_sia_bgm_share_to_tdp_yyyymm` |
| 3 | Task34 | NAB ttl | Manual-德勤 | `dw_task34_sia_bgm_sales_val_vol_nab_yyyymm` |
| 3 | Task35 | NAB all channel ttl | Manual-德勤 | `dw_task35_sia_all_channel_nab_mizone_sales_val_yyyymm` |
| 3 | Task36 | Premise drink ttl | Manual-德勤 | `dw_task36_sia_on_premise_yyyymm` |
| 4 | Task2 | ANP UTC&车身 | Manual-德勤 | `dw_task2_trade_anp_yyyymm` |
| 4 | Task6 | ANP POSM spending | Manual-德勤 | `dw_task6_trade_posm_item_po_yyyymm` |
| 4 | Task11 | MI | OSS | `dw_task11_sales_execution_cust_mi_yyyymm` |
| 4 | Task12 | Bluesky | OSS | `dw_task12_sales_execution_bluesky_yyyymm` |
| 4 | Task13 | ANP 旺促（旺促/赛事/路演/试饮） | Manual-德勤 | `dw_task13_trade_tt_afh_promotion_executed_yyyymm` |
| 4 | Task14 | ANP 品显 | Manual-德勤 | `dw_task14_trade_tt_afh_prod_display_completed_yyyymm` |
| 4 | Task17 | ANP 陈列架 spending | Manual-德勤 | `dw_task17_trade_posm_rack_yyyymm` |
| 4 | Task18 | ANP 冰柜 | Manual-德勤 | `dw_task18_trade_cooler_yyyymm` |
| 4 | Task19 | ANP 社区团购 | Manual-德勤 | `dw_task19_trade_community_group_buying_yyyymm`（**唯一没有 Owner / 处理进度的 Task**） |
| 4 | Task20 | ANP MT spending | Manual-德勤 | `dw_task20_trade_mt_consumer_promotion_yyyymm` |
| 4 | Task21 | ANP 微信立减 | Manual-德勤 | `dw_task21_trade_wechat_discount_immediately_yyyymm` |
| — | Task37 | PPI | — | `dw_task37_ppi_promotional_offers_yyyymm`（**不在 TaskLog 里，是台账冻结后追加的**） |

**这份清单对 runtime 的用处**：它是"一次真实交付会拆成多少个 asset、每个 asset 大概是什么粒度的东西"的实测基线——37 个 asset、约 160 个 source sheet、约 2.4 万行长表。任何"一个 Excel 一个 asset"的假设都会低估一个数量级。

**平台 2.22 的 7 步流程与本卡的对应：** ①初步梳理逻辑=step 6→8 ②定义澄清&补充数据=step 0 澄清 + step 12 ③补充后重新梳理=step 8 重跑 ④by task 导出后检查（逻辑/字段/名称匹配、趋势是否缺失、判断源数据问题 vs mapping 问题）=step 10–12 ⑤逻辑更新后重新导出并 charting=下游「业务校验与签核」交付物 ⑥与源数据 cross-check（**平台要求两人互检**）=step 11 对账 ⑦寻找异常点原因=下游「业务校验与签核」。

---

## 澄清点

依宪法 §4.0：先读完 reads 白名单，只问"答案会改变产出"的问题，一次问完，答案登记留档。

1. **时间颗粒度与建模窗口的起止**（缺失类）
   读到：项目档案锁定了颗粒度，但交付文件的实际覆盖期常常更短。
   - A. 以项目档案的窗口为准，窗口外的行在清洗时截掉（推荐）—— 口径一致，但会有 asset 报"行被丢弃"，对账必须知道这是有意的
   - B. 以数据实际覆盖期为准，窗口反过来收缩 —— 数据一行不丢，但下游每个因子的可比区间不同

2. **闭枚举清单**（岔路类）
   读到：schema 默认把渠道类型与指标角色设为闭、品牌与省份设为开。
   - A. 照默认走（推荐）—— 渠道打错字会被挡住；品牌名册未定前不会误伤
   - B. 品牌/省份也闭 —— 需要客户先给出完整名册，否则第一批数据会大面积违规

3. **主数据对齐不上时的处置**（越界类）
   读到：平台规则是"对不齐就填 `NA`，绝不臆造"。
   - A. 照平台走，填空值并在一致性检查里作为未映射值上报（推荐）
   - B. 按最近似名称映射 —— 快，但把人的判断藏进了 SQL 里，下游无从复核

4. **对账的数值基准列**（缺失类）
   读到：`data.reconcile` 的数值校验需要指定原始表的数值列（`--raw-value`）；不指定则**数值校验静默跳过而报告仍写 `ok: true`**。
   - A. 每个 asset 都指定（推荐）—— 这是唯一能抓住"每列都合法但少了三分之一数据"的检查
   - B. 源表是多值宽表、没有单一数值列 —— 需要先约定按哪几列求和作为基准

5. **国家级（无渠道）行的处理**（越界类）
   读到：schema 声明 `channel_type` 为空即"全国"。
   - A. 空即全国，共享进每一个模型对象（推荐）—— 平台原生语义
   - B. 给它一个渠道 —— 这正是把全国级媒体从分渠道建模里整块删掉的原因，不建议

6. **未被因子树声明的指标（orphan）怎么办**（岔路类）
   读到：平台与 runtime 都要求"树没要过的指标照样发布，列在一旁由人裁决"。
   - A. 照走（推荐）—— 在清洗里丢掉它们等于藏起客户真实交付的数据
   - B. 清洗阶段就滤掉 —— 不采纳

---

## 产出格式

### 1) 目标 schema 契约 —— `metadata/schema/target-schema.yaml` [store]

```yaml
version: 2
grain:
  time: month
  keys: [brand, channel_type, province_group, l1, l2, l3, l4, metric, month]
columns:
  - name: channel_type
    label: 渠道类型
    kind: dimension            # dimension | time | factor | metric | value
    type: text                 # time→integer · value→number · 其余→text
    required: false
    enum: channel_type         # 仅 channel_type / metric_type / brand / province_group
    nullMeans: national        # 仅 channel_type：空 = 全国，不是缺失
    definition: "客户的一级渠道分类，用于模型对象拆分"
  - name: source
    label: 数据来源
    kind: dimension
    type: text
    required: true
    system: true               # 系统列，掉了会被自动补回
```

**19 列，顺序固定**（runtime `dataeng/columns.py:COLUMN_NAMES`）：
`task_name, brand, province_group, channel_type, channel, year, month, source, l1, l2, l3, l4, l5, l6, l7, l8, metric_type, metric, value`
**必填**：`brand, year, month, l1, l2, l3, l4, metric_type, metric, value`

**平台 2.21 长表的 21 列**（`wide-table-schema.json` · `wideTableColumns`）：
`数据源 | 品牌 | 品类 | 产品 | 省份组别 | 省份 | 渠道类型 | 渠道 | 年 | 月 | 数据类型Level1 | 数据类型Level2 | 数据类型Level3 | 数据类型Level4 | 数据类型Level5 | 数据类型Level6 | 数据类型Level7 | 数据类型Level8 | METRICS类型 | Unit | VALUE`

**平台 2.24 ModelData 的 22 列**（`modelDataColumns`）：
`TASKNAME | 品牌 | 省份组别 | 省份 | 渠道类型 | 渠道 | 年 | 月 | 数据源 | 数据类型Level1–Level8 | METRICS类型 | METRICS | VALUE | Variable no. | Metric no.`

列角色三段式：①模型颗粒度（品牌·品类·产品·省份组别·省份·渠道类型·渠道，由 Product/Geo/Channel 主数据清洗）②时间颗粒度（年·月，由 Time 主数据清洗）③因子映射（L1–L4 严格等于因子树，L5–L8 是该 L4 的下钻维度，无则 `NA`）。

**枚举文件** —— `metadata/schema/enums/<name>.yaml` [store]

```yaml
closed: true
values:
  - canonical: MT
    aliases: ["现代渠道", "Modern Trade", "商超"]
  - canonical: TT
    aliases: ["传统流通", "Traditional Trade"]
```

### 2) 列画像 —— `data/raw/<asset>/profile.json` [computed]

```json
{
  "asset": "ec-smartpath-sales",
  "tables": [{
    "name": "t",
    "rows": 24180,
    "columns": [
      {"name": "渠道", "dtype": "object", "nullPct": 0.0, "distinct": 7,
       "looksNumeric": false,
       "topValues": [{"value": "天猫", "rows": 6120}, {"value": "京东", "rows": 5880}]},
      {"name": "花费金额", "dtype": "float64", "nullPct": 0.012, "distinct": 23044,
       "looksNumeric": true, "min": 0.0, "max": 8842119.0, "mean": 41220.7}
    ]
  }]
}
```

`topValues` 只在 distinct ≤ 40 时给出（取前 12）；`looksNumeric` = 可转数字的比例 > 0.8。

### 3) 清洗配方 —— `data/clean/<asset>/clean.sql` [store]

```sql
SELECT
  '产品线A'                        AS brand,
  {{enum:channel_type:渠道}}       AS channel_type,
  ''                              AS channel,          -- 该源无二级渠道
  CAST(期间 / 100 AS INTEGER)      AS year,
  CAST(期间 AS INTEGER)            AS month,            -- yyyymm
  '消费者需求驱动'                  AS l1,
  '品牌广告/内容种草'                AS l2,
  '品牌传播'                        AS l3,
  'Digital Display'                AS l4,
  'NA' AS l5, 'NA' AS l6, 'NA' AS l7, 'NA' AS l8,
  'spending'                       AS metric_type,      -- Y | spending | X
  '花费'                            AS metric,
  CAST(花费金额 AS DOUBLE)          AS value,
  'media-spend'                    AS source
FROM t
WHERE 花费金额 IS NOT NULL
```

一条原始行携带多个指标时用 `UNION ALL` 逐指标 unpivot，**不得为了迁就源表去加宽目标 schema**。

### 4) 一致性检查报告 —— `data/clean/<asset>/conformance.json` [computed]

```json
{
  "ok": false,
  "checked": 19,
  "rows": 24180,
  "missingRequired": [],
  "extra": ["促销标记"],
  "enumViolations": [{"column": "channel_type", "values": ["O2O到家", "私域"]}],
  "unmappedValues": [{"column": "brand", "values": ["脉动经典", "脉动纤维＋"]}],
  "typeErrors": [{"column": "month", "declared": "integer", "rows": 12}],
  "duplicateGrainKeys": 0,
  "grainKeys": ["brand", "channel_type", "province_group", "l1", "l2", "l3", "l4", "metric", "month"],
  "unenforcedDimensions": ["province_group"]
}
```

违规清单每类**最多列 20 条**（`VIOLATION_CAP = 20`）。

### 5) 对账报告 —— `data/clean/<asset>/reconcile.json` [computed]

```json
{
  "ok": true,
  "rawRows": 8060,
  "cleanRows": 24180,
  "rowsDropped": 0,
  "rawSum": 332180114.0,
  "cleanSum": 332180114.0,
  "valueDriftPct": 0.0,
  "monthMin": 202210,
  "monthMax": 202510,
  "notes": [],
  "bySource": [
    {"source": "media-spend", "rows": 24180, "value": 332180114.0,
     "metrics": 3, "monthMin": 202210, "monthMax": 202510}
  ]
}
```

`cleanRows` 是 `rawRows` 的 3 倍是正常的——一行三指标的 unpivot。**行数不是不变量，数值合计才是。**

### 6) 发布清单 —— `data/published/manifest.yaml` [view]

```yaml
published:
  assets:
    - source: media-spend
      rows: 24180
      value: 332180114.0
      metrics: 3
      monthMin: 202210
      monthMax: 202510
  rows: 241800
  metrics: 60
  months: [202210, 202510]
```

### 7) 归属清单 —— `data/published/coverage.yaml` [store]

```yaml
records:
  - id: ind-media-spend-3f2a9c1b07
    treeRowId: f-0007                 # "" = orphan
    assetId: media-spend
    assetName: Media 花费明细
    metric: "花费"
    metricType: spending              # Y | spending | X
    l1: 消费者需求驱动
    l2: 品牌广告/内容种草
    l3: 品牌传播
    l4: Digital Display
    semanticType: currency
    unit: RMB                         # 平台 2.21 的 Unit：percentage / Unit / Volume K / RMB
    currency: CNY
    aggregation: sum
    numberFormat: "#,##0"
    ruleVersion: v2
    coverageStart: 202210
    coverageEnd: 202510
    rows: 37
    boundBy: auto                     # human | auto | ""
```

`id = ind-<asset>-<sha1(metric|metric_type|l1|l2|l3|l4)[:10]>`。

### 8) 数据字典（平台 2.23，runtime 缺失）—— 建议落 `metadata/data-dictionary.yaml` [store]

每行 = 一个 source sheet：

| Theme | SheetName | Source Sheet | 位置 | 来源系统 | granularity | 服务于哪一个 L4 factor | ETL 逻辑 | 时间范围 | Y or X | TableName | 归口部门 | 提供方 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ODS | EC Smartpath sales | ods_sales_..._gt_0112_年月 | database | 魔方 | monthly | 竞品渠道成交驱动变化 | 按照渠道和地域聚合 | 202210-202510 | X | ods_ec_data_yyyymm | EC | Cube |
| ODS | Macro 高铁客运量 | 手工表_macro_0104 | OSS://dan-cn-dbc-... | 手工数据 | monthly | 环境普适性因素 | Hardcode L1–L4 + 单位换算 | 202210-202510 | X | ods_macro_yyyymm | SIA | SIA |

**三层，`Theme` ∈ `{ODS, DW, DIM}`：**

| 层 | 含义 | 命名 | 例 |
|---|---|---|---|
| ODS | 一个源表一行，原始宽表，字段全是 String | `ods_<domain>_<subject>_<grain>`，grain 后缀 `_yyyymm` / `_yyyymmdd` / `_年` / `_年月` / 日期戳 | `ods_ec_data_yyyymm`、`ods_sia_macroeconomics_yyyymm`、`ods_trade_posm_item_po_yyyymm` |
| DW | 一个 Task 一张表，**已经是 2.21 的长表形状** | `dw_task<N>_<domain>_<subject>_yyyymm` | `dw_task1_ec_data_yyyymm` |
| DIM | 主数据 / 映射表 | `dim_<domain>_<subject>_mapping` | `dim_sales_channel_mapping`、`dim_md_product_category_mapping`、`dim_md_region_mapping`、`dim_md_province_city_mapping`、`dim_md_media_category_mapping`、`dim_ci_social_product_category_mapping`、`dim_o2o_upc_product_mapping` |

最终集成对象：`vw_all_dataset_model_data_yyyymm`（Theme=DW，Display Name = `Model Data`）= 各 DW Task 表的 `UNION ALL`。
**ODS→DW 契约一句话：** ODS 是逐源的原始宽表、无类型；DW 是逐 Task 的长表，由 Hardcode / Direct / Mapping / Transform / Calculation 逐列产生；视图是它们的并集。

来源系统二分：`魔方`（数据库直取）/ `手工数据`（OSS 上的线下表格）。每个源**必须**标注「服务于哪个 L4 因子」与「X / Y」。
附带三页：`List`（索引）、`Change Log`（日期/原因/版本/更改人/说明）、`数据表明细页`（4 行表头 `Table/View Name · Theme · Display Name · Table Description` + 列级网格 `Column Name / Display Name / Datatype / 是否为KEY / FK To / Source_table / Logic / Comments`）。

**列级 ETL 逻辑实例**（`Task1` 页，`dw_task1_ec_data_yyyymm`）：

| Column Name | Source_table | Logic | Comments |
|---|---|---|---|
| TASKNAME | | `'EC smartpath sales'` | Hardcode |
| 品牌 | `ods_ec_data_yyyymm` | `Manufacture` | Direct |
| 渠道 | `dim_md_channel_mapping` | `渠道下钻1` | Mapping |
| 年 | `ods_ec_data_yyyymm` | `LEFT(Period,4)` | Transform |
| 数据类型Level1 | `ods_ec_data_yyyymm` | `if(Manufacture='DBC','KPI','Base')` | Transform |
| VALUE | `ods_ec_data_yyyymm` | `Value` | Calculation |

**注意：`是否为KEY` 列在平台上从头到尾是空的**——平台没有声明过主键。粒度是事实上的，不是声明出来的。runtime 用 `grain.keys` 把它显式化，这是 runtime 相对平台的改进。

### 9) 长表样例行（平台 2.24 实盘）

```
NAB all channel | NAB | National | NA | NA | 2025 | 202507 | SIA - All Channel
  | Baseline Factor | External Factors | Industry Trend | NAB品类整体趋势
  | NAB All Channel Offtake Value | NA | NA | NA | value | sales value | 33827171917
```

```
Macro | NA | National | NA | NA | 2025 | 202508 | SIA
  | Baseline Factor | External Factors | Macro | 环境普适性因素
  | 高铁客运量 | NA | NA | NA | Traffic | 铁路客运量 | 504990000
```

Danone 实盘规模：约 2.4 万行，约 90 个 source sheet，37 个 Task。

---

## 打分与判定规则

本交付物没有 0/0.5/1 打分（那是「数据质量评分」的事）。它的判定全部是**布尔不变量**——每一条要么成立要么不成立，不成立就阻断发布。

### 一致性检查（`data.conform`）—— 问"形对不对"

| 检查 | 判据 | 阻断 |
|---|---|---|
| `missingRequired` | 必填列（`brand, year, month, l1, l2, l3, l4, metric_type, metric, value`）任一缺失 | 是 |
| `enumViolations` | 闭枚举出现未声明的值 | 是 |
| `typeErrors` | 值不符合声明类型（time→integer，value→number，其余→text） | 是 |
| `duplicateGrainKeys` | 粒度键组合重复 > 0 —— 意味着 join 扇出，**每列都合法但数值翻倍** | 是 |
| `unmappedValues` | 开放枚举出现新值 | 否，上报评审 |
| `extra` | 目标 schema 之外的列 | 否，上报 |
| `unenforcedDimensions` | 声明为 dimension 但没有闭枚举约束的列 | 否，提示 |

`ok = 无 missingRequired ∧ 无 enumViolations ∧ 无 typeErrors ∧ duplicateGrainKeys == 0`。
**`ok: false` 即禁止发布。**"大部分对了，剩下的开个 ticket" 不是本交付物接受的状态。

### 对账不变量（`data.reconcile`）—— 问"量对不对"

| 不变量 | 判据 | 说明 |
|---|---|---|
| 数值合计 | `abs(cleanSum - rawSum) / abs(rawSum) <= TOLERANCE`，`TOLERANCE = 1e-4` | **最重要的一条**。它是唯一能抓住"一个多余的 `WHERE` 丢掉三分之一数据、而每一列依然完全合法"的检查 |
| 行数 | `rowsDropped` 记录并解释 | 行数变化**不是**失败条件——unpivot 会成倍放大行数。行数只在"没有 unpivot 却掉了行"时是信号 |
| 时间跨度 | `monthMin` / `monthMax` 与原始表一致 | 抓截断：一个 CAST 失败会把 2022 年整年变成 NULL 然后被过滤掉 |
| 分来源明细 | `bySource[]` 每个来源的行数/数值/指标数/月份区间 | 多源 union 时，是哪个源出的问题一眼可见 |

**已知陷阱（必须在 runtime 修）：** 不传 `--raw-value` 时数值校验**静默跳过**，而报告仍然写 `ok: true`。这让最重要的一条不变量变成可选的。

### 平台的时间与方差不变量（dbt generic tests）—— **runtime 完全没有**

平台在 `dataeng/dbt/workspace.py::_MMM_GENERIC_TESTS` 里挂了四条通用测试，每个 mart 建成时自动跑，**返回任何一行即视为失败、阻断发布**。这是平台的一道 runtime 缺失的确定性闸门，值得整条搬过来：

| 测试 | 挂在哪 | 参数 | 判据（返回行=失败） |
|---|---|---|---|
| `time_span_min_years` | `period_date` | `min_years = 2` | `min(dt)` 为空，或 `date_diff('month', min, max) + 1 < 24`。**建模最少要 24 个月** |
| `time_granularity_allowed` | `period_date` | `max_gap_days = 45` | 相邻不同日期的**间隔中位数 > 45 天**，或没有可比日期。这条挡的是季度/年度数据 |
| `has_variation` | `value` | `min_cv = 0` | `count(distinct value) <= 1`，或 `stddev_pop(value)` 为空或为 0（可选：`stddev/|mean| < min_cv`）。**一条常数序列解释不了任何 KPI 波动** |
| `yoy_comparable` | `period_date` | `tolerance = 0.5` | 年数 ≥ 2 且 `min(每年的期数) < 0.5 × max(每年的期数)`。**抓的是"某一年只收了三个月"** |
| `not_null` | `value` | — | 值为空 |
| `accepted_values` | 每个带 `standard_values` 的列 | — | 出现枚举外的值（= runtime 的闭枚举违规） |

runtime 现在只有 `accepted_values`（闭枚举）与隐式的 `not_null`（必填列）。**前四条一条都没有**，而它们全部是确定性的、可以直接实现的。

### 沙箱安全边界（平台 `dataeng/duck.py`，runtime `dataeng/duck.py` 同源）

平台的注释写得很直白："这是唯一执行 AI 撰写 SQL 的地方，按安全关键对待。"三层：

1. **无外部访问**：`SET enable_external_access=false`；`SET lock_configuration=true`（老引擎上尽力而为）
2. **语句白名单**：只允许以 `select` / `with` 开头；单语句（先把字符串字面量涂白再查 `;`，好让 `sales copy.xlsx` 这样的文件名不误伤）；禁用词按**词边界**匹配：
   `attach detach copy install load pragma set insert update delete drop alter create truncate export import call vacuum checkpoint read_csv read_parquet read_json read_text read_blob parquet_scan csv_scan glob sniff_csv httpfs system( shell getenv putenv`
3. **资源上限**：预览 50 行（`PREVIEW_ROWS`）、清洗输出硬上限 50 万行（`MAX_OUTPUT_ROWS`）、超时 20 秒（`DEFAULT_TIMEOUT_S`），看门狗线程到点调 `con.interrupt()`

用户 SQL 里禁用 `create`，但引擎自己用它包一层（`CREATE TEMP TABLE __clean_out AS (…)`）——所以"永不写入"是结构保证，不是约定。
标识符清洗 `sanitize_ident`：非字母数字下划线→`_`，去首尾 `_`，转小写，空则 `t`，数字开头补 `t_`，**截断到 48 字符**。
错误一律不抛给调用方：安全错误 / 超时（`查询超过 20 秒`）/ SQL 错误各自变成 `ok:false` + 一句可读的 error，`finally` 一定关连接。

**平台还有一条 runtime 没有的性质：预览 ≡ 构建。** 预览 SQL 与正式构建走同一套编译路径，所以"预览显示不出构建产生不了的形状"。平台用一个测试逐格断言两者相等。

**AI 起草的 SQL 在入库之前先被验证**：平台 `service.suggest_sql` 会拿草稿跑一次 `limit 1` 的预览，跑不通就返回**空字符串**加一句"生成的 SQL 跑不起来"。理由写在测试里：一个存下未验证模型输出的步骤，会在下一次预览时把它跑起来。

### 发布判定（`data.publish` + `data.claim`）

**平台对"已发布"的定义是五条同时成立**（`dbt/service.py::publish`）：
① `dbt build`（seed + run + test）全绿——每条通用测试通过、没有节点报错；② 存在一个 `marts` 层模型且**是本次构建出来的**；③ schema 一致性通过（无缺必填列、无枚举违规）；④ mart 非空；⑤ 行落成带版本号的 parquet，且其指标完成了因子行归属。
版本号按 asset 单调递增（`latest_version + 1`），路径 `data/projects/<pid>/assets/<aid>/v<n>.parquet`，**只追加、重发布不删旧版**。

| 判据 | 说明 |
|---|---|
| `long_table_present` | 长表存在且非空 |
| `response_present` | 长表里存在 `metric_type = Y` 的行。**最常被漏掉的一条**——收数模板有意不带 KPI（Y 是被解释的对象，不是要收的因子），一批纯驱动因子的交付能通过其他所有检查然后什么都拟合不出来 |
| `coverage_claimed` | 每个已发布指标都完成了归属判定（claimed / orphan 二选一） |
| `computed_by_tool:data/published/long.parquet` | 长表来自一次有记录的工具运行，不是模型写的 |
| 未通过一致性检查的 asset | 被 `data.publish` 拒收并点名 |

### 空即是发现

一条返回零行的配方、一份解析后什么都没有的交付、一个整列全空的字段——都要写下来。**看起来像成功的空结果，比失败更糟，因为里面没有任何可以反对的东西。**

---

## Gate

| 触发条件 | 判定者 | 候选处置 | 路由 |
|---|---|---|---|
| 目标 schema 与枚举起草完成（发布前，数据到达前） | 人（口径拍板） | ① 采纳并锁定 ② 改某个枚举的闭/开 ③ 改粒度键 ④ 退回重拟 | ①→ 进入接收交付；②③→ 改后重跑 `schema.check`；④→ 回第 1 步。平台对应 G2.22「处理逻辑确认」的前置 |
| 客户交付到位 | 人（收货确认） | ① 确认齐了 ② 缺件，列出缺什么并回上游追数 | ①→ 抽取；②→ 回「数据需求与验收」交付物追交付；平台路由「数据 Owner → 客户沟通表」 |
| 一致性检查有闭枚举违规 / 类型错 / 粒度键重复 | 人（数据 Owner）+ 第二人互检 | ① 该值是已声明值的同义词 → 加进 `aliases` ② 是没人声明过的真实类别 → 加一个新 canonical ③ 是源里的错别字 → 加 `enum-map.yaml` 条目并置 `accepted` ④ 这个枚举本就不该闭 → 改 `closed: false`（**并说明为什么**）⑤ 配方错了 → 改 SQL 重跑 | 任一处置后必须重跑 清洗→一致性检查→对账。平台 G2.22 明确要求 **两人互检 cross-check** |
| 对账数值漂移超容差 / 时间跨度被截断 | 人（数据 Owner） | ① 是有意的窗口裁剪 → 登记原因 ② 是配方 bug → 改 SQL ③ 是源数据本身的问题 → 回客户沟通表 | ②→ 重跑；③→ 平台路由「数据 Owner → 客户沟通表」，紧急度中 |
| 年度大数 YoY 增长率 > 30% / 月度异常值 | 人（数据 Owner） | ① 真实业务波动，登记说明 ② 口径变化，登记并进入下游质量评分的口径一致性判据 ③ 数据错误，回源 | 平台 G2.22 的三道必问题之一；②会直接影响「数据质量评分」的 caliber 判据 |
| 发布长表 | 人（发布拍板） | ① 发布 ② 先补齐某个 asset 再发 ③ 退回 | ①→ 下游「因子映射」；②→ 回 step 8；③→ 回 step 1。**注意 orphan 不在本 gate 裁决**，它由因子树的 apply-proposals 采纳或驳回 |

**Gate 呈现形态（宪法 §4.1 话术规范 + D6）：** 候选 + 推荐 + 每项后果 + 证据路径。禁止开放式填空。

---

## 与 runtime 现状的差异

| 平台定义 | runtime 现状 | 判定 | 建议 |
|---|---|---|---|
| 2.21 长表 21 列，含 `品类`、`产品`、`Unit` | 19 列（`task_name, brand, province_group, channel_type, channel, year, month, source, l1..l8, metric_type, metric, value`），**无 `unit` 列**，无 `品类`/`产品` | 偏离 | `unit` 必须补进长表。现在 unit 只存在于 `coverage.yaml` 的归属记录上，于是两个单位不同的 asset 可以被直接相加而没有任何东西能拦住——而这正是平台「维度一致性」要抓的事。`品类`/`产品` 可按项目档案的模型颗粒度矩阵决定是否启用 |
| 2.24 ModelData 含 `TASKNAME`、`Variable no.`、`Metric no.` | 有 `task_name`；`Variable no.`/`Metric no.` 在 runtime 的「模型输入」交付物里才出现 | 一致 | 保持——这两个编号本来就是 2.35 的产物 |
| 2.23 数据字典（ODS→DW 血缘 + 列级 ETL 逻辑 + Change Log） | **完全缺失**。`knowledge/methodology/workflow.json` 里有 2.23 这一步，但 runtime 没有对应的任务、工具、产出物或检查项。全仓 grep `dictionary\|lineage\|数据字典` 只命中那一行 JSON | **缺失** | 补一份 `metadata/data-dictionary.yaml`（字段见「产出格式」第 8 节），由 step 15 生成、人校对。它是数据血缘与可复现的唯一事实源；没有它，三个月后没人能回答"这个数是怎么算出来的" |
| 主数据表（Product / Geo / Channel / Time）负责把异构源名称清洗成统一维度 | 无主数据层。`brand` / `province_group` 只是开放枚举，由 `data.conform` 检查；`schema.check` 把"未约束的维度"当成非错误打印出来 | 缺失 | 至少补 Geo 与 Channel 两张对照表并要求闭枚举；否则 `unenforcedDimensions` 是个没人看的提示 |
| 2.22 TaskLog：优先级、对接人、多轮 PROCESSING LOGIC 按日期迭代、处理进度、Owner | `data/clean/<asset>/asset.yaml` 有名称/来源/状态/备注；多轮逻辑迭代靠 `clean.sql` 的文件历史 | 偏离（可接受） | 保持。runtime 是单人/单会话工作流，不需要甘特与排期。但**"数据逻辑对接人"和"多轮 LOG"值得进 `asset.yaml`**——它是"这个口径当初是谁拍的"的唯一线索 |
| 2.22 步骤 6：与源数据 cross-check **需两人互检** | 无双人机制 | 缺失（有意） | 在 gate 呈现里明确写出"这一条平台要求两人互检"，由人决定是否找第二个人。工具无法强制 |
| 对账：数值合计不变量 | `data.reconcile` 有 `rawSum` / `cleanSum` / `valueDriftPct`，容差 1e-4 | 一致 | — |
| 对账：不传 `--raw-value` 则数值校验跳过但仍报 `ok: true` | 现状如此 | **偏离（缺陷）** | 改成：未做数值校验时 `ok` 不得为 `true`，或增加 `valueChecked: false` 字段并让 `reconciles_with_raw` 判定它。一个可以静默不跑的不变量不是不变量 |
| 发布后的整体对账（长表合计 vs 各 asset 合计之和） | **没有**。`data.reconcile` 只在单 asset 的 `result.parquet` vs 它自己的 raw 之间跑；`data.publish` 写了 `manifest.yaml` 但没有任何检查项把它和各 asset 的对账报告比对 | 缺失 | 补一条发布后不变量：`长表行数 = Σ 各 asset cleanRows`、`长表数值合计 = Σ 各 asset cleanSum`。union 少了一个 asset 是最容易发生、也最难发现的错 |
| 跨源对账（asset A 的花费 vs asset B 的同一 L4 花费） | 没有 | 缺失 | 归入下游「数据质量评分」的"维度一致性/业务准确性"，此处只需在数据字典里把"服务于同一 L4 的多个源"标出来 |
| `manifest.yaml` 的 `months` 字段 | 写的是 `sorted(...)[:2]`，即**两个最小的月份**，不是 min/max | **偏离（缺陷）** | 改成 `[min, max]`。现在这个字段在多月数据上是错的 |
| `artifacts/s2/data-engine.md`（视图） | 出现在 `shared/workspace-layout.md`，但不在任何 manifest 的 `produces` 里，也没有任何 skill 写它 | 多余/悬空 | 要么让 `publish` 模式产出它（发布摘要 + 对账表 + orphan 清单），要么从 layout 删掉 |
| orphan 的处置记录 | `dataeng/orphans.py` 有 `adopt` / `dismiss` 两个 Python 函数，但**没有 CLI 工具**；skill 让用户去跑 `/mmm:factor-tree apply-proposals`，而磁盘上没有任何东西记录一个 orphan 最后是被采纳还是被驳回；`coverage_claimed` 明确允许带着未处置的 orphan 通过 | 缺失 | 补 orphan 处置的落盘记录（可并入 `coverage.yaml` 的 `records[].disposition`），并让发布 gate 呈现"还有 N 个 orphan 未处置" |
| 清洗 SQL 的预检 | 只能靠执行来发现错误；`{{enum:...}}` 令牌没有 lint | 缺失（低优先） | 可加一条 `data.lint-sql`：检查令牌语法、检查 SELECT 的输出列是否覆盖必填列。省一轮沙箱执行 |
| Schema 在数据到达前声明 | 一致（2.0s 先于 2.0a） | 一致 | 这是 runtime 相对平台的**改进**，平台的 schema 是随 TaskLog 逐步长出来的 |
| 模型只读 profile 不读行 | 一致 | 一致 | 这是 runtime 相对平台的**改进**，也是 grounding 预算的基础 |
| 粒度键（主键）显式声明 | `target-schema.yaml` 的 `grain.keys` + `duplicateGrainKeys` 检查 | **一致（runtime 更好）** | 平台字典页有 `是否为KEY` 列但从头到尾空着，粒度只是事实上的。保持 runtime 做法 |
| 四条时间/方差不变量（`time_span_min_years=2` · `time_granularity_allowed max_gap_days=45` · `has_variation` · `yoy_comparable tolerance=0.5`） | **一条都没有** | **缺失（高优先）** | 全部补进 `data.conform` 或新增 `data.invariants`。四条都是纯 SQL、确定性、可测。尤其 `has_variation`——一条常数序列现在能一路走到统计检验才被 CV 挡下，白跑三层 |
| `not_null` on `value` | 有（value 必填） | 一致 | — |
| AI 起草的 SQL 先跑 `limit 1` 验证再入库 | 无预检，直接执行 | 缺失（中） | 补 `data.dryrun`：`limit 1` 跑通才写 `clean.sql`。省一轮沙箱往返，也避免半成品配方留在磁盘上 |
| 预览 ≡ 构建（同一编译路径，逐格断言相等） | runtime 的 `preview.md` 是结果表的 head，与 `data.clean` 同源，天然一致 | 一致 | — |
| 沙箱：`enable_external_access=false` · 单语句 · 禁用词表 · 50 万行上限 · 20 秒超时 · 字面量涂白 | 同源实现 | 一致 | 核对一次禁用词表是否随平台更新过 |
| 长表 union 去重 | 平台 `binding.published_long_table` **不去重**，重复发布重叠 asset 会静默重复计数 | runtime 同样不去重 | **缺失（高优先）** | 发布时按粒度键去重或直接报重复。这是平台已知会静默出错的地方，没有理由继承 |
| 可建模性下限（`_MIN_ROWS=12` · `_MIN_MONTHS=6` · `month` 可读比例 ≥ 50%） | runtime 无此闸 | 缺失 | 补进发布判定。平台把它放在绑定环节，理由是"12 行的表拟合不出任何东西，早说比晚说好" |
| 分类学充分性（无 `channel_type` → 无模型对象；无 Y → 无响应；无 X → 无驱动） | runtime 有 `response_present`，无另外两条 | 部分缺失 | 补 `objects_present`（至少一个非空 `channel_type` 或明确声明全国单对象）与 `drivers_present` |
| `Data Process_2.24.xlsx` 实际导出 19 列（无 `省份`、无 `Variable no.` / `Metric no.`），与 2.21 的 21 列、`modelDataColumns` 的 22 列**三份都不一样** | runtime 19 列，与**实际导出文件**一致 | 一致（对齐了正确的那一份） | 保持。在备注里记清楚三份列表不一致，避免下次有人照文档去改 schema |

---

## 备注

**1. 交互式数据网格的替代方案（有意放弃登记）。**
平台在 2.22 的 step 4「by task 导出数据后检查」用的是 TanStack 数据网格：人逐行看清洗结果，逐行标"已check"。runtime 有意放弃它，替换为**「审查违规与未映射值」**。文本形态这样承载：

- 网格承载的是**行的可见性**；文本承载的是**违规的可枚举性**。二者的信息结构不同但覆盖同一件事：一条清洗规则错了，要么表现为某列的枚举违规、要么表现为类型错、要么表现为粒度键重复、要么表现为对账数值漂移。这四类都是有限、可列举、可逐条裁决的。
- 因此审查界面是四段文本：① 每个 asset 一行"合规/不合规、对账/不对账" ② 闭枚举违规**全量列出值**（不截断——被截断的第 21 个违规值就是没人看见的那个）③ 开放枚举首次出现的值（这是评审不是失败）④ 对账的数字。
- 网格能做而文本做不到的一件事：**看到一行具体的数据长什么样**。runtime 用 `data/clean/<asset>/preview.md`（结果表的 head + profile）补上，但它是**只读展示**，不是逐行裁决的入口。逐行裁决在 runtime 里被明确取消——2.4 万行没有任何人真的逐行看过，网格给的是"看过了"的错觉。
- 这条应登记进 `docs/specs/deliberate-omissions.md`：**平台有什么** = 交互式数据网格逐行审查；**为什么不要** = 逐行审查在 2.4 万行规模上是无法执行的仪式，且它掩盖了"违规是可枚举的"这个事实；**什么条件下重审** = 当出现一类既不表现为枚举违规、也不表现为类型/粒度/对账异常的清洗错误时。

**2. 平台文档与代码/实盘不一致处（文档与实现冲突时以实现为准）。**

- **"宽表"有四份互不相同的列清单**：
  ① KB `2.21-宽表数据集维度.md` / `wide-table-schema.json` 的 `wideTableColumns` = **21 列**（有 `品类`、`产品`、`Unit`，无 `TASKNAME`、无 `METRICS`）；
  ② `wide-table-schema.json` 的 `modelDataColumns` = **22 列**（有 `TASKNAME`、`METRICS`、`Variable no.`、`Metric no.`，无 `品类`/`产品`/`Unit`）；
  ③ 实际导出的 `Data Process_2.24.xlsx` = **19 列**（连 `省份`、`Variable no.`、`Metric no.` 都没有）；
  ④ 2.22 工作簿的 `Z1.DataStation Frame`（每个 TaskN 页真正使用的排版框架）= **27 列**（多出 `产品线`、`大区`、`数据源方`、`数据分类`，且 `数据类型Level8` 重复出现一次）。
  平台代码 `ingest/dataset.py` 以 ③ 为准，并且**列数不等于 19 就直接报错**。runtime 的 19 列与 ③ 一致，这是对的。谁想照 ①② 去加列，先看这条。
- `Task1` 的 DW 字典页声明了一个 **`数据类型Level9`**，全平台其他任何地方都不存在。忽略。
- 平台命名约定自己也破了：`ods_trade_陈列架数量`（标识符里有中文）、`ANP_spending_UTC&车身` 页被标成 `Theme=DIM` 却指向一张 `ods_` 表。说明"命名约定"在平台上是惯例不是检查——runtime 如果要立这条约定，就得配一个检查。
- `Task15` 有 Task 无字典页（37 个 Task 只有 36 张 DW 表）；`Task37` 有字典页但不在 TaskLog 里。**台账与字典不是同一份真值**，这正是 runtime 用 manifest + 检查项取代双份台账的理由。
- `task21.sql` 的实盘写法值得照抄的一点：金额按比例拆分时**拆分比例之和恒等于 1**（`mp_rate + ma_rate = 1`），于是 `拆分后合计 == 拆分前合计` 是构造性成立的，不需要额外对账。任何"按比例分摊"的清洗逻辑都应该这样写。

**2b. 平台自己也没有"源合计对账"。**
2.22 第 6 步 `跟源数据 cross-check，需要两个人去互相检查` **没有任何代码实现**。平台有的是：dbt 通用测试（时间/方差/枚举）、schema 一致性、2.1→2.2→2.4 的**人口对账**（`reconcile.py`，解释为什么 177 行因子树在 2.2 变成 85 组、在 2.4 变成 29 个，见「因子映射」卡）、以及 2.1 产出物里的「按来源分列的入库行数」页（加这一页的理由原文：*"一个你以为会落 1.2 万行的源只落了 12 行，这种事整体行数完全看不出来"*）。
**runtime 的 `data.reconcile` 数值合计对账是相对平台的净增功能。** 不要因为"平台没有"就削弱它——恰恰相反，平台缺它才是它存在的理由。

**3. 本交付物**不产出任何 0/0.5/1 分值。所有平台文档里出现在 2.2 段落的"打分"字样都属于 2.11/2.12，即下游的「数据质量评分」交付物。混淆这两者会导致在数据还没发布时就去打质量分——而质量分的每一个判据都需要已发布的长表。

**4. 命名。** runtime 的 `data-engine` skill 名与本交付物名「发布数据集」不同名。按宪法 A5 一物一 skill，这是可以的（skill 名描述动作，交付物名描述产物），但契约卡、`deliverables.yaml` 与 gate 呈现里一律用交付物名。
