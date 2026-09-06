# 变更影响矩阵

来自流程 §10.2。这是 `impact` 步骤的全部内容：给定一类变更，至少要重新看哪些东西。

**它是提示，不是判断。** 流程原文写着：本表"不得替代用户对 Patch/Version 的选择"。
矩阵告诉你哪里需要被重新看，不告诉你看完之后语义上意味着什么——
后者是人的判断，而且是 `patch_or_version` 那个决策点的输入。

## 矩阵

| 变更类型 | 至少检查 | 通常受影响的阶段 |
|---|---|---|
| Rename / view label | 稳定 ID（**不能变**）、aliases、既有查询、mapping locator、文档 | candidate |
| Entity add / remove / split / merge | 定义、关系、属性、映射、相关 CQ、scope 成员、迁移材料 | alignment、candidate、cypher |
| Relationship endpoint / type / cardinality | source/target role、既有数据兼容性、Cypher、相关 CQ、跨 scope 引用 | candidate、cypher |
| Attribute datatype / nullability / classification | data binding、检查项、分类字段暴露面、迁移、聚合与读取面 | candidate、cypher |
| Evidence correction | `evidential_ir`、alignment、依赖它的对象、相关 assumption、**之前那次人工确认还算不算数** | evidential_ir、alignment、candidate、cypher |
| Process change | `process_ir`、事件与状态、映射、受影响的本体对象、相关 CQ | process_ir、alignment、candidate、cypher |
| Access Scope membership | 稳定引用、覆盖、重叠、跨 scope 引用、membership digest、**authorization-impacting diff** | 不重跑 revision；改 `releases/rel-NNNN/` |

## 逐条说清楚

### Rename / view label

改的是展示，不是身份。**`id` 不能跟着变**——`ids_stable_unique` 会拿父 revision
对一遍：canonical_name 没变的对象 id 也不能变。反过来，改了 `view_label` 而 `id` 不变，
才是正确的改名。

旧名字要进 `aliases`，不要丢。半年后有人拿旧名字来问，`aliases` 是唯一能接上的地方。

### Entity add / remove / split / merge

四种里 split 和 merge 最容易出事，因为它们同时动身份和关系：

- **split**：原对象的每条关系、每个属性、每条 support 都要判归到哪一边。
  判不了的说明拆得不对。原 id 保留给其中一边，另一边是新 id；
  在 diff 的 `removed`/`added` 里用 `replaced_by` 把两边接上。
- **merge**：被合并掉的那个进 `removed`，`replaced_by` 指向留下的那个，
  它的 `aliases` 并进去。指向它的关系端点全部改指。

remove 一定要回答 CQ：`evaluation/cq-register.yaml` 里有没有题目的
`required_entities` 提到它。有就说明这次删除会让某道题从 passed 掉到 failed，
那是 `evaluate` 的跨 revision 比较该报出来的东西。

### Relationship endpoint / type / cardinality

**"既有数据兼容性"是这一行的重点，也最容易被跳过。** 1:1 改成 1:many，
现存数据当然还合规；1:many 改成 1:1 就不一定了。这个方向性差异是
Patch 与 Version 的典型分界，但**不要替人下这个结论**，把它作为证据摆出来。

改端点等于换了一条关系。考虑是否应该是"删旧的 + 加新的"，而不是"改这一条"——
如果两端都换了，它已经不是同一条关系了，保留原 id 是在撒谎。

### Attribute datatype / nullability / classification

`classification` 的变更是 authorization-impacting 的：`revision.py diff` 会把
`classification`、`owner`、`source`、`target`、`cardinality`、`datatype` 六个字段的变化
标成 `authorization_impacting: true`。这些条目要单独拉出来给 `submit` 的
`access_scope_review` 看——分类字段暴露面变了，scope 的预览也要重看。

nullable: false → true 是放松，true → false 是收紧。收紧要问现存数据里有没有空值。

### Evidence correction

**波及最远的一类。** 一条抽取改了，`evidential_ir` 里的 fact 变，
alignment 里指向它的映射变，candidate 里挂着这条 support 的对象全部要重新看。
用 `trace` 的 `impact <source>` 把这条链拉出来，不要靠记忆。

**还要检查之前那次人工确认还算不算数。** `evidence` 阶段的
`reuse_valid_for_current_source` 就是干这个的：材料变了，之前"我确认过"的那次确认
可能已经是对另一份材料的确认了。这条最容易被忘掉，因为它不体现在任何对象上。

### Process change

`process_ir` 变了，`events[].process_ref` 和 `lifecycles[].transitions[].trigger`
这两个反向引用要跟着查（`refs_resolve` 会报悬空的，但不会报"指向了一个语义已经变了的步骤"）。

流程步骤的顺序变化经常意味着生命周期的转换条件变了，而转换条件是
`lifecycle` 类 CQ 的唯一依据。

### Access Scope membership

**这一类不产生新的 revision。** scope 声明住在 `releases/rel-NNNN/access-scopes.yaml`，
不在 revision 里。改它要重算 `membership_digest`，并且流程 §12.3-5 说得很清楚：
已发布 release 内的 scope 身份与成员是不可变的，**变化产生一个后继 release**，
以及一份 authorization-impacting semantic diff。

改成员之后 `scope_refs_resolve` 会立刻报 digest 对不上——那正是它存在的意义：
成员在批准之后变过，人批的就不是发出去的那份了。

## 影响分析怎么落进产物

`revisions/rMMMM/revision.yaml` 里记 `change_request_ids`；每条变更请求
（`history/comments.yaml`）里记 `affected_layers`、`affected_stages`、
`affected_competency_questions`、`affected_access_scopes`——字段名对齐流程附录 F，
模板见 `templates/change-request.yaml`。

这四个字段是 `impact` 步骤的产出，也是 `confirm` 步骤给人看的东西：
"你要改这一条，它会动到这些"。
