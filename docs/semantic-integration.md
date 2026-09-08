# Semantica × Enact：原生本体的生产、管理与消费

Ontology Studio 位于 **智能中心 → Ontology → 工作室**。知识、业务数据与系统行动先进入 Sources；本体创建沿用真实 Issue 和五角色 Ontologizer Family；业务问题从普通 Issue 发起，Sites 继续同一次调查。

## 用户旅程

| 阶段 | 用户操作 | 持久交付与界面 |
| --- | --- | --- |
| 连接知识与系统 | Sources 添加 Git、数据连接、系统行动连接；发现并检查目录 | Git 文件与 commit；数据库表、视图、字段、主外键；API/MCP 参数、响应、调用方式与能力。只读预览不会执行写工具 |
| 明确业务范围 | 智能中心打开 Ontology Studio，选择不可变知识快照和业务问题，启动 Family | 真正的构建 Issue、五角色任务树、范围与访谈反馈、阶段事件；可查看失败及重试 |
| 构建原生本体 | Analyst 提取证据，Engineer 建模，Reviewer 独立检查，Steward 准备交付，Coordinator 组织反馈 | OWL/RDF、SHACL、原生 classes/properties、知识图谱、来源清单、PROV-O、规则、数据与行动绑定、能力问题和验证报告 |
| 检查和修改 | Studio 查看可缩放、搜索、过滤、点选的图谱及节点详情，修改模型或绑定 | Semantica 图数据和分析结果；源文档锚点；每次原生构建保留不可变修订。绑定变化必须重新构建和验证 |
| 测试与发布 | 检查 SHACL、能力问题、冲突、来源及绑定目录；发布确切版本 | 带 digest 的不可变 release；源端结构变化或未通过的验证会阻止发布/执行；版本比较和停用保留历史 |
| 用自然语言消费 | 在普通 Issue 中提出问题，由 Agent 选择已发布 release | 同一个 Issue run 记录本体查询、实际业务查询、规则求值、行动建议、授权状态、执行和独立读回 |
| 终端交互 | 从 Issue 打开业务 Site，点选拓扑对象，查看证据与可用行动 | `run.attach` 连接原 Issue run；既有证据按 Site manifest 投影，页面刷新或切换构建不另造调查 |

Family Skill 是**交付方法**。原生 Ontology artifact 才是主要交付物，Skill Package 仅保留为明确请求时的兼容导出。原有 candidate/evidence/process/alignment 包的编译入口继续兼容既有版本，不再作为新本体的主编辑模型。

## 复用与新增边界

| 能力 | 复用 Semantica | Enact 新增部分及原因 |
| --- | --- | --- |
| 多源接入 | `ingest` 原生 Git、数据库、REST、MCP 等适配器及其读取/发现能力 | 工作区连接目录、加密的用户凭据、能力分类、快照、目录版本和可视化。语义库不管理 Enact 用户与连接生命周期 |
| 解析和抽取 | `parse`、`normalize`、`split`、`semantic_extract`、ExtractionSchema/Validator | 将原生模型请求交给 Enact 已连接 Runtime 的结构化子操作；不要求另配模型供应商密钥 |
| 图构建和质量 | `kg`、`deduplication`、`conflicts` | 把原生结果、待复核发现及人工反馈呈现在 Studio，并保留修订 |
| 本体与验证 | `ontology` 的 OWL/SHACL/术语工具及原生验证 | Enact 发布门槛、不可变版本、连接绑定、工作区治理 |
| 查询与推理 | 原生 RDF/Oxigraph 查询、`reasoning` 的规则与实际推导证据 | 把成功的业务查询输出映射为规则事实，并绑定精确 source step；不以聊天描述代替实际数据 |
| 来源与时间 | `provenance`、原生 ContextGraph 推导图及持久快照 | 关联 Issue、task、run、approval、receipt，提供业务步骤和应用入口。独立决策、反事实和历史查询尚无面向 Enact Agent 的入口 |
| Pipeline 与导出 | `pipeline`、`export`，原生阶段与 RDF/OWL/JSON-LD 等工件 | 任务归属、模型操作租约、结果持久化、版本范围及下载/展示 |
| 可交互展示 | Semantica Explorer 的 Sigma/Graphology 交互、邻域聚焦、关系检查、组件布局与本体编辑模型；原生 RDF 图数据 | 将这些组件适配到 Enact 身份、主题、Issue 和导航；业务 Site 展示实际对象拓扑。未直接嵌入整个 Explorer 或 Python visualization 的 Plotly/静态仪表盘，以免建立第二套全局图状态和界面 |
| 系统写操作 | Semantica 描述行动、生成带规则证据的意图 | 继续使用 Enact 现有 REST/MCP 执行器、人工确认、幂等与读回。读取型 ingest 不能代替业务系统的事务和权限 |
| 多 Agent | Semantica 原生本体、知识图谱与来源工件作为共享上下文 | Family 成员读取同一版本化草稿及 Issue 证据，复用 Enact 的调度与并发控制；未引入 Agno 团队或另一个全局 ContextGraph 会话 |

连接器 registry 会明确显示依赖是否已安装、适配器是否已实现；一个上游模块存在不等于当前部署已经支持全部操作。FAISS/向量库、云数仓、邮件和流等可选能力需要对应依赖与真实账户。私有语义服务已有路径/时间检查及带来源的输入向量检索适配，但尚未接入 Enact Agent 网关或 Studio 操作入口，不属于本次用户旅程的已验证能力。Git 支持已授权的本地 commit 快照与公开远程源；私有远程认证、OAuth 刷新和 daemon 私网隧道仍需另外实现。

## 运行与配置

1. 按 Enact 原有方式应用全部迁移。语义表从 454 开始；478–486 增加 Source Catalog、快照、原生修订和 Site 同 run；500–505 增加模型子操作与 Family construction。
2. Semantica 仓库使用 `semantica/semantic_service/Dockerfile`，只安装原生运行依赖。可组合 `docker-compose.selfhost.yml`、`docker-compose.selfhost.build.yml` 和 `docker-compose.semantic.yml`。语义服务无公开端口，持久状态放在独立 volume。
3. 配置稳定的 32 字节 Base64 `ENACT_SEMANTIC_SECRET_KEY`、相同的 Enact `ENACT_SEMANTIC_SERVICE_KEY` / Semantica `SEMANTIC_SERVICE_API_KEY`。原生读取从语义服务发起，业务写操作从 Enact 后端发起，两者都必须能访问连接地址。
4. `ENACT_SEMANTIC_ALLOWED_ORIGINS` 限定源端精确 origin；本地 Git 等还需 `ENACT_SEMANTIC_ALLOWED_PATHS` 和两端只读挂载。不得因代理 DNS 返回保留地址而关闭原生网络保护；可以使用明确授权、commit 一致的本地 Git 镜像。
5. `ENACT_SEMANTIC_MODEL_API_URL` 必须等于 Semantica 的 `SEMANTIC_ENACT_ORIGIN`，并能从语义容器访问 Enact。结构化模型子操作使用当前 task bearer、独立执行通道、Schema 验证和租约；不在 pipeline 检查点中保存 bearer。
6. 连接 Codex 或 Claude Runtime 后从 Studio 启动 Family。大知识库可显式选择抽取的 `source_ids` / `chunk_ids` 和模型操作预算；`extraction_coverage` 必须展示未处理范围，禁止把部分抽取声称为全覆盖。

详细 API 与权限见 [semantic-runtime.md](semantic-runtime.md)。旧 bootstrap 只用于兼容测试，不是新版 Family 原生生产入口。

## Quality Traceability

参考系统位于相邻 QualityTraceability 仓库的 `runtime`，保持独立持久数据库。REST 提供类型化 OpenAPI；`/mcp` 将查询及创建 DRAFT 方案映射到同一业务函数与幂等机制。SQL 数据绑定采用真实发现的表/视图；原生 SQL 使用命名参数，不能提交任意查询覆盖 release 中的模板。

质量业务流程区分：观察到的批次暴露、规则推导出的行动建议、DRAFT 方案、SQM 方案审批、当地 Plant Manager 审批、系统执行、独立读回。HTTP 200 或图谱边不能替代已核验的业务状态。GAP-006 的跨厂审批负责人仍是未决业务事项；参考 API 中已有的角色检查是实现现状，不能当作用户已确认的业务政策。当前原生规则只建议 DRAFT 方案，未决事项随本体修订和发布治理保留。

Site 展示真实 case/batch/plant/stock/line/delivery 拓扑和逐步证据。AT01 对应 Graz 有文档依据；CN03/MX01 的城市映射未被原文确认，不绘制臆测工厂坐标。自然语言解释在原 Issue 中进行，Site 的固定数据刷新按钮按实际功能标注。

数据库专用 reader 与 reporting views 提供了代码和隔离权限测试；当前本机验收可复用现有独立参考库凭据并强制只读事务，不声称已经部署新的数据库角色授权。外部企业 ERP/MES、云数据仓库和生产身份仍需要真实连接配置。

## 验证原则

分别检查原生库与容器测试、Enact 数据库权限/恢复测试、真实 CLI 模型调用、真实 Source 目录及读预览、实际 Family task tree、已发布本体查询/推理/行动回执，以及登录账户中的 Studio/Issue/Site 交互。确定性 fixture、真实参考系统和外部企业系统必须明确区分；具体一次验收的 IDs 与结果应单独记录，不能把测试设计当成已经执行的结果。
