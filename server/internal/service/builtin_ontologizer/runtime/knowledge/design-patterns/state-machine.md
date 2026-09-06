# 模式 · State Machine

## 问题

CSV 的 `status` 列有 draft、posted、reversed 三个值。
知道取值不够——客户的问题是"这条分录**能不能**冲销"，
答案取决于当前状态、期间状态和谁来批。

## 错误的建模

只建一个枚举属性：

```yaml
attributes:
  - id: attr.journal_entry.status
    owner: ent.journal_entry
    datatype: string
    nullable: false
    enum_source: "draft | posted | reversed"
    support: [...]
```

这等于说"status 字段可以写这三个字符串之一"。
它没有说 draft 能不能直接跳到 reversed，也没有说谁有资格做这次转换。
白皮书 §4.7 的说法是：状态机把"字段可以写任意字符串"提升为
"业务对象只能沿合法路径演化"。

## 模式

**一个实体一条生命周期**，转换写全五件事：从哪、到哪、什么触发、什么条件、谁能做。

```yaml
lifecycles:
  - id: lc.journal_entry
    entity: ent.journal_entry
    states: [draft, posted, reversed]
    transitions:
      - { from: draft, to: posted, trigger: evt.journal_posted,
          actor_roles: [preparer] }
      - { from: posted, to: reversed, trigger: evt.reversal_posted,
          guard: "period.status != hard_close", actor_roles: [controller, gl_supervisor] }
    support: [{ type: evidence, alignment_id: aln.0016 }]

  - id: lc.accounting_period
    entity: ent.accounting_period
    states: [open, soft_close, hard_close]
    transitions:
      - { from: open, to: soft_close, trigger: evt.period_soft_closed }
      - { from: soft_close, to: hard_close, trigger: evt.period_hard_closed }
    support: [{ type: evidence, alignment_id: aln.0017 }]
```

两条生命周期是必需的：`lc.journal_entry` 的 guard 引用了期间状态，
所以期间必须是一个有自己生命周期的实体，不能是 `ent.journal_entry` 上的一个字符串属性。

**guard 写不下去的时候，说明你碰到了一个未裁决的冲突。**
这个域里"软关账期间能不能冲销"正是如此：手册 §6.3 说经财务控制批准可以，
政策 v4 §3.2 说一律不可以。不要在 guard 里挑一边写死。做法是把 guard 写成
两边都同意的部分（`period.status != hard_close`），
把争议留成两条 disputed 的 constraint 或 policy，裁决交给人。

## 什么时候不要用

- **取值之间没有转换规则** —— `currency` 有 CNY 和 USD，但没有"从 CNY 变成 USD"
  这回事。那是枚举属性，用 `enum_source`。
- **状态属于别人** —— 期间状态不要建成分录的生命周期。
  一个生命周期只管一个实体（`lifecycles[].entity`）。
- **状态其实是派生的** —— "超期未审批"是由时间和状态算出来的，
  不是一次转换的结果。它属于 constraint 或 metric。

## 检查项

`schema_valid`（`entity` `states` `transitions` `support` 必填）、
`refs_resolve`（`entity` 存在；每个 `from`/`to` 都在 `states` 里；
`trigger` 指向存在的 event 或 process 对象）、
`behaviour_present`（warning：一条生命周期都没有会报"允许怎样变化没有被建模"）。

`guard` 和 `actor_roles` 是可选字段，写错或不写都不会报。
它们的正确性只能靠审阅第四轮。
