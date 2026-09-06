---
name: review
description: 带领域专家和本体工程师按 Evidence → Process → Mapping → Ontology 四轮，逐个审阅一个已经 ready-for-review 的 revision，每个 entity / relationship / attribute / event / lifecycle / constraint 都必须落到五种处置之一：accept、comment、direct_edit、defer、reject——没有 pending，comment 也是结论。direct_edit 在这里只被记录，封存的 revision 一个字节都不动，落地是 revise 的活；defer 必须带 owner、理由和目标版本；reject 必须给出无依据 / 重复 / 越界 / 语义错误四类理由之一；定位不到证据的 claim 标 unsupported。大图按层、类型或邻域分组呈现，给整组建议让人改例外，绝不摊开一张 hairball，也绝不问 62 个问题。用于"审一下这版""r0002 能开始审了吗""这个关系方向对吗""这个实体没依据吧""这条约束我不同意""哪些对象还没看""哪些是重复概念""把审阅结论汇总一下"这类请求。只产出审阅记录，不改本体、不出新版本、不回答对象的来历。
---

# Review · 四轮审阅

交付物只有一份：`reviews/review-r<NNNN>.yaml`。它记录这一版里**每一个**被审对象的结论，
以及由 comment 汇总出的变更请求（写进 `history/comments.yaml`）。它不改动被审的那个 revision。

先确认对象：没有点名就审 HEAD，且它的状态必须是 `ready_for_review`。
状态是 `gate_failed` 的 revision 不审——机器门没过的东西拿给人看，是在浪费领域专家最贵的那点注意力。

`<pkg>` 是包目录，判断标准是 `<pkg>/scripts/state.py` 存在。先试本 SKILL.md 所在目录（Enact Marketplace 安装后的布局），再试往上两级（Claude Code 插件布局）；都不是就在 skills 根目录下按 `*/scripts/state.py` 搜一遍，仍找不到停下报告，不要手写替代。`<pkg>/scripts/`、`<pkg>/shared/`、`<pkg>/tools/`、`<pkg>/knowledge/` 四个目录都在包里，下文相对路径以 `<pkg>` 为基准。

## 步骤

| # | 步骤 | 谁 | 做什么 |
|---|---|---|---|
| 1 | `evidence-pass` | H | 出处、版本、anchor、抽取准确性、冲突。定位不到的 claim 标 unsupported |
| 2 | `process-pass` | H | 顺序、actor、record、event、decision、handoff、exception、lifecycle |
| 3 | `mapping-pass` | H | 每个对象有没有 support；找 one-to-many / many-to-one / unmapped / contradictory |
| 4 | `ontology-pass` | H | identity、definition、granularity、方向与基数、datatype、约束、重复概念、是否在范围内 |
| 5 | `close-out` | S | 汇总 requested changes、orphaned、unsupported，写 `reviews/` 与 `history/comments.yaml` |

每轮的逐条清单在 `references/four-pass.md`。清单不是背下来的，是照着走的——
四轮各自问的问题不同，混着问的结果是每一样都问了一半。

走完之后开决策点 `semantic_review`（DE/OE/PO 拍板，OO 负责）：

```bash
python3 <pkg>/scripts/state.py decide <ws> --point semantic_review \
  --verdict request_changes --role DE --object r0002 --rationale "软关账那条规则两边说法冲突，先不接受"
```

`accept_revision` 是关门裁决，记录前会跑 `review_binary`、`defer_has_owner`、`reject_has_reason`。

## 规则

**四轮的顺序不能换。** 先确认我们知道什么，再确认业务怎么运转，再确认映射成不成立，
最后才评价设计。反过来审，人会先爱上一个漂亮的模型，然后回头替它找依据——
这时候 evidence 轮就变成了一场辩护，而不是一次核对。

**五种处置，没有第六种，也没有空着的。** `review_binary` 检查两件事：每个对象的
`disposition` 属于 accept / comment / direct_edit / defer / reject，且 candidate 里
每个声明都在 `items` 里出现过。停在中间状态的对象等于没审。
说不准也要落一个 comment，把说不准的地方写进 `note`——那也是结论。

**direct_edit 在这里只被记录，不被执行。** 封存的 revision 是只读的，改它就毁掉了
"人当时看的是哪一版"这条线索。把人想要的改法写进 `intended_edit`，
由 `revise` 在新 revision 里落地。这条不是流程洁癖：审阅意见和它的落地分开记录，
才能在半年后回答"这个改动是谁要求的、基于什么"。

**defer 要有主。** owner、rationale、target_revision 三样缺一不可（`defer_has_owner`）。
没有 owner 的延后会漂移成事实——三个月后没人记得它曾经是个待办，它就变成了模型的一部分。

**reject 要有理由类别**（`reject_has_reason`）：`unsupported`（无依据）、`duplicate`（重复）、
`out_of_scope`（越界）、`semantically_wrong`（语义错误）。类别不是分类癖，它决定下一轮
是删除、是合并、是移出范围还是重写——四件完全不同的事。

**62 个对象不要问 62 次。** 按层、按类型或按邻域分组，给整组一个建议，请人只改例外。
方法在 `references/presenting-large-graphs.md`。一次摊开一张关系网，人看到的是一团线；
一次问 62 遍，人到第 15 个就开始点"同意"了——两种做法都会让审阅变成走过场。

**空结果也是结论。** 没有重复概念、没有无依据对象、没有断链，就明确说出来，
不要用"未发现明显问题"含糊过去。常见的语义毛病对照 `knowledge/anti-patterns.md`。

## 取材范围

| 可以读 | 为什么 |
|---|---|
| `revisions/**` | 被审的四层产物、`trace-index.yaml`、`validation/`、生成报告 |
| `reviews/**` | 同一 revision 或历史 revision 的既有结论，避免重复审 |
| `history/comments.yaml` | 上一轮还没关掉的变更请求和 defer backlog |
| `define/**` | 追一条 support 到证据登记和访谈记录时用 |

**审阅中途不联网、不捞新材料。** 人批的必须就是他看见的那一版。
需要新证据才能判断的，落成一条 comment，回到 `evidence` 去补。

## 交付物字段

模板在 `templates/review.yaml`，处置的完整语义在 `references/dispositions.md`。
最小形态：顶层 `revision`、`passes`（四轮各一个 `status: done`）、`items`（每个对象一条）。

## 这个 Skill 不做什么

- **不改任何本体产物。** 不写 `candidate.yaml`，不开新 revision，不动封存目录。
- **不落地审阅意见。** 那是 `revise`：`normalize` → `impact` → `regenerate` → `diff`。
- **不回答对象的来历。** "这条关系哪来的""哪些没依据"是 `trace` 的 `why` 与 `unsupported`。
- **不选候选发布，不判 Patch/Version。** 前者在 `revise`，后者在 `submit`，都由人决定。
- **不重跑机器门。** 门在 `generate`/`revise` 封存时已经判过了；重算全部检查用
  `state.py audit`。
