# 初始问题清单：3–10 条草稿

章程里的 `competency_questions_draft` 是草稿，不是正式登记。
正式登记、批准与执行归 `evaluate`，那里有决策点 `competency_questions`。
这里只要 3–10 条，每条有 `question`、`persona`、`decision`——三样缺一，
`charter_complete` 就不过。

写作规则的完整版在本包知识库的 `knowledge/cq-writing-rules.md`（流程 §11.2 与白皮书 §10.1、§10.5）。
下面是初稿阶段最容易踩的几条。

## 三个必填字段各自在防什么

| 字段 | 例子 | 它在防什么 |
|---|---|---|
| `question` | 某条已过账的分录现在能不能冲销 | 用业务语言问，不嵌字段名、表名或查询语句 |
| `persona` | 总账会计 | 防"系统需要知道分录状态"这种没有人在问的伪问题 |
| `decision` | 是否发起冲销申请 | 防"知道了有什么用"回答不上来的问题 |

写不出 persona 和 decision 的，通常不是业务问题，是一次字段查询。
"JournalEntry 有哪些属性"不是 CQ；"这条分录能不能冲销"才是。

## 数量为什么卡在 3–10

少于 3 条，范围没被问题约束住，什么都能塞进来。
多于 10 条，初稿阶段没有人真的逐条想过——它们会变成一张没人看的清单，
然后在评估阶段发现一半答不了也没人在意。

真的有 20 个问题，说明范围偏大，回到 `references/scale-check.md` 做一次显式选择。

## 从哪里来

按可信度排：

1. **SOW 或立项说明里写着的**。标 `origin: sow`，最可信。
2. **人在澄清时说出来的**。标 `origin: interview`。
3. **你从材料里推出来的**。标 `origin: drafted`，并在 `confirm` 那一步让人逐条确认。

系统可以提候选问题，但候选在被人认领之前不算数——流程 §11.1 写明
Ontologizer 不自行发明问题。初稿阶段的 `drafted` 是允许的，
但它必须显式标出来，不能混在 `sow` 里蒙混过关。

`evals/fixtures/journal-reversal/competency-questions/cqs.csv` 是一份写好的例子，
六条各覆盖一种能力（filter / relate / aggregate / trace / lifecycle）。

## 一题一能力

一条 CQ 只考一种能力。"2026 年 1 月有哪些分录被冲销过、原因分布如何、
分别该谁审批"是三题，拆开写。合在一起的问题在评估时无法判 Passed 还是 Failed——
答对两问算什么？

## 覆盖面自查

初稿阶段不要求覆盖全部能力，但如果 6 条问题全是 `retrieve`，
说明这份本体大概会退化成一张实体属性表。至少让"关系"和"状态变化"
各有一条问题问到——它们是后面 `behaviour_present` 那项检查在盯的东西。
