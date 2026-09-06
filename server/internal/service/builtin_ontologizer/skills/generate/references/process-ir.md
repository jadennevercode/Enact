# Process 层 · `process_ir.yaml`

回答一个问题：**业务怎么发生？**

里面是步骤、参与者、输入输出、决定、衔接、异常，以及跨 revision 稳定的 locator。
里面**没有**目标设计——没有实体、没有关系、没有属性、没有约束。

## 顶层不许出现的键

`layer_separation` 拿这一串去核 `process_ir` 的顶层键和 `steps` 条目内的键：

```
entities  relationships  attributes  constraints
policies  capabilities   bindings    metrics
bundle    declarations   domain
```

最常见的一种混入是在一条 step 上挂 `entities:` 列表——读流程读着读着，
顺手把"这一步涉及哪几个实体"写下来了。那件事属于 `alignment.yaml`。

## 事件和生命周期可以写在这里

`events` 与 `lifecycles` **不在**禁列里。流程 §5.3 把它们算作 Process 层自己的
内容：一份描述"什么时候发生了什么、状态怎么走"的流程表示，是在尽本分。

两层的事件靠**形状**区分，不靠位置：

```yaml
# process_ir.yaml —— 流程事件：谁在哪一步做了什么
events:
  - id: proc.evt.approved
    name: 审批通过
    at_step: proc.step.approve
    actors: [proc.role.supervisor, proc.role.controller]
    locator: "ev.001 §6.2/3"
```

```yaml
# candidate.yaml —— 本体事件：带定义与依据，指回流程那一条
events:
  - id: evt.reversal_approved
    participants: [ent.journal_entry]
    changes_state_of: ent.journal_entry
    process_ref: proc.evt.approved          # ← 两层互查
    definition: 审批人对一次冲销申请作出通过裁决的时刻，它使原分录进入可被冲销的状态。
    support: [{ type: evidence, alignment_id: aln.003 }]
```

流程事件没有 `definition`、没有 `support`——它不是一个设计决定，
只是"图上/文档里这一步之后发生了这件事"。本体事件有这两样，
因为把某个时刻提升成一个可被查询、可被约束引用的对象是一个设计决定。

写在这里的流程事件，id 进 `refs_resolve` 认得的 locator 集合，
所以 candidate 的 `process_ref` 和 `lifecycles[].transitions[].trigger` 都能指它。

## 必填字段

`schema_valid` 核 `steps` 里每条的 `id`、`name`、`actors`。三样都不能空。

`actors` 空的步骤是一个没有人做的动作。它通常意味着两件事之一：
这一步其实是系统自动的（那就写 `[proc.role.system]`），
或者材料里根本没说谁做（那就写下来并当作一个缺口，不要留空）。

## 七个可被引用的集合

`refs_resolve` 和 alignment 的 `source` 都从这七个集合里取 id：

```
steps  events  decisions  handoffs  exceptions  records  roles
```

在这七个之外定义的东西（比如模板里的 `open_paths`）不能被引用。
它们是给人读的备注，不是 locator。

## locator 是跨 revision 的身份

每条 step 的 `id` 是稳定 locator：改名不换 id。
上一版审阅时有人对 `proc.step.approve` 提了意见，这一版这个 id 还在，
意见就还挂得上；id 变了，意见就变成断链，只能标 orphaned。

再加一个 `locator` 字段指回证据（`"ev.001 §6.2/3"`），
这样审阅 Process 轮的人不用翻回证据层就能核对顺序。

## 图上没有的线，这里就没有

`flow-diagram-notes.md` 里三处断口：审批否决分支的连线断开、
回滚之后无去向、右下角一个没有连线的「复核」方框。

**不要在 `process_ir` 里替它补线。** 正确的做法是把断口本身写下来：

```yaml
decisions:
  - id: proc.dec.approval_outcome
    name: 审批是否通过
    branches:
      - { when: "通过", to: proc.step.create_reversal }
      - { when: "否决", to: proc.exc.rejected }
    note: >-
      否分支在流程图上连线断开（ev.gap.001）。此处的去向来自访谈 q.202，
      不是材料原文——alignment 里对应的映射 confidence 记为 medium。

open_paths:
  - id: proc.open.rollback_target
    description: 回滚之后流程指向哪里，流程图未画，访谈也未覆盖
    locator: "ev.003 图/回滚节点"
```

访谈补上的那条线可以画进 `branches`，但 `note` 要写清楚它来自访谈不是材料，
并且 alignment 里那条映射的 confidence 要降下来。这样三个月后有人问
「这条路径是哪儿来的」，答案就在文件里。

访谈也没覆盖的（回滚去向、「复核」方框）进 `open_paths`，**不猜**。
猜一条出来，它在 candidate 里会长成一条有向关系，然后在审阅里没人认得出
它是猜的——因为那时候它已经和别的关系长得一模一样了。

## 异常路径要有终点

`exceptions` 里每条要有 `handling`。手册 §6.4 给了四条，
访谈补了第五条（审批被否决 → 退回制单人）。

异常路径是 `lifecycle` 的主要来源之一：「过账失败则整笔回滚，原分录状态不变」
直接决定了生命周期上没有一条从 posted 出去又回来的转换。
没有异常，生命周期就只有一条主干线，而主干线是最不需要建模的部分。

## 决定点要写清楚判据

```yaml
decisions:
  - id: proc.dec.threshold
    name: 金额是否达到 50,000
    at_step: proc.step.approve
    branches:
      - { when: "amount >= 50000", to: proc.role.controller }
      - { when: "amount < 50000",  to: proc.role.supervisor }
    open_question: 阈值口径含税与币种未定，见 asm.001 / ud.002
```

`open_question` 不是装饰。这条判据的口径没定，意味着 candidate 里
`attr.journal_entry.amount` 的 `unit_or_format` 只能挂假设——
在 Process 层就把这件事标出来，Ontology 层写假设的时候就不会显得突兀。
