# 五种处置

来自流程 §9.3。每个被审对象恰好落一种，没有第六种，也没有空着的。
`review_binary` 检查这件事，同时检查 candidate 里每个声明都出现在 `items` 里。

| 处置 | 含义 | 之后发生什么 | 必填 |
|---|---|---|---|
| `accept` | 这个对象和它的 trace 都够了 | 留在 candidate，进入总体门 | — |
| `comment` | 需要解释或变更，形成一条变更请求 | 进 `revise` 的影响分析 | `note` |
| `direct_edit` | 人当场就知道该怎么改 | 记录改法，由 `revise` 在新 revision 落地 | `intended_edit` |
| `defer` | 不阻断当前范围，但要留待办 | 进 defer backlog | `owner`、`rationale`、`target_revision` |
| `reject` | 无依据、重复、越界或语义错误 | 下一版删除或替代，历史保留 | `reject_reason` |

## accept 不等于"没意见"

accept 的意思是：这个对象的定义、身份、依据链在**当前范围**下都成立。
不是"我看过了"，也不是"没什么大问题"。有一点说不准就落 comment，
把说不准的地方写进 `note`——那也是结论，而且是比默许更有用的结论。

## comment 是默认

拿不准落 comment。它最便宜：不改任何东西，只留下一个必须被回答的问题。
一条 comment 在 `close-out` 时变成 `history/comments.yaml` 里的一条变更请求，
带 `change_id` 和 `target_object_id`，由 `revise` 逐条闭环（`changes_closed`）。

写 comment 的时候写清楚**你希望看到什么变化**，不要只写"这里不对"。
"这里不对"到了修订阶段会变成一次猜测，而猜测出来的改动没人能验收。

## direct_edit 在这里只被记录

**封存的 revision 是只读的。** direct_edit 不写 `candidate.yaml`，它写
`items[].intended_edit`——一段说清楚"改成什么"的文字，最好直接给出目标字段和目标值：

```yaml
- object_id: rel.reverses
  disposition: direct_edit
  layer: ontology
  reviewer: DE1
  intended_edit:
    field: cardinality
    from: { source: "1", target: "1" }
    to: { source: "1", target: "many" }
    note: 一条原分录在极端情况下可能被冲销后再冲销，手册 §6.2 说的"只能一次"是系统限制不是业务规则
```

为什么不当场改：审阅意见和它的落地分开记录，才能回答"这个改动是谁要求的、
基于什么、在哪一版生效"。就地改掉，这三个问题的答案就都消失了，
`revision_sealed_immutable` 也会把这次改动报成一次历史被覆盖。

## defer 要有主

三样缺一不可，`defer_has_owner` 逐条查：

- `owner` —— 一个具体的人或角色，不是"团队"；
- `rationale` —— 为什么现在不做；
- `target_revision` —— 打算在哪一版处理，可以写 `next`，但不能空着。

没有 owner 的延后会漂移成事实。三个月后没人记得它曾经是个待办，
它就变成了模型的一部分——而且是没有人为之负责的那部分。

## reject 的四类理由

`reject_has_reason` 只接受这四个词，因为它们各自导向完全不同的下一步：

| `reject_reason` | 什么情况 | 下一版怎么处理 |
|---|---|---|
| `unsupported` | 找不到任何证据或显式假设支撑它 | 删除，或补一条 assumption 再重新提出 |
| `duplicate` | 和另一个对象说的是同一件事 | 合并到那个对象，别名并入 `aliases` |
| `out_of_scope` | 真实存在，但不在这次的边界内 | 移出，记进 backlog，可能进下一个 bounded context |
| `semantically_wrong` | 建错了——方向反了、粒度错了、把事件建成了实体 | 重写；这类通常牵动关系和属性 |

**删除不删历史。** reject 的对象在下一版消失时，`semantic-diff.yaml` 里那条 `removed`
必须带 `replaced_by` 或 `removal_rationale`（`diff_removals_explained`）。
审阅时把 reject 的理由写清楚，修订时就有现成的 `removal_rationale` 可写。

## 怎么给整组建议

九个属性全部 accept，比逐个问九遍有用。分组呈现的做法在
`presenting-large-graphs.md`；这里只说结论的形态：

> Ontology 轮 · 属性（2 个）：都建议 accept。
> `attr.journal_entry.amount` 的单位写的是"本位币，不含税（假设）"——
> 政策 §3.3 没说含不含税，这是我们自己定的。要改哪个？

给整组一个默认处置，把需要单独说的那一两个点出来。人改例外，不逐个确认。
