# 步骤 · factor-tree/materials —— 匹配行业、收材料、定起底方式

三件事：把这个项目的行业对上知识库里的行业包，把客户给的报告清点成一份索引，
把"这棵树从哪起底"定下来。都落进 `artifacts/s1/materials-index.md`。

**类型：H。** 行业是 scoping 时人定的，材料是人给的，起底方式由前两件事推出来——
这一步不产生判断，只产生记录。

## 1 · 匹配行业知识（M）

行业锚点来自 scoping：`mmm.yaml` 的 `industry`（项目档案里也有一份）。
**不要在这里重新问行业，也不要从材料里猜行业。**

```bash
~/.local/bin/mmm script knowledge_recall <workspace> --pack
```

三种回答，都要照原样记进索引：

| 回答 | 记什么 | 意味着 |
|---|---|---|
| 匹配到包 | `industryAnchor: food-bev/beverage/...`、`industryPack: food-bev/beverage` | 这个包覆盖 **L1–L4 + 指标**，整棵树可以从它起底 |
| 有行业、没有包 | `industryAnchor: <锚点>`、`industryPack: none` | 这是一个真答案。只能从客户自己的树起底 |
| 档案里没有行业 | `industryAnchor: none`、`industryPack: none` | 回去把行业问出来——见下面那条"两头都空"的规矩 |

匹配到的包给的是**完整四层加指标**，不是只有骨架。L1/L2 从这一步起锁定：
后面几步确认的是 L3/L4 与主指标，不是这两层。**除非人明确提出要改**——那条路
在确认那一步开着，但要先看清代价（见 `confirm.md`）。

## 2 · 清点材料（M）

读 `inputs/industry-reference/**` 下每一份文件，每份记五件事：

| 记什么 | 怎么记 |
|---|---|
| 文件名 | 原样 |
| 是什么 | 竞品研究 / 内部复盘 / 财报 / 媒介报告… |
| 覆盖期间 | 材料自己声明的区间，写不出来就写"未声明" |
| 能支持什么 | 它能给因子树提供哪一类因子的依据 |
| 读了多少 | 字数，以及是否截断 |

**不要在这里概括内容。** 概括是知识包那一步的事。这一步是目录：有什么、覆盖什么期间、
能拿来主张什么。

混进来的无关文件照样列进索引，并在备注里写明不采用与原因（常见的是别的行业的案例、
别的项目的数据表、表名带前导空格的空表）。悄悄跳过一个文件，下一个人会以为它没来过。

`inputs/industry-reference/` 空着时，先说出来再问是不是确实没有；确实没有的，
放一份 `NONE.md` 写清楚是谁确认的、为什么没有，缺口就留在明面上。

## 3 · 定起底方式（M，多数情况下不用问）

起底方式是**推出来的**，不是问出来的。按这张表判：

| 客户上传了自己的树 | 行业包 | `baselineChoice` | 怎么用 |
|---|---|---|---|
| 有 | 有 | `client-tree` | 客户的树是基线，行业包只用来补它缺的分支（记 `gapFillPack`） |
| 有 | 无 | `client-tree` | 客户的树是基线，没有行业对照 |
| 无 | 有 | `template` | 行业包全量起底，再按这个项目的材料增删 |
| 无 | 无 | —— | **停下来提醒人** |

**两头都空的时候不要往下走。** 没有行业包、客户也没上传树，这棵树就只能凭材料现推，
L1/L2 会变成一个没有任何背书的自创骨架，而它在交付物里看起来和真骨架一模一样。
这时候要说的是：

```
【停一下】这棵树现在没有起底的依据
读到：项目档案的行业是 <空 / 无包>，inputs/client-factor-tree/ 是空的。

  A. 补上行业（推荐）—— 行业是 scoping 时定的，回去把它定下来，我再匹配知识包。
  B. 让客户发一份他们自己在用的因子树 —— 放进 inputs/client-factor-tree/。
  C. 两样都没有，坚持现推 —— 我会照这个项目的材料推一版，
     并且全程标明这棵树没有任何行业背书。风险由这个项目自己承担。
```

选 `client-tree` 而目录是空的，就不能记 `client-tree`——记了下一步会按一棵不存在的树去补缺口。

结论写进索引 meta 的 `baselineChoice`（`template` 或 `client-tree`）。
**推导那一步只认这几个字段。** 记错了，整棵树会按错的方式建起来，而错误要到两次确认之后才现形。

## 4 · 写材料索引（M）

```markdown
---
step: factor-tree/materials
skill: factor-tree
generated: "2026-08-08T10:40:00+08:00"
grounding:
  - { path: "inputs/industry-reference/competitor-benchmark-2025.pdf", chars: 38200, truncated: true }
  - { path: "inputs/industry-reference/brand-review.pptx", chars: 9100, truncated: false }
knowledgeRecall: none
industryAnchor: food-bev/beverage/functional-sports-drinks
industryPack: food-bev/beverage
baselineChoice: client-tree
gapFillPack: food-bev/beverage
counts: { materials: 2, usable: 2 }
---

# 材料索引

| 文件 | 是什么 | 期间 | 能支持什么 | 备注 |
|---|---|---|---|---|
| competitor-benchmark-2025.pdf | 竞品研究 | 2024-01–2025-06 | 竞品投放与份额类因子 | 120 页，只读了前 38,200 字 |
| brand-review.pptx | 内部复盘 | FY2024 | 品牌健康度、价格带 | — |

## 缺口

- 没有任何材料覆盖电商促销力度；因子树会提出这一支但没有材料背书，留给访谈去问。
```

两条硬要求：

- **截断要在正文里说一遍。** 只写在 meta 里，技术上诚实，实际上没人看见。
- **「缺口」不能空着。** 它是访谈提纲的出题来源；真的没有缺口，就写一句为什么没有。

## 5 · 交验收

验收时会查：`inputs/industry-reference` 下有文件、索引的信息块完整、取材没有超出白名单、
行业锚点与起底方式都已记录且成立（`baseline_choice_recorded`——选 `template` 就必须真有那个包，
选 `client-tree` 就必须真有那份文件）。

做完这一步说一句：**因子树的取材步已完成，请验收 `factor-tree/materials`。**
不要自己判定它通过。

## 取材范围

`inputs/industry-reference/**`、`inputs/client-factor-tree/**`、
`artifacts/s1/project-profile.yaml`、`mmm.yaml`。
