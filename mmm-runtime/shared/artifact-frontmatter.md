# 交付物的元信息块

每份产出物都带一段机器可校验的元信息：**哪一步产出了它、它被允许读什么、它实际读了什么、
有没有内容被截断**。`gate_check.py` 校验它；编排层看进度时读的也是它，而不是打开正文。

## Markdown 产出物 —— YAML 前置块

```markdown
---
step: interview/digest
skill: interview
generated: "2026-08-08T14:02:00+08:00"
grounding:
  - { path: "inputs/interview-minutes/layer1-gm.txt", chars: 18422, truncated: false }
  - { path: "artifacts/s1/factor-tree.yaml", chars: 9310, truncated: false }
knowledgeRecall: none
counts: { proposed: 6, evidenceBacked: 6 }
---

# 访谈消化 —— 第一层（总经理）
...
```

## YAML 产出物 —— 顶层的 `meta` 键

YAML 产出物把同样的字段放在 `meta:` 下面，正文在它旁边。这样整个文件仍是一份 YAML 文档，
所有解析器都用同一种方式读它。

```yaml
meta:
  step: factor-tree/derive
  skill: factor-tree
  generated: "2026-08-08T11:20:00+08:00"
  grounding:
    - { path: "artifacts/s1/knowledge-package.md", chars: 6120, truncated: false }
  knowledgeRecall: "kb:food-bev/beverage@2026-08"
  counts: { baseline: 41, proposed: 12, accepted: 0, rejected: 0 }
rows:
  - id: f-0001
    ...
```

## 字段

| 字段 | 必填 | 含义 |
|---|---|---|
| `step` | 是 | 产出它的构建步骤，写全称 `<交付物>/<步骤>` |
| `skill` | 是 | 哪个 Skill 写的 |
| `generated` | 是 | ISO-8601，带时区偏移 |
| `grounding` | 是 | 读过的每一份材料，带保留的字符数与是否截断 |
| `knowledgeRecall` | 是 | 用了哪个知识包，没有就是 `none` |
| `counts` | 有行或有条目时 | 各状态的计数，让编排层不必打开正文就能报进度 |

`grounding: []` 是合法值——有的步骤确实什么都不读（比如纯粹重组用户给的输入）。
任何一处 `truncated: true` 都值得在人拍板时说出来：审的人有权知道这份东西是基于
一份文档的一部分做出来的。

每个 `grounding[].path` 都必须命中该步骤在 `shared/manifests/deliverables.yaml` 里
`reads:` 的某条通配，这一条有检查。字符数没有上限——它要回答的是"读了多少"，
不是"有没有超"，所以写上去的数字必须是真的。

### 联网取材的条目

联网查来的东西用 `url` 代替 `path`，而且**必须记访问日期**：

```yaml
grounding:
  - { path: "artifacts/s1/interview/outline.md", chars: 8200, truncated: false }
  - { url: "https://example.com/…", accessed: "2026-08-17", chars: 900, truncated: false }
```

只有 `reads:` 里带 `web:*` 的步骤可以出现这种条目——今天是两处：`factor-tree/derive`
与 `interview/pre-answer`。**日期不是装饰**：网页会改，一条查不到日期的引用，
半年后没有人能复核它当时说了什么。

一条既没有 `path` 也没有 `url` 的取材记录不合法——它声称读过东西，却没说读的是什么。

## 由脚本写入的字段

这些不用手写，列在这里是为了让文件里不出现看不懂的东西。

| 字段 | 出现在 | 谁写的 | 含义 |
|---|---|---|---|
| `generatedFrom` | `ledger.md` 一类的文本视图 | 渲染脚本 | 这份视图是从哪个文件渲染出来的 |
| `sourceHash` | 同上；`.docx` / `.xlsx` 记在自定义文档属性里 | 渲染脚本 / 工作簿应用 | 源文件正文的哈希；`view_current`、`workbook_current` 会重算它比对 |
| `acceptedDrivers` · `requested` · `missing` | `coverage.md` | 工作簿应用 | 采纳的驱动因子数、请求了多少、缺口是多少 |
| `orphanSheets` | `coverage.md` | 工作簿应用 | 没有任何指标对应的表 |
| `responseRequested` | `coverage.md` | 工作簿应用 | 响应指标在不在这份需求里；没有它 `coverage_complete` 不过 |

## 后面的步骤会改的产出物

`factor-tree.yaml` 由 `factor-tree/derive` 写出，之后 `factor-tree/confirm` 和
`factor-tree/amend` 都会改它。它的 `step` **始终写产出它的那一步**（`factor-tree/derive`），
不改。

原因是 `grounding_within_allowlist` 拿这个字段去查该步骤的取材范围：重新盖章会让
`derive` 因为"读了后面步骤合法添加的材料"而检查不过。后面的确认要留痕，用自己的日期字段
（`reviewedAt`、`amendedAt`），不覆盖产出者的戳。

## 由渲染生成的视图

一份从别的文件派生出来的文件——比如 `ledger.md` 派生自 `selection.json`——
带同样的元信息块，外加 `generatedFrom: <源文件>`，正文第一行是：

```
<!-- 这是渲染出来的视图 · 不要手改 · 重新生成方式见对应 Skill -->
```

有一条静态检查在盯着：没有任何 Skill 可以手写一份渲染视图。

二进制视图（`.docx`、`.xlsx`）没有地方放元信息块，指纹改走自定义文档属性
（`docProps/custom.xml` 的 `sourceHash`），由 `doc_current` 与
`workbook_current` 读出来比对。载体不同，规矩一样：视图不手改，过期就重新生成。
