# 四轮审阅清单

来自流程 §9.2。四轮不是四个视角，是四道各自独立的关口，顺序固定：
Evidence → Process → Mapping → Ontology。

顺序的理由在 `shared/four-layers.md`：反过来审，人会先接受一个漂亮的模型，
再回头替它找依据；那时 evidence 轮问的就不是"这条从哪来"，而是"这条能不能算数"。

每轮走完在 `reviews/review-rNNNN.yaml` 的 `passes.<轮次>.status` 写 `done`。
四轮都 `done` 之前，`review_binary` 不通过——这是"跳过一轮"唯一会被发现的地方。

## 1 · Evidence 轮

读 `revisions/rNNNN/evidential_ir.yaml`，逐条对照 `define/evidence-snapshots/`。

| 看什么 | 具体问题 | 不对的时候 |
|---|---|---|
| 出处 | 每条 fact 的 `source_id` 指向哪个快照？那个快照还在吗 | comment，或 reject（`unsupported`） |
| 版本 | `source_digest` 与快照 manifest 里的一致吗；材料换过版本吗 | comment，回 `evidence` 重新登记 |
| Anchor | `anchor.location` 能不能真的定位到（页/段/行/单元格/图区） | comment |
| 原文 | `exact_snippet` 是原始短语，还是已经被改写过 | comment；改写过的要还原 |
| 抽取准确性 | 这句话在原文里是不是这个意思；有没有丢掉限定条件 | direct_edit（记录改法）或 comment |
| 不确定性 | `confidence` 与材料的实际清晰度相称吗 | comment |
| 冲突 | 冲突的两条是不是各自留着、标了 disputed、没有被合并 | comment；合并过的必须拆回来 |

**定位不到的 claim 标 unsupported。** 处置写 `reject` + `reject_reason: unsupported`，
或者写 `comment` 要求补依据——区别是：这个对象没有依据就不该存在（reject），
还是它应该存在只是依据没记上（comment）。

例：`ent.close_period` 的 support 挂的是 `asm.001` 而不是证据。这不是错误，
但要在这一轮确认："关账期间是个假设"这件事，领域专家知道且认可。

## 2 · Process 轮

读 `revisions/rNNNN/process_ir.yaml`。这一轮的主审是流程负责人（PO）。

| 看什么 | 具体问题 |
|---|---|
| 顺序 | 步骤的先后是真实顺序，还是文档的排版顺序 |
| Actor | 每步谁做；写的是岗位还是系统；同一岗位在不同步骤名字一致吗 |
| Record | 每步产生什么记录；记录之间靠什么关联 |
| Event | 哪些时刻需要被记住（发生时间、参与者、前后状态） |
| Decision | 判断点的条件写全了吗；阈值有没有出处 |
| Handoff | 交接在哪里发生；交接双方是不是都在 actor 清单里 |
| Exception | 异常路径有没有终点；被拒绝之后走到哪里 |
| Lifecycle | 状态有哪些；转换的触发和守卫条件是什么 |

**断掉的连线是这一轮最常见的发现。** 冲销流程图里"审批不通过"那条线在图上没有终点，
`proc.step.approve` 之后就没有下文了——这不是画图的人偷懒，是这个分支的业务规则
从来没有被写下来。把它记成 comment，让人回答；不要在这一轮自己补一个合理的猜测。

孤立节点同理：图右下角那个没有任何连线的"复核"方框，要么是漏画的步骤，要么是
另一个流程的残留。两种可能的处置完全不同，所以必须问。

## 3 · Mapping 轮

读 `revisions/rNNNN/alignment.yaml`，配合 `trace-index.yaml`。

| 看什么 | 具体问题 |
|---|---|
| 有没有 support | candidate 里每个对象至少一条 support，且能落到带 anchor 的证据或显式 assumption |
| one-to-many | 一条证据支撑了多个对象——是合理的复用，还是一条材料被过度解读 |
| many-to-one | 多条证据指向同一个对象——它们说的真是同一件事吗，还是两个概念被合并了 |
| unmapped | 证据里有、模型里没有的东西——是有意不建，还是漏了 |
| contradictory | 两条 support 互相矛盾却都挂在同一个对象上 |
| confidence | `confidence: medium/low` 的映射，人认不认 |

`trace_complete` 已经机器判过"有没有 support"。这一轮判的是**这条 support 成不成立**——
指向一条真实存在的证据，和这条证据真的支撑这个设计，是两件事。

`unmapped` 要专门看一遍：机器不会报"证据里有而模型里没有"，因为它不知道少了什么。
这是四轮里唯一只有人能做的检查。

## 4 · Ontology 轮

读 `revisions/rNNNN/candidate.yaml`。主审是本体工程师（OE）与领域专家（DE）。

| 看什么 | 具体问题 |
|---|---|
| Identity | 这个对象的身份靠什么确定；两条记录里的它还是同一个吗 |
| Definition | 定义能不能判别；说了"什么不属于"吗；是不是同义反复 |
| Granularity | 类型还是实例、主数据还是交易、实体还是事件、对象还是状态——四条界线各自站对了吗 |
| 方向与基数 | 方向是业务方向吗；基数是真实约束还是当前数据的样子 |
| Datatype | 单位、格式、可空、多值、枚举来源写清楚了吗 |
| 约束 | axiom / constraint / rule 三分是否恰当；开放世界下"缺失 ≠ 为假"考虑了吗 |
| 重复概念 | 两个 ID 说的是不是同一件事；别名是不是被建成了独立实体 |
| 范围相关性 | 它支撑哪条 CQ、哪个决策；答不上来就是该问的问题 |

`definition_present` 只能判"非空且不以自身名称开头"。**同义反复是人判的**：
"冲销分录是用来冲销的分录"通过了机器检查，但它没有告诉任何人任何事。

常见的语义毛病——只建名词、关系名词化、粒度混杂、属性承载稳定关系——
逐条对照 `knowledge/anti-patterns.md`。

## 走完之后

`close-out` 汇总三样东西：

1. 所有 `comment` 变成 `history/comments.yaml` 里的变更请求（模板见
   `skills/revise/templates/change-request.yaml`）；
2. 上一版的 comment 指向本版已不存在的对象时，列进 orphaned 报告；
3. 标为 unsupported 的 claim 单独成表，交给 `evidence` 或 `revise`。

然后开 `semantic_review` 决策点。
