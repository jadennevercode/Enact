# 语义发现启发式

来自流程 §7.3。六种候选对象，每种一条识别启发和一个检查问题。
用途是：读证据的时候知道自己在找什么，以及在两种归类之间摇摆时问哪一句话。

例子全部取自 `evals/fixtures/journal-reversal/`（日记账冲销域），因为抽象的例子
在这件事上没有用——归类错误几乎总是发生在具体材料的模糊地带。

## 目录

- [六种候选对象](#六种候选对象)
- [1 · Entity 实体](#1--entity-实体)
- [2 · Event 事件](#2--event-事件)
- [3 · Relationship 关系](#3--relationship-关系)
- [4 · Attribute 属性](#4--attribute-属性)
- [5 · Role 角色](#5--role-角色)
- [6 · State 状态](#6--state-状态)
- [常见误判](#常见误判)
- [归类拿不准的时候](#归类拿不准的时候)

## 六种候选对象

| 候选对象 | 识别启发 | 检查问题 |
|---|---|---|
| Entity | 有持续身份、可独立引用、在多个事件中保持存在 | 不同记录中的它是否仍是同一个东西？ |
| Event | 在某时发生、改变状态或建立事实，带参与者和时间 | 是否需要保留发生时间、参与者和前后状态？ |
| Relationship | 两个各有独立身份的对象之间有业务含义的连接 | 连接是否需要方向、基数、时间或自身属性？ |
| Attribute | 描述某对象的值，通常没有独立生命周期 | 这个值要独立引用、治理或连接吗？要就提升成实体 |
| Role | 同一参与者在某关系或流程语境中的资格 | 它是稳定对象、关系端角色，还是一个标签？ |
| State | 实体生命周期中的可枚举条件，由事件或动作转换 | 有没有允许的转换、前置条件或审计要求？ |

这六种不是互斥的分类学，是六把尺子。同一个词在不同语境下可以量出不同结果——
"冲销"既可以是事件（`evt.reversal_created`）又可以是关系（`rel.reverses`），
两个都建才是对的，建一个就丢了一半信息。

## 1 · Entity 实体

**识别启发**：材料里反复出现、有编号或主键、在不同段落里被当作同一个东西谈论。

工单里的 `JE-2026-0091` 在 CSV 里是一行、在手册 §6.2 里是"原分录"、在
政策 §3.2 里是"已过账分录"。三处说的是同一个东西 → 实体。

```yaml
entities:
  - id: ent.journal_entry
    view_label: Journal Entry
    canonical_name: JournalEntry
    aliases: [日记账分录, JE, 分录]
    definition: "在总账中登记的一组借贷平衡的会计记录，有唯一编号、所属会计期间和过账状态；纸质单据不属于本类。"
    counter_examples: ["工厂口中的纸质'凭证'——不是系统对象"]
    identity_keys: [journal_id]
    support: [{ type: evidence, alignment_id: aln.0007 }]
```

注意 `counter_examples`：术语表明确写着"'凭证'在部分工厂指纸质单据，不是系统对象"。
定义里说清楚什么**不**属于这个类，和说清楚什么属于同样重要（白皮书 §4.2）。

**这个域里的实体**：`ent.journal_entry`、`ent.reversal_request`（冲销申请单，
手册 §6.5 说它有单号、三条记录靠它关联 → 有独立身份）、`ent.accounting_period`、
`ent.employee`、`ent.reason_code`。

## 2 · Event 事件

**识别启发**：材料里带时间副词的动词——"审批通过后系统生成"、"冲销分录过账后，
原分录状态变为 reversed"。发生一次、改一次状态。

```yaml
events:
  - id: evt.reversal_posted
    participants: [ent.journal_entry, ent.employee]
    definition: "冲销分录完成过账的时刻；此后原分录状态为 reversed，冲销分录状态为 posted。"
    time: { event_time: true, record_time: true }
    changes_state_of: ent.journal_entry
    process_ref: proc.step.post_reversal
    support: [{ type: evidence, alignment_id: aln.0021 }]
```

检查问题的重点在"前后状态"。手册 §6.2-5 同时给了前状态和后状态，所以这是事件；
如果材料只说"系统会过账"而不说过账改变了什么，那你手上的其实是一个流程步骤
（属于 `process_ir`），还不是一个事件。

## 3 · Relationship 关系

**识别启发**：两个已经立住的实体之间，材料用业务动词连接它们。

CSV 里的 `reversal_of` 列指向另一条 `journal_id`——两端都是实体，连接有方向、
有基数（手册 §6.2-2："一条分录只能被冲销一次"）→ 关系。

```yaml
relationships:
  - id: rel.reverses
    source: ent.journal_entry
    target: ent.journal_entry
    source_role: reversal
    target_role: original
    direction: source_to_target
    inverse_name: reversed_by
    cardinality: { source: "1", target: "1" }
    semantics: reference
    definition: "冲销分录与它所冲销的原始分录之间的对应；借贷方向相反、金额相同，一条原分录至多被冲销一次。"
    support: [{ type: evidence, alignment_id: aln.0009 }]
```

## 4 · Attribute 属性

**识别启发**：CSV 的列名、手册里的"必须填写 X"。默认先当属性，然后问检查问题。

```yaml
attributes:
  - id: attr.journal_entry.amount
    owner: ent.journal_entry
    datatype: decimal
    unit_or_format: "本位币金额，含税口径未定"
    nullable: false
    support:
      - { type: evidence, alignment_id: aln.0013 }
      - { type: assumption, id: asm.0004 }
```

这条属性同时挂了 evidence 和 assumption，是有意的：手册 §6.2-3 说门槛按本位币，
政策 §3.3 明说"未对'金额'是否含税、是原币还是本位币作出说明"，而 CSV 里
`tax_included` 有 Y 也有 N。含税口径是一条显式假设，不是事实。
**证据不足时保留显式假设，不编造精确定义**——流程 §3 Minimal semantic commitment。

## 5 · Role 角色

**识别启发**：材料里的人名位置上出现的不是人，是资格——"制单人"、"审批人"、
"财务控制"。

判断顺序是：**先试关系端角色，再试实体。** 只有当这个资格自己需要被治理
（有授予、有生效期、有权限清单）时才升格为实体。

在这个域里，"制单人"和"审批人"是关系端角色：

```yaml
relationships:
  - id: rel.prepared_by
    source: ent.journal_entry
    target: ent.employee
    source_role: prepared_entry
    target_role: preparer
    direction: source_to_target
    cardinality: { source: "1", target: "0..n" }
    semantics: reference
    definition: "分录与其制单人之间的记录归属；同一员工在另一条分录上可以是审批人。"
    support: [{ type: evidence, alignment_id: aln.0011 }]
```

"财务控制（Controller）"是个反例。术语表说：总部叫"财务控制"、工厂叫"财务经理"，
"两者权限是否等同，wiki 里没有说明"。这就不是一个可以随手建成实体的角色——
它是一条 unresolved assumption，要挂 `asm.*`，并在生成报告里点名。

## 6 · State 状态

**识别启发**：可枚举的取值，且材料描述了在什么条件下从一个值变到另一个值。

CSV 的 `status` 列有 draft / posted / reversed；政策 §3.1 给了期间的
open / soft_close / hard_close。两个都是状态，各属于一个实体，各要一个生命周期。

```yaml
lifecycles:
  - id: lc.journal_entry
    entity: ent.journal_entry
    states: [draft, posted, reversed]
    transitions:
      - { from: draft, to: posted, trigger: evt.journal_posted, actor_roles: [preparer] }
      - { from: posted, to: reversed, trigger: evt.reversal_posted, guard: "period.status != hard_close", actor_roles: [controller, gl_supervisor] }
    support: [{ type: evidence, alignment_id: aln.0016 }]
```

`guard` 那一条正好是本域最重要的争议点，见下面的误判 3。

## 常见误判

**1 · 把该提升的属性留在属性上。** CSV 里 `period` 看着像一列字符串（`2026-01`），
建成 `attr.journal_entry.period` 顺理成章。但政策 §3.1 说期间有三种状态、
手册 §6.3 说期间状态决定能否冲销——它有自己的生命周期、被规则引用、
需要独立治理。检查问题的答案是"要"，所以它必须是 `ent.accounting_period`，
用 `rel.belongs_to_period` 连过去。留在属性上，`lc.journal_entry` 的 guard
就没有东西可以引用，`refs_resolve` 也不会报——因为悬空的是语义，不是引用。

**2 · 把别名当成两个概念。** 术语表列了"冲销 / 红冲 / 反过账"，还特意注明
"'红冲'是习惯说法，系统里没有这个动作"。建成两个实体是重复概念反模式。
放进 `aliases`，让检索能命中，但只有一个对象。
反过来，"调整分录"和"冲销分录"术语表明说"不是一回事"，合并才是错的。

**3 · 把冲突挑一个留下。** 手册 §6.3 说软关账期经 Controller 批准仍可冲销；
政策 v4 §3.2 说软关账后任何已过账分录不得冲销。两份都是权威来源，
政策部说自己优先、共享中心实际按手册执行、分歧未正式裁决。
**两条都留，各自 disputed，把裁决留给人**（`conflicts_not_merged`）。
在 candidate 里这表现为两条 constraint 或一条 constraint 加一条 assumption，
而不是一条你自己选出来的 guard。

**4 · 把角色建成实体。** "制单人"和"审批人"建成两个实体，会得到一个模型：
同一个 `emp-2101` 在 CSV 里既是 preparer 又是 approver，于是他成了两个对象。
职责分离约束（政策 §3.4）恰恰要求判断"是不是同一个人"——身份被拆开之后，
这条约束就写不出来了。

**5 · 把流程步骤当事件。** 流程图注记里"[系统] 过账"是一个步骤，属于
`process_ir`；`evt.reversal_posted` 是它成功之后建立的事实，属于 `candidate`。
把步骤直接写进 candidate 会触发 `layer_separation`——但更常见的失败是反过来：
在 `process_ir` 的一条 step 里顺手挂一个 `entities:` 列表，检查同样会报。

**6 · 只建名词。** 只产出 entities + relationships + attributes 的 candidate
在结构上是合法的，但 `behaviour_present` 会给一条 warning。这个域里
状态、审批门槛、职责分离全都在行为侧——只建名词等于把客户真正的问题
（"这条分录能不能冲销"）留在模型外面。

## 归类拿不准的时候

按这个顺序问：

1. 它在材料里出现过几次，每次说的是同一个东西吗？（→ Entity）
2. 材料关心它什么时候发生、谁参与、之后变成什么样吗？（→ Event）
3. 它是两个已经立住的东西之间的连接吗？（→ Relationship）
4. 有没有哪条 CQ、哪条规则要按它过滤、聚合或引用？（→ 从 Attribute 提升）

四个都答不上来，这个候选对象大概不该存在——流程 §8.3-8 最小模型：
只加入支撑范围、流程、数据绑定或胜任问题的对象。
删掉比留着好，留着的每一个对象都要有人审、有人维护、有依据可查。
