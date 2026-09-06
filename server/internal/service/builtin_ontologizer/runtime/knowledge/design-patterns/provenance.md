# 模式 · Provenance

## 问题

"软关账期间不得冲销"——这句话是谁说的？哪一版说的？还作数吗？
和另一份文件说的相反怎么办？

白皮书 §11.7 把忽略这件事列为反模式：**"客户等级为金牌"必须附带来源、
有效时间和权威性；不同系统给出冲突值时，本体应表达冲突或决策规则，
而不是静默覆盖。**

## 错误的建模

三种，一种比一种隐蔽。

(a) **没有依据**：`ent.approval_matrix` 写着 `support: []`——`trace_complete`
直接报。

(b) **挑一个冲突留下**：只建一条 `con.soft_close_reversal`，
statement 写"软关账期间经财务控制批准可以冲销"——只留了手册那一条。

(c) **把推断写成事实**：在 `evidential_ir.yaml` 里记一条
`statement: "所有工厂对软关账起止时点的定义一致"`——而术语表恰恰说
"各工厂对'软关账'起止时点理解不一"。

## 模式

**一条陈述、一个来源、一条依据链。** 冲突各留一条，各带出处，状态 disputed。

```yaml
constraints:
  - id: con.soft_close_reversal_manual
    kind: rule
    statement: "软关账期间，经财务控制批准仍可冲销已过账分录。"
    scope: [ent.journal_entry, ent.accounting_period]
    support: [{ type: evidence, alignment_id: aln.0033 }]

  - id: con.soft_close_reversal_policy
    kind: rule
    statement: "进入软关账后，任何已过账分录不得冲销；须在下一开放期间提交调整分录。"
    scope: [ent.journal_entry, ent.accounting_period]
    support: [{ type: evidence, alignment_id: aln.0034 }]
```

两条各自的 alignment 指向 `evidential_ir.yaml` 里两条不同的事实，
每条事实带自己的锚点：

```yaml
facts:
  - id: fact.0033
    statement: "在软关账（soft close）期间，经财务控制批准后仍可冲销"
    source_id: process-general-ledger-ch6
    anchor:
      location: "process-general-ledger-ch6.md#6.3"
      exact_snippet: "在软关账（soft close）期间，经财务控制批准后仍可冲销"
  - id: fact.0034
    statement: "进入软关账后，任何已过账分录不得冲销"
    source_id: reversal-policy-v4
    anchor:
      location: "reversal-policy-v4.md#3.2"
      exact_snippet: "进入软关账后，**任何已过账分录不得冲销**"
```

证据不足时，不要编一个精确结论——挂一条显式假设：

```yaml
    support: [{ type: assumption, id: asm.0004 }]
```

这就是流程 §3 的 **Minimal semantic commitment**：证据不足时保留明确的
unresolved assumption，不编造精确分类、基数或约束。

## 什么时候不要用

- **不要为了让检查变绿而挂假的 assumption。** assumption 要在 FAGC 登记里真实
  存在并有 rationale，`refs_resolve` 会去查。
- **不要把执行日志全文搬进本体。** 保留证据**引用**，全文属于 Audit /
  Evidence Store（白皮书 §12）。
- **同一来源的两句话不是冲突。** 冲突指两个权威来源给出互斥结论。

## 检查项

`trace_complete`（每个声明至少一条 support；evidence 型要能落到带锚点的事实）、
`no_inference_as_fact`（fact 必须有含 `exact_snippet` 的 anchor）、
`conflicts_not_merged`（冲突各留一条、标 disputed、每组有一条未决 decision）、
`refs_resolve`（alignment_id 与 assumption id 都要解析）。

这一维是本包覆盖得最完整的。**剩下没人管的是依据够不够强**——
一条锚点存在，不等于它支持你写的那个结论。
