# 模式 · Policy

## 问题

"超过 50,000 元的账务变更需财务控制审批"、"制单、审批、复核三项职责不得由
同一人承担"。这两句都是规范，但性质不同：一句是义务，一句是禁止；
一句有金额条件，一句无条件成立。

## 错误的建模

**错法一：全部塞进一条 constraint。**

```yaml
constraints:
  - id: con.approval_rules
    kind: rule
    statement: "金额大于 50000 需 Controller 审批，且审批人不能是制单人，且软关账期间要另外批准。"
    scope: [ent.journal_entry]
    support: [...]
```

三条规范挤在一句话里。任何一条变了，整条都要改；
`cq.006`（软关账期间按哪条规则处理）也没法指向其中一条。

**错法二：把执行细节写进政策**——`action: "POST /api/v2/approvals?timeout=30&retry=3"`。
白皮书 §4.9 划的线：**业务政策由 Ontology 声明，技术执行由数据、知识或行动系统
完成。** 超时和重试属于 System of Actions。

## 模式

**一条规范一条 policy**，三个规范类型分清楚，条件写成业务语言。

```yaml
policies:
  - id: pol.reversal_approval_threshold
    modality: obligation           # permission | obligation | prohibition
    subject: role.controller
    action: cap.approve_reversal
    condition: "金额（本位币）≥ 50000"
    support: [{ type: evidence, alignment_id: aln.0022 }]

  - id: pol.segregation_of_duties
    modality: prohibition
    subject: role.preparer
    action: cap.approve_reversal
    condition: "该员工是同一条分录的制单人"
    support: [{ type: evidence, alignment_id: aln.0018 }]

  - id: pol.soft_close_reversal_manual
    modality: permission
    subject: role.controller
    action: cap.create_reversal_entry
    condition: "期间状态 = soft_close 且已获财务控制批准"
    support: [{ type: evidence, alignment_id: aln.0033 }]
```

第三条有争议：政策 v4 §3.2 给出相反的 prohibition。
**两条都写，不要合并**——见 `provenance.md`。
白皮书 §4.9 说完整政策还要有优先级、适用范围、生效时间、例外、依据和冲突处理；
在这个域里"政策部立场为本政策优先，但共享中心实际按操作手册执行，
该分歧尚未正式裁决"就是冲突处理这一栏的内容，它属于一条未决 decision，
不属于你替客户做的选择。

**政策和约束怎么分。** Constraint 验证数据或状态（借贷必须平）；
Policy 规范主体对动作的许可、义务或禁止（谁可以批）。
判据是句子里有没有"谁"。

## 什么时候不要用

- **扩展模块按范围产出。** `policies` 是扩展模块——`initiate` 阶段没有声明
  这个范围，就不要产。声明了却空着，才是问题。
- **不要把权限模型搬进来。** policy 声明规范，**不做 per-user ACL、
  runtime allow/deny**（SPEC §1 非目标）。主体分配属于外部 IAM。
- **无主体的规则不是政策**，是 constraint 的 `kind: rule`。

## 检查项

`schema_valid`（`modality` `subject` `action` `condition` `support` 必填）、
`refs_resolve`（`action` 要解析到一个存在的声明）。
`modality` 选得对不对、`condition` 写得准不准，**没有检查能发现**。
