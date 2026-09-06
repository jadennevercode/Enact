# Semantic diff

`revisions/rMMMM/semantic-diff.yaml`，由脚本生成，人补上删除的交代之后交人逐条审。

```bash
python3 <pkg>/scripts/revision.py diff <ws> r0002 r0003
```

它写进 `r0003/semantic-diff.yaml`。**父 revision 已封存时只打印不写入**——
diff 属于新版本，不属于旧版本。

## 结构

```yaml
from_revision: r0002
to_revision: r0003
generated_at: 2026-09-03T15:02:11+08:00
summary: { added: 1, removed: 1, changed: 2, unaffected: 6 }

added:
  - object_id: pol.single_reversal
    kind: policy
    view_label: 一条分录只冲销一次

removed:
  - object_id: con.single_reversal
    kind: constraint
    view_label: null
    replaced_by: pol.single_reversal      # 二选一，不能都空
    removal_rationale: null

changed:
  - object_id: rel.reverses
    kind: relationship
    fields: [cardinality, definition]
    authorization_impacting: true         # 脚本判定，见下

unaffected: [ent.journal_entry, ent.reversal_entry, attr.journal_entry.status, ...]
```

## 四个集合各自的意思

| 集合 | 怎么算出来的 | 谁在管 |
|---|---|---|
| `added` | 在新版有、旧版没有的 id | — |
| `removed` | 在旧版有、新版没有的 id | `diff_removals_explained` |
| `changed` | 两版都有但规范化后不相同，`fields` 列出变了哪些键 | 人逐条审 |
| `unaffected` | 两版都有且逐字相同 | `unaffected_unchanged` |

## removed 的两个字段是故意留空的

`revision.py diff` 把每条 `removed` 的 `replaced_by` 和 `removal_rationale` 都写成 `null`，
然后在终端提醒你去填。**它不猜。** 只有人知道这个对象是被另一个对象替代了，
还是压根不再需要了——而这两件事在下游的后果完全不同：

- `replaced_by` 指向新对象 → 下游可以改指，这通常还是 Patch 的范围；
- `removal_rationale` 说明不再需要 → 下游引用它的东西全都断了，这通常意味着 Version。

**注意：填这两个字段是在陈述事实，不是在选 Patch/Version。** 别在 diff 里写
"因此这次应该是 Patch"——那个判断不属于这里（`shared/decision-points.md`）。

审阅时 reject 的理由类别通常就是现成的 `removal_rationale`：
`duplicate` → 写 `replaced_by`；`out_of_scope`、`semantically_wrong` → 写 `removal_rationale`。

## authorization_impacting 是什么

脚本盯六个字段：`classification`、`owner`、`source`、`target`、`cardinality`、`datatype`。
其中任意一个变了，这条 `changed` 就标 `authorization_impacting: true`。

理由是流程 §12.3-5：scope 声明的成员和暴露面依赖这些字段。
分类变了、属主变了、关系端点变了，`submit` 阶段 `access_scope_review` 要重看的东西也变了。

这个标记是**保守的**：它宁可多标，也不漏标。标了不等于真的动了授权边界，
它只是告诉 `submit`："这几条你别跳过"。

## 怎么把 diff 交给人审

`confirm` 步骤。按这个顺序说，三段：

1. **摘要**：新增 1 / 删除 1 / 变更 2 / 未受影响 6，出处写清楚（`r0003/semantic-diff.yaml`）。
2. **逐条**：先说 `authorization_impacting` 的，再说其余 `changed`，然后 `removed`（带交代），
   最后 `added`。`unaffected` 只报数字，不列表——列出来只会稀释注意力。
3. **还没关的**：`changes_closed` 报出的未闭环变更请求、还没填交代的 removed。

然后问：这些改动是你要的吗？有没有哪一条不该变？

**不要在这里给 Patch/Version 的倾向性说法。** 一句"看起来兼容"就足以让人点同意，
而下游要不要改，只有他知道。
