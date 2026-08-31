# 有意放弃登记表

**依据：** 架构宪法 `2026-08-08-architecture-and-methodology.md` §5——"放弃是登记出来的决定，不是沉默"。
**范围：** 平台 `AgenticMMM0612 V2` 的全部能力面：产品架构（08）、项目管控（05）、前端（`frontend/src/`）、整包 vendor 的四个开源栈、后端 ASR/LLM、建模与报告阶段。
**登记口径：** 只登记 runtime **不打算要**或**尚未有**的东西。已经继承的（M/A/C/H 打标、gate 协议、禁用词表、交互三原则、Artifacts-Driven 与六态、星型编排）不在本表，它们在宪法正文里。

---

## 0. 先说结论

**放弃得对的（占绝大多数）：** 三个整包 vendor 的开源栈（dagster / cube / lightdash）**平台自己就没用**——零引用，且各自的职责已被平台手写的 494 行 orchestrator、`dbt/target_schema.py` 与 Graphic Walker 接管。Copilot 常驻面板在一个跑在 Claude Code 里的插件上是套娃。周计划/甘特/每日指派/SLA 升级是给"一个进程服务多个项目、人不在场"设计的，而 runtime 是"一次会话一个目录、人就在对面"。前端的 21,000 行里，绝大部分是把已经存在的信息**画出来**——信息结构 runtime 全都有（D6：形态降级，信息结构不降级）。

**真的缺了的（原六条，见 §7；其中两条已补上）：** ~~修改留痕~~（2026-08-09 已补）、
~~Insight 的 gap/conflict 两类~~（2026-08-17 已补，见 §7 第 2 位）、审计日志里的模型版本、
项目记忆里的口径结论、gate 的紧急度、连续失败转人工。这六条的共同点是：**它们解决的问题在 runtime 里一样存在，而 runtime 既没有实现也没有等价物**，且每一条的代价都在"一个字段 + 一条断言"这个量级。

**一条容易搞错的事实：** 平台**没有实时多人协作**。整个 `frontend/src/` 里零 yjs / CRDT / WebSocket / Liveblocks，同步方式是每 1.5 秒轮询 `/api/state`。"协作"在这个平台里指的是**人机协作**。所以"放弃了实时协作编辑"这句话如果写进登记表就是错的——该写的是"放弃了 AI 提案 / 决策收件箱 / 活动流这三个 UI 平面"。

---

## 1. 产品架构与协作机制（08 文档）

| # | 平台能力 | 平台出处 | 它解决什么问题 | runtime 的替代 | 放弃理由 | 什么条件下重审 |
|---|---|---|---|---|---|---|
| 1 | 双平面协作架构（流程平面 ‖ 协作平面） | 08 §4.1 | 流程保证事按序发生，但人需要在任意时刻深入任意资产 | **会话本身就是协作平面**；不设两个平面 | 两个平面的分离是 GUI 才需要的概念——在对话里"深入一个资产"就是读一个文件，不需要另开一个面 | runtime 变成常驻服务、多人同时在一个工程上工作 |
| 2 | Artifact Workspace（主视图 + AI 侧栏 + 血缘条 + 版本/diff 条）的四个动词：问 / 挑战 / 改 / 比 | 08 §4.2 | 单个资产的检视、质疑、修改、对比集中在一处 | 问=直接问；改=改 YAML；比=变更表。**"挑战"无专门形态**（见注 A） | 形态降级、信息结构不降级（D6）。血缘由 artifact meta 的 `grounding` / `knowledgeRecall` / `derivedFrom` 承载 | 见 §7 第 2 条（"挑战"的实质是 conflict 类洞察） |
| 3 | Insight Engine：cross-link 关联 / gap 缺口 / conflict 矛盾 / recall 联想 | 08 §5.1–5.4 | 线性流水线看不见跨阶段、跨资产、跨项目的联系 | **无。** `orchestrator status` 的 Problems 段是 conflict 的静态雏形 | cross-link 与 recall 需要跨项目语料库与向量检索，runtime 一次只看一个目录 | **gap 与 conflict 值得重审 → §7 第 2 条** |
| 4 | InsightCard 的硬约束：≥2 个证据锚点、必须带 suggestedAction、dismissed 须选理由 | 08 §5.4 | 防止"AI 洞察"退化成噪音 | 无（因 3 一并放弃） | 随 3 | 若重新引入 gap/conflict，**这三条约束必须一起引入**，否则会得到一堆无法行动的观察 |
| 5 | Copilot 常驻面板（全局上下文、只读分析、血缘溯源问答、起草任意 Proposal） | 08 §6 | 用户随时提任意问题而不新开一条绕过治理的写入路径 | **runtime 就跑在一个 Copilot 里** | 套娃。平台需要它是因为平台的主界面不是对话；runtime 的主界面就是对话 | 不重审 |
| 6 | Proposal→Apply 唯一写入通道 + Proposal 的 `targetArtifact.version` 过期失效 | 08 §3.1–3.2 | AI 永不直接改状态；基于旧版本的提案自动失效 | 唯一写入通道**已继承**（A2/§2.2 所有权矩阵）。版本失效的等价物是 `gate_check` 的 `evidence_drift()` 提示 + `state.py reopen` 级联重置下游 | 版本号机制需要一个 artifact 服务；文件系统上的等价答案是哈希漂移 | 若出现并发写同一 workspace 的场景 |
| 7 | 三道闸中的**闸①自动打回**（schema 校验失败自动退回 AI 重试，不进人审） | 08 §3.3 | 机器可判的错误不消耗人的注意力 | predicate 失败会让模型看到错误再改——**行为等价，但没有重试次数上限** | runtime 的闸①②合并在 `gate_check.py` 里，效果相同 | **重试上限值得重审 → §7 第 6 条** |
| 8 | confidence 置信降级（`< 0.7` 从"可一键 Apply"降为"必须人改写"） | 08 §3.4 | 低置信产出不该一键采纳 | **无。** runtime 不产生 confidence 数值 | 模型自评置信度不可信。runtime 的替代逻辑是"数字必须报出处"——**有出处比有置信度更硬** | 不重审（该机制的正确形态在 runtime 已经是 provenance） |
| 9 | 连续 3 次同任务低置信 → 通知项目管控转人工 | 08 §3.4 | 防止无限重试循环 | **无** | 随 8 一起被放掉了 | **值得重审 → §7 第 6 条**（防循环与置信度无关） |
| 10 | 可复现性分层（M 严格可复现 / A·C 可追溯+可验证） | 08 §3.5 | 审计时诚实区分"机器算的 / AI 写的 / 人定的" | **部分继承**：`computed_by_tool` 与 `view_derived_from` 覆盖了 M 与 view；A/C 的"prompt/模型/证据全留痕"**缺模型版本** | — | **模型版本值得重审 → §7 第 3 条** |
| 11 | AI Cognitive Options（AI 权衡多个方案、自动选推荐项、非阻塞、随时可改） | 08 §10.1.14（B-15） | 体现 AI 的认知能力而不只是执行；又不因此卡住流程 | **无。** runtime 的选择题一律阻塞（gate） | runtime 的 §4.0 澄清协议与 gate 都是阻塞式的，刻意如此——非阻塞的"AI 已经替你选了，你随时可以改"在一个会输出文件的环境里等于"没人会去改" | 若 runtime 出现长时间无人值守运行的模式 |
| 12 | LangGraph 后端编排图（管控为中心节点、`interrupt()` 映射人工节点） | 08 §10.2 | 多智能体编排的运行时 | manifest + orchestrator skill + Claude Code 会话 | 平台自己也标注"暂不实施，仅记录约束" | 不重审 |
| 13 | Artifact 生命周期 `draft→proposed→confirmed→frozen` + `staleness()` 主动过期广播 | 08 §8 | 下游能知道自己依赖的上游已经变了 | `progress.yaml` 的 pending/done + gate verdict + 签核冻结（gate-protocol 第 3 条）+ `reopen` 级联 | 被动（reopen 时级联）而非主动（广播），单会话下等价 | 并发场景 |

**注 A —"挑战"这个动词。** 平台的 §4.2 举例："这个弹性为什么这么高" → AI 组装证据回应，**或承认存疑并建议动作**。runtime 里最接近的是 `mmm-tool <id> --explain`（读工具实现）与 tool trace（读运行记录）。差别在于：平台的"挑战"会**产出一个 Proposal 或一张 conflict 卡**，runtime 的追问只产出一段对话。这条与 §7 第 2 条是同一件事的两面。

---

## 2. 项目管控与调度（05 文档）

| # | 平台能力 | 平台出处 | 它解决什么问题 | runtime 的替代 | 放弃理由 | 什么条件下重审 |
|---|---|---|---|---|---|---|
| 14 | 周计划 / W0–W10 甘特（任务 × 周 × Owner） | 05 §2.2 | 一个 10 周的项目需要一张排期图 | **无** | 排期是项目经理的工作，不是流程引擎的。runtime 回答"下一步做什么"，不回答"这周做什么" | 不重审 |
| 15 | 优先级分层（数据 Task 分 1–4 级，决定检查顺序） | 05 §2.2 | 37 个数据 task 谁先谁后 | 依赖图决定顺序；**同层内无序** | 依赖图已经排掉了硬顺序 | **值得重审 → §7 第 8 条** |
| 16 | 每日指派（任务 × 日期 × 执行人矩阵，XJ/TL/Beth） | 05 §2.2 | 多人团队的分工 | **无** | runtime 是一人 + AI。指派给谁这件事没有第二个候选 | 团队协作场景 |
| 17 | 延迟跟踪（计划 vs 实际 −4/−2/0）+ 关键路径延迟自动重排下游 | 05 §2.2 / §2.3 | 延期预警 | **无** | 没有计划日期就没有延迟。runtime 不记录任何时间承诺 | 随 14 |
| 18 | SLA 跟踪与升级（超时未处理升级到项目负责人） | 05 §4.2 | 待办被晾着没人管 | **无** | 会话里没有"超时"——人就在对面，gate 呈现出来就是在等他 | 若 runtime 以异步任务形式运行（提交后离开） |
| 19 | 里程碑 M1–M5 + 阶段准入条件（未 sign-off 的数据不得入模） | 05 §2.1 | 防止在不合格输入上开工 | **已继承**：`closes_stage` + gate 依赖 + `depends_on`；"只能由人关闭"= signoff gate | — | — |
| 20 | 回边（回流路径）一等公民 + **记录回流原因** | 05 §2.1 | 返工是常态不是异常 | 回边**已继承**（`state.py reopen` 级联重置下游）；**回流原因只有一个自由文本 note** | — | 回流原因应并入 §7 第 1 条的变更账本 |
| 21 | 全平台 Gate 路由表 11 条（触发条件 / **路由对象** / **紧急度**） | 05 §4.1 | 不同的失败要找不同的人，且轻重不同 | gate 挂在交付物上，谁的 gate 谁开；**无路由对象、无紧急度** | runtime 只有一个人 | **紧急度值得重审 → §7 第 5 条** |
| 22 | 人工介入收件箱（证据 + AI 建议 + 候选处置 + 驳回回炉目标） | 05 §4.2 | 待办集中在一处 | gate 呈现**已继承全部四要素**；"收件箱"这个聚合视图由 `orchestrator status` 承担 | — | — |
| 23 | 审计日志含 **LLM 模型版本**（05 原文标注为产品硬要求） | 05 §5.1 | "这份判断是哪个模型做的" | `tool-runs.jsonl` + `decisions.log`；**无模型版本** | 漏掉的，不是想放的 | **值得重审 → §7 第 3 条** |
| 24 | `change_tracker` 修改留痕（因子/指标/口径/先验的增删改） | 05 §5.2 · 08 §10.1.1 | "记录每个项目都因为什么补了什么、删了什么"（StatusCheckList 原文） | **无。既无实现也无等价物** | 漏掉的 | **头号重审项 → §7 第 1 条** |
| 25 | `knowledge_review` 知识回流评审（G0.3） | 05 §5.2 · §7 | 项目定制沉淀回行业包 | **已实现**：`retrospect` Skill，交付物「复盘与沉淀」，带 `retrospective/promote` 签核门；两处偏离见 knowledge-inventory §5.4 | — | 不重审 |
| 26 | 项目记忆：当前阶段 · 未决 Gate · **关键口径结论** · **客户偏好**，注入每个 agent 会话 | 05 §5.3 | 10 周的项目不该反复问已经定过的事 | 前两项由 preflight（读 mmm.yaml/progress/manifest）+ `orchestrator status` 覆盖；**后两项无载体**——`metadata/vocabulary.yaml` 在 workspace-layout 里写明了，但**无人读无人写** | — | **值得重审 → §7 第 4 条**（正是 A6 澄清协议要防的重复提问） |
| 27 | `status_reporting`（对内站会摘要 / 对客户进度摘要） | 05 §6 | 两种受众的进度汇报 | 对内=`orchestrator status`；**对客户的进度摘要无** | 对客户汇报是顾问的活儿，不是流程引擎的 | 不重审 |
| 28 | G0.1 项目计划确认 | 05 §7 | 实例化出来的任务计划要人点头 | **不需要**：runtime 的流程是 manifest 里固定的，不逐项目实例化 | 无可确认之物 | 不重审 |
| 29 | 上下文总线的版本广播 + 下游"基于过期版本"标记 | 05 §3.2 · 08 §8 | 因子树改了，下游算的是旧版 | `state.py reopen` 级联把下游全部重置为 pending | 被动重算 vs 主动标记，单会话下结果相同且更安全（重算而非提醒） | 并发场景 |

---

## 3. 前端（`frontend/src/`，约 21,000 行 / 98 个文件）

| # | 平台能力 | 平台出处 | 它解决什么问题 | runtime 的替代 | 放弃理由 | 什么条件下重审 |
|---|---|---|---|---|---|---|
| 30 | 交互式因子树编辑器 ×3（S1 采纳/剔除编辑器、共享 canvas 原语、行业模板编辑器） | `components/project/FactorTreeEditor.tsx`、`project/factor-tree/`、`knowledge/editors/FactorTreeEditor.tsx` | 逐行 triage AI 与访谈提出的因子行 | `factor-tree.yaml` 逐行编辑 + `render_tree.py` 生成 md 视图 + `review` 模式的采纳/剔除 | 树的编辑本质是改一份带层级的表；YAML 就是那份表 | 不重审 |
| 31 | **四个叠加视图**：DataProcessingCanvas / QualityCanvas / StatCanvas / OlsTreeView——在**同一棵因子树**上叠不同分析层 | `components/project/canvas/*` | "这棵树上，哪些因子映射到了数据、质量几分、统计过没过、OLS 落不落区间"——一屏看完 | 四份独立的 scorecard YAML，各自带 `treeRowId`；`funnel.yaml` 是唯一把它们合起来的地方 | 信息全在，**视角没了**（见注 B） | 若 `funnel.yaml` 在实战中被反复要求"再按树展开一遍" |
| 32 | TanStack 数据网格 + 列 profile（dtype / 空值率 / 值分布） | `components/dataeng/grid/DataGrid.tsx` | 几百行宽表的响应式浏览 + 表头即 profile | `data.profile` payload + `preview.md`（head + profile） | **信息已继承，交互放弃**。模型读 profile.json 比读网格更准 | 不重审 |
| 33 | React Flow DAG ×2：转换管线图（8 种 step、连边、dbt 构建状态着色）+ 工作流 DAG（三种泳道：Stage / Agent / Human·AI·Auto） | `components/dataeng/pipeline/PipelineCanvas.tsx`、`components/canvas/WorkflowCanvas.tsx` | 看清依赖与执行分类 | manifest 的 `depends_on` + `klass` + `orchestrator status` | 平台自己也把管线图标为"次于网格的切换视图" | 不重审 |
| 34 | Canvas 多格式渲染编辑（Excel/PPT/Word/Markdown 四种 + review/validation/olsTree/masterData 四种专用） | `components/project/canvas/ArtifactCanvas.tsx`、`lib/artifact-format.ts` | 在浏览器里像编辑 office 文档一样编辑交付物 | `export.xlsx`（openpyxl）+ `shared/lib/xlsx.py`（零依赖写盘）；**无 pptx/docx 生成** | 它渲染的是结构化 JSON，不是真 OOXML；真落盘靠 SheetJS。runtime 的交付物是文件本身 | 报告阶段若入界（D3 现为不做） |
| 35 | **人机协作三面板**：AI 提案（带来源智能体与置信度）/ 决策收件箱 / 活动事件流 | `components/assistant/`、`components/decisions/`、`components/layout/ActivityPanel.tsx` | 提案、待办、动态各有归处 | 会话本身 + `orchestrator status` + `decisions.log` + `tool-runs.jsonl` | **注意措辞**：平台没有实时多人协作（零 CRDT/WebSocket，1.5 秒轮询）。放弃的是三个 UI 平面，不是"协作" | 不重审 |
| 36 | Graphic Walker 自助 BI 探索（拖拽式，图表 spec 每 2 秒持久化） | `components/project/validation/ExploreTab.tsx` | **客户**在业务校验签核时自己换维度看 | `render.html` 的固定图表页 | 唯一一条"客户而非顾问"的交互 | **值得重审 → §7 第 9 条** |
| 37 | Data Engine 整套 UI（3,757 行 / 13 文件：资产、schema、转换三栏、按 step 类型的配置面板、发布面板、指标目录、防抖实时预览） | `components/dataeng/` | 在编辑器里边写边看转换结果 | `clean.sql` + `data.clean` + `data.conform` + `preview.md` | 无编辑器就无实时预览需求 | 不重审 |
| 38 | 多项目 landing + 项目创建 UI + 全局设置（LLM/ASR 凭证） | `components/projects/`、`components/settings/` | 一个进程服务多个项目 | 一目录一项目；`~/.mmm/workspaces.log` 只记路径 | workspace-layout 已论证："没有注册表就是设计" | 不重审 |
| 39 | 前后端四份契约同步（`blueprint.py`↔`scenario.ts`、`models.py`↔`types.ts`，`CLAUDE.md` 要求手工保持一致） | `frontend/src/lib/scenario.ts` 等 | — | **放弃 UI 即消灭这四份同步契约** | **这是收益不是损失，登记在此以免被当成损失** | — |

**注 B — 第 31 条是前端里最值得记的一条。** 平台那四个 canvas 不是四个页面，是**同一个树形原语上叠四层分析结果**（映射 / 质量 / 统计 / OLS 区间），每行带 `ok/warn/bad/muted` 色调。runtime 把这四层拆成了四份 YAML，每份都带 `treeRowId` 指回同一行——**数据模型是等价的，甚至更干净**（`master.funnel` 的六层损耗表就是把它们重新合起来的产物）。真正丢掉的是"在树的形状上看损耗"这个视角。目前的判断是：`funnel.yaml` 按 mapping / quality / signoff / statistical / selection / range 六层给出每层的死亡计数，回答的是同一个问题（"S2 是筛选还是屠杀"），且更适合口头汇报。**保持放弃，但记下这条的替代是 funnel 而不是"无"。**

---

## 4. 整包 vendor 的四个开源栈（合计 591M，全部在 `.gitignore` 里）

平台自己的 `.gitignore` 第 31–37 行写着：`# Local reference-only checkouts (large, do not commit)`。**这句注释本身就是平台对这四个栈的裁决。**

| # | 平台能力 | 平台出处 | 它在平台里承担什么职责 | runtime 的替代 | 放弃理由 | 什么条件下重审 |
|---|---|---|---|---|---|---|
| 40 | **dbt**（`dbt-core-main/`，41M） | 接入代码 `backend/app/dataeng/dbt/`（12 模块）；`config.py` 的 `dbt_bin` / `dbt_timeout` | **转换引擎，四个里唯一真接入的。** `compiler.py` 从同一套 per-step SQL 模板**双路编译**：① dbt 模型（`{{ ref }}` + enum 作 seed）——权威、把关发布、跑质量测试；② 一条自包含 `WITH` 查询（只含目标 step 的祖先）——丢进 DuckDB 沙箱做秒级预览。`_test_preview.py` 断言两路逐格一致 | `data/clean/<asset>/clean.sql` + `data.clean`（DuckDB）+ `data.conform` + `data.reconcile` | **双路编译的价值在于"编辑器里秒级预览 + 发布时权威构建"，runtime 没有编辑器，只有一条路径。** dbt 的 ref/seed/test 编排在单工作区规模上是净负担。另注：平台也不构建这个 checkout——它 shell 出去调外部安装的 dbt Fusion 二进制（钉在 `2.0.0-preview.199`），vendored 目录只是参考源码 | 当一个工程的 `clean.sql` 超过约 30 个、且开始出现跨 asset 引用（此时 DAG 编排开始有价值） |
| 41 | **dagster**（`dagster-master/`，338M，最大） | 全仓库**零引用** | 本该是编排层。平台改为自己写 `backend/app/orchestrator/`（`engine.py` + `runner.py`，共 494 行）：每项目独立 asyncio 后台任务 + 运行守卫，状态每步落 JSON，**HITL gate 与 autopilot 是一等公民** | manifest + orchestrator skill + `state.py` | **平台自己就没用它**，并写出了 494 行替代品——理由正是通用 DAG 编排器给不了"每步都可能停下来等人"这件事。runtime 的需求与平台相同且规模更小 | 不重审 |
| 42 | **cube**（`cube-master/`，81M） | 全仓库**零引用**（grep `cubejs` / `Cube` 零命中） | 本该是语义层（指标定义的单一事实源）。平台改由 `dbt/target_schema.py`（2.21 统一长表目标 schema）+ `dataeng/indicators.py`（指标目录**从因子树 × coverage 派生**）承担 | `knowledge/schema/target-schema.yaml` + workspace `metadata/schema/` + factor-tree | **平台自己就没用它，而且它想解决的问题已被因子树解决**——"指标定义"这件事的归属是因子树，不是语义层。runtime 完整继承了这个选择（"The Factor Tree IS the indicator catalog"） | 不重审 |
| 43 | **lightdash**（`lightdash-main/`，131M） | **唯一一处引用是拒绝**：`docs/superpowers/specs/2026-07-22-business-validation-self-serve-explore-design.md:42`——"**Embed Graphic Walker**, not a hand-built config layer or a Lightdash" | 本该是 BI 可视化 / 自助探索 | `render.html` | **平台自己就拒绝了它**，职责给了 Graphic Walker（即第 36 条） | 随 36 |

**一句话总结：** 四个栈 591M，其中 550M（dagster + cube + lightdash）是**平台自己都没用的只读参考 checkout**。runtime 丢掉它们零损失。唯一真接入的 dbt 也不是从这个 checkout 接的。

---

## 5. 后端能力

| # | 平台能力 | 平台出处 | 它解决什么问题 | runtime 的替代 | 放弃理由 | 什么条件下重审 |
|---|---|---|---|---|---|---|
| 44 | **ASR 语音转写**（104 行 / 2 文件，OpenAI 兼容 Whisper，25MB 守卫，600s 超时） | `backend/app/asr/whisper.py`；处理器 `agents/business.py:1076` `transcribe_audio()`（任务 1.4b） | 客户访谈**录音** → 文字。转写结果作为 `.transcript.txt` sidecar 写回同一 category，下游 `writeback_minutes` 零改动消费；每文件带 `asr_status` 状态；未配置时出一条 finding 而**不硬阻塞** | **无。** `inputs/interview-minutes/` 只收文本 | Claude Code 环境没有稳定的音频输入通道；且访谈录音是敏感材料，让顾问自己转写是更合适的边界 | **值得重审（低位）→ §7 第 7 条** |
| 45 | **LLM 可切换层**（282 行） | `backend/app/llm/volcano.py` + `store/model_service.py` | **重要更正：不是多 provider 抽象。** 单 provider（Volcano Ark，OpenAI 兼容），无基类无注册表；可移植性来自把 base_url/model/key 做成运行时配置。282 行里绝大部分在对付两件具体的事：① 端点不支持 `response_format`，要从代码围栏/自由文本里健壮抽 JSON；② **该网关把 429 报成 HTTP 400**，且突发后**罚 10 分钟锁定**，naive 重试会把瞬时限流变成十分钟"每个 grounded 步骤静默返回空结果" | Claude Code 的模型层 | runtime 不自己调 LLM | 不重审代码。**但第 ② 条的教训值得作为知识留存**——"限流被伪装成别的错误码时，静默降级比失败更危险"，与 runtime 的"empty is a finding"（conventions §9）是同一条原则 |
| 46 | 多格式入站解析（pdf/pptx/docx/xlsx/csv） | `backend/app/ingest/extract.py` | 客户交付的材料是各种格式 | **已继承**：`mmm_engine/dataeng/extract.py`（pypdf / python-pptx / python-docx） | — | — |
| 47 | 多项目 store + `heal_state()`（新 blueprint task 回填到已存项目） | `backend/app/store/state.py` | 流程升级后老项目不炸 | 一目录一项目 + `new_workspace.py --migrate` | — | — |
| 48 | 工具注册表 + `inspect.getsource` 实时读源（文档不会漂） | `backend/app/tools/registry.py` | 工具文档与实现同步 | **已继承**：`mmm-tool <id> --explain` | — | — |
| 49 | `allow_reference_fallback`（默认 False：没数据的项目必须阻塞，不得静默用别人的数字） | `backend/app/config.py` | 防止跨项目数据串味 | **已继承且更强**：runtime 连参考数据都不装（"the runtime carries no engagements"） | — | — |

---

## 5b. 数据质量判据里被替换掉的两条（2026-08-11）

新版打分规则重写 `data-quality` 时，两条旧判据被替换而不是补充。两条都是有意的，
两条都有代价，记在这里。

| 被换掉的 | 换成了 | 代价 | 什么条件下重审 |
|---|---|---|---|
| **数据完整性按历史跨度算**（≥24 个月 1 分 / 12–24 个月 0.5 分 / <12 个月 0 分） | **按缺失率算**（无缺失 1 分 / <10% 0.5 分 / ≥10% 0 分），分母是「该序列报出的格子数 × 档案时间窗的月数」 | **「历史不足两年建不了模」这条在质量层不再单独拦。** 一个只有 8 个月、但这 8 个月很完整的指标现在拿满分。这道防线只剩统计检验层的 `MIN_SCORED_MONTHS = 12`——它判不可用、总分 0，但那是在业务校验签核之后，比质量层晚两步 | 若出现「短历史指标一路活到 OLS 才被发现」的实例，就在完整性维度下补一个独立的「历史覆盖」子项，而不是把缺失率改回去 |
| **连续性子项**（实际期数 / 日历跨度，≥95% 1 分 / 其余 0.5 分） | **整项删除**，缺月由数据完整性的缺失率承担 | 几乎没有：它的 `<80%` 与 `<95%` 两个分支返回同一个分，意味着缺了 90% 月份的序列和缺了 15% 的得分一样，而且它是建议型、本来就不阻断 | 不重审。它测的东西现在被测得更准，而且是阻断的 |

新规则同时新增两条**需要外部输入**的判据。它们不是「没做」，是「做了但缺料」：
`consistency.dimension` 要长表的 `unit` 列，`accuracy.business` 要
`metadata/reference-totals.yaml`。缺料时它们 `computed: false`、恒 1 分、不阻断，
并在视图与 Excel 上渲染成**「未校验」**。料一到位，同一份判据自动变成可计算且阻断——
这是本次唯一一处「先把接口留出来」的设计，理由是这两项是全套规则里仅有的真正在做
交叉校验的，而"没查"被渲染成 1 分曾经是这张表上最容易被误读的两格。

---

## 6. 建模与报告阶段（平台 3.x / 4.x）——用户已裁决不做

| # | 平台能力 | 平台出处 | 它解决什么问题 | runtime 的替代 | 放弃理由 | 什么条件下重审 |
|---|---|---|---|---|---|---|
| 50 | 3.1 先验设置规则 | 03 文档 · `reference/03.模型智能体/` | 把业务假设量化为模型参数约束 | 无 | D3 裁决不做。**且平台自己没写完**——06 §1 缺口 1：该文件"仅含 README 一行（需要与 3A 对应），正文为空" | 范围扩展到建模 |
| 51 | 3.2 模型调优规则 | 06 §4（草案） | 调参寻优的规则约束 | 无 | D3。**平台侧也只有一份未经业务确认的草案**（06 §1 缺口 2："无文件"） | 同上 |
| 52 | 3.3 技术检验（R² 85–95% · MAPE 5–15% · DW 1.5–2.5 · Negative Base/Coeff 红旗即停） | 03 文档 · 05 §4.1 | 模型技术质量把关 | 无 | D3 | 同上 |
| 53 | 3.4 业务检验（弹性偏离先验 >30% 亮红灯） | 05 §4.1 | 模型结果不反常识 | **runtime 在 S2 就做了一个轻量版**：`ols-test` 的区间反常识判读（`ols.scorecard` 对照行业带） | D3；且 runtime 的范围止于模型输入锁定，OLS 只用于**选变量** | 同上 |
| 54 | 4.1 报告生成（Group1–6 与因子树映射、5D 解读、Chart book） | 04 文档 | 交付客户的报告 | 无 | D3。06 §1 缺口 9 记着 Group1–6 的映射"只给了实例，无生成规则" | 范围扩展到报告 |
| 55 | 预算优化 / SimulationStudio | 08 §10.1（裁决 D1） | what-if 与预算分配 | 无 | **平台自己已裁决出范围** | 不重审 |
| 56 | 贝叶斯层级模型设计（region/storetype/product channel 层级，PFME by L3，product halo by L2） | `Data Analysis_2.32Charting.xlsx` 的 `6.MODEL Design`；R + Stan MCMC 脚本 | 医学营养品案例的建模范式 | 无 | D3；且它属于另一个行业案例（见知识清单 §4.3） | 同上 |
| 57 | Meridian / PyMC 模型后端 | 08 §9 确定性引擎层 | 正式 MMM 求解 | `mmm_engine/mmm/`（numpy `lstsq` 的轻量 OLS，仅用于 2.5 预验证） | D3 | 同上 |

---

## 7. 值得重新考虑的放弃

按"价值 ÷ 代价"排序。每条给出**补它的代价**与**不补的后果**。

### ~~第 1 位：修改留痕（变更账本）~~ —— **已补上（2026-08-09）**

- **平台出处：** 05 §5.2（原文引自 StatusCheckList：「需要有个地方记录每个项目都因为什么补了什么，或者删了什么，后续需要以此来维护知识库」）· 08 §10.1.1 已实现的字段：**增/删/合并 × 原因 × 来源 × 确认人**，接受建议变更时自动追加。
- **runtime 现状：** `state/decisions.log` 记的是**gate 过不过**，不是**改了哪几行、为什么**。因子被删、口径被改、枚举被加，理由只活在被覆盖的 YAML 文件之外。全仓库搜 `变更 / 留痕 / 账本 / 假设` 只命中宪法本身。
- **为什么它是真缺口：** 它解决的问题在 runtime 里**一模一样地存在**——一个因子在 d-1.21 被剔除，三周后客户问"为什么没有 KOL"，今天答不出。而且宪法 §4.4 的 `promote` 回流通道**以它为前置条件**：没有账本，`promote` 只能对着最终态的因子树猜每一行是哪来的。
- **代价：** 一个 JSONL 格式约定（13 个字段）+ `close` 的一条拦截 predicate（改了已存在的对象却没写账本 → 拒收）+ `reason` 非空校验 + 一条 selftest 对抗断言（AI 不得填 `decidedBy`）。**完整设计已写在 `knowledge-inventory.md` §5.2–5.4，可直接实施。**
- **收益：** ① 回答"为什么"；② 解锁 `promote`；③ 复议时不必重新论证；④ 顺带承载"回流原因"。
- **实际落地：** `metadata/change-ledger.jsonl`（只能追加）+ `shared/lib/changes.py` +
  `state.py record-change`，由编排层在人拍板之后写。`why` 与 `decidedBy` 为空直接拒写。
  与设计的差异：**没有加"改了对象却没写账本就拒收"的拦截检查**——那会让已有工作区
  的既往步骤集体失败，且账本的价值在于内容而非覆盖率。改为在 `status` 的问题段里提示。

### ~~第 2 位：Insight Engine 的 gap 与 conflict 两类~~ —— **已补上（2026-08-17）**

- **实际落地：** 做成访谈的第五个能力 `interview/insights`（可选步骤），产出
  `artifacts/s1/interview/insights.yaml` 与 `assumptions.yaml`，加两条判定式
  `insights_actionable` / `assumptions_answerable`，Word 版由
  `apps/report/interview_insights.py` 渲染。
- **三条前置约束是一起进来的**（下面那段写着"若引入必须一起引入"的那三条）：
  每条洞察 ≥2 个证据锚点、必须带可执行建议、被忽略的要写忽略理由。
  三条都做成了会失败的断言，不是文档里的嘱咐——`selftest.py` 里各有一条正反用例。
- **`kind` 只开放 `gap` 与 `conflict`**，`cross-link` 与 `recall` 仍然不做，理由不变：
  它们要跨项目语料与向量检索，而 runtime 一次只看一个目录。写进判定式，
  出现别的 `kind` 直接失败——这样"不做"是一条会响的规则，不是一句备忘。
- **与原设计的一处差异：** 关键假设（`assumptions.yaml`）不在原提案里，是这次一并做的。
  它解决的是同一个问题的另一半：洞察说"这里有个缺口"，关键假设说"这个设定没人背书"。
  它的读者在 S2——`stat-screening/score` 与 `ols-test/fit` 的取材范围里都加了它。
- **没做的一处：** 洞察上限 3 条那个约束没有实现。平台设它是为了防 UI 卡片刷屏，
  而这里的约束是"每条都要能执行"，能执行的洞察多几条不是问题。

<details>
<summary>原登记内容（备查）</summary>

#### 第 2 位：Insight Engine 的 gap 与 conflict 两类 — 登记表 #3

- **平台出处：** 08 §5.3。**gap** = 沿 KBQ↔数据Task↔模型变量↔报告图表 这条链做覆盖扫描找断点（例："KBQ A19 没有任何数据 Task 支撑"；"朗镜数据仅 5 个月，竞品门店执行因子将无法入模"）。**conflict** = 已确认结论之间的逻辑冲突（例："客户确认的弹性上限 0.7 与近三月数据趋势冲突"；"财务口径 100M ↔ 营销收数 87M，超 10% 容差"）。
- **为什么只重审这两类：** cross-link（跨资产语义关联）与 recall（跨项目联想）需要跨项目语料与向量检索——runtime 一次只看一个目录，放弃是对的。但 **gap 与 conflict 是纯粹的静态可判定检查**，不需要任何检索。
- **runtime 现状：** `orchestrator status` 的 "Problems" 段落**已经是 conflict 的雏形**（`truncated: true`、`knowledgeRecall: none`、不该为零的计数、签了核但还有未决行的 gate、比核准时间更新的 artifact）——但它是一段人写的检查清单，不是会失败的断言。gap 侧只有 `coverage_complete`（只覆盖 data-request 一段）与 `funnel.yaml` 的 `notSupplied`。
- **具体缺什么：** ① **跨交付物的覆盖链扫描**——从访谈问题一路查到模型输入，哪一段断了；② **"客户已签核的结论与后续数据矛盾"**——runtime 完全没有，而 `business-validation` 的逐图签核恰恰制造了大量"已确认结论"。
- **代价：** 把 status 的启发式升格为一组具名 predicate（每条一个函数 + 一条 selftest）。中等。
- **前置条件：** 若引入，**必须一起引入 #4 的三条约束**（≥2 个证据锚点 / 必须带可执行建议 / 忽略要选理由），否则会得到一堆无法行动的观察——平台自己写着"洞察必须能落回流程，否则就是噪音"。

</details>

### 第 3 位：审计日志记录模型版本 — 登记表 #23 / #10

- **平台出处：** 05 §5.1 明确标注为产品硬要求：「含 LLM 模型版本——产品要求 LLM 可切换，必须记录每次产出用的是哪个模型」。08 §3.5 把它列为 A/C 类产出"可追溯"的构成之一。
- **runtime 现状：** `tool-runs.jsonl` 记 `at / tool / task / argsDigest / status / ms / out / payloadSha`——**M 类完备**。artifact meta 记 `task / skill / mode / generated / grounding / knowledgeRecall`——**A/C 类缺模型标识**。今天答不出"这份因子树是哪个版本的 Claude 写的"。
- **为什么是真缺口：** 模型换代会改变判断。一份三个月前的因子树，如果模型换过，重跑结果不同是正常的还是回归，今天无法区分。
- **代价：** **本表最便宜的一条**——artifact meta 加一个 `producedBy` 字段（模型标识 + 时间），`check_suite` 加进 `REQUIRED_META`。半小时。
- **收益：** 让"可追溯"这三个字在 A/C 类上真正成立，而不是只在 M 类上成立。

### 第 4 位：项目记忆里的"关键口径结论"与"客户偏好" — 登记表 #26

- **平台出处：** 05 §5.3。平台的例子极具体：客户确认「WD 按 NAB 销售额加权」之后，这条成为**全局口径注释**注入每个后续 agent 会话（05 §3.2 的上下文同步矩阵里也单列了"数据口径备注 / 客户 Q&A 结论"这一行）。
- **runtime 现状：** `metadata/vocabulary.yaml`（每项目角色关键词覆盖）在 `shared/workspace-layout.md` 里被写明了，但**全仓库无读者也无写者**。口径结论今天只活在某次 gate 的 `note` 里，preflight 不读 `decisions.log` 的正文。
- **为什么是真缺口：** 这**正是宪法 A6 与 §4.0 澄清协议要防的事**——"已登记的事项，任何 Skill 不得重问"。而今天登记的地方是一条不会被读的日志行。澄清协议已经写好了规则，缺的是那个"登记处"。
- **代价：** 让 `metadata/vocabulary.yaml`（或与第 1 位的账本合并为同一份 `metadata/`）真的被 conventions §5 的 preflight 读取，并加一条 predicate："澄清结论已写入 metadata"。小。
- **收益：** 消除重复提问——这是用户能直接感知到的质量差异，也是宪法把澄清机制化的初衷。

### 第 5 位：Gate 的紧急度与受众 — 登记表 #21

- **平台出处：** 05 §4.1 的 11 条路由表，每条带**路由对象**与**紧急度**（低/中/高）。高级别只有五种：某 L4 因子全部指标 = 0（**预警**，路由到 BA + 客户找替代数据）、客户 sign-off 拒绝、Negative Base/Coeff 红旗即停、弹性偏离先验 >30%、客户 Review 意见。
- **runtime 现状：** 所有 gate 同一种呈现。"某 L4 全部指标不达标"这件事 runtime **检得出来**（`funnel.yaml` 的 `notSupplied`），且 `master-data` 的 lock gate 要求把每个 `notSupplied` 因子逐条念出来——**但那是 S2 收尾时**。平台的设计是**在它发生的那一刻**就标成高优并指向客户。
- **为什么值得重审：** `master-data/references/lock.md` 自己写着"客户第一次在汇报会上看到这个清单是一场糟糕的会议；这是最后一个便宜的时刻"。**平台的答案是别等到最后一刻。**
- **代价：** manifest 的 gate 加 `urgency` 与 `audience` 两个字段，`orchestrator status` 按 urgency 排序。小。
- **收益：** 把"数据缺口要问客户"这件事从 S2 收尾提前到它被发现的那一步。

### 第 6 位：连续失败转人工 — 登记表 #9 / #7

- **平台出处：** 08 §3.4 后半句——「连续 3 次同任务低置信 → 通知项目管控转人工执行」。
- **runtime 现状：** predicate 失败让模型看到错误再改，**没有任何重试上限**。理论上可以在同一个 gate 上循环下去。
- **为什么与置信度无关：** 前半句（confidence < 0.7 降级）放弃是对的——模型自评不可信，runtime 用 provenance 替代。但后半句防的是**循环**，与置信度是两件事，被一起丢掉了。
- **代价：** `progress.yaml` 的任务记一个 `attempts` 计数，`gate_check` 失败时自增，达阈值时 `orchestrator` 提示"这一步已经失败 N 次，需要你介入"。小。
- **收益：** 低，但成本也低。主要价值在无人值守场景。

### 第 7 位：ASR 访谈转写 — 登记表 #44

- **理由：** 访谈是 S1 四个交付物之一，而**录音是访谈的实际入口**——平台的参考材料里是 11–12 份 docx 转录稿，说明有人做了转写这件事。"让顾问自己转 11 份录音"是真实成本。平台的实现只有 **104 行**，且设计干净（sidecar 写回同一 category，下游零改动；未配置时出 finding 而不硬阻塞）。
- **不补的理由仍然成立：** Claude Code 环境没有稳定的音频输入通道；访谈录音是敏感材料。
- **重审条件：** 若 runtime 长期跑在一个能挂音频文件的环境里。届时的正确形态是一个 Tool（`interview.transcribe`），而不是一个服务。

### 第 8 位：优先级分层 — 登记表 #15

- **理由：** 平台的数据 task 分 1–4 级，**决定检查顺序**（2.22 数据检查第 1 步就是"据 TaskLog 确认优先级，按优先级定检查顺序"）。runtime 靠依赖图排序，**同层内的 N 个 asset 无序**——一个真实工程里 `data/clean/` 下会有几十个 asset。
- **代价：** manifest 或 `asset.yaml` 加一个 `priority` 字段，`orchestrator next` 按它排。小。
- **收益：** 中等。价值在于"先把 Y 和主要媒体投放理清楚"这类顺序判断今天要靠人每次重说。

### 第 9 位：客户侧的自助换维度看图 — 登记表 #36

> **2026-08-11 · 本条已作废，理由是它被做掉了。** 见架构文档 D10。下面这段"低成本替代"的提案同时作废：预置几种切法解决不了真实的状态空间（时间粒度 × 品牌 × 渠道 × 区域 × 数据来源子集 × L4–L8 路径 × 指标子集），它只是把同一批算术预先做完再塞进页面。实际做法是页面内嵌窄化过的长表、在浏览器里按 payload 指定的口径归约，并用 `shared/fold-contract.md` + 400 状态的跨宿主逐位比对把这件事钉住。保留原文备查。

- **为什么它是"前端交互在纯对话环境无意义"的唯一例外：** 业务校验的签核人**是客户，不是顾问**。而客户在签核过程中说"能不能按渠道再看一遍"是签核本身的一部分，不是额外需求。runtime 今天的答案是重跑 `validation.series` + `render.html`——顾问在场时可行，客户自己看时不可行。
- **代价（低成本替代，不是把 Graphic Walker 搬进来）：** 让 `validation.series` 一次性输出几种预置切法（按渠道 / 按区域 / 按产品），`render.html` 在一页里渲染成可切换的几组图。中等偏小。
- **收益：** 签核会议上少一轮往返。

> **Graphic Walker 那条仍然成立。** D10 做的是"按预先定义好的维度重算"，不是"任意拖拽出任意图"。自由探索页签依赖一个大型 React 库，与"单文件、零外部请求、五年后还能打开"直接冲突，本轮不做。

---

## 8. 三条不在上面、但值得记一笔的观察

1. **runtime 放弃的 3.1/3.2，平台自己也没写完。** 06 文档 §1 的缺口 1、2 明写：3.1 先验设置规则"文件仅含 README 一行，正文为空"；3.2 模型调优规则"无文件"。D3 裁决"建模不做"因此不是在放弃一个成品，是在拒绝接手一个空壳——**这让 D3 比它看起来更安全**。

2. **平台在行业隔离上和 runtime 得出了同一个结论。** `backend/app/agents/data_rules.py:333` 硬编码 `REFERENCE_INDUSTRY = ("food-bev", "beverage")`，注释写"Everyone else gets no benchmark rather than a beverage benchmark"，并有回归测试禁止饮料区间用到护肤/医药。runtime 的目录锚定隔离是同一判断的另一种实现，**两边都写明了同一个触发事件**。这条不是放弃，是**独立验证**。

3. **放弃 UI 的最大收益不是少写代码，是消灭四份手工同步契约。** `CLAUDE.md` 要求 `blueprint.py`↔`scenario.ts`、`domain/models.py`↔`lib/types.ts` 逐字段保持一致。这类契约不会报错，只会慢慢漂。登记在 #39，因为它容易被当成损失清点，实际是净收益。
