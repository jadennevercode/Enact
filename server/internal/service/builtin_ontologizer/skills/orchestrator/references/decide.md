# decide · 怎么把一个人的判断记下来

八个决策点在 `shared/manifests/decision-points.yaml` 里，跑 `state.py points` 就能列出来。
这个 Skill 是唯一往 `history/decisions.log` 写字的地方。

## 呈现：四段，顺序不变

来自 `shared/decision-points.md`。少一段人就是在没看依据的情况下点了同意。

**1 · 在定什么** —— 把决策点的问题原文念出来，加一句"这件事按 RACI 该谁拍板"。
用户说"就我一个人"也照说，然后用 `--role` 记他此刻的身份。

**2 · 依据** —— 交付物路径，加一份他能据以判断的摘要：按状态计数、这次变了什么、
自上次以来新增了什么。每个数字报出处（哪一次检查、哪一版算出来的）。说不出出处的数字就不说。

**3 · 还没定的** —— 每一条单独列。这是决策点的真正内容。
有未决项时不要把 approve 作为推荐；先把未决项摆到他面前。

**4 · 选项与后果** —— 每个合法裁决词，选它之后会发生什么、哪些交付物会被冻结
（`freezes` 字段列的那些）。

## 落一行

```bash
python3 <pkg>/scripts/state.py decide <ws> \
  --point scope_and_boundary --verdict approve --role OO \
  --object "-" --rationale "SOW 边界确认，规模在 V1 内"
```

脚本会挡住四类错误，别绕过它们：

| 它拒绝什么 | 为什么 |
|---|---|
| 不认识的决策点 id | 日志不可回改，笔误会永久留下，日后表现为"这事没人拍过板" |
| 该决策点没有的裁决词 | 同上 |
| 不在推荐名单里的角色 | 要用就加 `--force-role`，让"用了非常规角色"这件事显式 |
| 关门类裁决但要求的检查项没过 | 见下 |

## 关门时检查项没过怎么办

脚本会列出没过的项然后退出，例如：

```
semantic_review 还不能关：
  !! review_binary 未通过：reviews/review-r0004.yaml: 没有审阅记录
```

**这是交付物的问题，不是记录的问题。** 把这条原样转给拥有它的 Skill：
`review_binary` / `defer_has_owner` → `review`；`parent_unchanged` / `diff_removals_explained`
→ `revise`；`charter_complete` → `initiate`；`package_excludes_raw` 等 → `submit`。

`--skip-checks` 只有一个正当用途：人在完全知情的前提下决定带着未决项继续。
这时理由里要写清楚他知道什么、接受什么。用它来让一条红线变绿，是在伪造审计线索。

## Patch/Version 不给推荐

这是八个决策点里唯一一个只给证据、不给推荐的。给它：语义差异、会影响授权的变更清单、
迁移材料。不要说"看起来像 Patch"。

流程 §12.2 与 §19.2 写明本包不自动判断语义影响、不自动选择 Patch/Version。
给了推荐，人会点同意——而这个选择的后果（下游消费者要不要改）只有他知道。

## 签核之后

`freezes` 列的交付物在这次裁决后不该再改。改动不是禁止的，但要走一次显式重开：
再记一条裁决说明为什么重开，然后往前重跑。

没有任何脚本能从文件本身分辨"经批准的修改"和"偷偷的修改"。能查的是可见性——
`state.py audit` 会重算全部检查，被改过的封存版本会被报出来。
