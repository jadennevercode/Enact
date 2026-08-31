# 知识资产吸收清单

**范围：** 上游 `AgenticMMM0612 V2/Assets/数据智能体知识库/` 全部 19 个文件（README ×1、模版化 ×9、流程化 ×4、机器可读 ×5），逐份核对 runtime `knowledge/` 的吸收状态；外加核查后发现的第二处知识资产 `backend/data/templates/_index.json`（§2.5）。
**判类依据：** 架构宪法 `2026-08-08-architecture-and-methodology.md` §2.1（7 步判定规则）、§4.4（Knowledge 双分区与回流）。
**结论性质：** 本文给出的是动作，不是评估建议。每条都写明"放哪、为什么、谁写"。

---

## 0. 六条最重要的结论

1. **runtime 的知识库里有两个死条目。** `knowledge/methodology/workflow.json` 与 `wide-table-schema.json` 登记在 `index.yaml` 里，但全仓库无任何代码或文档读它们（已 grep 验证）。它们的职责已分别被 `shared/manifests/s2.yaml`（流程）和 `knowledge/schema/target-schema.yaml` + `dataeng/columns.py`（长表契约）接管。按 §2.1 第 7 条，"流程"是**机制**不是 Knowledge，放在 `knowledge/` 本身就是归类错误。

2. **方法论被误关进了行业包。** `knowledge/industry/food-bev/beverage/factor-ranges.json` 里带着 `businessAnalysisSteps`（六步业务分析）、`drilldownTrigger`（ROI 跌 >30% 或销量波动 >20% 触发下钻）、`factorTreeLevels` 三个字段——它们是**跨行业**方法论，却因为按目录锚定的隔离机制，只有饮料项目读得到；而且事实上**没有任何代码读它们**。护肤项目拿不到六步框架，这不是策略是构造。

3. **模版化目录里有 3 份是产出物模板，不是知识。** `2.12 数据质量评分表`、`2.23 数据字典`、`2.24/2.35 的编号列` 是交付物的字段级骨架——按 §4.1 它们的归宿是 `skills/<name>/templates/`。而 runtime **今天一个 templates/ 目录都没有**（已验证：12 个 skill 全部只有 SKILL.md + references/）。这是宪法 §4.1 与现状之间最大的一处未落地。

4. **散文版规则与机器可读版规则已经矛盾，吸收散文版会引入第二份真相。** `模版化/2.33` 的打分是 0/0.5/1/**2** 四档、`Total = CV + Pearson + VIF`、`Good ≥ 3`、VIF **越大分越高**；而 runtime 加载的 `statistical-scoring.json` 是 0/0.5/1 三档、`Total = CV × Pearson × VIF`、`Good > 0.5`、VIF **越大分越低**。同样，`模版化/2.11` 写 `Final = 四维之和`（满分 4），却又说 `score=1 验收 / 0.5 人决策`（满分 1）——原文自相矛盾，runtime 解成了乘积。**结论：散文版一律不吸收，但这两处裁决必须登记。**

5. **上游真正的可插拔知识包不在 `Assets/`，而 runtime 一份都没吸收。** 平台的行业包机制是 `backend/app/store/templates.py` + `backend/data/templates/_index.json`，里面已经种好了 5 个模板：**94 行**的饮料因子树（45 个 L4，其中 44 行带真实 ROI 区间）、**94 条**分层访谈题（Leadership / Management / Operation × 12 个角色）、4 条规则、2 条饮料知识笔记、3 条通用笔记。runtime 的 beverage pack 只有从 `factor-ranges.json` 来的 **23 行**。更要命的是：runtime 的 prose recall 适配器 `shared/lib/knowledge.py::recall()` **今天固定返回 `None`**——`factor-tree derive` 与 `interview outline` 这两个最该有行业依据的步骤，事实上没有任何行业依据，且这件事被 `knowledgeRecall: none` 如实记录着，没人当回事。

6. **beverage pack 是一个案例，不是一个行业；而第二个行业压根不存在。** 平台 00 文档 §9 承诺"行业知识包必须可插拔（饮料包 / 医药营养包 / …）"，但核查结果是：**医药营养包从未建成**——08 文档 §10.1.11 明确记着"HCP/PFME（医学营养品）sheet 属另一行业案例，**已排除**"，06 文档 §3 至今把"行业包打标"列为未完成的平台行动项。平台自己也得出了和 runtime 一样的结论并硬编码了它：`backend/app/agents/data_rules.py:333` 写着 `REFERENCE_INDUSTRY = ("food-bev", "beverage")`，并有一条回归测试禁止饮料区间用到护肤或医药项目上。**runtime 的目录锚定隔离机制与平台的这行常量是同一个判断的两种实现——这不是巧合，是同一个 bug 教出来的。**

---

## 1. 判类口径（怎么用 §2.1 的 7 步规则判知识资产）

7 步规则是对"能力单元"提问的，知识资产要先转译一次。转译规则如下，本文所有归类都按它执行：

| 资产的形态 | 对应 §2.1 的哪一步 | 归宿 |
|---|---|---|
| 阈值、公式、区间、枚举——**同样输入必然同样输出** | 第 1 步 Tool | 机器可读文件放 `knowledge/`，**由 Tool 加载**；散文孪生本不该存在 |
| 固定产出形态的骨架（图表页透视结构、工作簿列布局） | 第 2 步 App | `apps/<name>/` 的模板 |
| **某一个交付物**的字段级填空骨架 | §4.1 | `skills/<name>/templates/` |
| 跨 Skill、跨项目复用的表达骨架与解读话术 | 第 6 步 Knowledge | `knowledge/`（§4.4 明确把"话术模板"列进沉淀区） |
| 行业事实、区间、行业特有枚举 | 第 6 步 Knowledge | `knowledge/industry/<l1>/<l2>/` |
| 步骤顺序、依赖、gate 位置 | 第 7 步 机制 | `shared/manifests/`，**不是** Knowledge |

**两条硬规则，本文反复用到：**

- **一份规则只能有一个权威形态。** 机器可读版被代码加载，散文版就只能是它的注释，不能是并列的第二份。上游同时维护 `模版化/2.33` 与 `机器可读/statistical-scoring.json`，两份已经漂开——这是"两份真相"的活样本，不要复制这个结构。
- **模板归属看"谁独占它"。** 一个交付物独占、随该交付物演进 → Skill 的 `templates/`。多个 Skill 或多个项目共用 → `knowledge/`。这条区分了 `2.12 评分表`（data-quality 独占 → Skill templates）与 `2.32 解读规则表`（business-validation 与未来的报告都用 → knowledge）。

---

## 2. 逐份清单

### 2.1 机器可读/（5 份 JSON）——全部已吸收，但两份是死的

| 上游文件 | 内容摘要 | runtime 现状 | 归类 | 建议动作 |
|---|---|---|---|---|
| `validation-scoring.json` | 2.11/2.12 四维（一致性·准确性·完整性·颗粒度）十个子项的 0/0.5/1 判定条件 + 验收口径 | **已吸收，逐字节相同**，落 `knowledge/methodology/validation-scoring.json`，由 `mmm_engine/scoring/rules.py` 与 `quality.py` 加载 | 沉淀区 rules（Tool 规则源） | **保留不动。** 它是 `quality.scorecard` 这个 Tool 的规则源，位置和写通道都对 |
| `statistical-scoring.json` | 2.33 CV / Pearson / VIF 三检验的分档 + `Total = CV × Pearson × VIF`、Good > 0.5 | **已吸收，逐字节相同**，落 `knowledge/methodology/`，由 `stat.scorecard` 加载 | 沉淀区 rules（Tool 规则源） | **保留不动**，但把它与 `模版化/2.33` 的四处冲突登记进 §5 的裁决表——今天这个裁决只存在于代码里，没有文字 |
| `factor-ranges.json` | 23 条 L1–L4 因子的 ROI Range / 年度 Contribution Range / 下钻颗粒度；**外加**三个方法论字段 | **已吸收，逐字节相同**，落 `knowledge/industry/food-bev/beverage/`，由 `knowledge.match_factor_range` 按精确键查 | **混装**：区间=案例数字；`businessAnalysisSteps`/`drilldownTrigger`/`factorTreeLevels`=跨行业方法论 | **拆三份**，见 §4。这是本清单里唯一需要动现有文件的一条 |
| `wide-table-schema.json` | 2.21/2.24/2.35 的长表列定义，含 `Variable no. / Metric no.` | **已吸收但已死**：登记在 `index.yaml`，全仓库无引用。职责被 `knowledge/schema/target-schema.yaml` + `dataeng/columns.py` 接管，且 runtime 版更严（带 `enum`、`nullMeans: national`、`required`） | 归类错误：它是 schema 契约，而 runtime 的 schema 契约在 `knowledge/schema/` 与 workspace `metadata/schema/` | **从 `index.yaml` 摘除，文件移入 `docs/specs/platform-contracts/` 作为出处引用。** 唯一还有价值的内容是 `Variable no./Metric no.` 两列，见下条 |
| `workflow.json` | 2.1→2.35 的 DAG：子阶段、步骤、闸门、humanInLoop 标记 | **已吸收但已死**：登记在 `index.yaml`，全仓库无引用。职责被 `shared/manifests/s2.yaml` 接管 | 归类错误：按 §2.1 第 7 条，流程是**机制**（`shared/manifests/`），不是 Knowledge | **从 `index.yaml` 摘除，文件移入 `docs/specs/platform-contracts/`。** 流程放在 knowledge/ 会让"改流程"有两个入口，而只有一个入口是被 `check_suite` 检查的 |

> **为什么"死条目"不是无害的：** `index.yaml` 是知识库的注册表，也是 prose recall 的候选面。一个不被任何 Tool 加载、又出现在注册表里的文件，会被模型当成可引用的依据召回，然后落进 `knowledgeRecall` 戳里——一条谁都没在维护的规则，就这样获得了出处。

### 2.2 模版化/（9 份）——3 份该变成 Skill 模板，4 份不该吸收

| 上游文件 | 内容摘要 | runtime 现状 | 归类 | 建议动作 |
|---|---|---|---|---|
| `2.11-数据通用校验标准.md` | 四大核心规则的**定义性**说明：维度/时间/口径一致性各指什么，字段完整性要含哪些核心字段，颗粒度三层含义 | **部分**：判定阈值已在 `validation-scoring.json`；定义性说明散落在 `skills/data-quality/references/score.md`，但"核心字段清单"（投放含渠道/金额/时间/触达人数；转化含转化时间/金额/对应渠道；基线含自然流量/季节/竞品）**未吸收** | 不吸收整份（与 JSON 重复）；其中**核心字段清单**是行业无关的完整性检查表 → 沉淀区 rules | **只摘一段。** 把"核心字段清单"补进 `validation-scoring.json` 的 `comprehensiveness.field` 作为 `expects` 数组，让 `quality.scorecard` 能机械判"只有 spending 没有 performance"这一档，而不是靠模型读散文 |
| `2.11-数据校验打分规则.md` | 四维十子项的 0/0.5/1 阈值表 + 验收口径 | **已吸收**（就是 `validation-scoring.json` 的来源） | 不吸收（散文孪生） | **不吸收。** 唯一动作：登记裁决——原文 `Final = 完整性+颗粒度+真实性+一致性`（和，满分 4）与 `score=1/0.5/0`（满分 1）自相矛盾，runtime 解为**乘积**（`Total = 一致性 × 准确性 × 完整性 × 颗粒度`）。这个解读没有任何文字记录，只在 `scoring/quality.py` 里 |
| `2.12-数据质量评分表.md` | **产出物列结构**：每行 = 一个 L4 下的一个指标，列含四维评分 + 四维文字说明 + `Brand Granularity Compliancy / exists / collected / integrity` 四联列 + Channel 同族四联列 + Total | **部分**：`skills/data-quality/references/score.md` 给了 row 的 YAML 示例，但**没有 templates/ 目录**，且 Brand/Channel 的 compliancy·exists·collected·integrity 四联列**完全未吸收** | **应转为 Skill 模板** → `skills/data-quality/templates/quality-scorecard.yaml` | **新建模板。** 那四联列不是冗余：`exists`（数据实际存在的颗粒度）vs `collected`（采集到的颗粒度）的差值，正是"客户有但没给"与"客户根本没有"的区分——这是 `master-data` 收尾时 `notSupplied` 因子要向客户交代的东西，runtime 现在算不出来 |
| `2.21-宽表数据集维度.md` | 长表列定义 + 四条设计要点（三段式维度、主数据驱动、长表而非宽表、L1–L4 与因子树严格一致） | **部分**：列定义已由 `knowledge/schema/target-schema.yaml` 承载且更严；四条设计要点里"**对不齐就填 NA，绝不臆造**"这条原则未成文 | 列定义=不吸收（已有更好的）；"绝不臆造"=**机制**（`shared/`） | **只摘一句。** 把"维度对不齐填 NA，绝不臆造"写进 `shared/file-kinds.md` 或 `shared/numbers-provenance.md`——它和"模型不得手写数字"是同一条纪律的两半，现在只有后一半被 selftest 守着 |
| `2.23-数据字典.md` | **产出物模板**：每行 = 一个 source sheet，15 列（Theme/SheetName/Source Sheet 位置/来源系统/granularity/**服务于哪个 L4 因子**/ETL 逻辑/时间范围/**X or Y**/TableName/**归口部门**/**提供方**）+ Change Log 约定（日期/原因/版本/更改人/说明） | **基本未吸收**：runtime 有 `data/clean/*/asset.yaml`（name·sources·status·notes）和 `data/published/manifest.yaml`（每个源贡献了什么），覆盖了血缘的机器侧；但"服务于哪个 L4/X or Y/归口部门/提供方"这四个**对人、对客户、对追责**的列全无 | **应转为 Skill 模板** → `skills/data-engine/templates/data-dictionary.yaml` | **新建模板，优先级高于 2.12。** 理由：`Data source DEPT.` + `Data provider` 是数据出问题时"找谁"的唯一答案，`data-request` 阶段就该填、`data-engine` 阶段核实。另外它的 **Change Log 五列是回流账本的现成字段表**，见 §5 |
| `2.24-数据集与ModelData.md` | 数据全集表的列定义 + `Variable no. / Metric no.` + "2.24 全集 vs 2.35 子集"的关系 | **部分**：长表已实现（`data/published/long.parquet`）；全集/子集关系已由 `master_data.adopted_indicators` 实现；**`Variable no. / Metric no.` 未实现** | 列定义=不吸收；编号规则=**Tool**（确定性，同输入同输出） | **在 `master.assemble` 里实现编号**，写进 `artifacts/s2/model-input.xlsx`。理由：编号是 S3 引用变量的握手协议，也是"贡献度能回溯到哪个 L4"的钥匙。runtime 的范围止于模型输入锁定，但**交付出去的表必须让下游认得出变量** |
| `2.31-指标业务校验规则.md` | 四块内容混装：① 六步业务分析框架 ② 下钻触发规则 ③ 维度拆解四象限（牛眼/成熟/潜力/问题市场）④ ROI/Contribution 区间表 ⑤ 假设→先验示例表（异常模式/可能原因/置信度/验证方法/涉及因子） | **部分**：④ 已吸收为 `factor-ranges.json`；①② 以字段形式躺在同一个 JSON 里但**无人读**；③⑤ **完全未吸收** | **必须拆**：①②③=跨行业方法论 → 沉淀区 rules；④=案例数字 → 见 §4；⑤=行业特有的异常判读候选 → industry pack | **拆四份**，见 §4。③④⑤ 中最值得补的是 **⑤ 假设→先验示例表**：`business-validation` 今天要模型"解释异常"，但没给它任何**候选原因的清单**，只能自由发挥——而自由发挥的因果解释正是最像真话的假话 |
| `2.33-指标技术校验规则.md` | CV/Pearson/VIF 三检验的分档 + 合成判定 + 与 2.1 的区别 | **冲突**：runtime 用的是 `statistical-scoring.json`，与本文件在**四处**不一致（档位 0/0.5/1/2 vs 0/0.5/1；Total 求和 vs 求积；Good≥3 vs Good>0.5；VIF 方向相反） | 不吸收（散文孪生，且是**过时**的那一份） | **不吸收，登记冲突。** 判决：以 `statistical-scoring.json` 为准，理由是它被代码加载、被 `stat.scorecard` 的 payload 检验、被 selftest 覆盖，而 md 只被人读。冲突四条逐条写进 §5 裁决表 |
| `2.35-Model-Input.md` | 2.24→2.35 的五条收敛规则 + 编号列 + 与 backend 的衔接 | **部分**：五条收敛规则已由 `funnel.yaml` 的五种 verdict + `adopted_indicators` 实现（且 runtime 版更细：mapping/quality/signoff/statistical/selection/range 六层损耗）；编号列未实现 | 收敛规则=**Tool**（已实现）；编号=Tool（未实现） | **不吸收散文。** 编号并入 2.24 那条动作。runtime 的 funnel 已经严格覆盖了本文件的规则 1–4，且规则 5（编号）是唯一缺口 |

### 2.3 流程化/（4 份）——按 §2.1 第 7 条，流程是机制不是知识

| 上游文件 | 内容摘要 | runtime 现状 | 归类 | 建议动作 |
|---|---|---|---|---|
| `00-数据智能体流程总览.md` | 2.1→2.35 的三子阶段、三道闸门、每步的【输入】【动作】【输出】【闸门】、关键产物链 | **已吸收**为 `shared/manifests/s2.yaml`（且 runtime 版带 predicates，比散文强） | **机制**（`shared/manifests/`），不是 Knowledge | **不进 `knowledge/`。** 移入 `docs/specs/platform-contracts/` 作为交付物契约卡的出处引用（宪法 §5 要求每张卡填"平台出处"） |
| `2.22-数据处理流程.md` | 7 步处理流程 + 5 步数据检查 + TaskLog 15 列 + KBQ 因子↔Task 对应 + 三类备注标签 | **部分**：`reconcile.json` 覆盖了第 6 步"与源数据 cross-check"；TaskLog 的台账职责被 `data/clean/*/asset.yaml` 部分接管；**两条质量纪律未吸收** | 流程=data-engine 的 references（A 步骤编排）；TaskLog 列=与 2.23 合并成一份数据字典模板；**两条纪律=机制** | **摘两条纪律进 `shared/`：**（a）"检查 charting 时**要用真实数据源核对，不能直接用 charting 表的数**"——这是 `view_derived_from` 机制的业务表述，机制已有，但反例说得比机制清楚，值得写进 `shared/numbers-provenance.md` 作为注解；（b）"与源数据 cross-check **需两人互相检查**"——runtime 是单人+AI，等价物是 gate 的"提出者不得自答"，已由 gate-protocol 覆盖，**不吸收，登记为已有等价物** |
| `2.32-数据展示与趋势解读.md` | ① Charting 透视骨架（Summary TOTAL / by Region / 店类型 / 产品 / MODEL Design / KPI·Base·PFME·Promotion·Finance）② **解读规则表**（看什么/用什么图/解读要点/结论示例/相关 L4）③ 端到端输出示例 | **部分**：`skills/business-validation/references/charts.md` 定义了 chart roles（response=Area / spending=Line / 其余=Bar）和"读 facts 不读 series"的纪律；**解读规则表完全未吸收** | ①=**App 模板**（`apps/charts/`）；②=**沉淀区**（§4.4 明列"话术模板"）；③=示例，随 ② 走 | **新建 `knowledge/methodology/chart-reading.yaml`**，承载解读规则表。理由：`business-validation` 的 C 步骤要模型"看图说业务"，现在它拿到的是 facts payload + 自由发挥；这张表把"看什么"变成有限清单（整体趋势 / 同比增速跑赢跑输 / 份额变化 / 费用 vs 销量叠图 / 品牌搜索领先指标），**每条都绑定了要引用的 L4 因子**——这正好把 §4.1 话术规范第 5 条（数字必须报出处）从"要求"变成"填空" |
| `2.34-指标筛选OLS.md` | OLS 快速验证的输入/动作/判定/**冲突处置**/输出，以及"选变量不是建模"的定位 | **部分**：`skills/ols-test` 已实现 fit/propose/review；**冲突处置的两条分支未成文**（无候选落区间 → 回 2.31 复核业务假设或回 2.2 复核数据处理；某因子全不可用 → 预警） | 流程=ols-test 的 references；**冲突处置=Gate 的候选处置** | **补进 `skills/ols-test/references/review.md` 的 gate 呈现段。** 按 §4.1 话术规范第 4 条，gate 必须给候选+推荐+后果——"没有候选落在区间内"今天没有列出的候选，模型会自己编一个处置；上游已经写好了两个（回退复核业务区间 / 回退复核数据处理），直接用 |

### 2.4 README.md

| 上游文件 | 内容摘要 | runtime 现状 | 归类 | 建议动作 |
|---|---|---|---|---|
| `README.md` | 知识库导读：三形态说明、数据智能体定位、三道闸门表、统一宽表契约、**编号↔文件↔本库映射表**、与 backend 的对接建议 | 未吸收 | 索引文档，不是知识 | **移入 `docs/specs/platform-contracts/` 作为索引。** 它的"编号↔文件"映射表是提取契约卡时的目录，宪法 §5 要求每张卡写"平台出处"，这张表就是出处的查找表。**不进 `knowledge/`** |

### 2.5 范围外的重大发现：上游的知识包在 backend，不在 Assets

`Assets/数据智能体知识库/` 只是**数据智能体（S2）**的规则库。平台真正的**行业知识包机制**在另一处，runtime 一份都没吸收：

| 上游位置 | 内容 | runtime 现状 | 归类 | 建议动作 |
|---|---|---|---|---|
| `backend/data/templates/_index.json` · `tpl-bev-factor-tree` | **94 行**饮料因子树：L1/L2/L3/L4 + 指标 + roiRange + contributionRange。45 个 distinct L4，44 行带真实 ROI 区间。L1 分布：生意基本盘 38 / 渠道成交驱动 28 / 消费者需求驱动 24 / 促销优惠 4。种子来自 `reference/roi- contribution-range.xlsx` | **完全未吸收。** runtime 的 beverage pack 只有 23 行（来自 `factor-ranges.json`），是这份的一个子集 | industry pack（骨架部分）+ 案例（数字部分） | **吸收，按 §4.2 拆两层落盘。** 这是 `factor-tree derive` 唯一可能的行业依据，比 23 行版本覆盖面大三倍 |
| 同上 · `tpl-bev-interview` | **94 条**访谈题，字段 `category / role / question`；12 个角色分三层：Brand Leadership(8) · Management Team-{Sales,Mkt,Finance}(24) · Operation Team-{Brand,Media,EC,Activation,Sales-KA,Trade Mkt,Execution,SIA}(62) | **完全未吸收。** `skills/interview/references/outline.md` 要模型自己生成提纲 | **拆两层**：分层角色框架=跨行业方法论；具体题目=Mizone 案例 | **吸收框架，不吸收题目。** 题目里到处是 "Mizone"；但"三层 × 12 角色 × 现状/期望/数据可得性三段式"是通用的，且 `tpl-general-knowledge` 里那条 `gk-interview` 已经把它抽象好了 |
| 同上 · `tpl-bev-rules` | 4 条规则：数据质量打分、统计初筛、技术审查基准（R² 85–95% · MAPE 5–15% · DW 1.5–2.5）、**批发并入 TT 渠道** | **部分**：前两条 runtime 已有（且更精确）；技术审查基准属建模阶段（D3 已裁决不做）；**"批发并入 TT"未吸收** | 前两条=重复；第三条=范围外；**第四条=真正的饮料行业知识** | **只吸收第四条**进 `knowledge/industry/food-bev/beverage/`。理由：它是一条会改变因子树与映射结果的行业惯例（批发数据不可拆时并入 TT，避免稀释 AFH 投资有效性），而且**只有做过饮料项目的人知道** |
| 同上 · `tpl-bev-knowledge` | 2 条饮料笔记：`Share of Throat（跨品类挤压）`——现调饮料/外卖即饮是外部竞争因子，外卖大战这类结构性突变要单列变量否则会被误吸收进媒体效应；`冰柜 × 陈列资产共线`——高共线时合并为单一渠道执行变量 | **完全未吸收** | industry pack（真正的行业知识） | **原样吸收。** 这两条是本清单里**信息密度最高**的资产：第一条能防住一类系统性建模错误（把外部冲击算成媒体效果），第二条直接对应 `stat-screening` 的 VIF 处置。两条加起来不到 100 字，价值远超 23 行区间表 |
| 同上 · `tpl-general-knowledge` | 3 条通用笔记：报告叙事风格（结论同时给量级与占比；ROI 结论必附"不可线性外推"口径）、Chart book 骨架（Part 0 基本面 → Part 1 全国 → Part 2 区域）、分层访谈框架 | **完全未吸收** | 沉淀区 rules（跨行业话术模板，§4.4 明列） | **吸收第 2、3 条。** 第 1 条属报告阶段（D3 范围外），但"ROI 结论必附不可线性外推"这半句对 `ols-test` 的区间判读仍然成立，值得单摘 |
| `Assets/sample-data/danone-mizone/` | 17 份 `DataRequest_*.xlsx` 采集模板（动销/冰柜/品牌传播/渠道执行/电商平台媒体及促销/竞争格局/铺货/宏观环境/复购粘性…），按 L3 分册 | 未吸收；runtime 的 `data-request` 用 `build_workbooks.py` 从因子树现场生成 | 案例样本，不是知识 | **不吸收为知识**，但**作为 `apps/workbook/` 的形态参照**——17 份真实交付出去过的工作簿，是"一个 L3 一册、一个 L4 一表"这条规则的实物证据 |

**为什么这块被漏掉了：** `knowledge/index.yaml` 的三个 pack（methodology / schema / food-bev/beverage）全部溯源到 `Assets/数据智能体知识库/机器可读/` 的 5 个 JSON。蒸馏时把"知识库"等同于那个目录名，而平台把 S1 的行业包放在了 `backend/data/templates/`——两处从没有交叉引用。**结果是 runtime 吸收了整套 S2 打分规则，却没吸收任何 S1 行业知识**，而 S1（因子树、访谈）恰恰是最依赖行业先验的两个交付物。

**这解释了一个一直没人追究的现象：** `shared/lib/knowledge.py::recall()` 返回 `None`，`shared/knowledge-recall.md` 却规定了三个调用点（`scoping knowledge` / `factor-tree derive` / `interview outline`）。机制建好了，库是空的——不是适配器没写完，是**没有东西可召回**。上表的第 1、2、4、5 行就是该放进去的东西。

---

## 3. 三类误置的明确划分（回答"哪些不是知识"）

宪法 §2.1 第 6 步说"跨项目可复用的事实/规则/区间/模板 → Knowledge"，但"模板"这个词太宽，直接照抄会把半个上游知识库倒进 `knowledge/`。按下表切开：

### 3.1 这些是**产出物模板**，归 `skills/<name>/templates/`

| 内容 | 为什么不是 Knowledge | 归属 Skill |
|---|---|---|
| `2.12` 数据质量评分表的列结构 | 它是**一个交付物的骨架**，随 `quality-scorecard.yaml` 的字段一起演进。放进 `knowledge/` 意味着改一个字段要走 `promote` 通道——把日常编辑变成评审事件 | `data-quality` |
| `2.23` 数据字典的 15 列 + `2.22` TaskLog 的 15 列（合并为一份） | 同上。而且它的字段（归口部门、提供方）是**项目特定的人名与部门**，天然属于 workspace，模板只提供空格 | `data-engine` |
| `2.35` Model Input 的表头 + 编号列 | 它是 `model-input.xlsx` 的列布局，由 `master-data` 独占 | `master-data`（其中 xlsx 的组装线按 §4.3 属 `apps/workbook/`） |

**判别标准一句话：** 如果改这个模板只影响一个交付物、且改完不需要别的项目同意，它就不是沉淀区的东西。

### 3.2 这些是**确定性规则**，权威形态是 Tool 加载的机器可读文件，不要再有散文版

| 内容 | 现在的权威形态 | 散文版的处置 |
|---|---|---|
| 四维十子项的 0/0.5/1 阈值 | `validation-scoring.json` ← `quality.scorecard` | `模版化/2.11` 两份**不吸收** |
| CV/Pearson/VIF 分档与合成 | `statistical-scoring.json` ← `stat.scorecard` | `模版化/2.33` **不吸收**（且它是过时的那份） |
| 2.24→2.35 的五条收敛规则 | `master_data.adopted_indicators` + `funnel.yaml` 的五种 verdict | `模版化/2.35` **不吸收** |
| `Variable no. / Metric no.` 的分配 | **尚未实现** → 应实现在 `master.assemble` | `wide-table-schema.json` 的两列定义随文件移出 |

**判别标准一句话：** 如果它能写成一个函数、并且两个人算出来必须一样，它的家在 Tool 的规则源里，不在给人读的文件里。上游同时维护散文与 JSON 的后果已经摆在眼前——`2.33` 的两份在四个点上漂开了，没有任何人发现。

### 3.3 这些是**机制**，归 `shared/`，改动要走 selftest 红→绿

| 内容 | 上游位置 | 归属 |
|---|---|---|
| 2.1→2.35 的步骤顺序、依赖、闸门位置 | `流程化/00`、`机器可读/workflow.json` | `shared/manifests/s2.yaml`（已实现） |
| "维度对不齐填 NA，绝不臆造" | `模版化/2.21` 设计要点 | `shared/numbers-provenance.md`（**待补**） |
| "核对 charting 要用真实数据源，不能用 charting 表的数" | `流程化/2.22` 检查步骤 4 | `shared/numbers-provenance.md` 的注解（**待补**） |
| "cross-check 需两人互相检查" | `流程化/2.22` 步骤 6 | 已有等价物：gate-protocol 的"提出者不得自答"，**不吸收** |

### 3.4 这些才是真正的 Knowledge（沉淀区）

| 内容 | 分区 | 目标路径 |
|---|---|---|
| 六步业务分析框架 + 下钻触发规则 + 维度拆解四象限 | 沉淀区 rules（跨行业） | `knowledge/methodology/business-review.yaml`（**新建**） |
| 图表解读规则表（看什么/什么图/解读要点/绑定 L4） | 沉淀区 rules（跨行业话术模板） | `knowledge/methodology/chart-reading.yaml`（**新建**） |
| 四维十子项阈值、CV/Pearson/VIF 分档 | 沉淀区 rules | 已在 `knowledge/methodology/`（**不动**） |
| 饮料行业的 L1–L4 因子骨架 | industry pack | `knowledge/industry/food-bev/beverage/factor-tree-skeleton.yaml`（**新建**，见 §4） |
| 饮料行业的异常→假设候选表 | industry pack | `knowledge/industry/food-bev/beverage/anomaly-hypotheses.yaml`（**新建**，见 §4） |
| Danone Mizone 的 ROI / Contribution 数字 | **案例区（新分区）** | `knowledge/cases/danone-mizone/factor-ranges.json`（见 §4） |

---

## 4. 行业包：一个案例被当成了一个行业

### 4.1 问题

`knowledge/index.yaml` 的 beverage pack 说明已经诚实地写明"这些区间是 Danone Mizone 案例，源文件自称须替换"。但**说明不是机制**：

- `match_factor_range()` 查到数字后，调用方拿到的就是一个区间，`knowledgeRecall` 戳记的是 pack id `food-bev/beverage`——**戳里没有"这是一个案例的数字"这件事**。ols-test 的区间反常识判读会拿它当行业基准用。
- 同一个文件里还混着三个跨行业方法论字段（`businessAnalysisSteps` / `drilldownTrigger` / `factorTreeLevels`），被行业隔离机制锁在饮料目录里，**任何非饮料项目都读不到六步框架**。
- 23 条因子里，**L1–L4 的结构**（生意基本盘/消费者需求驱动/渠道成交驱动 → 外部因素 → 品类趋势 → 市场规模…）是真正的饮料行业知识，可复用；**数字**是一个客户一次交付的结果，不可复用。两者存在同一个 `factors` 数组的同一行里，无法分别引用。

### 4.2 建议：拆成三层，并新增"案例"分区

```
knowledge/
  methodology/
    business-review.yaml         # 新建：六步框架 · 下钻触发 · 四象限（从 factor-ranges.json 迁出 + 从 2.31 补全）
    chart-reading.yaml           # 新建：图表解读规则表（从 2.32 吸收）
  industry/food-bev/beverage/
    factor-tree-skeleton.yaml    # 新建：L1-L4 因子结构与候选指标名，无数字
    anomaly-hypotheses.yaml      # 新建：异常模式→可能原因→置信度→验证方法→涉及因子（从 2.31 吸收）
    enums/channel_type.yaml      # 不动
  cases/
    danone-mizone/
      factor-ranges.json         # 迁入：ROI / Contribution 数字 + 出处戳
```

**`index.yaml` 增加 `kind: case`，并且对 case 分区加一条构造约束：** case 的数字被 keyed lookup 命中时，返回值必须带 `provenance: {kind: case, id: danone-mizone, project: <原项目>}`，`knowledgeRecall` 原样落戳。这样"我用了一个案例的区间"这件事会跟着数字走到 gate 呈现上，而不是停在 `index.yaml` 的一段注释里——**注释保护不了下一个不读注释的人。**

**升级规则（与 §5 的回流通道配套）：** 数字类条目**只有被 ≥2 个项目独立确认**才能从 `cases/` 升进 `industry/`。单项目数字永远留在 `cases/`。这条规则如果早存在，今天就不会有一个饮料 pack 里装着一个客户的数字。

### 4.3 关于第二个行业（医学营养品 / HCP）——它不存在

平台 00 文档 §9「双行业案例说明」的原文承诺是：

> 「→ 行业知识包必须可插拔（饮料包 / 医药营养包 / …），L1/L2 跨包共享，L3/L4+指标按包加载。」

**但核查结果是：这个包从未建成，而且平台已经明确放弃了它。** 三处证据：

| 证据 | 出处 | 说明 |
|---|---|---|
| 「HCP/PFME（医学营养品）sheet 属另一行业案例，**已排除**」 | 08 §10.1.11（B-12 交付物对齐） | 平台把它排除出了产品 |
| 「行业包打标：饮料包（Danone）/ 医药营养包……」仍在**未完成行动项**里 | 06 §1 第 7 条 + §3 待办 | 从 2026-06 挂到现在没做 |
| `backend/data/templates/_index.json` 只有 5 个模板，全部 `food-bev/beverage` 或 `general` | 实测 | 包机制建好了，只装了一个行业 |

**医学营养品在上游的真实存在形态**，是 Nestlé Health Science（`NHSc_` / `mROI_` 系列）的**原始客户工作文件**，散在 `reference/99.各模块Reference/模块二三|模块四五/` 与两张 sheet 里：

- `factor&data_request.xlsx` 的 `2024PFME SPEND` sheet——14 类 HCP 活动（院内会/城市会/科室会/日常拜访/线上 HCP 会议/赞助临床研究/专家顾问会…）× 6 个产品的**花费表**。**它不是因子树**：没有 L1/L2/L3，没有指标，没有 ROI/Contribution 区间。
- `Data Analysis_2.32Charting.xlsx` 的 `6.MODEL Design` sheet——贝叶斯层级模型的变量设计（region / storetype / product channel 层级，PFME by L3，product halo by L2，store halo EC）。这属**建模阶段**，D3 已裁决不做。
- `模块四五/` 下的 `.R` + `.stan` + `.RData`——一份带绝对路径（`C:/Users/CNWangZh19/Desktop/mROI/`）的 MCMC 脚本。

**四点结论与动作：**

1. **无从吸收，登记为缺口而非遗漏。** 把 PFME 花费表做成一个可用的 HCP 行业包，需要**发明** L3/L4 映射和全部区间——那是一次新的行业建模工作，不是一次蒸馏。
2. **平台的行业锚定坐标里根本没有 HCP 这个节点。** `backend/app/domain/industries.py` 的 14 个 L1 里最接近的是 `health 医药健康 › supplement 保健品 › tonic 滋补营养` 和 `mother-baby › baby-food › infant-formula 婴配粉`——**两者都没有"医务/HCP 渠道"这个概念**。也就是说即便有内容，也没有地方挂。runtime 的 `industry/<l1>/<l2>/` 目录锚定没有这个限制（新目录就是新锚点），这是 runtime 相对平台的一个结构性优势，值得写下来。
3. **`2.32 Charting 骨架`不能放进 beverage pack。** 它源自医学营养品案例（06 §1 第 7 条点名），放进饮料目录就是把 B 行业的东西挂上 A 行业的锚。按平台自己开的药方"模板类资产归通用层"，它归 §3.4 的 `knowledge/methodology/chart-reading.yaml`。**这是本清单把它判为方法论而非行业包的第二个、也是更硬的理由。**
4. **动作：在 `index.yaml` 里为 `health/medical-nutrition` 写一条空占位。** `kind: industry`、`files: []`、description 写明"包未建成；`knowledgeRecall: none` 是正确答案，不得回退到 beverage"。理由：`index.yaml` 自己已经写着「**No pack for an industry is a real answer**」——把这句话变成注册表里的一行，比留在注释里更能防住回退。第一个 HCP 项目开工时，`promote` 通道会把它的因子骨架沉淀进这个空位，而不是先创造一个目录再讨论它该叫什么。

### 4.4 一个值得记下的印证

平台在 `backend/app/agents/data_rules.py:333` 硬编码了：

```python
REFERENCE_INDUSTRY = ("food-bev", "beverage")
```

并配了一条回归测试，断言 `build_range_index("beauty","skincare")` 与 `build_range_index("pharma",None)` 对饮料指标必须返回 `None`。其注释写道：**"Everyone else gets no benchmark rather than a beverage benchmark"**。

这与 runtime `knowledge/index.yaml` 开头那段（按目录锚定隔离、"一个护肤项目根本读不到饮料包，是构造不是策略"）**是同一个判断的两种实现**，而且两边都写明了同一个触发事件——一个 Danone 饮料区间被套到护肤因子上。**结论：runtime 的隔离机制不需要重新论证，它已经被上游独立验证过一次。** 需要补的不是机制，是 §4.2 里"案例 vs 行业"的第二道切分——平台那条常量把整个 beverage pack 当成了行业先验，包括那些其实只属于 Danone 一家的数字。

---

## 5. 回流通道设计建议

### 5.1 现状与缺口

runtime 今天有两条留痕：

| 文件 | 记什么 | 缺什么 |
|---|---|---|
| `state/decisions.log` | 每次人工裁决一行：`时间 \| gate id \| verdict \| who \| 证据路径 \| 备注` | 它记的是"**这个交付物过不过**"，不是"**这次改了哪 7 行、为什么**" |
| `state/tool-runs.jsonl` | 每次工具调用一行 | 机器动作，不含人的意图 |

**没有任何地方回答平台 StatusCheckList 的原文要求**："需要有个地方记录每个项目都因为什么补了什么，或者删了什么"。因子被删、口径被改、枚举被新增，今天只留在被覆盖的 YAML 文件里——**当前值在，理由不在**。而 §4.4 的 `promote` 通道要汇集的正是这些理由：没有账本，`promote` 就只能对着最终态的因子树猜"这行是哪来的"。

### 5.2 建议：`<workspace>/metadata/change-ledger.jsonl`

**位置理由：** §4.4 定义项目定制区 = workspace `metadata/`，写通道 = "对应 Skill + 人，带留痕"。账本就是那个留痕本身，放在它记录的那个分区里。**不放 `state/`**，因为 `state/` 是 Orchestration 独占的机器簿记（§2.2 所有权矩阵），而账本的写入者是各个产出型 Skill。

**格式理由：** 追加式 JSONL，与 `tool-runs.jsonl` 同构——一行一条、可 grep、可机读、并发追加不冲突、永不重写。**不用 YAML**：YAML 需要读-改-写整个文件，那正是"上一个写入者的记录被静默覆盖"的机制。

**字段（合并平台 08 §10.1.1 的增/删/合并×原因×来源×确认人、05 §5.2、`2.23 数据字典` 的 Change Log 五列、宪法 §4.4 的留痕要求）：**

| 字段 | 取值 | 为什么必须有 |
|---|---|---|
| `id` | `c-0001` 递增 | 让 knowledge 里沉淀下来的条目能反向指回来 |
| `at` | ISO8601 | 与 decisions.log 同格式，可按时间归并成一条时间线 |
| `deliverable` | 交付物 id（`factor-tree` / `data-engine` / …） | `promote` 按交付物聚类呈现；也让 `close` 能校验"本次交付物改了东西却没写账本" |
| `object` | `factor` \| `indicator` \| `caliber` \| `enum` \| `schema-column` \| `definition` | 决定它将来能升级进沉淀区的哪一层：`factor`→行业包骨架，`enum`→行业包枚举，`caliber`/`definition`→方法论或话术 |
| `ref` | 对象标识：`f-0007` / `(l4, indicator)` / `channel_type:MT` / 列名 | 同一对象的多次变更能串成一条历史 |
| `action` | `add` \| `remove` \| `merge` \| `rename` \| `redefine` | 平台原文是"增/删/合并"；补 `rename`/`redefine` 是因为口径变更既不是增也不是删，却是最常引发争议的一类 |
| `before` / `after` | 变更前后的值（`merge` 时 `before` 是数组） | 没有 before 的账本只是一份当前态的重复 |
| `reason` | 自由文本，**必填** | 平台要求的"因为什么"。空字符串应被 `close` 拒收 |
| `source` | `ai-proposal` \| `client-report` \| `interview` \| `data-observation` \| `client-request` \| `gate-rework` | §4.4 原文的"AI 推荐/报告/访谈"。**这是 `promote` 最重要的筛选维度**：客户实证来源的变更值得升级，AI 提议来源的不值得 |
| `evidence` | 路径（`inputs/…` / `data/derived/…` / `artifacts/…`） | 与 gate 证据同构；让"因为报告里说"能被翻到那一页 |
| `decidedBy` | 人名或 `human` | 平台要求的"确认人"。AI 不得填自己 |
| `gate` | 触发它的 gate id，可空 | 与 `decisions.log` 交叉引用：一次 gate 通过对应账本里的 N 行变更 |
| `promote` | `null` \| `proposed` \| `promoted:<knowledge 路径>` \| `declined:<原因>` | 回流状态就地记录，不需要第二份表；也让同一条不会被 `promote` 重复提名 |

**示例行：**

```json
{"id":"c-0014","at":"2026-08-08T14:22:00+08:00","deliverable":"factor-tree","object":"factor","ref":"f-0031","action":"add","before":null,"after":{"l3":"渠道/终端营销","l4":"即时零售补贴"},"reason":"客户 2025 年新增美团闪购专项预算，占线上费用 12%，原树无对应因子","source":"interview","evidence":"inputs/interview-minutes/2026-07-30-trade-mkt.md","decidedBy":"张伟","gate":"d-1.4","promote":null}
```

### 5.3 让账本必然被写（否则它就是一份自觉表）

三条机制，缺一条账本就会烂掉：

1. **`close` 拦截。** Orchestration 的 `close` 在跑 predicates 时增加一条：若本次交付物修改了它独占的 store 中**已存在**的对象（即不是首次生成），而 `change-ledger.jsonl` 中没有 `deliverable` 匹配且 `at` 晚于上次 close 的行 → 拒收，提示"本次改了 N 处，账本里 0 条"。这把"记账"从美德变成交付条件。
2. **`reason` 非空由 predicate 校验**，不由 Skill 自觉。空理由的账本行比没有账本更坏——它制造了留痕的假象。
3. **AI 不得填 `decidedBy`。** 与 §2.2"AI 永不直接改状态"同源：账本记的是人的决定，AI 写的是草案。`selftest` 加一条对抗断言——产出型 Skill 写入 `decidedBy: ai`（或任何非人值）必须被拦。

### 5.4 `promote` 通道的具体形态

**状态：已实现**，落在 `retrospect` Skill（交付物「复盘与沉淀」，`artifacts/s3/retrospective.md`），
与这一节写的形态有两处有意偏离，见本节末尾。

```
state.py promote <工作区>          ← 只汇总，不判断、不写
  ① 读 metadata/change-ledger.jsonl 与 metadata/skill-feedback.jsonl
  ② 按来源分类；另捞因子树里 status: rejected 的行
  ③ 交给 retrospect 逐条呈现选择题（H 类，AI 只提名不入库）
  ④ 人批准的写 knowledge/ 并在 index.yaml 登记，带来源戳；
     裁决落在签核过的复盘报告里
```

**提名信号（决定"推荐"选哪个，不决定结果）：**

| 信号 | 含义 | 权重方向 |
|---|---|---|
| `source ∈ {client-report, interview, client-request}` | 客户实证，不是 AI 猜的 | **强正**——AI 提议的变更升级进沉淀区，等于让模型自己给自己写规则 |
| 同一 `ref` 被 ≥2 次 gate 引用 | 本项目里反复确认过 | 正 |
| `object ∈ {factor(L1/L2 层), enum, definition}` | 复用面大 | 正；`object == factor` 但落在 L4 具体指标名上则为负——L4 是客户特定的 |
| `object == caliber` 且 `ref` 含客户品牌/系统名 | 客户特定口径 | **强负**——它属于这个项目，不属于行业 |

**呈现（照 §4.1 话术规范第 4 条，候选+推荐+后果）：**

```
【回流 3/11】新增因子「即时零售补贴」
本项目来源：访谈（Trade Mkt，2026-07-30），已过 d-1.4，后续 5 处引用
  A. 升级为饮料行业包的因子骨架（推荐）—— 之后每个饮料项目的因子树起底自带这一行；
     行业包是实时读取不拷贝，已有项目下次 gate_check 立刻生效
  B. 升级为跨行业方法论 —— 不推荐：即时零售补贴是快消渠道特有的
  C. 只留在本项目 —— 下一个饮料项目要重新发现一次
  D. 拒绝并记原因
```

**写入沉淀区时的三条约束：**

- **带来源戳**：每条 knowledge 条目写 `provenance: {project, gate, at, ledgerRef: c-0014}`。出问题能回到是哪个项目、哪次 gate 引入的——这是今天 beverage pack 最缺的东西。
- **数字类条目走 `cases/`**：见 §4.2。ROI/Contribution 这类数字，单项目只能进 `cases/<project>/`，≥2 项目独立确认才能进 `industry/`。
- **`promote` 是 `knowledge/` 的唯一写通道**（§2.2 所有权矩阵）。**已落地**：`check_suite` 里的「只有 retrospect 的流程能写 knowledge/」，扫描除 `retrospect` 外每个 Skill 的 references 与 scripts，出现写库指令即失败。

**两处有意偏离本节的设计：**

| 这一节写的 | 实际做的 | 为什么 |
|---|---|---|
| 账本行回写 `promote` 状态 | 不回写。裁决落在签核过的复盘报告里 | 账本是只追加的，回写就得改行；一份能改写的账本记录的不再是发生过的事 |
| 通道叫 `orchestrator promote` | 通道在 `retrospect`，编排层只交棒、开确认、记裁决 | 公理 A2/A3：出卡片和落地是干活，记裁决是编排。原来的写法让 `promote.md` 指示走 `decide`，而流程里根本没有对应的门——那条指示从来执行不了 |

另外，本节没有覆盖的一半也一并实现了：**用户对 Skill 本身的纠正与习惯**（`metadata/skill-feedback.jsonl`，见 `shared/skill-feedback.md`），收尾时变成对 Skill 文件的修改。原设计只有"项目 → 知识库"这一个方向。

### 5.5 账本与 decisions.log 为什么不合并

一次 gate 通过可能对应 0 条或 20 条内容变更。合并成一份日志，"这次 gate 里改了 7 行因子"会被淹没在一行 `approve` 里；分成两份并用 `gate` 字段互指，两个问题（**过没过** / **改了什么**）各自有一个能一眼看完的答案。这与 `state/` 与 `artifacts/` 分开的理由是同一条：一份文件回答一个问题。

---

## 6. 落地顺序（按"改动小、止血快"排）

| # | 动作 | 影响面 | 为什么排这个位置 |
|---|---|---|---|
| 1 | 从 `index.yaml` 摘除 `workflow.json` / `wide-table-schema.json`，文件移入 `docs/specs/platform-contracts/` | 2 行 YAML + 2 次 `git mv` | 死条目会被 prose recall 当依据召回并落戳。**先止血** |
| 2 | **吸收 `tpl-bev-knowledge` 的 2 条笔记 + `tpl-bev-rules` 的"批发并入 TT"** → `knowledge/industry/food-bev/beverage/notes.yaml` | 1 个新文件，约 150 字 | **投入产出比最高的一条。** 三条加起来不到 150 字，各自能防住一类系统性错误（外部冲击被算成媒体效果 / 冰柜×陈列 VIF 膨胀 / 批发稀释 AFH） |
| 3 | 拆 `factor-ranges.json`：方法论字段迁出到 `knowledge/methodology/business-review.yaml` | 1 个新文件 + 3 个字段迁移 | 六步框架现在只有饮料项目读得到，且没人读。迁出后立刻对全行业可用 |
| 4 | 登记 §2.2 的两处规则冲突裁决（2.11 求和 vs 求积、2.33 四处不一致） | 一段文字 | 裁决今天只存在于代码里。写下来的成本是十分钟，不写的成本是下一个人重新发现 |
| 5 | **吸收 94 行饮料因子树骨架** → `knowledge/industry/food-bev/beverage/factor-tree-skeleton.yaml`（去数字），数字进 `cases/` | 1 个新文件 + 一次结构/数字切分 | `factor-tree derive` 的行业依据从 23 行变 94 行（45 个 L4）。**这是 `recall()` 返回 `None` 的真正解法** |
| 6 | 新建 `metadata/change-ledger.jsonl` + `close` 拦截 + `reason` predicate | 一个格式约定 + 一条 predicate + 一条 selftest 断言 | `promote` 通道的前置条件。**没有账本，回流无从谈起** |
| 7 | 吸收分层访谈框架（3 层 × 12 角色 × 三段式）→ `knowledge/methodology/interview-framework.yaml`，**不吸收 94 条 Mizone 题目** | 1 个新文件 | `interview outline` 今天从零生成提纲。框架是通用的，题目是一家客户的 |
| 8 | 新建 `skills/data-engine/templates/data-dictionary.yaml` | 1 个模板 | runtime 第一个 `templates/` 目录，同时补上"数据出问题找谁"的缺口 |
| 9 | 新建 `knowledge/methodology/chart-reading.yaml`（含 `tpl-general-knowledge` 的 Chart book 骨架） | 1 个新文件 | 把 business-validation 的 C 步骤从自由发挥变成有限清单 |
| 10 | 新建 `skills/data-quality/templates/quality-scorecard.yaml`，含 Brand/Channel 四联列 | 1 个模板 + `quality.scorecard` 补字段 | 让"客户有但没给"与"客户根本没有"分得开 |
| 11 | `master.assemble` 实现 `Variable no. / Metric no.` | 1 个 Tool 改动 | 交付给下游的表要让下游认得出变量 |
| 12 | 新建 `knowledge/cases/` 分区，迁 Danone 数字，`index.yaml` 加 `kind: case` 与 provenance 戳 | 1 个新分区 + lookup 返回值加字段 | 改动最大，但它把"注释里的提醒"变成"跟着数字走的标签" |
| 13 | `index.yaml` 为 `health/medical-nutrition` 写空占位 | 5 行 YAML | 防住"没找到就退到饮料包"。等第一个 HCP 项目用 `promote` 填它 |

**关于 `recall()` 返回 `None`：** 第 2、5、7、9 条都是在往库里放东西。**在库空的前提下去实现 `recall()` 的检索逻辑是本末倒置**——今天召回不到不是因为适配器没写，是因为没有东西可召回。先填库，`recall()` 用最朴素的按锚点读目录 + 关键词过滤即可，不需要向量库。

---

## 附：核对方法

- 上游 19 个文件全部逐行读过；`机器可读/` 的 5 份 JSON 与 runtime 副本做过 `json.tool` 归一化 diff，**全部逐字节相同**（包括平台缺口清单 §1 第 6 条提到的扫描错字"克品/兑品/礼账/暻光量"——两侧均已清洗，无残留）。
- "无人读"的判定：对 6 个文件名在全仓库（排除 `.venv`、`.git`）做 grep，`workflow.json` 与 `wide-table-schema.json` 除 `knowledge/index.yaml` 自身外零命中；`businessAnalysisSteps` / `drilldownTrigger` / `factorTreeLevels` 三个字段名同样零命中。
- "无 templates/ 目录"的判定：`find . -type d -name templates`（排除 `.venv`）零命中于 `skills/`。
- `backend/data/templates/_index.json` 逐模板解析计数（94/94/4/2/3），L1 分布与 distinct L4 数为程序统计，非目测。
- 第二行业的判定基于三处交叉证据：00 §9 的承诺、08 §10.1.11 的"已排除"、`_index.json` 只有 `food-bev/beverage` 与 `general` 两个 industry 值；并核对了平台行业分类树 `backend/app/domain/industries.py` 的 14 个 L1 中无 HCP/医务节点。
