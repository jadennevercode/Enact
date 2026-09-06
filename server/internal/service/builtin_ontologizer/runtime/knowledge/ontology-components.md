# 本体的十二个构件

白皮书 §4 的十二个构件。每个回答三件事：**它是什么**、**高质量声明里有什么**、
**在本包里写成哪些字段**。字段名是硬约束，来自 `tools/validators/schema.py`
的 `CANDIDATE_FIELDS` 和 SPEC §8。**发明字段名会让 `schema_valid` 拒绝产物**，
或者更糟——字段被静默忽略，你以为写下的语义根本没进模型。

## 目录

[核心模块与扩展模块](#核心模块与扩展模块) ·
[4.1 Domain](#41-domain领域) · [4.2 实体](#42-concept--class--entity-type实体) ·
[4.3 Instance](#43-instance实例) · [4.4 属性](#44-attribute属性) ·
[4.5 关系](#45-relationship关系) · [4.6 事件与时间](#46-event-与-time事件与时间) ·
[4.7 生命周期](#47-state-machine--lifecycle生命周期) · [4.8 约束](#48-constraint--axiom--rule约束) ·
[4.9 政策](#49-policy政策) · [4.10 能力](#410-capability-与-action能力) ·
[4.11 Process / Skill / Strategy](#411-process--skill--strategy) ·
[4.12 绑定](#412-binding绑定) · [Metric](#metric指标)

## 核心模块与扩展模块

SPEC §2-E 把 candidate 分两档：**核心模块 V1 必产**，**扩展模块只在 `initiate`
声明了范围时才产**。

| 集合 | 档次 | 白皮书构件 | `schema_valid` 必填字段 |
|---|---|---|---|
| `entities` | 核心 | §4.2 | `id` `view_label` `canonical_name` `definition` `support` |
| `relationships` | 核心 | §4.5 | `id` `source` `target` `source_role` `target_role` `direction` `cardinality` `semantics` `definition` `support` |
| `attributes` | 核心 | §4.4 | `id` `owner` `datatype` `nullable` `support` |
| `events` | 核心 | §4.6 | `id` `participants` `definition` `support` |
| `lifecycles` | 核心 | §4.7 | `id` `entity` `states` `transitions` `support` |
| `constraints` | 核心 | §4.8 | `id` `kind` `statement` `support` |
| `policies` | 扩展 | §4.9 | `id` `modality` `subject` `action` `condition` `support` |
| `capabilities` | 扩展 | §4.10 | `id` `intent` `parameters` `preconditions` `effects` `support` |
| `bindings` | 扩展 | §4.12 | `id` `binding_kind` `target` `source_system` `support` |
| `metrics` | 扩展 | SPEC §8 | `id` `definition` `support` |

三条规则：`entities`/`relationships`/`attributes` **不能为空**（`schema_valid`
直接报"核心模块要求实体、关系、属性都有内容"）；`events` 和 `lifecycles` 空着
不阻断但 `behaviour_present` 会警告"只建名词"，真的没有状态变化就在
generation report 里写理由；扩展模块空着正常，**声明了范围却空着**才是问题。

每个声明都要有 `support`，这是 `trace_complete` 的入口。三种形态：
`{ type: evidence, alignment_id: aln.0007 }`（经 alignment 落到带锚点的事实）、
`{ type: assumption, id: asm.0004 }`（显式假设，必须在 FAGC 登记里）、
`{ type: process_reference, id: proc.step.approve }`（指向 process_ir）。

## 4.1 Domain（领域）

**是什么**：本体的顶层容器和治理边界。"订单管理"和"财务关账"是两个 Domain，
共同引用 Customer 不构成合并成超级本体的理由。
**高质量声明包含**：稳定名称与命名空间、业务描述、目标与非目标、版本与兼容策略、
所有者与审批责任、包含或导入的模块、与其他领域的连接点。
**本包字段**——Domain 不是集合，是 `bundle` 的一个键。`schema_valid` 要求
`bundle.id`、`bundle.domain`，且 `domain.id` 非空：

```yaml
bundle:
  id: r0002                                 # 必填
  parent: r0001
  domain:
    id: dom.journal_reversal                # 必填
    name: Journal Reversal                  # 以下均可选
    goals: [...]
    non_goals: [...]
    imports: []
    owners: { domain: ..., ontology: ..., process: ... }
```

`goals`/`non_goals`/`owners` 机器不查，但 `initiate` 的 `charter_complete`
会在工作区层面查章程里的对应内容，两边说的应该是同一件事。

## 4.2 Concept / Class / Entity Type（实体）

**是什么**：一组具有共同语义的事物，也叫 Entity Type、Object Type、业务对象。
**高质量声明包含**：稳定机器标识 + 显示名、精确定义、同义词与历史名称、身份键及其
业务含义、属性和关系、状态或生命周期、所有者与敏感性分类、示例与反例。白皮书 §4.2：
**定义"什么不属于这个类"与定义"什么属于"同样重要。**

```yaml
entities:
  - id: ent.journal_entry            # 必填 · 稳定技术 ID
    view_label: 日记账分录             # 必填 · 展示名，可改
    canonical_name: JournalEntry     # 必填 · 机器名
    definition: "在总账中登记的一组借贷平衡的会计记录，有唯一编号、所属期间与过账状态。"  # 必填
    support: [{ type: evidence, alignment_id: aln.0007 }]                              # 必填
    aliases: [JE, 分录, 凭证]          # 以下均可选
    counter_examples: ["工厂口中的纸质'凭证'"]
    business_purpose: "冲销判断的主对象"
    inclusion_rationale: "cq.001/003/005 的主语"
    identity_keys: [journal_id]
    classification: internal
    cq_links: [cq.001]
```

## 4.3 Instance（实例）

**是什么**：某个类型的具体成员，`JournalEntry/JE-2026-0081`。
**高质量声明包含**：全局或域内稳定身份；企业场景还要处理主数据与黄金记录、
标识映射与实体消歧、合并与拆分历史、来源优先级和冲突事实。
**本包字段：没有，这是有意的。** `CANDIDATE_FIELDS` 里没有 `instances` 集合，
白皮书 §12 把"详细业务数据行"划在本体之外，归 Data Foundation / 源系统。
本包对实例只做两件事：实体上声明 `identity_keys`（拿什么认这个对象），
`bindings` 里指出去哪里取（`source_system`）。

`evidence/journal-entries-sample.csv` 里的六行是**证据**不是模型内容：它们进
`evidential_ir.yaml` 的 facts、带锚点，支撑"status 有三个取值"这类事实。抄进
candidate 检查不会报——但你已经把一份数据快照冻进了本体。

## 4.4 Attribute（属性）

**是什么**：对象具有的类型化事实。**高质量声明包含**：数据类型、单位、格式、枚举；
必填、默认值、允许范围、唯一性；业务定义、别名；是否为身份、敏感或派生；生效时间、
记录时间和来源；计算逻辑。白皮书 §4.4：**"金额"为 decimal 仍然不够。**

```yaml
attributes:
  - id: attr.journal_entry.amount
    owner: ent.journal_entry          # 必填 · 必须指向存在的实体（refs_resolve）
    datatype: decimal                 # 必填
    nullable: false                   # 必填
    support: [{ type: evidence, alignment_id: aln.0013 }, { type: assumption, id: asm.0004 }]
    unit_or_format: "本位币金额；含税口径未定"   # 以下均可选
    multi_valued: false
    enum_source: null
    classification: financial
    is_identity: false
    is_derived: false
    temporal: { valid_time: true, record_time: true }
```

`nullable: false` 是布尔假值，但 `schema_valid` 只把 `None`、空串、空列表、
空映射算作缺失，写 `false` 是安全的。

## 4.5 Relationship（关系）

**是什么**：对象之间有语义的连接。白皮书称它为本体的核心，因为**大量业务意义存在于
对象之间，而不是单个对象内部**。**高质量声明包含**：源与目标类型、方向与逆关系、
基数、语义类别、关系自身的属性（有效时间、角色、数量、置信度）、是否可传递/对称/
互斥/可推导。

```yaml
relationships:
  - id: rel.reverses
    source: ent.journal_entry         # 必填 · 必须是实体
    target: ent.journal_entry         # 必填 · 必须是实体
    source_role: reversal             # 必填
    target_role: original             # 必填
    direction: source_to_target       # 必填
    cardinality: { source: "1", target: "1" }  # 必填 · 两端都要有
    semantics: reference              # 必填 · ownership|composition|reference|dependency|causal|lineage
    definition: "冲销分录与原始分录的对应；借贷相反、金额相同。"   # 必填
    support: [{ type: evidence, alignment_id: aln.0009 }]      # 必填
    inverse_name: reversed_by                                  # 以下均可选
    temporality: { kind: event_time, valid_from_attr: posted_at }
    reified: false          # 关系自身带属性或生命周期时置 true 并另建实体
```

`relationship_declared` 查上面五个语义字段和 `cardinality` 的两端。

## 4.6 Event 与 Time（事件与时间）

**是什么**：世界如何变化。只描述当前状态会丢掉"为什么变成这样"。**高质量声明
包含**：业务事件本身，以及事件时间（现实何时发生）、记录时间（系统何时知道）、
有效时间（事实在哪段时间成立）、处理时间、版本时间（定义或政策何时生效）。
白皮书 §4.6：**避免 AI 用今天的政策解释昨天的决策。**

```yaml
events:
  - id: evt.reversal_posted
    participants: [ent.journal_entry, ent.employee]   # 必填 · 都要是实体
    definition: "冲销分录完成过账的时刻。"                # 必填
    support: [{ type: evidence, alignment_id: aln.0021 }]  # 必填
    time: { event_time: true, record_time: true }   # 以下均可选
    changes_state_of: ent.journal_entry
    process_ref: proc.step.post_reversal
```

`process_ref` 是 Ontology 层引用 Process 层，这个方向是设计好的；反过来
（process_ir 里出现 `entities:`）会被 `layer_separation` 拦下。

## 4.7 State Machine / Lifecycle（生命周期）

**是什么**：实体允许处于哪些状态、如何转换、条件是什么。它把"status 字段可以写任意
字符串"提升为"业务对象只能沿合法路径演化"。**高质量的一次转换包含**：当前状态、
目标状态、触发事件、guard 条件、执行效果、转换后必须成立的条件、可执行主体、
失败与回滚补偿语义。

```yaml
lifecycles:
  - id: lc.journal_entry
    entity: ent.journal_entry         # 必填 · 必须是实体
    states: [draft, posted, reversed] # 必填
    transitions:                      # 必填
      - { from: draft, to: posted, trigger: evt.journal_posted, actor_roles: [preparer] }
      - { from: posted, to: reversed, trigger: evt.reversal_posted,
          guard: "period.status != hard_close", actor_roles: [controller] }
    support: [{ type: evidence, alignment_id: aln.0016 }]  # 必填
```

`refs_resolve` 查三件事：`entity` 存在、每个 `from`/`to` 都在 `states` 里、
`trigger` 指向存在的 event 或 process 对象。

## 4.8 Constraint / Axiom / Rule（约束）

**是什么**：什么必须成立。三类分开：**Axiom** 描述领域语义并支持推理、
**Constraint** 验证数据或状态、**Rule** 按条件推导结论或触发决策。

```yaml
constraints:
  - id: con.balanced_entry
    kind: constraint          # 必填 · axiom | constraint | rule
    statement: "sum(debit) == sum(credit)"   # 必填
    support: [{ type: evidence, alignment_id: aln.0019 }]  # 必填
    scope: [ent.journal_entry]
    open_world_note: "缺少某条明细不等于该分录不平衡。"
```

`open_world_note` 可选，但它承载白皮书 §4.8 的关键提醒：**不要把"缺少事实"当成
"事实为假"**。CSV 里那几个空 `approver` 正是它的现场。

## 4.9 Policy（政策）· 扩展模块

**是什么**：谁可以、必须或禁止做什么。三种规范类型：**Permission**（条件满足时
可以做）、**Obligation**（必须做）、**Prohibition**（禁止做）。**高质量声明还包含**：
优先级、适用范围、生效时间、例外、依据、决策理由、冲突处理。

```yaml
policies:
  - id: pol.reversal_approval_threshold
    modality: obligation        # 必填 · permission | obligation | prohibition
    subject: role.controller    # 必填 · 谁
    action: cap.approve_reversal # 必填 · 做什么（refs_resolve 会解析）
    condition: "amount_base_currency >= 50000"  # 必填
    support: [{ type: evidence, alignment_id: aln.0022 }]  # 必填
```

**这个域里的政策冲突要写成两条，不是一条。** 手册 §6.3 说软关账期经财务控制批准
仍可冲销、政策 v4 §3.2 说一律不得。两条都留、各带来源、各标 disputed，裁决交给
人——`conflicts_not_merged` 在 evidence 阶段就这么要求，到 candidate 层别偷偷合并。

## 4.10 Capability 与 Action（能力）· 扩展模块

**是什么**：世界中能够做什么。**Capability 描述业务意图**（what can be done），
**Binding 描述如何连接执行系统**（how and where）——同一个能力在 SAP、Oracle
或自研系统里绑不同执行端而业务含义不变。
**一个面向 Agent 的动作契约包含**：名称、别名、目标实体；类型化参数与返回值；
前置条件、效果、后置条件；幂等性与重试；权限、委托与审批条件；超时、失败与补偿；
执行证据。

```yaml
capabilities:
  - id: cap.create_reversal_entry
    intent: "为一条已过账分录发起并生成冲销分录"   # 必填
    parameters:                                  # 必填
      - { name: journal_id, datatype: string, required: true }
      - { name: reason_code, datatype: enum,   required: true }
    preconditions: ["原分录 status == posted", "原分录尚未被冲销"]   # 必填
    effects: ["生成一条 ent.reversal_entry 并建立 rel.reverses"]     # 必填
    support: [{ type: evidence, alignment_id: aln.0024 }]           # 必填
    target_entity: ent.journal_entry     # 可选，但 refs_resolve 会解析它
```

按业务意图命名，不按接口路径命名（白皮书 §10.3）。

## 4.11 Process / Skill / Strategy

**是什么**：能力如何组合。白皮书 §4.11 分五样：**Process**（较稳定的步骤与分支）、
**Skill**（可复用的能力组合与知识依据）、**Persona**（角色职责与决策边界）、
**Template**（阶段、角色与治理门）、**Runtime plan**（Agent 针对一次任务生成的
执行计划，**通常不属于本体定义本身**）。
**本包字段：candidate 里没有对应集合。** Process 住在四层的 Process 层——
`process_ir.yaml`，含 `steps`（必填 `id` `name` `actors`）、`roles`、`events`、
`decisions`、`handoffs`、`exceptions`、`records`。Runtime plan 归 Agent Runtime，
本包不碰。两层通过 `events[].process_ref` 与
`lifecycles[].transitions[].trigger` 互查。

## 4.12 Binding（绑定）· 扩展模块

**是什么**：语义如何落到现实系统。没有绑定的本体可以沟通和推理，但不能反映
企业当前状态。**六类绑定**（白皮书 §4.12）：Data（表、视图、流、API）、Metric（SQL、DSL、语义
模型）、Knowledge（文档、段落、引用）、Action（REST、MCP、函数、动作契约）、
Identity（人员、角色、组织、服务身份）、Evidence（血缘、审计日志、运行追踪）。

```yaml
bindings:
  - id: bind.journal_entry_data
    binding_kind: data          # 必填 · data|metric|knowledge|action|identity|evidence
    target: ent.journal_entry   # 必填 · refs_resolve 会解析
    source_system: "ERP
    GL_JE_HEADER"  # 必填
    support: [{ type: evidence, alignment_id: aln.0026 }]  # 必填
    refresh: daily
    mapping_version: "2026-01"  # 可选
```

白皮书 §4.12 要求绑定保留来源系统、刷新时间、映射版本和质量状态。只有
`source_system` 必填——但没有刷新时间的绑定，回答"这个数新不新"只能靠猜。

## Metric（指标）· 扩展模块

白皮书没有单列一节；SPEC §8 把它作为扩展模块，因为 Metric Binding 需要一个被绑定
的对象。`cq.004`（"2026年1月有哪些分录被冲销过以及原因分布"）是典型需要指标的问题；
指标只声明含义，计算实现放进 `binding_kind: metric` 的那条绑定。

```yaml
metrics:
  - id: met.monthly_reversal_rate
    definition: "某会计期间内被冲销的分录数 ÷ 该期间已过账分录总数"  # 必填
    support: [{ type: evidence, alignment_id: aln.0028 }]        # 必填
```
