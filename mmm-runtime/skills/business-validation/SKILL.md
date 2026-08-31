---
name: business-validation
description: 一个因子路径一张卡，把这个因子的指标画在销量上给客户看——他可以当场换粒度、换渠道、往下钻、换指标。响应变量按渠道的年度同比超过 ±40% 的那几段逐条解释并定下它在模型里怎么处理，最后请客户过目，把他明确否掉的指标记下来。用于"把因子画出来""这看着像你们的生意吗""2025 年为什么掉这么多""这个异常怎么解释""客户过目了"这类请求。产出「业务校验与签核」这一份交付物；客户在这里否掉的指标，后面每一层都不再用。
---

# 业务校验与签核

**这个 Skill 只产出这一份交付物。** 它是唯一一层由懂生意的人、而不是统计量来否决因子的关卡：
质量层说这条序列是完好的，统计层会说它动得有没有用，只有客户能说 2025 年那一跌是平台砍了合作不是媒体。

**开始前：** 读 `../../shared/conventions.md` 定位工作区，确认数据质量评分已确认。
数据阶段的工具从统一入口进：`~/.local/bin/mmm tool <id> …`。

## 一个因子路径一张卡

页面的组织方式是**一张卡对应长表里真实存在的一个 `L1›L2›L3` 组合**。因子树声明了要什么，
这里只画数据真的到位的因子。完整路径是唯一键：同名的 L3 挂在两个不同的父节点下，是两张卡，
不合并。

每张卡上，**销量是背景板，这个因子的指标叠在上面**：

| 序列 | 图形 | 轴 |
|---|---|---|
| 响应（销量） | 填充面积，青色 | **右轴** |
| 花费类 | 折线 | **左轴** |
| 其余一切 | 柱状 | **左轴** |

销量在右、驱动在左，是因为两者单位根本不同，不能共用一条刻度；而图上大多数序列是驱动，
所以把默认先读的那条轴留给它们。**这是定过的决定，不重新讨论。**

## 第 0 步 · 澄清（先读完再问）

先读完取材范围内的全部输入。**已经写在里面的不许问。** 详见 `references/clarify.md`。

| 澄清点 | 什么时候必须问 | 推荐项 |
|---|---|---|
| 响应变量在长表里标出来了吗 | **每次必看**。没有就停下，不许兜底求和 | 数据处理那一步标了 KPI 角色的那条 |
| 有指标的汇总口径不是因子树定的 | 每次都要看一眼 | 回因子树补上；补不了就把推断的逐个报出来让人确认 |
| 每个异常算真实业务还是数据错误 | 逐条问，三选一 | 无默认，AI 只能提名 |
| 客户没提到的指标怎么算 | 每次说一遍 | 按认可算；只记他明确否掉的 |

答案写进 `signoffs.yaml` 的假设登记。问不到人按推荐项走，标 `assumed: true` 加理由。

## 构建步骤

| # | 步骤 | 类型 | 做什么 | 详细 |
|---|---|---|---|---|
| 1 | `page` | M | 跑 `validation.panel` + `validation.facts` + `validation.analyses` | `references/charts.md` |
| 2 | `page` | C | 逐卡填 `chart-analyses.yaml`——**结构固定、条数有上下限**，只把算好的数改写成业务语言 | `references/charts.md` |
| 3 | `page` | M | 出图册：`~/.local/bin/mmm app charts book --workspace <工作区>` | `references/charts.md` |
| 4 | `anomalies` | M | 跑 `validation.anomalies` | `references/anomalies.md` |
| 5 | `anomalies` | C | 每个异常一张假设卡：假设 + 依据 + 代价 + 提名处置 | `references/anomalies.md` |
| 6 | `signoff` | H | 客户过目；逐条裁定异常；记下他否掉的指标 | `references/signoff.md` |
| 7 | — | — | 告诉编排层：业务校验与签核已写好，请验收 `business-validation/signoff` | — |

## 硬规矩

**每个数都来自一次真实的工具运行。** 解读只许引 `validation-facts.json` 与
`chart-analyses.json` 里已经算好的数。**逐字照抄：不四舍五入、不换单位、不心算、不重算。**
想要的数不在结果里，要么该由工具产出（说出来然后停下），要么它就不是这份交付物能给的数。

**解读是一张受校验的表，不是一篇文章。** 结构定死：一句话结论 + `trends`（2–4 条）+
`anomalies` / `inflections` / `caveats`（各 ≤6 条）。引的每个期间必须真实存在于那张卡。
写的时候是哪批数，靠 `seriesDigest` 记着——数动过之后那一段会被判为过期并退回计算读数。

**没写解读的卡不是错。** 每张卡都预填了一份计算读数，页面上写明它是计算读数。
与其编一段，不如让它显示读数——一份刻意平实的东西，不会被误当成谁的判断。

**没有响应变量就停下。** 长表里一行 `metric_type == "Y"` 都没有时，`validation.panel` 会判失败
并让你回数据处理那一步标 KPI 角色。**不许把全表指标（花费、温度、比率、指数）求和当 Y**——
那是平台踩过的坑：任何非参考项目走的都是这条错路。

**每个指标按它自己的口径汇总，而口径来自因子树。** `artifacts/s1/factor-tree.yaml` 的
`rows[].aggregation` 是整条链路上**唯一由人定、且过了确认门**的那一份。指标登记表
`data/published/coverage.yaml` 排第二——它看起来更靠近数据，但那一列是按指标名字猜出来
再存下来的，存过一遍的猜测还是猜测。两边都没有才按名字现场推断，而推断这件事会印在页面上。
**一条被加起来的摄氏度和一条被加起来的花费，在图上长得一模一样。**

归约只会四件事：求和、取平均、取最小、取最大。因子树允许人定加权平均这类做不了的口径，
**替换在工具里完成并写在页面上**，页面自己不做任何重新解释。

**图形是定死的：** 响应 → 面积（右轴）；花费 → 折线（左轴）；其余 → 柱状（左轴）。
同一份数据换个形状就成了两个发现。

**页面自己会算，但它算的东西被验证过两次。** 生成页面前 node 会把页面内联的归约拿去重放
几百个筛选态，和工具算的逐位比对，对不上就不写这一页；页面打开时它再自查一遍，对不上
就一张图都不画。口径写在 `../../shared/fold-contract.md`。

**处置必须真的咬合到拟合。** `event` 在窗口加一列 0/1 控制项；`cap` 在窗口内把响应缩尾；
`raw` 只带一句说明。**只有 `status: accepted` 的卡片才生效**——停在 `pending` 的一律什么都不做。
这正是这套设计取代的那个 bug：一个存下来却没人读的选择。

**客户没提到的按认可算。** 这一关只记他明确否掉的指标。图册上有几十条指标，逼客户逐条表态，
换来的是一屏被批量点成"是"的按钮，而"有人真的看过"和"没人反对"之间唯一的区别信号就此消失。
所以要求这次会评本身有人、有时间——否则那两件事会是同一份文件。
**否掉的那些被统计检验、OLS 预验证、模型输入一路继承，中途任何一步不得复活。**

**这一层只继承，不重审。** 映射层忽略的、质量层弃用的，不画、不给客户看。
客户问起一个页面上没有的因子，说清楚它死在哪一层。

**某个 L4 因子的全部指标都被否 → 预警。** 回流到业务理解找替代指标，不是一句备注。

## 客户对着图提问、要求改图

图册出来之后，问答和调整都在对话里发生，做法见 `references/ask.md`。两条规矩：

- **答问题一律先跑 `validation.read`**，用它返回的数字作答。它和页面走的是同一个归约内核，
  所以顾问口头说的和客户此刻看到的不可能不一样。
- **换个维度看不用重跑**——页面上就能切。告诉他点哪儿。要看一个页面切不出来的东西
  （换了指标口径、换了时间窗定义），那不是改图，是改这份交付物。

## 取材范围

| 步骤 | 只能读 |
|---|---|
| page | `data/derived/validation-panel.json`、`validation-facts.json`、`chart-analyses.json`、`artifacts/s1/factor-tree.yaml`、`data/published/coverage.yaml`、`artifacts/s2/quality-scorecard.yaml`、`inputs/interview-minutes/**` |
| anomalies | `data/derived/anomalies.json`、`validation-panel.json`、`validation-facts.json`、`inputs/interview-minutes/**`、`inputs/industry-reference/**` |
| signoff | `artifacts/s2/business-validation.md`、`anomalies.yaml`、`chart-book.html`、`data/derived/validation-panel.json`、`validation-facts.json` |

工具的用途、参数与产出结构见 `tools/catalog/validation.panel.yaml`、`validation.facts.yaml`、
`validation.analyses.yaml`、`validation.read.yaml`、`validation.anomalies.yaml`——
引用目录卡，不另写一套说明。
图册本身的设计与验收清单见 `apps/charts/README.md`。

## 产出物与模板

| 产出 | 模板 |
|---|---|
| `artifacts/s2/chart-analyses.yaml` | `templates/chart-analyses.yaml` |
| `artifacts/s2/chart-book.html` | 由图册应用生成，没人手改它 |
| `artifacts/s2/business-validation.md` | 同上——**它是解读表的视图，不是源**，改它没有用 |
| `artifacts/s2/anomalies.yaml` | `templates/anomalies.yaml` |
| `artifacts/s2/signoffs.yaml` | `templates/signoffs.yaml` |

做完任何一步，交给编排层验收。**你不自己关确认、不记裁决、不流转状态。**

## 说话的规矩

1. 先说结论，再说依据，不铺垫。
2. 只说业务语言：说「确认」「检查项」「交付物」「计算结果」，不说 gate、predicate、artifact。
3. 每步三句话内交代：做了什么 / 结果是什么 / 需要你什么。
4. 要人拍板时永远给选择题：候选 + 推荐 + 每项后果，不给开放式提问。
5. 数字要报出处。说不出出处的数字就不说。
6. 拿不准就问。"大致""可能""建议进一步确认"通常是该问没问留下的痕迹。
