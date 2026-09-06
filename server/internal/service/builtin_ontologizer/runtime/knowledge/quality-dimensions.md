# 质量维度

流程 §16.2 给了八个维度，白皮书 §10.4 给了十个。四个重合，剩下十个各说各的——
合起来十四个。这份文档把它们并成一张表，并对每一个诚实回答：
**这个包里有什么在管它，还有什么没人管。**

两份文档在这件事上不完全一致，那不是需要抹平的问题，是有用的信号：
流程站在交付与治理的角度（可演化、可治理、可移植），
白皮书站在 AI 消费的角度（可检索、可执行、上下文效率）。
一份只满足其中一边的本体，会在另一边翻车。

## 目录

- [并表](#并表)
- [三层质量模型放在哪一层](#三层质量模型放在哪一层)
- [没人管的那六个](#没人管的那六个)
- [两份文档的分歧](#两份文档的分歧)

## 并表

来源列：**流** = 流程 §16.2，**白** = 白皮书 §10.4，**流白** = 两边都有。

| 维度 | 来源 | 它问什么 | 这个包里谁管 | 没覆盖的部分 |
|---|---|---|---|---|
| 正确性 | 流白 | 定义和规则是否符合领域专家共识？设计与已确认证据一致吗？ | `semantic_review` 决策点；四轮审阅的第四轮 | 全部靠人。没有任何检查能判断一条定义是否符合共识 |
| 完整性 | 流白 | 能否回答既定胜任问题？对 declared scope 够不够？ | `evaluate` 阶段的 CQ 结果（L3，不阻断） | CQ 覆盖矩阵没做（流程 §19.3 列为 P1）。"够不够"仍是人的判断 |
| 一致性 | 流白 | 有没有互相矛盾的类、关系、政策？命名、方向、datatype 有没有内部冲突？ | `refs_resolve`、`ids_stable_unique`、`schema_valid` 管**结构**一致 | **语义**冲突没人管。两条互相矛盾的 constraint 全部检查都过 |
| 可追溯性 | 流白 | 定义、事实、规则有没有来源、负责人和版本？ | `trace_complete`、`no_inference_as_fact`、`refs_resolve`、`trace_index_current`、`decision_logged` | 覆盖得最完整的一维。剩下的是**依据够不够强**——一条锚点存在不等于它支持这个结论 |
| 清晰性 | 白 | 名称、定义、示例和反例是否足够明确？ | `definition_present`（非空、不是名称复述） | `aliases`、`counter_examples`、`business_purpose` 全是可选字段。定义"可不可判别"没人管 |
| 可解释性 | 流 | 非本体专家能否通过四层理解对象为何存在？ | `layer_separation`、`trace` Skill 的 `why <object>`、`trace-index.yaml` 十项内在字段 | 能不能**读懂**没人管。一条完整的追溯链仍然可以由一串没人看得懂的 id 组成 |
| 可执行性 | 白 | 能力、参数、状态和政策能否被运行时验证？ | `schema_valid` 查 `capabilities` 的 `parameters`/`preconditions`/`effects` 必填；`refs_resolve` 查 `lifecycles` 的状态与触发 | 扩展模块**不产**就完全不涉及。前置条件写得对不对没人管 |
| 可检索性 | 白 | 用户真实表达能否命中相关概念和能力？ | 没有检查项 | 完全没覆盖。`aliases` 可选，别名召回没有测试。CQ 用业务语言写是唯一间接的压力 |
| 可组合性 | 白 | 能否安全复用共享模块并跨域连接？ | 没有检查项 | 完全没覆盖。`bundle.domain.imports` 字段留了，V1 不用（SPEC §12 后续增强） |
| 时态正确性 | 白 | 能否选择任务时点适用的事实和规则？ | 没有检查项 | 完全没覆盖。`temporality`、`temporal`、`time` 全是可选字段 |
| 上下文效率 | 白 | 能否产生最小充分而非冗余的上下文？ | 没有检查项 | 建模期无法度量。最小模型原则（流程 §8.3-8）靠审阅执行 |
| 可演化性 | 流 | Stable ID、semantic diff、migration 和不可变历史支不支持变化？ | `ids_stable_unique`、`revision_sealed_immutable`、`parent_unchanged`、`diff_removals_explained`、`unaffected_unchanged`、`locators_resolve_or_orphaned` | 覆盖得第二完整。migration simulation 没做（流程 §19.3 P2） |
| 可治理性 | 流 | Scope 覆盖、owners、digests、PR 预览和审计完不完整？ | `scopes_cover_or_unscoped`、`scopes_no_principals`、`scope_refs_resolve`、`patch_version_human`、`pr_matches_preview`、`package_excludes_raw`、`decision_logged` | `owners` 在 candidate 里是可选字段；`charter_complete` 只在工作区层面查三位负责人 |
| 可移植性 | 流 | Candidate contract 是否遵循受支持的 portable profile？ | `cypher_generated_and_parses`（静态检查：语句块平衡、标签合法、引用的标签在 candidate 里声明过） | 真实图库的 import / conformance 没做——`tools/cypher/adapters/` 只有契约，V1 不实现 |

## 三层质量模型放在哪一层

流程 §16.1 把质量分三层，上表里的每一维都落在其中之一：

| 层 | 谁判 | 阻断什么 | 上表哪几维 |
|---|---|---|---|
| L1 Deterministic conformance | `tools/validators` | `ready_for_review`、`submission_ready` | 可追溯性、可演化性、可治理性、可移植性，以及一致性的结构部分 |
| L2 Human semantic review | `review` / `revise` 的处置与决策点 | 通过 revision 决策体现，无独立批准门 | 正确性、清晰性、可解释性，以及一致性的语义部分 |
| L3 Competency evaluation | `evaluate` | **永不阻断** | 完整性、可检索性的一部分 |

三层的比例说明了一件事：**L1 覆盖的四维，恰好是治理关心的四维；
业务关心的那几维（正确性、完整性、可检索性）几乎全在 L2 和 L3。**
所以全绿的检查报告不是"本体是好的"，是"本体没有明显坏"。
向用户报告时按这个分寸说话。

## 没人管的那六个

上表里"完全没覆盖"的六项，值得单独列出来，因为它们容易被一份绿色的检查报告掩盖：

1. **语义一致性** —— 两条互相矛盾的 constraint / policy。冲销域里就有现成的一对
   （手册 §6.3 与政策 v4 §3.2）。evidence 阶段的 `conflicts_not_merged`
   要求它们各留一条、标 disputed；到了 candidate 层，**没有检查确认这个分歧
   还在**。审阅时要专门找一遍。
2. **可检索性** —— 别名覆盖、多语言、口语表达命中。`aliases` 是可选字段。
   术语表里"红冲""反过账""预关账"这些说法如果没进 `aliases`，
   系统上线后用户第一句话就问不出东西。
3. **可组合性** —— 跨域连接与共享上层概念。V1 单域，`imports` 空着。
4. **时态正确性** —— 白皮书 §4.6 的六种时间（事件、记录、有效、处理、版本、
   适用）在 schema 里都有位置，但全是可选字段。政策 v4 有生效日期
   2025-04-01，手册第 6 章没有版本时间——这个差别没有任何机制会提醒你。
5. **上下文效率** —— 建模期没法度量，只能靠最小模型原则。
6. **可执行性的语义部分** —— `preconditions` 写了就过，写错了也过。

对这六项，唯一现实的做法是在生成报告和审阅提示里点名，
让人知道机器在这几处帮不上忙。**假装有依据比没有依据危险**
（`shared/conventions.md` §5）。

## 两份文档的分歧

三处，都值得知道：

**1 · 清晰性 vs 可解释性。** 白皮书的"清晰性"问的是名称、定义、示例、反例
是否明确（对象自己说得清不清楚）；流程的"可解释性"问的是非专家能否通过四层和
inspector 理解**它为什么存在**（追溯链读不读得通）。两者常被混为一谈，
但覆盖它们的东西完全不同：前者是 `definition_present` + 一堆可选字段，
后者是 `layer_separation` + `trace-index.yaml`。本表分开列。

**2 · 完整性的口径。** 白皮书说"能否回答既定胜任问题"，流程加了一句限定：
"对 declared scope 和关键 CQs 足够，**不追求领域无限完备**"。
流程的说法更可执行——完整性是相对声明范围的，不是绝对的。
本包按流程的口径：`initiate` 阶段声明范围，`evaluate` 阶段只对那些 CQ 负责。

**3 · 流程没有可检索性和时态正确性。** 流程的八维里没有这两条，
因为流程写的是构建过程的质量，不是消费端的质量。
但白皮书 §11.4 和 §11.7 又把它们当作反模式的核心。
本包的立场是两边都收进来，并诚实标注它们目前没有覆盖——
这正是"两份文档不一致，就把不一致本身报出来"该有的样子。
