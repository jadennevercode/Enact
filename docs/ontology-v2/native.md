# 统一业务模型与 Semantica 复用规格

状态：实现与自动验收中；真人业务验收单独记录。

## 权威模型

`definition.schema_version=2` 保存 Entity、Attribute、Relationship、Action、Policy 与双绑定。每个对象有稳定标识、业务名称、描述与可选别名。Attribute 属于 Entity；Relationship 明确方向及 cardinality.min/max；Action 声明输入/输出与适用 Policy；Policy 使用许可、禁止、义务、约束四种类型。Action 的 identity_parameters 从输入规格中选择业务目标字段，用于跨推理轮次识别已有草稿。

业务 definition 是可编辑来源；OWL、SHACL、RDF、图投影和绑定配置由它编译。不得同时提交 definition 与另一份 ontology。旧发布物保持不可变；新发布必须通过构建过程中的四个人审关口。

## 直接复用

- `semantica.ingest`：现有原生连接器、Git/文档读取、数据库发现、OpenAPI/MCP 调用契约。
- `semantic_extract`、normalize、deduplication、conflicts：既有 native pipeline 的抽取、规范化和冲突评审阶段。
- `ontology` 的 OWLGenerator、SHACLGenerator，以及已有 quality gate：生成技术投影和真实结构检查。
- PySHACL 实例校验、实际 SPARQL competency questions、现有规则执行器：以真实结果为计数依据。
- 现有严格三值规则条件求值：执行 Policy，缺少事实产生 unknown，不视为许可。
- 原生 Explorer 的 Graphology/Sigma 场景与交互行为；Louvain 分组、Dijkstra 路径、ForceAtlas2 布局在 Studio 复用。

## Enact 必须补充的部分

Semantica 没有 Enact 的 workspace/member/task principal、Issue 对话、人审与发布控制、执行凭据、系统幂等回执，因此这些由 Enact 保存和校验。Action/Policy 的五类对象契约也按用户业务理念实现，不把系统 API 操作混同于业务 Action。

当前自然语言上下文检索采用业务名称、别名和明确关联的邻域展开，记录种子对象与跳数；未配置向量后端时不会声称使用向量检索。同名候选保留歧义，找不到对象要求澄清。图投影上限 500 节点、1500 边，并给出真实总数及截断状态。

## 测试与评分

结构检查、SHACL、实际 CQ 分开记录 numerator/denominator、engine、status。没有样例执行的数据/行动绑定、没有真人审阅的维度明确标为未测，不凑总分。Semantica 完整 OWL-DL 一致性占位能力不计作通过。

验收必须覆盖关系基数进入真实 SHACL、Action/Policy 可被 RDF 查询、中文别名与歧义、禁止/未知优先阻止行动、参数与查询目标隔离、越域 scope、真实总数与截断。

## 模块复用清单与边界

| Semantica 模块 | 本轮集成方式 | 没有直接替代的部分及原因 |
| --- | --- | --- |
| ingest | REST、数据库、Git、MCP、Web、文件原生 ingestor；企业连接器使用现有 adapter | Enact 管理凭据、主体权限和目录快照。企业连接器需真实凭据才能现场验证。 |
| semantic_extract | 原生抽取 schema/validator，Runtime 执行与提取操作重放 | 业务范围与歧义需要人回答，不能由抽取结果自动定案。 |
| kg | GraphBuilder 创建知识图，保留真实节点和关系 | 五类业务构件的展示投影与查询结果拓扑由 Enact 适配。 |
| reasoning | 原生 Reasoner、规则证明、SPARQL 查询及 ContextGraph | Action/Policy 条件使用严格三值执行契约；未接入的 Datalog/Rete 接口不宣称已成为消费路径。 |
| vector_store | 原生向量搜索接口保留，可配置后端 | 本轮中文业务上下文依靠名称、别名和邻域；没有启用向量后端时不会伪装成混合检索。 |
| split | TextSplitter 与已有来源分块流程 | 人审卡片按业务主题分组，不直接展示原始 chunk。 |
| provenance | ProvenanceManager、PROV-O、来源哈希与处理阶段记录 | Issue、真人决定、运行回执归 Enact；来源追溯是详情而非 Studio 首屏。 |
| ontology | OWLGenerator、SHACLGenerator、OntologyQualityGate | 用户五类构件是权威模型；原生生成物是编译结果，未完成的 OWL-DL 检查不会计入通过。 |
| conflicts | ConflictDetector 与已有冲突审阅结果 | 有业务影响的冲突交给人决定。 |
| deduplication | DuplicateDetector、EntityMerger | 合并保留来源且需要明确决定，不自行合并同名主体。 |
| normalize | TextNormalizer 及现有规范化阶段 | 业务别名和单位的含义由本体声明。 |
| pipeline | PipelineBuilder、ExecutionEngine 与可追溯阶段 | 人机交互生命周期由 Enact Issue/Family/ReviewPacket 承接。 |
| export | RDFExporter、OWL/Turtle 与原生 artifact | HTML 业务报告和 JSONL 操作日志是 Enact 新增的消费产物。 |
| visualization | 原生 Explorer 的 Graphology/Sigma 与五类行为组件，并接入 Louvain/路径/ForceAtlas2 | 世界地图、节点业务分析、真人行动确认需要 Enact/Site 业务界面。 |
| temporal intelligence | 原生图的时间属性和 ContextGraph 能力保留 | 本轮没有将双时态/time-travel 做成完整业务 UI，不能作为已验收能力。 |
| multi-agent / Agno | 借鉴共享上下文图；原生 ContextGraph 用于知识与推理 | 使用已有 Enact Agent Family、任务身份和子任务生命周期；不再引入第二套 Agno 调度与授权。 |
