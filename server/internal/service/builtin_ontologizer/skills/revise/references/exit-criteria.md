# 修订循环的退出条件

来自流程 §10.3。五条全满足，才把 `select`（决策点 `candidate_selection`）摆到人面前。

差一条就不要摆。把差的那条单独列出来——决策点的真正内容是"还没定的那部分"，
不是"可以点同意了"（`shared/decision-points.md`）。

## 五条

| # | 条件 | 谁判 | 怎么查 |
|---|---|---|---|
| 1 | 所有 blocking 检查项、导入与 conformance 失败已解决 | 脚本 | `revision.py seal` 的结果；`revision.yaml.status` 是 `ready_for_review` |
| 2 | 关键变更请求已关闭，或有明确 owner 与延后理由 | 脚本 | `changes_closed` |
| 3 | 每个被审对象仍能解析到证据/假设，以及一个 revision | 脚本 | `trace_complete`、`locators_resolve_or_orphaned` |
| 4 | Semantic diff 已由相关负责人审阅 | **人** | `confirm` 步骤走过；没有脚本能判这一条 |
| 5 | 已明确选定一个 revision 作为候选发布 | **人** | 就是 `candidate_selection` 本身 |

`state.py decide --point candidate_selection --verdict select` 在记录前会自己跑
`requires_gates: [ready_for_review]` 与 `requires_checks: [parent_unchanged, changes_closed,
diff_removals_explained]`，不过就拒绝并列出没过的项。

## 第 4 条为什么没有脚本

因为"审阅过了"这件事没有磁盘痕迹。可以伪造一个"已审阅"的标记，
但那个标记只能证明有人点过一下，不能证明有人读过。

所以这条靠流程保证：`confirm` 步骤把 diff 逐条摆出来，人在对话里回应了，
再进 `select`。跳过 `confirm` 直接 `select`，是这个 Skill 最容易犯也最难被发现的错误——
它不会让任何检查项变红。

## 记录裁决

```bash
python3 <pkg>/scripts/state.py decide <ws> \
  --point candidate_selection --verdict select --role OO --object r0003 \
  --rationale "chg.001/003 已关闭，chg.002 延后给 OO1；diff 三条改动已与 DE、PO 逐条过"
```

`select` 是关门裁决。`defer` 是另一个合法取值——它的意思是"这一版不作为候选，
再修一轮"，记下来同样有价值：以后有人问"为什么 r0003 没发"，日志里有答案。

选定之后在 `revisions/r0003/revision.yaml` 写 `candidate_release: true`。
**候选发布是被选中的那个 revision 本身，不是它的一份新副本**——
复制一份出来，追溯链就会在复制的那一刻分叉。

## 确实要带着未决项往前走

用 `--skip-checks`：

```bash
python3 <pkg>/scripts/state.py decide <ws> --point candidate_selection \
  --verdict select --role OO --object r0003 --skip-checks \
  --rationale "chg.002 软关账裁决要等政策部，客户接受带这条未决项发布"
```

这不是绕过检查，是把"明知有未决项仍然决定继续"这件事本身记进日志。
日志只追加，改主意不是改那一行，是再记一行。
