# 步骤 · factor-tree/amend —— 把访谈带来的改动写回树

这是**外部改动进入因子树的唯一通道**。今天走的是访谈回写；以后数据带着树没问过的口径回来，
走的也是同一条路。

**类型：H。** 逐条裁决由人做、由编排层收；你负责把每条改动连同它的原话摆出来，
以及把裁定如实应用到树上。

## 1 · 读（M）

`artifacts/s1/interview/proposals-*.yaml`、`artifacts/s1/factor-tree.yaml`、
`artifacts/s1/interview/minutes-*.md`（只用来把原话放回上下文里看）。

## 2 · 提案长什么样

字段与 `skills/interview/templates/proposals.yaml` **逐字一致**，两边不许各写一套：

```yaml
proposals:
  - id: p-003
    kind: add                      # add | amend | reject
    targetRow: f-0041              # amend / reject 必填
    l1: 消费者需求驱动
    l2: 品牌广告/内容种草
    l3: 内容种草
    l4: 直播
    indicator: "直播投放金额"
    dimension: "月度, 品牌, 渠道, 地区"
    granularity: "只能到月，给不了周"   # 访谈最常带回来的就是这类颗粒度约束
    rationale: "直播已经是数字投放里最大的一条线。"
    evidence: "\"去年数字预算里大概四成花在直播上\" —— 第三层访谈，媒介"
    applied: pending               # -> accepted | rejected，由这一步写
```

**`granularity` 不要当成注释读。** 客户说"这个指标只能到月"，意味着如果项目锁的是周度，
这一行进不了模型——采纳它的同时要么改项目档案的颗粒度，要么把这条约束带进数据需求。
把它读成一句备注，就等于在收数时才发现。

**`evidence` 空着的提案不该走到人面前。** 验收会先卡在
`proposals_have_evidence` 上，而修的地方在访谈那一步，不在这里：
一条没有原话撑着的因子改动，是访谈没有真正产出的东西。

## 3 · 逐条呈现（C）

按它触及的 L3 分组，做成一张**变更表**：

| 类型 | 目标行 | 变成什么 | 理由 | 原话 |
|---|---|---|---|---|
| add | —— | 新增 直播 / 直播投放金额 | 数字投放最大的一条线 | "去年大概四成花在直播上" |
| amend | f-0041 | 指标换成 曝光量（去重） | 现有口径重复计人 | "同一个人刷到三次算三次" |
| reject | f-0018 | 剔除 线下路演 | 去年已停做 | "路演 2024 年就砍了" |

一条一个裁决，形式还是候选 + 推荐 + 后果 + 证据。

**改动如果推翻了人自己之前的裁决，要当面说。** 目标行上有 `decidedBy` 的，
呈现时明说"这一条会覆盖你在确认因子树时做的决定"——人有权知道自己正在改自己的主意。

## 4 · 应用（M）

| 人的裁定 | 写进因子树 | 写进提案 |
|---|---|---|
| 采纳一条 `add` | 新增行：`source: interview`、`status: accepted`、`decidedBy`、`decidedAt`，`evidence` 原样带过来 | `applied: accepted` |
| 采纳一条**换指标**的 `amend` | **新增一行**承载改动；被取代的行改 `status: rejected`，`rationale` 写清楚被谁取代 | `applied: accepted` |
| 采纳一条**只改附属信息**的 `amend`（`primary`、`definition`、`unit`、`owner`、补一句说明） | 就地改那几个字段，写上 `decidedBy`、`decidedAt` | `applied: accepted` |
| 采纳一条 `reject` | 目标行改 `status: rejected`，写上 `decidedBy`、`decidedAt` | `applied: accepted` |
| 不采纳 | 树一个字不动 | `applied: rejected`，理由写人的原话 |

**指标本身变了，绝不就地改那一行。** 那种改动是"新增一行 + 剔除一行"，
这样树上还看得见访谈之前大家信的是什么、以及为什么变了。就地覆盖会抹掉访谈起过作用的唯一证据。

**指标文字没变的那种，反过来**：复制一行会造出两行同身份（路径 + 指标），
`tree_has_rows` 会直接判失败。就地改字段，在 `rationale` 里记一句改了什么。

**这一步只翻访谈来源的行。** `template`、`ai`、`websearch`、`report`、`upload` 的行
归上一道确认管，这里不碰。人手动剔掉的行也不会被翻回来。

**访谈提案要动 L1/L2 的时候**，做法和确认那一步一样：先摆代价，再让人拍板
（数据需求分册重排、跨项目不可比、已作数的判断要重看一遍），并且先给出
"在现有骨架下用一个新 L3 装下它"这个不动骨架的替代方案。访谈存在的意义就是
发现树不知道该问什么，为了归置一个因子把人退回去重建骨架，是对认真做访谈的惩罚——
所以这条路是开着的，只是不能默默走过去。

人拍板要改的，新增的 L1/L2 标 `source: interview`，原话进 `evidence`，
呈现时明说一句"骨架长了一层"，并把新骨架同步回 `knowledge-package.md` 的骨架表。

采纳之后如果某个 L4 的主指标该换，在同一轮里换掉。一个 L4 出现两条主指标，
`primary_indicator_per_l4` 会失败，并且会把是哪一组报出来。

## 5 · 变更账本

**这一步不直接写账本。** 账本只能由编排层追加（`state.py record-change`，见
`../../shared/change-ledger.md`）。每条被采纳的改动，你负责把 `source: interview`、
证据指向哪份纪要说清楚；编排层拿到裁决后据此记账，`gate` 写 `factor-tree/amend`。

## 6 · 收尾（M）

在 `meta.amendedAt` 写上时间，**不要动 `meta.step` 和 `meta.generated`**。
重新生成当前版工作簿，**再归档一份带日期的访谈校正版**：

```bash
~/.local/bin/mmm app workbook factor_tree -w <workspace>
~/.local/bin/mmm app workbook factor_tree -w <workspace> \
  --out exports/factor-tree-<日期>-访谈校正.xlsx
```

两条都要跑，它们回答的不是同一个问题。`artifacts/s1/factor-tree.xlsx` 永远是**当前版**；
而客户是在访谈之前那一版上签的字，采纳完改动之后，当前版就不再是他看过的那一份了。
归档的那一份是"访谈到底改了什么"唯一便宜的答案——没有它，只能把两版 YAML 摆在一起看。

归档件的内容必须和当前的树一致。树在归档之后又改过，就重新归档一份，
不要留一份说不清是哪一版的文件在 `exports/` 里。

验收时会查：每条提案都有裁定（`proposals_resolved`）、树里没有重复身份的行
（`tree_has_rows`——访谈新增的行也要过这一关）、没有未裁决的行（`no_undecided_rows`）、
每个 L4 恰好一条主指标（`primary_indicator_per_l4`）、
工作簿与树同步（`workbook_current`）、校正版已归档（`amended_workbook_archived`）、
人的裁决已记录。

做完说一句：**访谈的 N 条因子改动已处理完，采纳 A 条、驳回 B 条，校正版工作簿已归档，
请验收 `factor-tree/amend`。**

**每条提案都要有裁定**，包括没人想要的那些——它们是"驳回并写明理由"，
不是留在那儿让整个文件慢慢变得无关紧要。
