# Rule check 怎么真的跑

Rule check 是本包在 V1 里**能真跑**的那一类检验。它不需要图库，
只读绑定 revision 的两份产物：

- `revisions/rNNNN/candidate.yaml` —— 目标语义模型；
- `revisions/rNNNN/trace-index.yaml` —— 每个对象的追溯记录。

## 它回答什么

一句话：**这版模型有没有把这道题需要的东西声明出来，并且它们之间连得上。**

四步，逐步都可能否掉这道题：

| 步 | 查什么 | 查不到时 |
|---|---|---|
| 1 | `required_entities` 里每个 id 在 candidate 的 `entities` 里存在 | 缺概念 → `unsupported` |
| 2 | `required_relationships` 里每个 id 存在，且两个端点都在第 1 步的集合里 | 缺连接 → `unsupported` |
| 3 | `required_attributes` 里每个 id 存在，`owner` 指向第 1 步里的实体 | 缺字段 → 看情况 |
| 4 | 题目需要的**路径**在关系图上走得通 | 走不通 → `failed` |

第 4 步是唯一需要真算的一步：把 `relationships` 当成一张有向图
（`source` → `target`，`direction: source_to_target` 决定方向），
看题目的起点实体能不能沿着 `required_relationships` 走到终点实体。

## unsupported 和 failed 在这里怎么分

这是这份文档最重要的一段，也是最容易搞错的一处。

**缺东西 = `unsupported`。缺东西说明当前模型契约没打算承诺这项能力**——
它需要一次范围决定（要不要把这个概念纳进来），不是一张缺陷单。

**东西都在但连不上 = `failed`。** 模型意图上应该支持这道题，
所需的实体和关系都声明了，但路径断了、方向反了、基数不允许——
这是设计错误，该开变更请求。

例：cq.003"某条冲销分录对应的原始分录是哪一条"
`required_entities: [ent.reversal_entry, ent.journal_entry]`、
`required_relationships: [rel.reverses]`。

- 三个 id 都在 → 走第 4 步；`rel.reverses` 的 source 是 `ent.reversal_entry`、
  target 是 `ent.journal_entry`，方向 `source_to_target`，路径通 → **passed**。
- 如果 `rel.reverses` 的方向被写反了，路径不通 → **failed**，这是真 bug。
- 如果 `ent.reversal_entry` 压根没建 → **unsupported**，这是范围问题。

## 光有路径不等于 passed

**流程 §11.1 明确禁止把"查询返回数据"等同于"语义正确"。** 在 rule check 这里，
等价的陷阱是：路径存在 ≠ 这条路径回答的是这个问题。

所以 passed 还要过 `expected_answer_shape` 这一关：

| 题目要的形状 | 路径上要能看出来 |
|---|---|
| 一个布尔 + 依据规则 | 有一条 constraint 或 lifecycle transition 的 guard 能给出判据 |
| 一条记录的编号 | 关系的 `cardinality` 在目标端是 `1`，否则答案是一组不是一条 |
| 一组按某维聚合的数 | 聚合维对应的属性存在，且它的 `datatype` 支持分组 |
| 一条时间线 | 有 event 与 lifecycle，且 event 记了 `event_time` |

对不上就是 `failed`，rationale 写清楚形状差在哪。

例：cq.001"这条已过账分录现在能不能冲销"要的是"布尔 + 依据规则"。
`lc.journal_entry` 的 `posted → reversed` 转换带 `guard: period.status != hard_close`，
这条 guard 就是判据——但软关账那条冲突还没裁决，guard 覆盖不了 `soft_close` 这一档，
所以这题在 fixture 里的正确状态是 `unsupported`（契约不承诺），不是 failed。

## 执行证据写什么

`cq_result_bound` 要求 passed 必须有 `execution_evidence`。它至少要能让人复核：

```yaml
execution_evidence: >-
  在 r0003 上：ent.reversal_entry --rel.reverses(source_to_target,
  cardinality source=1/target=1)--> ent.journal_entry，路径长度 1；
  目标端基数为 1，与 expected_answer_shape "一条分录编号" 相符。
  查自 revisions/r0003/candidate.yaml。
```

三样：**在哪个 revision 上、走了哪条路径、形状怎么对上的**。
写"检查通过"不算证据——它没有告诉复核的人任何可以验证的东西。

## 数字要报出处

报结果的时候写清楚是哪一次运行、绑定哪个 revision 算出来的：
"6 题里 3 passed / 1 failed / 2 unsupported（ev-0002，绑定 r0003）"。
说不出出处的数字就不说（`shared/conventions.md` 第 7 条第 5 款）。
