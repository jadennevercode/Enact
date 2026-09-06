# Evidence 层 · `evidential_ir.yaml`

回答一个问题：**我们从哪里知道？**

来源事实、术语、锚点、置信度、限制。它是 Define 阶段那批材料在这个 revision 里的
冻结投影——**不是复制一遍 FAGC 登记**，而是把这一版生成真正用到的那些事实
连同锚点固定下来。

## 必填字段

`schema_valid` 核 `facts` 里每条的 `id`、`statement`、`source_id`、`anchor`，
并核 `anchor` 里的 `location` 与 `exact_snippet`。

```yaml
facts:
  - id: ev.fact.001
    statement: 冲销分录的借贷方向与原分录相反，金额相同。
    source_id: ev.001                 # manifest 里的 evidence_id
    source_digest: "sha256:0f3c…"     # 冻结的原件哈希
    fagc_ref: fact.001                # 对应 FAGC 里哪张卡
    anchor:
      location: "§6.2/4"
      exact_snippet: "借贷方向与原分录相反，金额相同"
    confidence: high
```

`anchor` 可以是一个映射，也可以是一个列表（同一件事有两处出处时）。
两种写法都会被逐条核 `location` 与 `exact_snippet`。

## 锚点是整条追溯链的落点

`trace_complete` 的走法：candidate 某对象的 `support` → `alignment_id` →
alignment 的 `source` → 这里的某条 fact → 它的 `anchor`。
锚点缺 `location` 或 `exact_snippet`，这一整条链就断在最后一步，
而报错报在 candidate 那个对象上——**所以一个锚点写不全，会让一个看起来
毫无问题的实体过不了门。**

这不是设计缺陷，是设计意图：追溯链的强度等于它最弱的一环，报错就该报在
那一环所支撑的东西上。

## 不许出现的键

和 `process_ir` 同一串（见 `process-ir.md`）。这里最常见的混入是在一条 fact 上
挂一个 `entities:` 列表——读材料的时候顺手把"这条支撑哪几个实体"写下来了。

那件事属于 `alignment.yaml`。写在这里的后果是：以后没法回答
"这个实体是先有证据还是先有设计"，而这正是审阅 Mapping 轮唯一要问的问题。

## 冲突两条都进

```yaml
  - id: ev.fact.010
    statement: 软关账期间经财务控制批准后仍可冲销。
    source_id: ev.001
    anchor: { location: "§6.3", exact_snippet: "在软关账（soft close）期间，经财务控制批准后仍可冲销" }
    status: disputed
    conflict_group: cg.softclose

  - id: ev.fact.011
    statement: 软关账期间任何已过账分录不得冲销。
    source_id: ev.002
    anchor: { location: "§3.2", exact_snippet: "进入软关账后，任何已过账分录不得冲销。" }
    status: disputed
    conflict_group: cg.softclose
```

两条都写进来，都不映射到任何 candidate 对象（在 alignment 的
`unmapped_sources` 里说明为什么）。受影响的对象——这里是
`lc.journal_entry` 那条 `posted → reversed` 转换——改挂 assumption 型 support，
guard 的文字里直接写出未决。

这样审阅的人在 Ontology 层就能看见这个洞，不用翻回证据层去发现它。

## 术语和缺口

`terms` 记原始短语与别名，来源与锚点照写。candidate 里的 `aliases` 是**设计决定**
（我们决定把这几个说法归到同一个对象上），这里的 `terms` 是**来源记录**
（材料里确实有人这么叫）。两者形状像，责任不同。

`gaps` 记材料自己承认的空白：

```yaml
gaps:
  - id: ev.gap.001
    statement: 审批被否决之后流程走向何处，流程图上连线断开，材料未说明。
    source_id: ev.003
    anchor:
      location: "图/判断节点「审批通过?」否分支"
      exact_snippet: "否 →（图上此处连线断开，没有指向任何节点）"
    resolved_by: interview q.202
```

"材料里没有说"是一条有锚点的事实——锚点指向那个断口。
写下来，因为"没有说"和"我们没读到"是两件完全不同的事，
而半年后没人分得清，除非当时写下来了。

## 只放这一版用到的

不要把 FAGC 登记里全部 23 条都搬过来。搬过来的每一条，
`refs_resolve` 都会去核它的引用，而没有任何 alignment 指向它的事实
只是噪声——它让 Evidence 轮的审阅变成通读一遍材料。

这一版没用到但以后可能用到的事实，留在 FAGC 登记里就好。
FAGC 是项目级的、跨 revision 的；`evidential_ir` 是这一版的。
