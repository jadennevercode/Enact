# 边界

白皮书 §12：什么应该留在 Ontology 之外。

边界不是洁癖。清晰的边界让本体成为一份**共享契约**，
而不是又一个试图拥有所有内容的数据库。一个吞下 SQL、prompt、会话状态和
审批队列的本体，最后会因为没人能同时懂这几样东西而没人维护。

## 什么在里面，什么在外面

| 内容 | 是否属于 Ontology | 推荐归属 |
|---|---|---|
| 业务实体、关系、指标含义 | 是 | Ontology |
| 能力语义、政策、状态和动作声明 | 是 | Ontology |
| 物理表、文档、工具和动作的**引用** | 是，以 Binding 形式 | Ontology |
| 详细业务数据行 | 否 | Data Foundation / 源系统 |
| 文档正文和向量 | 否 | Knowledge Foundation |
| SQL、模型代码和连接器实现 | 通常否 | 数据服务、工具或行动系统 |
| Agent 会话、短期记忆和运行计划 | 否 | Agent Runtime |
| Prompt、模型选择和推理循环 | 否 | Agent Engineering |
| 审批任务、重试队列和补偿执行 | 否，但引用本体政策 | System of Actions |
| 执行日志全文 | 否，但保留证据引用 | Audit / Evidence Store |

三行"否，但……"是这张表里最容易误读的。**引用在里面，内容在外面。**

- 一条 `bindings` 记录说"`ent.journal_entry` 的事实来自 ERP 的 `GL_JE_HEADER`，
  日更"——这在里面。那张表的四万行数据在外面。
- 一条 `policies` 记录说"金额 ≥ 50000 时财务控制必须审批"——这在里面。
  ERP 里那个待办审批任务、它的超时重试、它的补偿逻辑，在外面。
- 一条 Evidence Binding 说"这个判断的执行证据存在审计日志里，
  引用 `run-0992`"——这在里面。日志全文在外面。

## 三条判据

拿不准的时候按这个顺序问：

1. **它会随实现变，还是随业务变？** 表名、接口路径、模型版本随实现变，
   放 Binding 或外部。"冲销分录借贷方向与原分录相反"随业务变，放本体。
2. **它是一个类型级的声明，还是一条实例级的记录？** "分录有 draft/posted/reversed
   三种状态"是类型级的；`JE-2026-0091` 现在是 reversed，是实例级的。
   本体只收类型级的。
3. **把它删掉，本体还能不能回答胜任问题？** 能，就说明它是实现细节。

## 这个包刻意不做的四件事

SPEC §1 的非目标里，有四件事和上面这张表直接对应。
它们不是"以后再做"，是**结构上不属于这里**。

### 不做运行时

本包不复刻 SaaS 运行面：多租户、SSO、sandbox、queue fairness、
per-user ACL、runtime allow/deny、production activation。

**保留的是语义等价物**：不可变的 `revisions/rNNNN/` 目录、内容 digest、
可归因的 `history/runs.jsonl`。你在本地得到的是同一套审计性质，
少了一个需要运维的服务。

一个具体后果：`submit` 阶段产出的 Access Scope 声明**只定义受治理的资源边界**，
不授权。`scopes_no_principals` 会拒绝任何出现 `users`、`groups`、`roles`、
`entitlements`、`assignments`、`grants`、`principals` 的 scope 文件。
principal assignment 和运行时放行属于外部 Platform / IAM——
流程 §3 把这条写成构建原则：**Access scope is not authorization。**

### 不做数据行

`CANDIDATE_FIELDS` 里没有 `instances` 集合。实例数据的位置是：
在实体上声明 `identity_keys`（拿什么认这个对象），
在 `bindings[].source_system` 里指出去哪里取。

`inputs/evidence/` 下的样本数据是**证据**，进 `evidential_ir.yaml` 的 facts、
带锚点，用来支撑"status 有三个取值"这类事实。它们不进 candidate。
`package_excludes_raw` 在提交时把 raw evidence、samples、transcripts、
detailed logs 一并挡在 submission package 外面。

### 不做 prompt

SPEC 的非目标写得直白：**不定义 Ontologize Engine 的真实 prompt/schema**——
那属于固定的 Engine release。本包用流程 §8 的 portable candidate schema，
并把"和真实 Engine 对齐"列为已知风险。

同样地，本包不产出 context package。白皮书 §8.2 的分工是：
**Ontology 是上下文生成器，不是上下文本身。** 装配 context package
是 Context Service 在运行时干的活，它需要知道 principal、situation、
token 预算——这三样在建模时都不存在。

### 不做 agent 会话状态

Runtime plan（Agent 针对一次具体任务生成的执行计划）按白皮书 §4.11
明确"通常不属于本体定义本身"。本包连一个存放它的字段都没有。

本包自己的会话状态也不落盘：**没有进度文件**，
`state.py status` 每次对着磁盘重算阶段。记下来的状态会和产物分叉，
推导出来的不会（`shared/conventions.md` §2）。

## 边界被越过的时候长什么样

三种，按发现难度从易到难：

**1 · 层与层之间混入。** `process_ir` 或 `evidential_ir` 里出现目标设计键——
顶层和条目内都算，`layer_separation` 会报。完整清单：
`entities`、`relationships`、`attributes`、`constraints`、`policies`、
`capabilities`、`bindings`、`metrics`、`bundle`、`declarations`、`domain`。
最常见的形态是一条 step 里挂一个 `entities:` 列表：
读流程读着读着就顺手把设计写下来了。

> **`events` 和 `lifecycles` 不在这份清单里。** 流程 §5.3 把事件和生命周期
> 算作 Process 层自己的内容，`refs_resolve` 也会去读 `process_ir` 的 `events`
> 收集可解析的 id。所以 `process_ir` 顶层写 `events:` 是本分，不是越界。
> 两层的事件靠形状区分：流程事件说的是谁在哪一步做了什么，
> 本体事件带 `definition` 和 `support`，并用 `process_ref` 指回流程那一侧。

**2 · 实现细节混进声明。** constraint 的 `statement` 里是 SQL，
capability 的 `intent` 是接口路径，binding 里塞了连接串。
**没有检查项管这一条**，只有人审能发现。判据是上面的第一条判据：
它随实现变还是随业务变。

**3 · 数据快照冻进模型。** 把 CSV 的六行抄进 candidate 当实例。
检查全绿，因为方向不对——`layer_separation` 只查 candidate 键
出现在另外两层，不查另外两层的内容出现在 candidate。
这一条同样只有人审能发现，判据是第二条：类型级还是实例级。

## 一句话

**本体声明稳定业务语义和规则，不吞并 UI、运行时调度、连接池、
模型 prompt、详细 SQL、会话状态和基础设施实现**（白皮书 §11.3）。
每次想往里加东西的时候，先问它属于上面哪一行。
