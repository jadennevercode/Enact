# 十二个字段

每个对象在 `revisions/rNNNN/trace-index.yaml` 里有一条记录。
字段表来自流程 §14.2，实现在 `tools/trace/index.py`。
一条真实记录的样子见 `templates/trace-record.yaml`。

| 字段 | 内容 | 它回答什么 / 空着意味着什么 |
|---|---|---|
| `object_id` | 稳定技术标识，如 `ent.journal_entry` | 跨版本认这个 id，不认显示名。显示名可以改，身份不能 |
| `object_kind` | entity / relationship / attribute / event / lifecycle / constraint / policy / capability / binding / metric / `orphaned_locator` | 值是 `orphaned_locator` 的那条不是对象，是一条断了的引用 |
| `object_revision` | 这条表示所在的版本 | 追溯回答永远要带版本号。不带版本的"它是这样的"没有意义 |
| `source_ids` | 支撑它的来源 id（证据来源，或假设的 id） | **空的意味着这个对象没有依据**，是 `unsupported` 查的就是它 |
| `source_digests` | 那些来源快照的摘要 | 摘要变了说明底稿换了版本，之前基于它的结论要重看 |
| `anchors` | 页/区域/行/单元格/图区定位符与原始短语 | 空着说明只有来源没有出处；人没法翻回去核对 |
| `support_types` | evidence / assumption / guidance / constraint / process_reference | 只有 `assumption` 的对象是靠推断撑着的，要单独讲清楚 |
| `alignment_ids` | 连接来源与目标的映射记录 id | 顺着它能从对象走回证据条目，`why` 的链路就靠它 |
| `confidence_or_uncertainty` | 抽取与映射的不确定性 | 低置信度的映射在审阅时要优先看 |
| `validator_results` | 点到这个对象名字的检查结果 | 空着不代表全绿，只代表没有检查点到它的名字 |
| `change_history` | created / added / changed / unchanged，以及相对哪个上一版 | `history` 模式把各版本的这一栏串起来 |
| `evaluation_links` | 依赖这个对象的 Competency Question | 有链接的对象改动会影响评估结果，要在修订影响分析里说明 |
| `scope_membership` | Access Scope 成员身份与发布 | 改这类对象会改变治理边界，是 Patch/Version 判断的依据之一 |
| `orphaned` | 这条是一个已经解析不到对象的定位符 | `true` 的记录不是对象，是上一版的意见指向了一个不存在的东西 |

（表里是十四行：`source_ids` 与 `source_digests`、`anchors` 与它的原始短语，
在流程 §14.2 里各算一项，落到文件里拆成了两栏。）

## 存进去的和现算的不一样

`tools/trace/index.py` 的 `write()` 只把**这一版自己决定得了**的字段存进封存的索引里。
两个字段不存：

- `scope_membership` —— 归属于后来的某个发布，那时这一版已经封存，改不动了。
- `orphaned` —— 归属于工作区的意见日志，随时会变。

要看这两栏，得让脚本现算一次（`derived=True`，见 `references/queries.md`）。
这个设计不是偷懒：如果把它们存进封存的索引，一个发布分配了 scope，
所有旧版本的索引就同时"过期"了，而它们又不许改——那道检查就会因为做对了事而失败。

## 三条不变量

**1 · 定位符要么解析，要么明确 orphaned。** 上一版的意见指向一个这一版里不存在的对象时，
索引里出现一条 `orphaned: true` 的记录，说明它来自哪条变更请求。
静默断链比 orphaned 更糟——没人会去找一条不知道断了的链。

**2 · 每一版记录版本基线。** 引擎与技能包版本、模型、输入摘要、产物摘要，
都在那一版的 `revision.yaml` 里，回答"这个结论是在什么条件下得出的"。

**3 · 删除对象不删除历史追溯。** 语义差异里每个被删的对象要说明被什么替代、
或者为什么不再需要。删掉的对象在旧版本的索引里仍然完整存在。
