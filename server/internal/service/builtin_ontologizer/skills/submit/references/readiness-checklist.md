# 就绪检查表

流程附录 H 的原表，落成 `releases/rel-NNNN/readiness-checklist.md`（模板同名，在
`templates/readiness-checklist.md`）。五个小节：Candidate 与验证、Revision 与评估、
版本决定、Access Scopes、Package 与治理。

## 谁来勾

**脚本能判的由脚本勾，判不了的留给人。** 这个区分是这份表全部的价值——
一张全靠人手工勾的表，勾的是"我记得应该没问题"。

| 勾 | 依据 | 谁 |
|---|---|---|
| Candidate generation 完成 | `revision.yaml.status == ready_for_review` | S |
| Cypher generation 完成 | `cypher_generated_and_parses` | S |
| 所有 mandatory 检查项通过 | `ready_for_review` 门 | S |
| Managed graph import 成功 | **V1 没有图运行时**——标 N/A 并写明 | S |
| Conformance validation 成功 | `tools/cypher` 静态检查 | S |
| Warnings 和 assumptions 已确认 | `generation-report.md` 里的未解决项逐条被人回应 | **H** |
| Semantic diff 已审阅 | 无磁盘痕迹 | **H** |
| Migration material 已审阅 | 无磁盘痕迹 | **H** |
| Stable identities 与 declaration references 已验证 | `scope_refs_resolve` | S |
| 覆盖 / 未覆盖 / 重叠 / 分类 / 跨 scope 面已审阅 | 预览摆出来了，但看没看是人的事 | **H** |
| 每个 access-relevant declaration 已覆盖或 unscoped | `scopes_cover_or_unscoped` | S |
| Membership changes 和 digest 已审阅 | digest 由 `scope_refs_resolve` 判，审阅由人 | S+H |
| 未写入 users/groups/roles/entitlements/grants | `scopes_no_principals` | S |
| Target repository、base 和 commit 已审阅 | 预览摆出来了 | **H** |
| Changed files 与 PR title/body 与 preview 一致 | `pr_matches_preview` | S |
| Raw evidence 等已排除 | `package_excludes_raw` | S |
| Checkout clean 且无 conflict | `checkout_clean` | S |
| Create pull request 已显式批准 | `decisions.log` 里的那一行 | **H** |

## 两条不能自作主张

**"Managed graph import 成功" 在 V1 里不能勾。** 本包不连图库
（`skills/evaluate/references/graph-answer-tests.md` 说的是同一件事）。
标 `N/A —— 本机无图适配器，未执行` 并留着。勾一个没跑过的项，
这张表就从证据变成了装饰。

**六个 H 项不能替人勾。** 尤其"Semantic diff 已审阅"和
"Warnings 和 assumptions 已确认"这两条——它们没有磁盘痕迹，
所以也没有任何检查会在你替人勾了之后报错。这是这份表最容易出事的地方。

做法：在 `readiness` 步骤把这六项单独列出来问一遍，用户回应了才勾，
并在表里记下是谁在什么时候确认的。

## 失败与未支持的 CQ 要附上

"Failed/Unsupported CQ rationale" 那一栏是给 GA 看的。评估不阻断提交，
但**结果要跟着走到 PR 边界**——否则"评估过了没有"这个问题在治理评审时无从回答。

没跑评估就写 `Evaluation run: none`，不要留空。空着看起来像忘了填。

## 数字要报出处

表里每个数字后面带出处：哪个 revision、哪个 release、哪一次检查算的。
`state.py audit` 能重算全部检查，所以这些数字是可复核的——
前提是写清楚它们从哪来。
