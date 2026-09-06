# audit · 对着磁盘重算全部检查

```bash
python3 <pkg>/scripts/state.py audit <ws>
```

它把所有检查项在每一版、每一个发布上重算一遍，`!!` 是会阻断的，`!` 是要人知悉的。
日常健康看 `status` 里的「问题」段（那是精选的六项）；audit 是全量的，用在两个时刻：

- 提交前，或者人问"这个项目还可信吗"。
- 怀疑有人手改过封存的东西时。`revision_sealed_immutable` 是唯一会说话的信号。

## 早期项目跑 audit 会刷屏，这是正常的

audit 不区分"还没到那一步"和"做错了"。一个刚建好、只有章程的项目跑 audit，
会看到二十多条未通过：没有证据登记、没有候选本体、没有发布包、
还有若干条因为根本没有版本可查而报出自身出错的检查。

这不是项目坏了。念给用户听的时候要分三堆：

| 堆 | 怎么说 |
|---|---|
| 还没做到的阶段 | "这些是后面阶段的检查，现在没有对应的交付物，正常" |
| 真正的问题 | 逐条照抄，指出该谁修 |
| 检查自身出错 | 照抄错误，说明这是缺少输入导致的，不要当成项目的问题 |

判断标准很简单：这一项属于的阶段，项目走到了没有。`shared/manifests/stages.yaml`
里每个阶段都列了自己的检查项。

## 报出来之后不要自己动手

脚本自己就写着这句话：`不要自己悄悄修复记录——报告、给方案、让人选。`

audit 报的每一条都指向一份具体的交付物，而那份交付物有主：

| 未通过的检查 | 交给谁 |
|---|---|
| `charter_complete` | `initiate` |
| `no_inference_as_fact`、`conflicts_not_merged`、`evidence_confirmed` | `evidence` |
| `readiness_resolved`、`model_cards_sourced` | `interview` |
| `schema_valid`、`layer_separation`、`trace_complete`、`relationship_declared` 等 | `generate` |
| `review_binary`、`defer_has_owner`、`reject_has_reason` | `review` |
| `parent_unchanged`、`diff_removals_explained`、`unaffected_unchanged` | `revise` |
| `cq_human_owned`、`cq_result_bound` | `evaluate` |
| `scopes_*`、`package_excludes_raw`、`pr_matches_preview`、`checkout_clean` | `submit` |
| `revision_sealed_immutable`、`decision_logged` | 停下来，问人发生了什么 |

最后两条特殊：它们说明历史被动过，或者某个决定改了状态却没有留下日志。
这两种情况没有"修一下"的选项——要先搞清楚是谁、什么时候、为什么。
