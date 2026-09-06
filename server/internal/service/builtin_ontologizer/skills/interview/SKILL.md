---
name: interview
description: 对领域专家做适应性访谈，把只存在于人脑子里的东西变成可纠正的结构化输入。围绕八项 readiness（目标、边界、用户与决策、核心对象、关键流程与事件、异常与生命周期、术语歧义、数据粒度）只问登记里回答不了的问题；分轮提问，一轮最多五题，能出选择题就不出开放题，每个选项后面写清楚选了会怎样；回答落成访谈记录与显式模型卡（实体、关系、属性、事件、角色、状态线索，每张卡带一句原话或一条显式假设）；系统猜的那部分标成 inferred，人确认之后必须变成 answered、corrected 或 skipped，skipped 要写理由。readiness 有缺口只产生警告，不阻断生成。用户说「开始访谈吧」「问我几个问题」「你还有什么不清楚的」「把缺口补一下」「这些实体卡对不对」「审批人算不算一个对象」「哪些还没问清楚」「readiness 过了吗」时就用它。凡是要从人身上取隐性知识、或要把访谈结果整理成可核对的卡片的请求都归它。
---

# interview · Define 阶段的访谈

**交付物三份：`define/interview-state.yaml`（问了什么、谁答的、原话）、
`define/model-cards.yaml`（候选对象线索卡）、`define/readiness.yaml`（八项状态）。**

开工前读 `shared/conventions.md`。访谈可以和 `evidence` 交替进行，
不必等材料全部登记完——但**每一轮之前都要先读一遍登记**，见规矩 2。

`<pkg>` 是包目录，判断标准是 `<pkg>/scripts/state.py` 存在。先试本 SKILL.md 所在目录（Enact Marketplace 安装后的布局），再试往上两级（Claude Code 插件布局）；都不是就在 skills 根目录下按 `*/scripts/state.py` 搜一遍，仍找不到停下报告，不要手写替代。`<pkg>/scripts/`、`<pkg>/shared/`、`<pkg>/tools/`、`<pkg>/knowledge/` 四个目录都在包里，下文相对路径以 `<pkg>` 为基准。

## 步骤

| # | 步骤 | 谁 | 做什么 |
|---|---|---|---|
| 1 | `prepare` | C | 读 FAGC 登记、证据快照、章程，逐项判断八项 readiness 现在能不能自己答上 |
| 2 | `ask` | **H** | 分轮提问，一轮 ≤5 题，选择题优先，答案原话记下 |
| 3 | `cards` | C | 把回答整理成模型卡，每张标出处 |
| 4 | `readiness` | S | 跑 `readiness_resolved` 与 `model_cards_sourced` |
| 5 | `confirm` | **H** | 人过一遍卡片与 readiness，把 `inferred` 全部落地 |

## 五条规矩

**1 · `inferred` 活不过确认。** 系统可以先猜一版八项 readiness 的答案，但那是猜的，
必须标 `status: inferred` 并把猜的内容原样摆出来。确认之后它只能是：

- `answered` —— 人认了，原话记进 `answer`；
- `corrected` —— 人改了，改后的说法记进 `answer`，猜的那版留在 `inferred_was`；
- `skipped` —— 人明确说这次不答，`rationale` 必填。

检查项 `readiness_resolved` 会把任何残留的 `inferred` 判失败。理由很直接：
留着它，等于把系统的猜测当成领域专家的输入喂进生成，而生成出来的对象上
不会写着"这一条是猜的"。八项各自在问什么、怎么算答完，见 `references/readiness-questions.md`。

**2 · 只问登记里答不出来的。** 章程里写过的边界不要重问，FAGC 里有锚点的事实不要重问。
已经记录过的，在 `interview-state.yaml` 里用 `kind: confirm_recorded` 指过去确认一下就行。

重问已知信息的代价不是浪费时间，是消耗信任。一个把人当资料库反复查询的访谈，
问到第三轮就没人认真答了，而真正需要他判断的那两三个问题正好在后面。

**3 · 一轮最多五题，能出选择题就不出开放题。** 选择题要带后果：
每个选项后面写清楚选了它模型会变成什么样、哪个 CQ 会答不出来。
怎么分组、怎么写选项、什么时候必须用开放题，见 `references/asking-well.md`。

**4 · 每张卡都要说得出从哪来。** `source_phrase`（引证据或访谈原话）或
`assumption_ref`（指向 FAGC 里一条真实存在的 `statement_id`），二选一必须有。
检查项 `model_cards_sourced` 核这件事，`assumption_ref` 还会去 FAGC 里查是否存在。
卡的形状与六种 `kind` 的判据见 `references/model-cards.md`，
识别启发式在 `knowledge/discovery-heuristics.md`。

**5 · 缺口是警告，不是拦路。** readiness 有洞不阻断生成——流程 §7.1 写死的。
把洞报出来、写清后果，继续与否是人的事。不要为了把八项填满而去猜，
猜出来的东西会以 `inferred` 的身份卡在规矩 1 上，绕不过去。

## 模板

- `templates/interview-state.yaml` —— 分轮记录，含 `confirm_inference` 与 `confirm_recorded` 两种问法
- `templates/model-cards.yaml` —— 六类卡各一个例子
- `templates/readiness.yaml` —— 八项，id 必须是那八个字符串

八项的 id 一个字都不能改：`goal`、`boundary`、`users_and_decisions`、`core_objects`、
`key_processes_and_events`、`exceptions_and_lifecycle`、`terminology_ambiguity`、
`data_granularity`。脚本按 id 取值，写错等于缺项。

## 命令

```bash
python3 <pkg>/scripts/validate.py <工作区> --stage interview
```

## 能读什么

| 目录 | 读 | 写 |
|---|---|---|
| `define/**` | ✅ 章程、证据快照、FAGC 登记 | ✅ 仅 `interview-state.yaml`、`model-cards.yaml`、`readiness.yaml` |
| `inputs/evidence/**` | ✅ 需要拿原文跟人对质时 | ❌ |
| `revisions/`、`reviews/`、`releases/` | ❌ | ❌ |
| 网络 | ❌ | — |

访谈答案补上了证据缺口时（比如流程图上断掉的那条线，人说了走向），
在 FAGC 里新增一条 `fact`，`source_ids` 指访谈轮次、`location` 写
`访谈 q.NNN`、`exact_snippet` 记他的原话。**那是 `evidence` 的文件，
本 Skill 只提出该补哪一条，由 `evidence` 落笔。**

## 这个 Skill 不做什么

- **不替人回答。** 猜可以，但猜出来的必须标 `inferred` 摆到台面上让他改。
- **不设计本体。** 卡片是线索，不是 candidate。卡上没有稳定 ID、没有基数、
  没有 support 链——那些是 `generate` 的活。在卡上写"基数一对多"就越界了。
- **不判断 readiness 够不够。** 报状态与缺口，是否继续由人定；
  证据充分性那个决策点属于 `evidence`。
- **不改证据登记。** 提出该补哪条 fact，落笔在 `evidence`。
- **不做一次性长问卷。** 分轮的意义在于后一轮的问题取决于前一轮的答案。
