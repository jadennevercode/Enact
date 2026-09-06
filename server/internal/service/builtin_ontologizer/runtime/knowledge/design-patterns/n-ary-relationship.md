# 模式 · N-ary Relationship

## 问题

"某员工在某段时间以审批人身份，对某条冲销申请给出批准，金额门槛是 50000。"
这句话里有三个参与方（员工、申请、门槛规则）加时间加角色。
二元关系装不下。

## 错误的建模

**错法一：把它压成一条二元关系** `rel.approved_by`（分录 → 员工）。
审批时间、审批结果、依据的门槛规则全丢了；`cq.005`（追溯责任）会缺一环。

**错法二：名词化**——建一个 `ent.approval_link`（"记录哪个员工审批了哪条申请"），
再用 `rel.link_has_employee`、`rel.link_has_request` 两条关系接回去。
全部检查都过，但这个"实体"没有业务身份、没有生命周期、没人会引用它。
这是流程 §19.3 点名的**关系名词化**。

## 模式

判据只有一句：**这个关联在业务里有没有自己的身份？**

有身份（有单号、有状态、有人会引用它）——建实体，这不叫名词化，
这叫 reification，而且要在被替代的那条关系上标出来：

```yaml
entities:
  - id: ent.approval_record
    view_label: 审批记录
    canonical_name: ApprovalRecord
    definition: "针对一条冲销申请的一次审批动作的记录，含审批人、结论、时间与依据的门槛规则。"
    identity_keys: [reversal_request_id, approval_seq]
    support: [{ type: evidence, alignment_id: aln.0023 }]

relationships:
  - id: rel.approval_of_request
    source: ent.approval_record
    target: ent.reversal_request
    source_role: approval
    target_role: approved_request
    direction: source_to_target
    cardinality: { source: "0..n", target: "1" }
    semantics: dependency
    definition: "一条审批记录所针对的冲销申请；一条申请可以有多次审批记录。"
    support: [{ type: evidence, alignment_id: aln.0023 }]
    reified: true

attributes:
  - id: attr.approval_record.decided_at
    owner: ent.approval_record
    datatype: datetime
    nullable: false
    support: [{ type: evidence, alignment_id: aln.0023 }]
```

没有身份，只是这次动作发生了——用事件（见 `event.md`）：
`evt.reversal_approved`，`participants: [ent.reversal_request, ent.employee]`。

手册 §6.5 帮你选：**每次冲销产生三条记录：冲销申请单、审批记录、冲销分录，
三者通过冲销申请单号关联。** 材料明说它是一条记录，那就是实体。

## 什么时候不要用

- **二元关系装得下就别 reify。** 加一个实体就是加一个要审、要维护、
  要挂依据的对象（最小模型，流程 §8.3-8）。
- **只是为了挂一两个属性** —— 关系上的 `temporality` 字段能表达有效时间，
  先试它。
- **参与方之一其实是取值不是对象** —— "金额门槛 50000"不是参与方，
  它是 policy 的 `condition`。

## 检查项

`relationship_declared`、`refs_resolve`（`owner`、端点都要解析）。
`reified` 是可选字段，写不写都不报。
**名词化没有检查能发现**——它只在人审时暴露，理由类别通常是 `semantically_wrong`。
