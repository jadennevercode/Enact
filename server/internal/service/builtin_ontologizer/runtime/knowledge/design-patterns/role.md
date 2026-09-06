# 模式 · Role

## 问题

同一个员工 `emp-2101`，在 `JE-2026-0091` 上是制单人，在别的分录上可能是审批人。
政策 §3.4 要求制单、审批、复核三项职责不得由同一人承担——
这条约束的前提是**能认出他是同一个人**。

## 错误的建模

把资格建成实体：

```yaml
entities:
  - id: ent.preparer
    view_label: 制单人
    canonical_name: Preparer
    definition: "在 ERP 中录入分录的人员。"
    support: [...]
  - id: ent.approver
    view_label: 审批人
    canonical_name: Approver
    definition: "对冲销申请给出批准或拒绝的人员。"
    support: [...]
```

全部检查都过。代价是 `emp-2101` 成了两个对象，
`con.segregation_of_duties` 从此写不出来——你没法比较两个不同类型的对象是不是同一个人。

## 模式

**先试关系端角色。** 角色住在 `source_role` / `target_role` 里，
参与者只有一个实体 `ent.employee`：

```yaml
relationships:
  - id: rel.prepared_by
    source: ent.journal_entry
    target: ent.employee
    source_role: prepared_entry
    target_role: preparer
    direction: source_to_target
    cardinality: { source: "1", target: "0..n" }
    semantics: reference
    definition: "分录与其制单人之间的记录归属；同一员工在另一条分录上可以是审批人。"
    support: [{ type: evidence, alignment_id: aln.0011 }]

constraints:
  - id: con.segregation_of_duties
    kind: constraint
    statement: "同一 employee 不得同时是某条分录的 preparer 与 approver。"
    scope: [ent.journal_entry, ent.employee]
    open_world_note: "approver 为空表示尚未审批，不表示不需要审批。"
    support: [{ type: evidence, alignment_id: aln.0018 }]
```

角色带时效或本身需要治理时，用 `actor_roles` 把它落在生命周期转换上：

```yaml
    transitions:
      - { from: posted, to: reversed, trigger: evt.reversal_posted,
          guard: "period.status != hard_close", actor_roles: [controller] }
```

## 什么时候不要用（改建实体）

当这个资格**自己需要被治理**时——有授予记录、有生效期、有权限清单、
有人负责维护它——它就该是实体。判据来自流程 §7.3 的检查问题：
**它是稳定对象、关系端角色，还是简单标签？**

冲销域里有一个现成的边界案例：术语表说"Controller 的中文岗位名在总部叫
'财务控制'，在工厂叫'财务经理'，两者权限是否等同，wiki 里没有说明"。
权限是否等同没有答案，就不能随手建一个 `ent.controller` 实体假装它是一个东西。
正确做法是挂一条显式 assumption，并在生成报告里点名：

```yaml
    support: [{ type: assumption, id: asm.0007 }]
```

## 检查项

`relationship_declared`（`source_role`、`target_role` 与其余三个语义字段必填）、
`refs_resolve`（关系端点与 constraint 的 `scope` 都要解析）。
**没有检查能发现你把角色建成了实体**——这一条只有人审能挡。
