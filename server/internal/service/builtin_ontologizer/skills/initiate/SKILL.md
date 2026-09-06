---
name: initiate
description: 初始化一个 Ontology 项目并把范围框起来，产出「项目章程」这一份交付物：一句话问题陈述、业务目标、in-scope 与 out-of-scope（必须覆盖时间、组织、数据粒度三维）、领域/流程/本体三位负责人、版本 pins、V1 规模检查（数据集合、文档数、样本行数、流程步骤、实体类型、关系类型六项估算）、3–10 条初始 Competency Question 草稿。有 SOW 或立项说明就从里面抽，没有就用问答一轮轮推导出来。用于「这是 SOW」「我们要建个本体」「帮我把项目框起来」「范围该定多大」「规模估不准」「这个领域该拆几个 bounded context」「先做哪一块」「重开这个项目」「初始问题清单写几条」这类请求。它是整个流程的第一份交付物，后面每个阶段都读它的边界与粒度；范围没框好，证据登记会漫无边际，生成出来的东西也没人能验收。
---

# initiate · 把项目框起来

**唯一交付物：`define/project-charter.yaml`。** 填法与字段含义见 `templates/project-charter.yaml`。
写完它，`charter_complete` 这项检查要能过；过不了就是没写完，不是"差不多了"。

开工前读 `shared/conventions.md` 与 `shared/decision-points.md`。
`<pkg>` 是本插件根目录，`<ws>` 是工作区目录。

## 四步

| 步 | 谁做 | 做什么 |
|---|---|---|
| `clarify` | 人 | 先读完 `inputs/charter/` 里的材料，只问"答案会改变章程"的问题。见 `references/charter.md` |
| `draft` | Claude | 写出章程草稿，每个字段标出是抽出来的还是推出来的 |
| `scale-check` | 脚本 | 六项估算与 V1 上限比对。见 `references/scale-check.md` |
| `confirm` | 人 | 决策点 `scope_and_boundary`，OO 拍板。目标、边界、负责人是人的判断，不是抽取结果 |

## 没有工作区就先要一个

这个 Skill 不建目录。工作区还不存在时，把请求交给 `orchestrator` 的 init：

```bash
python3 <pkg>/scripts/state.py init <目录> --slug <短名> --domain "<领域>" --goal "<一句话目标>"
```

理由不是分工洁癖：init 同时开决策日志、写 pins、把项目登记到本机清单。
自己 mkdir 出来的目录看起来一样，但它没有审计线索，而这一点要到几周后
有人问"这个边界谁定的"时才会暴露。

## 章程写完之后

```bash
python3 <pkg>/scripts/validate.py <ws> --check charter_complete
python3 <pkg>/scripts/state.py decide <ws> --point scope_and_boundary \
  --verdict approve --role OO --rationale "SOW 边界确认，规模在 V1 内"
```

裁决之后 `define/project-charter.yaml` 冻结。之后要改边界不是直接编辑，
是再记一条裁决说明为什么重开——因为证据登记、生成、审阅都已经按这份边界干过活了。

## 几条真正会出问题的规则

**out_of_scope 空着等于没有边界。** "做总账"不是范围，"做总账里与冲销相关的部分，
不做应付应收固定资产"才是。检查项要求 in/out 各至少一条，并且时间、组织、数据粒度
三维都要写出来——这三维是后面证据登记决定"这份材料要不要收"的唯一依据。

**三位负责人不能是同一个"我"。** 可以是同一个人，但要分别写出他在这三件事上的身份。
半年后回看，"谁以什么身份拍的板"是唯一能解释一个决定的东西。

**规模超限不拦你。** 六项估算超过 V1 上限时给三个选项让人选，不要自己缩范围，
也不要装作没看见。见 `references/scale-check.md` 与 `references/bounded-context-split.md`。

**初始问题清单是 3–10 条，每条要有 persona 和 decision。** 写不出"谁在什么决策点上问这个"
的问题，通常说明它不是一个业务问题，是一个字段查询。见 `references/initial-cqs.md`。

**抽出来的和推出来的要分开标。** SOW 里没写负责人，你根据"技术对口：数据平台组"
推出本体负责人是架构师——这是推断，要标出来让人确认，不能直接当成事实写进去。
把推断静默写成事实，是这套流程最想防住的一件事。

## 估不准怎么办

用户说"规模我估不准"是常态。不要因此空着，也不要编一个精确数字。做法：
给出一个可核对的区间与它的算法（"inputs/evidence 下 5 个文件，CSV 样本 6 行 ×
月均 4 万条 → sample_rows 按 4000 估"），标 `estimated: true`，让人改。
数字要能说出出处，说不出出处的数字就不写。

## 这个 Skill 不做什么

- 不建目录、不写项目记录、不记别的决策点——那是 `orchestrator`。
- 不登记证据、不做抽取、不判断材料够不够——那是 `evidence`。
- 不做访谈、不填八项 readiness——那是 `interview`。
- 不写正式的 Competency Question 登记。这里只出 3–10 条草稿；
  正式登记与批准在 `evaluate`，那里的决策点是 `competency_questions`。
