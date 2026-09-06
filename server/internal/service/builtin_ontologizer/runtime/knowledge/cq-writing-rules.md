# 胜任问题的写法

流程 §11.2 的编写规则，加上白皮书 §10.1（从胜任问题开始）和 §10.5（用 Agent
任务评测本体）。

胜任问题（Competency Question, CQ）决定需要哪些概念、关系、时间语义、规则和绑定，
也是后续评测的基础。**不要从"把所有表都导入"开始**——从人要拿这个本体
做什么决定开始。

## 目录

- [五条编写规则](#五条编写规则)
- [六类能力](#六类能力)
- [必填字段](#必填字段)
- [六道 CQ：好版本与坏版本](#六道-cq好版本与坏版本)
- [三种状态](#三种状态)
- [谁拥有这些问题](#谁拥有这些问题)

## 五条编写规则

1. **用业务语言写，不嵌入 schema 名称或 Cypher。** 问"某条已过账的分录现在能不能
   冲销"，不问"`ent.journal_entry` 的 `status` 为 posted 时 `lc.journal_entry`
   是否存在到 reversed 的转换"。后者预设了答案的形状，评测就退化成检查你有没有
   照着自己写的模型建模。
2. **每题明确 persona / decision、时间范围、过滤条件、预期粒度和成功证据。**
3. **覆盖 retrieve、relate、filter、aggregate、trace、lifecycle 六类能力中适用的部分。**
4. **一个问题只验证一个主要能力。** 复杂问题拆成可诊断的子问题——
   一道同时考四种能力的题失败了，你不知道该改哪儿。
5. **`Unsupported` 表示当前本体/图契约无法表达或回答，不等于系统故障。**

## 六类能力

| 能力 | 问的是 | 冲销域里的样子 |
|---|---|---|
| retrieve | 按标识或条件把对象取出来 | 这条分录的制单人是谁 |
| relate | 沿关系走到另一个对象 | 这条冲销分录对应的原始分录是哪一条 |
| filter | 按属性或状态筛出子集 | 哪些分录现在还能被冲销 |
| aggregate | 按维度汇总计数或求和 | 1 月被冲销的分录按原因代码怎么分布 |
| trace | 还原一条链路或责任线 | 这条分录从制单到冲销经历了谁的哪些动作 |
| lifecycle | 判断状态、转换与前置条件 | 软关账期间提交的冲销申请按哪条规则处理 |

一道题落在哪一类，决定了它失败时该改本体的哪一部分：
retrieve/filter 失败通常缺属性，relate 失败通常缺关系或方向反了，
aggregate 失败通常缺指标或维度，trace 失败通常缺事件，
lifecycle 失败通常缺生命周期或 guard。

## 必填字段

按流程附录 E，一条 CQ 登记长这样：

```yaml
cq_id: cq.001
问题: 某条已过账的分录现在能不能冲销
business_persona: 总账会计
decision_supported: 是否发起冲销申请
scope_and_time_window: 2025 财年至今；集团本部与华东两厂
required_filters: [分录状态 = posted, 尚未被冲销, 所属期间状态]
expected_granularity: 单条分录
expected_answer_shape: 是/否 + 不能的理由 + 若能则需要谁审批
required_entities: [ent.journal_entry, ent.accounting_period]
required_relationships: [rel.belongs_to_period]
required_attributes: [attr.journal_entry.status]
test_type: rule_check
target_revision: r0002
status: passed
execution_evidence: evaluation/runs/run-0007/cq.001.json
failure_or_unsupported_rationale: null
owner: FSSC总账主管
```

七件事缺一不可：**persona、decision、时间窗、过滤条件、粒度、
预期答案形状、成功证据**。缺任何一件，这道题都没法判定通过——
"预期答案形状"缺了，就只能凭感觉说结果对不对；"成功证据"缺了，
下一个 revision 没法比较。

## 六道 CQ：好版本与坏版本

六道题取自 `evals/fixtures/journal-reversal/competency-questions/cqs.csv`。
每道给出坏版本和它坏在哪。

### cq.001 · filter

> **好**：某条已过账的分录现在能不能冲销？
> persona 总账会计 · decision 是否发起冲销申请 · 粒度 单条分录 ·
> 答案形状 是/否 + 理由 + 需要谁审批

> **坏**：查一下分录状态。

坏在三处：没有 persona 和 decision，所以不知道答对了有什么用；
没有粒度和答案形状，所以返回一列 status 也算答了；
而且它其实是 retrieve，不是 filter——把能力类别写错，
失败时的诊断方向就错了。

### cq.002 · relate

> **好**：这条分录的冲销该由谁审批？
> persona 总账主管 · decision 把审批任务派给谁 · 过滤条件 金额（本位币）门槛、
> 职责分离 · 答案形状 一个角色名 + 依据的那条规则

> **坏**：`ent.employee` 通过 `rel.approved_by` 连到 `ent.journal_entry` 时，
> `amount >= 50000` 的分支返回什么角色？

坏在用 schema 名字提问。这道题问的其实是"我的模型里有没有我刚写的那条关系"——
它一定通过，而且什么都没验证。**用业务语言写**，让模型有可能答错。

### cq.003 · relate

> **好**：某条冲销分录对应的原始分录是哪一条？
> persona 财务复核 · decision 核对冲销是否成对 · 答案形状 一个分录号 +
> 冲销时间 + 冲销原因

> **坏**：冲销分录和原始分录是什么关系，以及这条关系是谁在什么时候批的、
> 当时期间是什么状态、这类冲销在 1 月一共有多少条？

坏在一题四能力（relate + trace + lifecycle + aggregate）。
流程 §11.2 说得明白：**复杂问题拆为可诊断子问题**。
这一题失败时，你面对四个可能的缺口，一个都定位不了。

### cq.004 · aggregate

> **好**：2026 年 1 月有哪些分录被冲销过，原因分布如何？
> persona 财务运营总监 · decision 判断错误集中在哪类科目 ·
> 时间窗 2026-01（按会计期间，不是按过账日期）· 粒度 原因代码 ·
> 答案形状 原因代码 × 条数的表，含合计

> **坏**：统计一下冲销情况。

坏在没有时间窗、没有粒度、没有答案形状。而且"2026 年 1 月"这个词在这个域里
有歧义——CSV 里 `JE-2026-0110` 的 `posting_date` 是 2026-02-09 而 `period` 是
2026-01。好版本必须说清按哪个口径。**时间窗写不清的 CQ，
通过与否取决于谁来跑它。**

### cq.005 · trace

> **好**：一条分录从制单到冲销经历了哪些状态和谁的动作？
> persona 内审 · decision 追溯责任 · 粒度 一条分录的全部事件 ·
> 答案形状 按时间排序的（时间、动作、执行人、前状态、后状态）序列 ·
> 成功证据 序列覆盖制单、过账、发起冲销、审批、生成冲销分录、冲销过账六步

> **坏**：这条分录的历史是什么？

坏在"历史"没有定义。返回一个 `last_modified` 时间戳也是历史。
好版本把成功证据写死成六个步骤——**这是能不能判定通过的关键**，
没有它，`status: passed` 只是一句主观意见。

### cq.006 · lifecycle

> **好**：软关账期间提交的冲销申请按哪条规则处理？
> persona 月结流程 owner · decision 决定是否放行 · 过滤条件 期间状态 =
> soft_close · 答案形状 适用规则 + 出处 + **该规则是否存在争议**

> **坏**：软关账期间能不能冲销？

坏在预设了单一答案。这个域里的真实情况是：手册 §6.3 说经财务控制批准可以，
政策 v4 §3.2 说一律不可以，政策部说自己优先，共享中心按手册执行，
分歧尚未正式裁决。一道只接受"能/不能"的题会逼着模型挑一边，
把整个项目最有价值的发现抹掉。**好版本的答案形状里必须留一格给争议。**

## 三种状态

| 状态 | 含义 |
|---|---|
| `passed` | 所需对象、关系、属性和路径存在；测试在绑定的 revision 上产生**符合预期形状与语义**的结果，并保存了执行证据 |
| `failed` | 本体意图上应该支持这个问题，但校验/查询/结果检查没满足，需要 defect 或 revision |
| `unsupported` | 当前范围或模型契约不承诺这个能力，或缺必要的概念、关系、数据绑定，需要一个范围决策 |

三条硬规则：

**1 · "查询返回了数据"不等于 passed。** 流程 §11.1 把这条写进系统职责：
系统**不得把"查询返回数据"简单等同于"语义正确"**。
`cq.004` 返回一张空表也是"返回了数据"；返回按 `posting_date` 而不是按
`period` 分组的表，同样是"返回了数据"。判定 passed 要对照
`expected_answer_shape` 和成功证据。

**2 · failed 和 unsupported 各要一条 rationale，passed 要有 execution_evidence。**
`cq_result_bound` 检查这件事，同时要求每条结果绑定一个存在的 revision id。
不绑 revision 的结果没有意义——本体一变，结论就作废了。

**3 · unsupported 不是故障。** 它是一个范围信号：这个问题当前的模型契约
不承诺回答。把它记成 failed 会让人去改模型，
而正确的动作可能是改范围，或者接受它。

白皮书 §10.5 补了一条诊断纪律：一次评测失败**既可能是模型问题，
也可能暴露本体词汇、关系、绑定或情境覆盖不足**，两者要分别诊断。
在本包里这体现为：failed 走 revision，unsupported 走范围决策。

## 谁拥有这些问题

**系统不自行发明问题。** 流程 §11.1 把这条列为质量门，`cq_human_owned` 检查它：
每条 CQ 的 `owner` 非空，`origin` 属于 `human` 或 `ai_proposed_human_approved`；
`origin` 为 `ai_proposed` 而未被批准的，不得进入评估运行。

系统可以提候选——流程 §19.3 把"自动提出 CQ 候选"列为 P2 增强，
并特意加了限定："**但必须由人批准后才进入正式 evaluation**"。
提候选和定问题是两件事。

批准这件事本身是一个决策点：`competency_questions`，由 DE / PO 裁决
（`approve` / `rework`），记进 `history/decisions.log`。
呈现时按四段走：在定什么、依据、还没定的、选项与后果
（`shared/decision-points.md`）。

最后一条纪律：**评测永不阻断提交**（流程 §11.1 质量门、§16.1 的 L3）。
CQ 结果是给人看的证据，不是门。把它做成门，人就会开始写容易通过的问题。
