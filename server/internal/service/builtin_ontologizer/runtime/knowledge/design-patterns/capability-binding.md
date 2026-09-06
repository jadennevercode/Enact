# 模式 · Capability + Binding

## 问题

"发起冲销"这件事，业务含义在集团内是一样的，但本部走 ERP、
华东两厂走各自的前置系统。你要让本体表达同一个能力，
同时说清它在哪些系统里怎么执行。

## 错误的建模

**错法一：按接口命名能力**——`cap.post_v2_gl_reversal`，
`intent: "调用 ERP 的 /v2/gl/reversal 接口"`。接口改版能力就得改名，语义跟着
实现漂。白皮书 §10.3：**能力应按业务意图命名，而不是按接口路径命名。**

**错法二：一个系统建一个能力**——`cap.create_reversal_erp` 和
`cap.create_reversal_east_plant`。同一个业务意图被拆成两个对象，政策要写两遍，
`cq.002`（该由谁审批）也得问两次。这是重复概念反模式。

## 模式

**Capability 说 what can be done，Binding 说 how and where。**
一个能力，多条绑定。

```yaml
capabilities:
  - id: cap.create_reversal_entry
    intent: "为一条已过账分录发起并生成冲销分录"
    parameters:
      - { name: journal_id, datatype: string, required: true }
      - { name: reason_code, datatype: enum, required: true }
    preconditions:
      - "原分录 status == posted"
      - "原分录尚未被冲销"
      - "所属期间状态不是 hard_close"
    effects:
      - "生成一条 ent.reversal_entry 并建立 rel.reverses"
      - "原分录状态转为 reversed"
    support: [{ type: evidence, alignment_id: aln.0024 }]
    target_entity: ent.journal_entry

bindings:
  - id: bind.create_reversal_erp
    binding_kind: action
    target: cap.create_reversal_entry
    source_system: "集团 ERP
    GL 冲销事务"
    support: [{ type: evidence, alignment_id: aln.0025 }]
    refresh: realtime
  - id: bind.journal_entry_data
    binding_kind: data
    target: ent.journal_entry
    source_system: "集团 ERP
    GL_JE_HEADER"
    support: [{ type: evidence, alignment_id: aln.0026 }]
    refresh: daily
```

`preconditions` 和 `effects` 是能力契约里最有价值的两栏：
它们让 Agent 在调用之前就知道什么条件下不能调、调完世界会变成什么样。
手册 §6.2-2 的"一条分录只能被冲销一次"和 §6.3 的期间限制，
在这里各变成一条前置条件。

**六种 binding_kind**：`data`、`metric`、`knowledge`、`action`、`identity`、
`evidence`。`target` 可以是能力，也可以是实体或指标——`refs_resolve` 只要求
它指向一个存在的声明。

## 什么时候不要用

- **扩展模块按范围产出。** `capabilities` 和 `bindings` 都是扩展模块。
  V1 只做核心六个集合时，把能力线索留在证据层，不要硬产。
- **没有执行系统就不要建 binding。** 一条 `source_system: "待定"` 的绑定
  比没有绑定更糟——它看起来像是已经落地了。
- **不要把 SQL 和连接串写进 statement 或 intent。** 那属于数据服务
  （白皮书 §12），本体保留引用。

## 检查项

`schema_valid`（capabilities 要 `intent` `parameters` `preconditions` `effects`；
bindings 要 `binding_kind` `target` `source_system`）、
`refs_resolve`（`target_entity` 与 `target` 都要解析）。

`preconditions` 写得对不对、`source_system` 是否真实存在，
**没有检查能发现**。刷新时间和映射版本是可选字段——
不写，"这个数新不新"就只能靠猜。
