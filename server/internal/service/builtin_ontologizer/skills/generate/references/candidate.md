# Ontology 层 · `candidate.yaml`

回答一个问题：**目标语义模型是什么？**

这一份是设计。前三层是它的依据。

建模判据不在这里重复——十二类构件各自"高质量定义应包含什么"看
`knowledge/ontology-components.md`，八条建模规则加十条设计原则看
`knowledge/modeling-rules.md`，六类候选对象的识别启发看
`knowledge/discovery-heuristics.md`。**这一份只讲这个文件的结构和它上面的检查项。**

## 根结构

```yaml
bundle:
  id: r0001                     # 与所在 revision 目录同名
  parent: null                  # 第一版为 null，之后写上一版
  domain:
    id: dom.general_ledger_reversal      # 必填
    name: General Ledger Reversal
    goals: [...]
    non_goals: [...]
    owners: { domain: DE1, ontology: OO1, process: PO1 }
  entities: [...]
  relationships: [...]
  attributes: [...]
  events: [...]
  lifecycles: [...]
  constraints: [...]
  layers: { process: process_ir.yaml, evidence: evidential_ir.yaml, mapping: alignment.yaml }
```

`schema_valid` 要求 `bundle.id`、`bundle.domain`、`domain.id` 都非空，
并且 `entities`、`relationships`、`attributes` **三个集合都不能为空**。

## 六个核心集合的必填字段

`schema_valid` 逐条核。缺一项，报的是 `缺少字段：xxx` 加对象 id。

| 集合 | 必填 |
|---|---|
| `entities` | `id` `view_label` `canonical_name` `definition` `support` |
| `relationships` | `id` `source` `target` `source_role` `target_role` `direction` `cardinality` `semantics` `definition` `support` |
| `attributes` | `id` `owner` `datatype` `nullable` `support` |
| `events` | `id` `participants` `definition` `support` |
| `lifecycles` | `id` `entity` `states` `transitions` `support` |
| `constraints` | `id` `kind` `statement` `support` |

`nullable: false` 是合法值（`false` 不算空）。

## 四项检查项在核什么

**`ids_stable_unique`** —— bundle 内 id 唯一；且与父 revision 相比，
`canonical_name` 没变的对象 id 也不能变。**改名不产生新对象**：
`view_label` 随便改，`id` 是身份。

**`refs_resolve`** —— 关系两端指向存在的实体；属性 `owner` 指向实体；
事件 `participants` 与 `changes_state_of` 指向实体，`process_ref` 指向
process_ir 的 locator（步骤或流程事件都行）；生命周期 `entity` 指向实体，转换的 `from`/`to`
必须在自己的 `states` 里，`trigger` 指向一个事件或 process locator；
约束 `scope` 的每一项指向一个已声明的对象；`support` 的
`alignment_id` / assumption id / process id 各自解析。

**`definition_present`** —— 实体、关系、事件的 `definition` 非空，
且不能以对象自己的名字开头再接一句短语。
「Journal Entry 是一条日记账分录」会被判为名称的复述。
写定义的方法：**说清楚什么不属于它**。

```yaml
definition: >-
  在总账中登记的一组借贷平衡的会计记录，有唯一编号、所属会计期间与过账状态；
  工厂口中的纸质「凭证」不属于本类。
```

**`relationship_declared`** —— 每条关系有 `direction`、`source_role`、
`target_role`、`semantics`，且 `cardinality` 两端都声明。
少了这些，一条关系在 Agent 眼里和一条外键没有区别，
而大量业务含义正好存在于对象之间。

## support 的三种形状

```yaml
support:
  - { type: evidence, alignment_id: aln.002 }      # 经 alignment 落到带锚点的事实
  - { type: assumption, id: asm.001 }              # 指向 FAGC 里一条显式假设
  - { type: process_reference, id: proc.step.post } # 指向 process_ir 的 locator
```

`trace_complete` 只追 `evidence` 型：顺着 `alignment_id` → alignment 的 `source`
→ evidential_ir 的那条 fact → 它的 `anchor`，锚点必须同时有 `location` 与
`exact_snippet`。

**证据不足时挂 assumption，不要伪造 evidence 型。**
`ent.close_period` 就是这种情况：政策 §3.1 列了三种关账状态，
但没有任何材料把「会计期间」当作一个可引用的对象来描述。
挂 `{ type: assumption, id: asm.001 }` 是诚实的；
硬编一条 alignment 指过去是把假设洗成了事实。

## 行为：事件与生命周期

`behaviour_present` 是 warning 级，但它是这套流程里最值得当真的一条警告。

只有实体和关系的本体能回答"这是什么"，不能回答"在什么条件下可以做什么"——
而后者才是 Agent 真正要用的那一半。

**事件**是"世界如何变化"：有时刻、有参与者、改变某个东西的状态。

```yaml
events:
  - id: evt.reversal_approved
    participants: [ent.journal_entry]
    time: { event_time: true, record_time: true }
    changes_state_of: ent.journal_entry
    process_ref: proc.step.approve
    definition: 审批人对一次冲销申请作出通过裁决的时刻，它使原分录进入可被冲销的状态。
    support: [{ type: evidence, alignment_id: aln.003 }]
```

**生命周期**是"允许怎样变化"：状态集合 + 转换，每条转换带 trigger、guard、
actor_roles。

```yaml
lifecycles:
  - id: lc.journal_entry
    entity: ent.journal_entry
    states: [draft, posted, reversed]
    transitions:
      - { from: posted, to: reversed, trigger: evt.reversal_posted,
          guard: "period.status != hard_close（软关账口径未裁决，见 ud.001）",
          actor_roles: [controller, supervisor] }
    support: [{ type: evidence, alignment_id: aln.006 }]
```

注意 guard 里那句括号。未决的口径就写在 guard 上，**不要挑一边写死**——
审阅 Ontology 轮的人一眼就能看见这个洞，不用翻回证据层。

## 约束三分

`kind` 三选一：

- `axiom` —— 语义上恒真，用于推理（"冲销分录不能冲销自己"）。
- `constraint` —— 数据必须满足（"借贷相等"、"一条分录最多被冲销一次"）。
- `rule` —— 业务政策的执行面（"制单人不得是审批人"）。

`open_world_note` 不是必填但值得写：缺少事实不等于事实为假。
「缺少冲销记录不等于未被冲销过，需以状态字段为准」——
这句话防的是把开放世界当封闭世界用，那是本体里最贵的一类错。

## 扩展模块

`policies`、`capabilities`、`bindings`、`metrics` 按 `initiate` 里声明的范围产出。
不在范围内就**整段删掉**，不要留空集合装样子——空集合会让审阅的人以为
你考虑过并决定不建，而实际上只是没做到那一步。

字段要求见模板里注释掉的那几段，`schema_valid` 对它们的核法和核心集合一样严。

## 最小模型

只加入支撑范围、流程、数据绑定或 CQ 的对象。每个对象上写
`inclusion_rationale` 与 `cq_links`，说清楚它为哪个问题而存在。

写不出来的，就是不该建的。这不是风格偏好——多出来的每个对象都要有 support、
都要被审阅、都要在以后每一版的 diff 里出现一次。
