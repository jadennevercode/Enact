# 模式 · Event

## 问题

材料说"审批通过后系统生成冲销分录，过账后原分录状态变为 reversed"。
你需要保留的不只是"现在是 reversed"，还有：什么时候变的、谁参与、之前是什么。
只描述当前状态会丢掉"为什么变成这样"（白皮书 §4.6）。

## 错误的建模

把变化压进一个属性：

```yaml
attributes:
  - id: attr.journal_entry.reversed_at
    owner: ent.journal_entry
    datatype: datetime
    nullable: true
    support: [...]
```

这条属性能过全部检查。但它答不了三个问题：谁做的、当时期间是什么状态、
这次动作和哪条审批记录对应。`cq.005`（一条分录从制单到冲销经历了哪些状态和
谁的动作）会直接失败。

## 模式

**一次状态变化 = 一个 event**，参与者列全，时间分开记，指回流程步骤。

```yaml
events:
  - id: evt.reversal_posted
    participants: [ent.journal_entry, ent.reversal_request, ent.employee]
    definition: "冲销分录完成过账的时刻；此后原分录为 reversed、冲销分录为 posted。"
    support: [{ type: evidence, alignment_id: aln.0021 }]
    time: { event_time: true, record_time: true }
    changes_state_of: ent.journal_entry
    process_ref: proc.step.post_reversal
```

四个可选字段各有用处：

- `time` —— 白皮书 §4.6 的双时态。`event_time` 是现实何时发生（过账日期），
  `record_time` 是系统何时知道。冲销域里两者会差开：CSV 里 `JE-2026-0110`
  的 `posting_date` 是 2026-02-09，`period` 是 2026-01。
- `changes_state_of` —— 指出这个事件改的是谁的状态，让生命周期能挂上来。
- `process_ref` —— 指向 `process_ir` 的步骤。这个方向的引用是设计好的；
  反过来在 `process_ir` 里写 `entities:` 会被 `layer_separation` 拦下。
- `participants` —— `refs_resolve` 要求每个都是存在的实体。
  少列一个参与者，追溯链上就少一个人。

事件和生命周期成对出现：`lc.journal_entry` 的
`{ from: posted, to: reversed, trigger: evt.reversal_posted }` 引用它。
`refs_resolve` 会确认这个 trigger 解析得到。

## 什么时候不要用

- **流程步骤不是事件。** 流程图注记里"[系统] 过账"是一个 step，属于 `process_ir`。
  只有当它建立了一个需要被记住的事实（前状态、后状态、参与者、时间）时，
  才在 candidate 里再建一个 event。两边通过 `process_ref` 连起来，不重复建。
- **纯派生的时点不是事件。** "本月第一条分录的过账时间"是一个查询结果，
  不是发生过的事。
- **材料只说"系统会做 X"而没说它改变了什么** —— 这时你手上还没有事件，
  先去把前后状态问清楚，或者记一条 assumption。

## 检查项

`schema_valid`（`id` `participants` `definition` `support` 必填）、
`refs_resolve`（participants / changes_state_of / process_ref 都要解析）、
`definition_present`（定义非空且不是名称复述）、
`behaviour_present`（warning：candidate 里一个 event 都没有会报）。
