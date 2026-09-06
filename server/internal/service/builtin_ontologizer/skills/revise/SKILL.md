---
name: revise
description: 把审阅产生的 comment、direct_edit、已解决的 assumption 和新证据落进一个**新的**不可变 revision：先归一化变更请求，再按变更类型做影响检查（改名、实体增删拆合、关系端点/类型/基数、属性 datatype/nullability/classification、证据纠正、流程变更、scope 成员变动），只重跑受影响的那几个阶段，生成 semantic diff 交人逐条审，父 revision 一个字节都不动；退出条件全部满足之后由人选定 candidate release。用于"把审阅意见落进去""按 chg.001 出一版""这个改动会影响什么""改一下这条关系的基数""出一份 diff 我看看""这版和上一版差在哪""r0003 定为候选发布"这类请求。自动影响分析只是提示，不替代人的语义判断，也绝不替代 Patch/Version 的选择；它产出新版本和 diff，不做审阅、不评估问题、不打包提交。
---

# Revise · 修订

交付物是两样：一个**新的** `revisions/r<MMMM>/`，和它里面的 `semantic-diff.yaml`。
父 revision 不动——不是"尽量不动"，是一个字节都不动（`parent_unchanged`）。

## 步骤

| # | 步骤 | 谁 | 做什么 |
|---|---|---|---|
| 1 | `normalize` | C | 把审阅记录里的 comment / direct_edit 归一成变更请求，写进 `history/comments.yaml` |
| 2 | `impact` | S | 按变更类型查 `references/impact-matrix.md`，算出受影响对象与受影响阶段 |
| 3 | `regenerate` | C+S | `revision.py new` 开新目录，只重跑受影响阶段，其余逐字复制 |
| 4 | `diff` | S | `revision.py diff <ws> <parent> <new>`，然后逐条补 removed 的交代 |
| 5 | `confirm` | H | 人逐条审 diff。改了什么、为什么改、还剩什么没关 |
| 6 | `select` | H | 决策点 `candidate_selection`——**只有五条退出条件都满足才提供这一步** |

```bash
python3 <pkg>/scripts/revision.py new <ws> --reason "落地 r0002 审阅意见" --change chg.001 --change chg.003
python3 <pkg>/scripts/revision.py diff <ws> r0002 r0003
python3 <pkg>/scripts/revision.py seal <ws> r0003     # 自己跑门，按结果写 status
python3 <pkg>/scripts/state.py decide <ws> --point candidate_selection --verdict select --role OO --object r0003 --rationale "..."
```

`seal` 自己跑 `ready_for_review` 门并按结果写 status——**不是由跑生成的那一方宣布成功**。
门没过就是 `gate_failed`，产物留着可诊断，但不会成为 HEAD。

## 四条不能让步的

**父 revision 一个字节都不动**（`parent_unchanged`）。修订是向前写，不是回改。
要"退回"某一版，用 `revision.py restore`——它把那一版复制成新的 rNNNN 并重新过门，
源版本原封不动。历史被覆盖之后，任何追溯都不再可信，而这件事没有任何脚本能事后恢复。

**声明为未受影响的对象必须逐字相同**（`unaffected_unchanged`）。
这条不是为了省算力。**diff 是 Patch/Version 那个决定的全部依据**——
顺手改一句定义、顺手统一一下命名，diff 就从 3 条变成 40 条；人第一次会认真看，
第二次开始翻页，第三次就不看了。一份没人读的 diff，等于没有 diff，
而那个决定的后果（下游消费者要不要改）只有人知道。

**每个删除都要有交代**（`diff_removals_explained`）：`replaced_by` 或 `removal_rationale`，
二选一，不能都空。`revision.py diff` 生成的 `removed` 条目这两个字段都是 `null`，
必须手工填——它故意留空，因为只有人知道这个对象是被替代了还是不再需要。
审阅时 reject 的理由类别（`skills/review/references/dispositions.md`）
通常就是现成的 `removal_rationale`。

**解析不到的定位符要标 orphaned，不能悄悄丢**（`locators_resolve_or_orphaned`）。
上一版的 comment 指向本版已经不存在的对象时，那条变更请求自己要带 `orphaned: true`——
标在 `history/comments.yaml` 里，不是标在 `trace-index.yaml` 里，因为变更记录是人会读的地方，
而派生索引重建一次就把标记抹平了，没人会注意到链断过。
注意它仍然要有一个合法的 `status`（`resolved` 或 `deferred`），否则 `changes_closed` 不通过——
断链是一条待办的属性，不是它的结局。静默断链比 orphaned 更糟：没人会去找一条不知道断了的链。

## 影响分析是提示，不是判断

`impact` 步骤只回答"哪些东西需要被重新看"，不回答"这个改动的语义后果是什么"。
矩阵在 `references/impact-matrix.md`（来自流程 §10.2），逐类列出至少要检查什么。

改一条关系的基数，矩阵会告诉你去看 source/target role、既有数据兼容性、Cypher、
相关 CQ 和跨 scope 引用；它不会告诉你 1:1 改成 1:many 之后下游的对账逻辑要不要改。
那是人的判断，而且它是 `patch_or_version` 那个决策点的输入——所以这里
**不给 Patch/Version 的推荐，一个字都不给**（见 `shared/decision-points.md`）。

## 只重跑受影响的阶段

做法在 `references/partial-rerun.md`。原则：`impact` 算出受影响阶段集合，
只有集合里的阶段重跑，其余产物从父 revision 逐字复制过来。
证据纠正会一路波及到 evidential_ir → alignment → candidate；
单纯改一句定义只动 candidate。两者重跑的范围差很多。

## 什么时候才能选候选发布

流程 §10.3 的五条退出条件，全满足才提供 `select`（`references/exit-criteria.md`）：

1. blocking 检查项全部通过；
2. 关键变更请求已关闭，或有明确 owner 与延后理由（`changes_closed`）；
3. 每个被审对象仍能解析到证据或假设，以及一个 revision；
4. semantic diff 已由相关负责人审阅；
5. 明确选定了一个 revision 作为候选发布。

差一条就不要把 `select` 摆上来。把差的那条单独列出来——
决策点的真正内容是"还没定的那部分"，不是"可以点同意了"。

## 取材范围

| 可以读 | 为什么 |
|---|---|
| `revisions/**` | 父 revision 的四层产物、trace-index、封存记录 |
| `reviews/**` | 要落地的处置与 `intended_edit` |
| `history/**` | 变更请求、defer backlog、既有裁决 |
| `define/**` | 证据纠正类的变更要回到快照和 FAGC 登记确认 |

**修订过程不联网。** 需要新材料才能改的，回 `evidence` 登记一个新快照，
再开新 revision——输入变了就开新版本，不要就地改旧的。

## 这个 Skill 不做什么

- **不审阅。** 四轮审阅和五种处置是 `review` 的活。
- **不改父 revision，也不"回退"。** 恢复用 `restore`，它向前复制。
- **不判 Patch/Version，不给推荐。** 那是 `submit` 的决策点，且是唯一不给推荐的一个。
- **不评估 CQ。** "这版还能回答那些问题吗"是 `evaluate` 的跨 revision 比较。
- **不宣布成功。** 门由 `revision.py seal` 跑检查项判定。
