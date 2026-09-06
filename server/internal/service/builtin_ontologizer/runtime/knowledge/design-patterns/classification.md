# 模式 · Classification

## 问题

冲销分录既是一条日记账分录（有编号、有期间、有过账状态、借贷要平），
又不完全是（它必须指向一条原分录，而且本身不可再被冲销）。
你要表达"它是一种 X，但多了一些约束"。

## 错误的建模

两种错法，方向相反。

**错法一：什么都挂继承。**

```yaml
relationships:
  - id: rel.request_is_a_journal_entry
    source: ent.reversal_request
    target: ent.journal_entry
    semantics: subclass_of
    definition: "冲销申请单是一种日记账分录。"      # 不成立
    # …（其余字段省略）
```

冲销申请单不是分录，它是发起冲销的那张单子——参与关系被写成了继承。
继承会让推理得出结论，误用继承会让推理得出**错误**结论，
而错误结论看起来和正确结论一样自信。

**错法二：用一个 `entry_type: normal | reversal | adjustment` 的枚举属性代替分类。**
这样写，"冲销分录不可再被冲销"这条约束没有地方挂——它只对其中一个取值成立，
而约束的 `scope` 只能指向对象，不能指向取值。

## 模式

**子类满足 is-a 且继承规则一致时，才用 subclass。** 用一条关系表达，
`semantics` 落在继承一类，定义里写明 is-a 判据和"多出来的是什么"。

```yaml
entities:
  - id: ent.reversal_entry
    view_label: 冲销分录
    canonical_name: ReversalEntry
    definition: "为抵销一条已过账分录而生成的分录，借贷方向相反、金额相同。"
    support: [{ type: evidence, alignment_id: aln.0010 }]
    aliases: [反向分录]
    counter_examples: ["调整分录——下一期间做，不改原分录状态，不是冲销分录"]

relationships:
  - id: rel.reversal_entry_subclass_of_journal_entry
    source: ent.reversal_entry
    target: ent.journal_entry
    source_role: subtype
    target_role: supertype
    direction: source_to_target
    cardinality: { source: "1", target: "0..n" }
    semantics: subclass_of
    definition: "冲销分录是一种日记账分录：继承编号、期间、过账状态与借贷平衡约束，额外要求指向一条原分录且自身不可再被冲销。"
    support: [{ type: evidence, alignment_id: aln.0010 }]

constraints:
  - id: con.reversal_not_reversible
    kind: axiom
    statement: "ent.reversal_entry 的实例不得成为 rel.reverses 的 target。"
    scope: [ent.reversal_entry]
    support: [{ type: evidence, alignment_id: aln.0012 }]
```

`counter_examples` 在这里特别值钱：术语表明说"调整分录"与"冲销分录"
**不是一回事**，写进反例可以防止后面有人把两者合并。

## 什么时候不要用

- **组成用 composition，拥有用 ownership，参与用事件。**
  这三样都不是继承，`semantics` 有对应取值。
- **只是为了少写几条属性** —— 继承是语义声明，不是复用手段。
- **子类之间会互相转化** —— 那是状态，用生命周期。一条分录不会从"普通分录"
  变成"冲销分录"，所以这里适合分类。
- **只有一个子类且没有额外语义** —— 直接在父类上加约束（最小模型）。

## 检查项

`inheritance_is_a`（warning）：`semantics` 落在
`inheritance` / `subclass` / `subclass_of` / `is_a` / `specialisation`，
或 id、名字里带 `subclass` / `is_a` 的关系，`definition` 必须含 is-a 判据
（"是一种"、"是一类"、"属于"、"子类"、`is a`、`kind of` 等）。

它只看措辞，**不看判据是否成立**。"冲销申请单是一种日记账分录"
一样能过这条检查。成立与否只有人能判断。
