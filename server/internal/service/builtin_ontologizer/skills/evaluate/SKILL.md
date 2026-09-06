---
name: evaluate
description: 用**人定义的** Competency Question 检验某一版本体到底能不能回答业务问题：导入或录入 CQ（业务语言，不嵌 schema 名也不嵌 Cypher，每题写明 persona、支撑什么决策、时间窗、过滤条件、粒度和成功证据长什么样，一题只验一个能力），按写作规则做 lint，绑定到一个具体 revision，跑 rule check 与可选的 graph-answer test，判成 passed / failed / unsupported 并存下执行证据，再跨 revision 比较看有没有退步。系统绝不自行发明问题——可以提候选，但候选带 ai_proposed 标记，经人批准才进正式评估；"查询返回了数据"不等于语义正确；unsupported 表示当前模型契约不承诺这项能力，不是缺陷。用于"这版能回答这些问题吗""导入这份 CQ 表""跑一下评估""r0003 比 r0002 退步了吗""这题为什么是 Unsupported""这几个问题写得对不对"这类请求。评估永不阻断提交，也不改本体、不出新版本。
---

# Evaluate · 胜任问题评估

交付物两样：`evaluation/cq-register.yaml`（问题登记，跨 revision 长期存在）和
`evaluation/runs/ev-<NNNN>.yaml`（一次运行的逐题结果，绑定一个具体 revision）。

**这个阶段永不阻断任何事。** 流程 §11.1 写死了：Evaluation never blocks submission。
它的价值不在于放行或拦截，而在于告诉人"这版模型离能用还差什么"，
以及"上一版能答的这版还能不能答"。

`<pkg>` 是包目录，判断标准是 `<pkg>/scripts/state.py` 存在。先试本 SKILL.md 所在目录（Enact Marketplace 安装后的布局），再试往上两级（Claude Code 插件布局）；都不是就在 skills 根目录下按 `*/scripts/state.py` 搜一遍，仍找不到停下报告，不要手写替代。`<pkg>/scripts/`、`<pkg>/shared/`、`<pkg>/tools/`、`<pkg>/knowledge/` 四个目录都在包里，下文相对路径以 `<pkg>` 为基准。

## 步骤

| # | 步骤 | 谁 | 做什么 |
|---|---|---|---|
| 1 | `import` | H | 从 CSV/XLSX/MD 导入，或逐条录入。**问题只能由人给** |
| 2 | `lint` | C+S | 按写作规则查：业务语言、一题一能力、六项要素齐（`knowledge/cq-writing-rules.md`） |
| 3 | `bind` | S | 绑定到一个 revision，解析每题声明的 required_entities / relationships / attributes |
| 4 | `run` | S | 跑 rule check；有适配器时跑 graph-answer test；存执行证据 |
| 5 | `compare` | S | 与前一次运行逐题对齐，找出退步 |
| 6 | `interpret` | H | 每条 failed / unsupported：接受、修订，还是延后 |

问题定稿之后开决策点 `competency_questions`（DE/PO 拍板，OO 负责）：

```bash
python3 <pkg>/scripts/state.py decide <ws> --point competency_questions \
  --verdict approve --role DE --rationale "六道题覆盖 filter/relate/aggregate/trace/lifecycle"
```

## 三条不能让步的

**系统不发明问题。** `cq_human_owned` 扫 `questions` 里的每一条，
只接受 `origin: human` 或 `origin: ai_proposed_human_approved`，且 `owner` 非空。
你可以提候选——读证据、读 candidate，提出"这个模型好像还应该能回答 X"——
但候选**不进 `questions`**，它放在登记里单独的 `proposed_candidates` 键下，
标 `origin: ai_proposed`。人认可之后才整条挪进 `questions`，
改成 `ai_proposed_human_approved` 并填上 owner。挪之前它一行都不算数。

理由不是形式主义：一组由系统自己出的题，检验的是系统自己的假设。
它一定会通过，而通过的那一刻你就失去了唯一能发现"我们建错了"的机会。

**passed 必须有执行证据**（`cq_result_bound`）。"查询返回了数据"不等于语义正确——
一条返回了 200 行的查询，可能正好把两个不该合并的概念合并了。
`execution_evidence` 要写清楚：在哪个 revision 上、经过哪条路径、
得到的形状与 `expected_answer_shape` 怎么对上的。

**unsupported 不是故障。** 它的意思是**当前模型契约不承诺这项能力**——
范围里没有、或者缺必要的概念、关系、数据绑定。它需要的是一次范围决定，
不是一张缺陷单。把 unsupported 报成失败，会让人去"修"一个根本没打算做的东西。
三种状态各自义务什么，见 `references/status-interpretation.md`。

## 怎么真的跑一次检查

**V1 没有图运行时。** 这句话要直说，不要暗示评估比实际能力更强。

- **rule check** 在这里是能真跑的：读绑定 revision 的 `candidate.yaml` 和
  `trace-index.yaml`，查这题声明的实体、关系、属性在不在，以及它们之间有没有路径。
  做法在 `references/rule-checks.md`。
- **graph-answer test** 需要一个真图库。没有适配器时，这类题**记为 `unsupported`
  并在 rationale 里写明原因是缺运行时**，不是模型的问题——见
  `references/graph-answer-tests.md`。绝不把没跑过的题标成 passed。

## 跨 revision 比较

`compare` 步骤逐题对齐两次运行，报三类变化：**退步**（passed → failed/unsupported）、
**进步**（failed/unsupported → passed）、**新增/消失的题**。

退步是这个阶段最有价值的产出：它说明上一轮修订删掉或改动了某个还有人依赖的东西。
做法与呈现顺序在 `references/comparing-revisions.md`。

## 取材范围

| 可以读 | 为什么 |
|---|---|
| `inputs/competency-questions/**` | 人给的原始 CQ 表 |
| `evaluation/**` | 既有登记与历次运行 |
| `revisions/**` | 绑定的 revision 的 candidate、trace-index、四层产物 |

**不写 revision，不写 `define/`。** 评估发现的问题变成 comment 或变更请求，
由 `revise` 落地——评估自己一个本体对象都不改。

## 交付物字段

`templates/cq-register.yaml`（字段对齐流程附录 E）、`templates/evaluation-run.yaml`。
写题的规则在 `knowledge/cq-writing-rules.md`，判什么算好题的维度在
`knowledge/quality-dimensions.md`。

## 这个 Skill 不做什么

- **不发明问题。** 提候选可以，放 `proposed_candidates`，等人批准再挪进 `questions`。
- **不阻断提交。** 全挂了也不拦；怎么处置由人在 `interpret` 里决定。
- **不改本体、不出新版本。** 那是 `revise`。
- **不判语义正确性。** 那是 `review` 的四轮和 `semantic_review` 决策点。
- **不把没跑过的题记成 passed。** 没有运行时就是 `unsupported`，理由写清楚。
