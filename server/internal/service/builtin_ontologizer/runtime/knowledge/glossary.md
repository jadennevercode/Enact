# 术语表

白皮书 §14 的双语术语表，加上本包引入的词。
**Skill 之间靠这张表保持说法一致**——同一个东西在两个 Skill 里叫两个名字，
用户就会以为那是两件事。

对用户说话时另有一条规矩（`shared/conventions.md` §7）：
不说 gate、predicate、validator、artifact，说「检查项」「机器门」「决策点」
「交付物」「这一版」。这张表是给 Skill 作者用的，不是给输出用的。

## 本体概念（白皮书 §14）

| English | 中文 | 简要定义 |
|---|---|---|
| Ontology | 本体 | 对领域概念化的显式、共享、机器可处理说明 |
| Domain | 领域 | 本体所描述的有界业务语境 |
| Class / Concept | 类 / 概念 | 一类事物的语义定义 |
| Entity Type / Object Type | 实体类型 / 对象类型 | 企业系统中对现实对象的可操作模型 |
| Instance | 实例 | 某个类型的具体对象 |
| Property / Attribute | 属性 | 对象具有的类型化事实 |
| Relationship / Link | 关系 / 链接 | 对象之间有语义的连接 |
| Axiom | 公理 | 用于定义领域语义并支持推理的逻辑声明 |
| Constraint / Shape | 约束 / 形状 | 数据或状态必须满足的要求 |
| Inference / Entailment | 推理 / 蕴含 | 从已有声明得到隐含结论 |
| Knowledge Graph | 知识图谱 | 由实体和关系事实组成的图 |
| Semantic Layer | 语义层 | 在物理数据之上提供业务概念、指标和关系的抽象层 |
| Data Binding | 数据绑定 | 把本体概念连接到真实数据源的映射 |
| Capability | 能力 | 稳定、可复用的业务意图声明 |
| Action Contract | 动作契约 | 带输入、效果、权限和运行保证的可执行操作 |
| Policy | 政策 | 对主体和动作的许可、义务或禁止规则 |
| Provenance | 来源 / 血缘 | 事实、数据或结论如何产生及来自哪里 |
| Grounding | 语义落地 / 依据化 | 将模型输出约束到真实定义、事实和证据 |
| Context Package | 上下文包 | 针对任务和角色组装的最小充分结构化上下文 |
| GraphRAG | 图增强检索生成 | 使用图结构改进检索和生成的 RAG 方法 |
| TBox | 术语层 | 类、属性和公理等模式级知识 |
| ABox | 断言层 | 关于具体实例的事实 |

## 本包引入的词

| English | 中文 | 简要定义 |
|---|---|---|
| Revision | 修订版 | 本包的状态单位：一次 generate 或 revise 产出一个 `revisions/rNNNN/`，封存后只读 |
| Sealed | 封存 | revision 写完并算过 digest 的状态；封存之后目录一个字节都不再动 |
| HEAD | 当前版 | 指针文件，内容是一个 revision id；restore 是向前复制成新 revision，不是回退 |
| Machine gate | 机器门 | 由 validators 判定、会阻断流程的两道门：`ready_for_review`、`submission_ready`；不需要人批准 |
| Decision point | 决策点 | 记录一个人的判断的八件事；除 `create_pull_request` 外都不是审批门 |
| Check | 检查项 | 一条确定性判定，有 id、级别（blocking / warning）和作用域；契约在 `shared/manifests/checks.yaml` |
| Four layers | 四层 | Evidence / Process / Mapping / Ontology 四份文件，各回答一个问题；不是四种视图 |
| Evidential IR | 证据层 | `evidential_ir.yaml`：来源事实、术语、锚点、置信度、限制 |
| Process IR | 流程层 | `process_ir.yaml`：步骤、参与者、输入输出、事件、决定、衔接、异常 |
| Alignment | 对齐层 | `alignment.yaml`：证据/流程与目标设计之间的显式对应，每条有 source、target、confidence |
| Candidate | 候选本体 | `candidate.yaml`：当前目标语义模型；bundle + 十个声明集合 |
| Declaration | 声明 | candidate 里的一个对象（实体、关系、属性、事件、生命周期、约束……），有稳定 id |
| Support | 依据 | 挂在声明上的一条来源：`evidence`（经 alignment 落到锚点）、`assumption` 或 `process_reference` |
| Anchor | 锚点 | 证据中的确切出处：`location` + `exact_snippet`，缺一不可 |
| Evidence snapshot | 证据快照 | `define/evidence-snapshots/es-NNNN/`：版本化的原始材料及其 manifest |
| FAGC register | 四分登记 | Fact / Assumption / Guidance / Constraint 四类陈述的登记表 |
| Model card | 模型卡 | 访谈阶段产出的显式建模线索卡，每张有出处或指向一条 assumption |
| Readiness | 就绪项 | 访谈阶段的八项检查，每项状态必须是 answered / corrected / skipped |
| Trace index | 追溯索引 | `trace-index.yaml`：每个对象一条追溯记录，由脚本从产物推导，不手写 |
| Orphaned locator | 断链定位符 | 上一版的 comment 指向一个这一版不存在的对象；必须显式标出，不许静默断链 |
| Semantic diff | 语义差异 | 相对父 revision 的对象级变化；每个 removed 要有 `replaced_by` 或删除理由 |
| Disposition | 处置 | 审阅时对每个对象给出的结论：accept / comment / direct_edit / defer / reject |
| Competency Question (CQ) | 胜任问题 | 本体必须能回答的业务问题；由人定义或批准，结果绑定 revision |
| Candidate release | 候选发布 | 被选中作为发布对象的那个 revision——不是另一个可变工作副本 |
| Access scope | 访问范围 | 受治理的资源边界声明；**不授权**，不含 users / groups / roles / entitlements / grants |
| Patch / Version | 补丁 / 版本 | 一次发布的兼容性性质：patch 升 minor 并产出增量迁移包，version 升 major 并产出完整新版本包；由人选，系统不给推荐 |
| Submission package | 提交包 | 提交给下游的产物集合；排除 raw evidence、样本、访谈记录、详细日志与主体信息 |
| Expert handoff | 专家移交 | 系统停手、把事情交回给人的出口；导出包必须先脱敏 |
| Workspace | 工作区 | 含 `ontologizer.yaml` 的那个目录；一个本体项目就是一个目录 |

## 三组容易混的词

**机器门 / 决策点 / 检查项。** 检查项是一条判定；机器门是一组检查项全过才算通过的
关卡；决策点是记录人的判断的地方。**阶段是否成功由检查项判定，不由人批准**——
Agent 跑完不等于成功。

**Support / Anchor / Alignment。** Anchor 在证据里（哪一页哪一行），
Alignment 在证据和设计之间（这条事实支撑那个对象），
Support 挂在设计上（这个对象的依据是哪一条 alignment 或哪一条假设）。
三个连起来才是一条完整的追溯链，断在哪一节都会让 `trace_complete` 报。

**Access scope 不是授权。** 这是流程 §3 的原则，也是必须原样显示给用户的一句话：
*Access scopes define governed resource boundaries. They do not grant access to
users or groups.* 主体分配与运行时放行属于外部平台。
