# Mapping 层 · `alignment.yaml`

回答一个问题：**证据和流程怎么支撑设计？**

一条 mapping = 一次显式断言：这个来源支撑那个设计对象。
它是四层里最薄的一层，也是唯一让追溯链能走通的一层——
没有它，Evidence 层和 Ontology 层就是两份互不相干的文件。

## 四个必填字段

```yaml
mappings:
  - id: aln.001
    source: ev.fact.001        # evidential_ir 的 fact id，或 process_ir 六个集合里的 id
    target: rel.reverses       # candidate 里存在的声明 id
    confidence: high           # high | medium | low
    rationale: 手册明确写了冲销分录与原分录的对应关系与方向
```

`layer_separation` 核 `source`、`target`、`confidence` 三样都非空；
`refs_resolve` 核两端真的存在：`source` 必须在 `evidential_ir.facts` 或
`process_ir` 的 `steps` / `events` / `decisions` / `handoffs` / `exceptions` /
`records` / `roles` 里；`target` 必须在 candidate 的声明里。

缺 `source` 或 `target` 的条目会被判为"无端点的自动对齐"。
那个说法的意思是：一条说"有依据"但指不出依据在哪的记录，比没有这条记录更糟——
它让 `trace_complete` 通过了，而链其实是断的。

## confidence 要老实

`high` / `medium` / `low` 不是修辞，它进 `trace-index.yaml` 的
`confidence_or_uncertainty` 字段，审阅 Mapping 轮时按它排序。

三条判据：

- **`high`**：来源里有一句话直接说了这件事，锚点能逐字对上。
- **`medium`**：来源支持这个设计，但中间隔着一次解释。
  比如 `proc.step.approve`（一个流程步骤）→ `evt.reversal_approved`（一个事件）——
  材料里有"审批"这一步，把它提升成一个有时刻、有参与者、改变状态的事件是我们的判断。
- **`low`**：来源只是相关，设计主要靠推理。这种通常应该改挂 assumption。

访谈补上的那条线（审批否决 → 退回制单人）对应的映射是 `medium`：
访谈是可归因的来源，但它不是文档，而且只问了一个人。

## 有歧义就指向假设

```yaml
  - id: aln.004
    source: ev.fact.002
    target: attr.journal_entry.amount
    confidence: medium
    rationale: 金额是审批路由的判据；但阈值口径未定
    ambiguity: 含税/不含税、原币/本位币两份材料都未说明
    assumption_ref: asm.001
```

`ambiguity` 和 `assumption_ref` 不是必填，但它们是这一层存在的另一半理由：
流程 §8.2 要求 alignment **记录 ambiguity 与 assumption**，而不是把它们平滑掉。

自己定一个口径然后不写下来，是这一层最坏的失败方式——因为它看起来一点问题都没有。

## 两个方向的"没对上"都要写

**`unmapped_sources`** —— 有来源但没落到任何设计对象：

```yaml
unmapped_sources:
  - source: ev.fact.010
    reason: 软关账冲突未裁决（ud.001）。两条冲突事实都不单独支撑对象。
  - source: proc.open.review_box
    reason: 「复核」方框未接入流程，无法判断它是角色、步骤还是遗留图元。
```

**`weakly_supported_targets`** —— 设计里有但证据支撑不足：

```yaml
weakly_supported_targets:
  - target: ent.close_period
    reason: 期间对象由政策 §3.1 的三种状态推出，但材料未把「会计期间」当作可引用对象描述
    support_used: { type: assumption, id: asm.001 }
```

两个列表空的时候**也要写出来**并说明是空的。
`shared/conventions.md` 第 5 条：空结果也是结论。
"没有未映射项"是一句有信息量的话，省略它等于让读的人以为你没检查。

## 一对多、多对一都是正常的

一条证据支撑多个对象（`ev.fact.004` 同时支撑 `ent.journal_entry` 和
`attr.journal_entry.status`）→ 两条 mapping，不同的 id。

一个对象由多条证据支撑（`rel.reverses` 既有手册的描述，又有 CSV 里
`reversal_of` 这一列的实证）→ 两条 mapping，同一个 target。

不要为了"整洁"合并成一条。合并之后，其中一份材料改版时你分不清
哪一半支撑还在。

## 这一层不做设计

`alignment` 里不出现新的对象、新的字段、新的定义。它只连线。

在这里写 `target: ent.approver`（一个 candidate 里不存在的实体）
不会创建那个实体，只会让 `refs_resolve` 报一条悬空引用——
而这正是它该做的：设计决定必须先在 candidate 里落地，才轮到这一层去连它。
