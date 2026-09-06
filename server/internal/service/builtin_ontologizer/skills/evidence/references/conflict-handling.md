# 冲突处理

两份材料说法打架时，**两条都留**。检查项 `conflicts_not_merged` 核这件事。

## 三种不是冲突的情况

先排除，否则会把正常的信息差都标成 disputed，然后没人再看那个标记。

1. **适用范围不同。** 手册讲总账、政策讲全公司，两者对同一个词给出不同门槛——
   这是范围差，各自写清 `scope` 即可，不是冲突。
2. **时间不同。** 旧版说 A，新版说 B，新版明确取代旧版——这是版本演进。
   记新版为现行，旧版标 `deprecated` 并写 `valid_time`。
3. **详略不同。** 一份说"需要审批"，另一份说"金额过 5 万需 Controller 审批"——
   后者是前者的细化，不是矛盾。

**是冲突的判据**：两条陈述在同一范围、同一时间上，对同一件事给出**互斥**的结论，
并且没有任何一份材料声明自己让位于另一份。

## 软关账那一组

```
手册 §6.3   在软关账期间，经财务控制批准后仍可冲销
政策 §3.2   进入软关账后，任何已过账分录不得冲销
```

同一时间窗（2025-11 之后两者都生效）、同一对象（已过账分录）、互斥结论。
政策自己还加了一句注："本条与《总账操作手册》第 6.3 条存在不一致。政策部立场为
本政策优先，但共享中心实际执行中仍按操作手册处理。该分歧尚未正式裁决。"

这句注不是裁决。它是**一方对争议的单方面陈述**，正好证明了争议存在且未决。
把它当成"政策优先，所以按政策记"来处理，是这里最容易犯的错。

## 怎么记

```yaml
- statement_id: fact.010
  classification: fact
  statement: 软关账期间，经财务控制批准后仍可冲销已过账分录。
  source_ids: [ev.001]
  anchors: [{ location: "§6.3", exact_snippet: "在软关账（soft close）期间，经财务控制批准后仍可冲销" }]
  status: disputed
  conflict_group: cg.softclose
  scope: 共享中心执行口径
  valid_time: "2025-11 起"
  authority_or_owner: 总账操作手册（FSSC）

- statement_id: fact.011
  classification: fact
  statement: 软关账期间，任何已过账分录不得冲销。
  source_ids: [ev.002]
  anchors: [{ location: "§3.2", exact_snippet: "进入软关账后，任何已过账分录不得冲销。" }]
  status: disputed
  conflict_group: cg.softclose
  scope: 集团政策口径
  valid_time: "2025-04-01 起"
  authority_or_owner: 集团财务政策部
```

四个字段是硬要求，缺一项检查项就不过：

| 字段 | 为什么它是必需的 |
|---|---|
| `source_ids` | 裁决的人要能翻回原件 |
| `scope` | 冲突常常在范围上就能化解——两条各自适用于不同主体 |
| `valid_time` | 也常常在时间上化解——一条已经作废了 |
| `authority_or_owner` | 裁决要找谁，以及谁的说法在治理上更重 |

## 每组配一条有主的未决事项

```yaml
unresolved_decisions:
  - id: ud.001
    conflict_group: cg.softclose
    question: 软关账期间到底能不能冲销？以政策 §3.2 为准还是以手册 §6.3 为准？
    owner: OO1                       # 必填。检查项核它
    options:
      - 以政策为准：软关账一律禁止，手册 §6.3 作废，生命周期少一条转换
      - 以手册为准：软关账经批准可冲销，转换带 guard，政策待修订
      - 按主体分口径：本部按政策、工厂按手册，实体上要加适用范围属性
    consequence_if_unresolved: >-
      lc.journal_entry 的 posted → reversed 转换 guard 只能写成假设，
      cq.006（软关账期间的冲销申请按哪条规则处理）无法回答。
    status: open
```

`owner` 必填的理由：没有主的未决事项会漂移成事实。三周之后没人记得它没被裁决过，
而模型里那条 guard 已经按某一方写死了。

`consequence_if_unresolved` 不是检查项要的，但它决定这条未决事项会不会被认真对待。
"有个分歧待确认"没人会动；"cq.006 现在答不出来"有人会动。

## 冲突之后怎么建模

裁决之前不要替它选一边。生成阶段的做法是：

- 两条冲突事实都进 `evidential_ir`，都带 `conflict_group`；
- `alignment` 里把它们列进 `unmapped_sources`，写明未裁决；
- candidate 里受影响的对象（这里是 `lc.journal_entry` 的转换 guard）
  挂一条 `assumption` 型 support，不挂 evidence 型；
- guard 的文字里直接写出未决："`period.status != hard_close`（软关账口径未裁决，见 ud.001）"。

这样审阅的人在 Ontology 层就能看见这个洞，不用翻回证据层。

## 材料内部自相矛盾

同一份材料前后打架时，处理方式一样：拆成两条 `fact`，同一个 `conflict_group`，
`authority_or_owner` 都写这份材料，`scope` 写各自出现的章节。
不要因为"是同一份文件所以后面的覆盖前面的"就静默取一条——文档里的后一段
未必是修订，可能只是另一个人写的。
