# 建模规则

流程 §8.3 的八条补充建模规则，和白皮书 §10.3 的十条概念设计原则，
在这里合成一份。两边讲的是同一件事的两个切面：流程讲"写下来的东西要满足什么"，
白皮书讲"决定写什么的时候按什么取舍"。

每条规则后面标了**谁来管**：机器检查项，还是只能靠人审。分清这件事很重要——
把只能人审的规则写成一句大写的 MUST，不会让它被执行，只会让人以为它被执行了。

## 目录

- [八条规则](#八条规则)
- [1 · 唯一身份](#1--唯一身份)
- [2 · 单一定义](#2--单一定义)
- [3 · 粒度](#3--粒度)
- [4 · 关系语义](#4--关系语义)
- [5 · 属性](#5--属性)
- [6 · 分类与继承](#6--分类与继承)
- [7 · 约束、契约与政策三分](#7--约束契约与政策三分)
- [8 · 最小模型](#8--最小模型)
- [白皮书补的三条](#白皮书补的三条)
- [机器管不到的那一半](#机器管不到的那一半)

## 八条规则

| # | 规则 | 机器检查项 | 机器管到哪 |
|---|---|---|---|
| 1 | 唯一身份 | `ids_stable_unique` | id 重复、改名换 id |
| 2 | 单一定义 | `definition_present` | 定义为空、定义是名称复述 |
| 3 | 粒度 | 无 | 全靠人审 |
| 4 | 关系语义 | `relationship_declared` | 五个字段是否填了 |
| 5 | 属性 | `schema_valid` 部分 | datatype、nullable、owner 是否有 |
| 6 | 分类与继承 | `inheritance_is_a`（warning） | 定义里有没有 is-a 判据 |
| 7 | 约束三分 | `schema_valid` 部分 | `kind` 字段是否填了 |
| 8 | 最小模型 | `trace_complete` 侧面 | 有没有依据；有没有用处查不了 |

## 1 · 唯一身份

每个 declaration 用稳定技术 ID；**单纯改名不产生新对象**。
`id` 是身份，`view_label` 是展示，`canonical_name` 是机器名。

```yaml
entities:
  - id: ent.journal_entry        # 永不改
    view_label: 日记账分录        # 随时可改
    canonical_name: JournalEntry # 改这个不改 id
```

**`ids_stable_unique` 管什么**：bundle 内 id 唯一；和父 revision 比，
`canonical_name`（没有就用 `view_label`）归一化后相同的对象，id 必须也相同。
把 Journal Entry 改名成 GL Entry 顺手换了 id，检查会指出它在父 revision 里叫什么。

**机器管不到**：id 命名是否可读、前缀是否成体系（`ent.` / `rel.` / `evt.`）。
一致的前缀不是硬性要求，但半年后翻 `trace-index.yaml` 的人会感谢你。

## 2 · 单一定义

每个实体、关系和关键属性有一条**无循环、可判别**的业务定义，并保留
source phrase 和 alias。白皮书 §10.3 补一句：**定义同义词，也定义易混淆词和反例。**

```yaml
    definition: "在总账中登记的一组借贷平衡的会计记录，有唯一编号、所属会计期间和过账状态。"
    aliases: [日记账分录, JE, 分录]
    counter_examples: ["工厂口中的纸质'凭证'——不是系统对象"]
```

**`definition_present` 管什么**：实体、关系、事件的 `definition` 非空；
定义不以对象自己的名字开头（去掉名字后剩不到 8 个字符就判为复述）。
`"Journal Entry 是一条日记账分录"` 会被拦下来。

**机器管不到**：定义**准不准**。"可判别"意味着拿两个边界样本给它，
能判出一个在内一个在外。`ActiveCustomer` 是"有过历史订单"还是"近 90 天付过款"，
机器分不出来，领域专家一眼能分出来——这正是四轮审阅第四轮要做的事。
`aliases` 和 `counter_examples` 是可选字段，一个都不写照样过检查。

## 3 · 粒度

区分类型与实例、主数据与交易、实体与事件、对象与状态；**同层对象保持可比较粒度。**

冲销域里的典型错法：把 `ent.journal_entry`（一条分录）和
`ent.general_ledger`（整个总账）并列成两个实体。它们不在一个数量级上，
放在同一张图里，任何"有多少个"的问题都会得到没有意义的答案。

**没有任何检查项管这件事。** 粒度混杂要靠人审第四轮识别，
或者靠语义 lint（流程 §19.3 列为 P2 增强，本包尚未实现）。
写生成报告的时候，把同层对象按数量级列一遍是最省事的自查方式。

## 4 · 关系语义

用业务动词命名；声明 source/target role、方向、可选性、基数和时间性；
关系自己有属性或生命周期时考虑 reification。
白皮书 §10.3 说同一件事：**关系要有方向、名称、基数和业务含义。**

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
    semantics: reference     # ownership | composition | reference | dependency | causal | lineage
    temporality: { kind: event_time, valid_from_attr: posted_at }
    reified: false
    definition: "冲销分录与它所冲销的原始分录之间的对应。"
    support: [{ type: evidence, alignment_id: aln.0009 }]
```

**`relationship_declared` 管什么**：`direction`、`source_role`、`target_role`、
`semantics` 四个字段非空，`cardinality` 是一个同时有 `source` 和 `target` 的映射。

**机器管不到**：基数**对不对**。`cardinality: { source: "1", target: "1" }`
和 `{ source: "1", target: "0..n" }` 在检查眼里没有区别，
但对"一条分录能不能被冲销两次"这个问题，两者给出相反的答案。
基数是最容易被模型信手填上的字段，也是审阅最该逐条盯的字段。
每条基数在审阅时都要能说出它来自哪句原文——这里是手册 §6.2-2
"一条分录只能被冲销一次"。

## 5 · 属性

明确 datatype、unit、format、nullability、枚举来源、敏感分类、是否多值；
**避免用自由文本承载稳定业务关系。**

```yaml
attributes:
  - id: attr.journal_entry.amount
    owner: ent.journal_entry
    datatype: decimal
    unit_or_format: "本位币金额；含税口径未定（asm.0004）"
    nullable: false
    multi_valued: false
    is_identity: false
    is_derived: false
    classification: financial
    temporal: { valid_time: true, record_time: true }
    support:
      - { type: evidence, alignment_id: aln.0013 }
      - { type: assumption, id: asm.0004 }
```

**`schema_valid` 管什么**：`id`、`owner`、`datatype`、`nullable`、`support` 必填。
`refs_resolve` 另外确认 `owner` 指向一个真实存在的实体。

**机器管不到**：`unit_or_format` 是可选字段，写 `decimal` 就能过检查。
但白皮书 §4.4 说得直白：**"金额"为 decimal 仍然不够**——含税还是不含税、
原币还是本位币、哪个时点有效、能不能跨币种直接比。
CSV 里 `tax_included` 有 Y 有 N、`currency` 有 CNY 有 USD，
而政策 §3.3 明说这件事没规定。一个只写 `datatype: decimal` 的属性
在检查上完美，在语义上把这个域最危险的歧义藏起来了。

也没有检查能发现"用自由文本承载关系"：一个 `remarks: "冲销了 JE-2026-0091"`
的字符串属性，机器看不出它其实是 `rel.reverses`。

## 6 · 分类与继承

只有子类满足 is-a 且继承规则一致时才用 subclass；**组成、拥有、参与不得误用继承。**

```yaml
relationships:
  - id: rel.reversal_entry_is_a_journal_entry
    source: ent.reversal_entry
    target: ent.journal_entry
    source_role: subtype
    target_role: supertype
    direction: source_to_target
    cardinality: { source: "1", target: "0..n" }
    semantics: subclass_of
    definition: "冲销分录是一种日记账分录：继承编号、期间、过账状态与借贷平衡约束，额外要求指向一条原分录。"
    support: [{ type: evidence, alignment_id: aln.0010 }]
```

**`inheritance_is_a` 管什么**（warning 级）：`semantics` 落在继承一类
（`inheritance` / `subclass` / `subclass_of` / `is_a` / `specialisation`），
或者 id/名字里带 `subclass`、`is_a` 的关系，它的 `definition` 必须出现
is-a 判据（"是一种"、"是一类"、"属于"、"子类"、`is a`、`kind of` 之类）。

**机器管不到**：判据**成不成立**。"冲销分录是一种日记账分录"能过检查，
"冲销申请单是一种日记账分录"同样能过——后者是把"参与"写成了继承。
继承会让推理得出结论，误用继承会让推理得出**错误**结论，
而错误结论看起来和正确结论一样自信。

## 7 · 约束、契约与政策三分

流程 §8.3-7：区分事实约束、平台 contract 和业务 policy；证据不足时记 assumption。
白皮书 §4.8 分得更细，本包按它的三分写进 `kind`：

| kind | 干什么 | 冲销域里的例子 |
|---|---|---|
| `axiom` | 描述领域语义，支持推理 | 每条冲销分录都对应一条原始分录 |
| `constraint` | 验证数据或状态 | 借方合计等于贷方合计 |
| `rule` | 按条件推导结论或触发决策 | 金额 ≥ 50000 需财务控制审批 |

```yaml
constraints:
  - id: con.segregation_of_duties
    kind: constraint
    statement: "同一 employee 不得同时是某条分录的 preparer 与 approver。"
    scope: [ent.journal_entry, ent.employee]
    open_world_note: "approver 字段为空表示尚未审批，不表示不需要审批。"
    support: [{ type: evidence, alignment_id: aln.0018 }]
```

**`schema_valid` 管什么**：`kind`、`statement`、`support` 必填；
`refs_resolve` 确认 `scope` 里的每个 id 都存在。

**机器管不到**：`kind` 选得对不对（把一条 rule 写成 constraint 没人拦），
以及 `open_world_note` ——它是可选字段，但白皮书 §4.8 把它当关键差异：
**缺少事实不等于事实为假**。CSV 里 `approver` 为空的那几行，
是"不需要审批"还是"还没审批"？封闭世界的校验会替你假设一个答案。

## 8 · 最小模型

只加入支撑范围、流程、数据绑定或胜任问题的对象。
流程 §3 把这条写成构建原则：**Model for questions and decisions**——
无用途的孤立概念应被质疑。

```yaml
    inclusion_rationale: "cq.001 要按期间状态过滤，guard 需要引用期间状态"
    cq_links: [cq.001, cq.006]
```

**`trace_complete` 管的是反方向**：每个 declaration 至少一条 support，
`evidence` 型 support 要能经 alignment 落到一条带锚点的 evidential fact 上。
它保证的是"这个对象有依据"，不是"这个对象有用处"。

**机器管不到有用处。** `cq_links` 和 `inclusion_rationale` 都是可选字段，
`refs_resolve` 只在 `cq_links` 有值时校验它指向存在的 CQ，不要求你写。
一个有完整证据链、没有任何 CQ 用得上的实体，全部检查都过。
这是最小模型原则唯一的执行方式：审阅时逐个问"哪条 CQ 需要它"，
答不上来就 reject，理由类别选 `out_of_scope`。

## 白皮书补的三条

流程 §8.3 没写、白皮书 §10.3 写了、本包认可的三条：

**优先建模稳定语义，把易变实现放在 Binding。** 表名、字段名、接口路径会变，
业务含义不会。`ent.journal_entry` 不叫 `ent.gl_je_header`，
ERP 表名放进 `bindings[].source_system`。没有检查管这件事，
但它决定这份本体能活几年。

**能力按业务意图命名，不按接口路径命名。** `cap.create_reversal_entry`，
不是 `cap.post_v2_gl_reversal`。同一个能力在 SAP 和自研系统里绑不同的执行端，
业务含义保持不变（白皮书 §4.10）。

**支持不确定性，不伪装成所有事实都绝对正确。** 这条在本包里有落法：
`support` 可以是 `{ type: assumption, id: asm.0004 }`。
证据不足时挂一条显式假设，比编一个精确的基数好——
流程 §3 Minimal semantic commitment。`trace_complete` 接受 assumption 型 support，
所以这条路是通的；`refs_resolve` 会确认这个 assumption 真的在 FAGC 登记里。

## 机器管不到的那一半

把上面散着的话收在一处。以下每一条，**没有任何检查项会报**，
只能在审阅（流程 §16.1 的 L2）里被人发现：

1. 定义**准不准**、可不可判别。
2. 基数**对不对**——填了就过，填反了也过。
3. 粒度是否可比——完全没有检查。
4. 继承判据是否**成立**——`inheritance_is_a` 只看定义里有没有 is-a 措辞。
5. 属性的单位、口径、时态是否说清——这些字段全是可选的。
6. `kind`（axiom / constraint / rule）分得对不对。
7. 对象有没有用处——`trace_complete` 只管有没有依据。
8. 术语是不是重复了——两个 id 不同、含义相同的实体，所有检查都过。

对应的做法只有一个：审阅按四层四轮走（`shared/four-layers.md`），
每个对象给出 accept / comment / direct_edit / defer / reject 之一
（`review_binary`），把"看起来没问题"从选项里拿掉。
