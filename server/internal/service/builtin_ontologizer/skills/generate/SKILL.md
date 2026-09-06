---
name: generate
description: 从已确认的证据快照、事实/假设/指引/约束登记、访谈状态与模型卡生成一个不可变的 revision：按 intake → process_ir → evidential_ir → alignment → candidate → 机器门 → Cypher → 一致性检查 → 追溯索引 → 封存的顺序分阶段跑，每阶段可取消、可重试、可诊断，失败和取消的运行都留在磁盘上可回收；四层各写各的文件，证据层不许出现设计字段，映射层每条都要有两端和置信度；候选本体不止实体关系，必须建出事件、生命周期与约束，每个对象有稳定 ID、非循环的定义和至少一条能走回锚点的依据；最后由脚本跑全部检查项并写状态。Agent 跑完不等于成功——封存那一步自己跑机器门、自己写结论，所以永远不要宣布生成成功了。用户说「生成候选本体」「跑一版」「从这些材料建模」「出个 candidate」「转成 Cypher」「重跑刚才失败那一步」「取消这次生成」「这一版为什么没过」时就用它。凡是要把 Define 的产出变成一版可审阅本体的请求都归它。
---

# generate · 生成一个 revision

**交付物：一个不可变的 revision（`revisions/rNNNN/`）。** 四层文件、Cypher、
生成报告、检查结果、追溯索引，封存之后只读。

开工前读 `shared/conventions.md`、`shared/four-layers.md`、`shared/revision-model.md`。

`<pkg>` 是包目录，判断标准是 `<pkg>/scripts/state.py` 存在。先试本 SKILL.md 所在目录（Enact Marketplace 安装后的布局），再试往上两级（Claude Code 插件布局）；都不是就在 skills 根目录下按 `*/scripts/state.py` 搜一遍，仍找不到停下报告，不要手写替代。`<pkg>/scripts/`、`<pkg>/shared/`、`<pkg>/tools/`、`<pkg>/knowledge/` 四个目录都在包里，下文相对路径以 `<pkg>` 为基准。

## 十个阶段

顺序照 `shared/manifests/stages.yaml` 的 `pipeline_stages`，不能换。

| # | 阶段 | 谁 | 做什么 |
|---|---|---|---|
| 1 | `intake` | S | `revision.py new` 开目录，冻结输入 digest，开 `runs/run-NNNN/` |
| 2 | `process_ir` | C | Process 层：步骤、参与者、输入输出、决定、衔接、异常 |
| 3 | `evidential_ir` | C | Evidence 层：来源事实、术语、锚点、置信度、限制 |
| 4 | `alignment` | C | Mapping 层：每条对应带 source、target、confidence |
| 5 | `candidate` | C | Ontology 层：实体、关系、属性、事件、生命周期、约束 |
| 6 | `gate` | S | 跑 Cypher 之前的强制门（七项，不含 Cypher）；过不了不往下走 |
| 7 | `cypher` | S | 从 candidate 渲染 `candidate.cypher` |
| 8 | `conformance` | S | Cypher 静态检查：括号、标签、引用的 id 是否都声明过 |
| 9 | `trace` | S | 建追溯索引（`revision.py seal` 会自动做） |
| 10 | `seal` | S | `revision.py seal`：跑门 → 写 digest → 写 status → 通过才成为 HEAD |

每阶段的输入输出、会出什么错、失败时怎么选，见 `references/pipeline.md`。

## 四条不能商量的

**1 · Agent 跑完不等于成功。** `revision.py seal` 自己跑 `ready_for_review` 门，
按结果写 `status`（`ready_for_review` 或 `gate_failed`）。**不要宣布生成成功了。**
报的是 seal 写下的那个状态，以及没过的是哪几项。

理由：一个自称完成的生成，把"检查过了吗"这个问题从脚本手里拿走交给了措辞。
读到"生成完成，共 12 个实体"的人会以为它过了门。

**2 · 四层不许互相渗。** `process_ir` 与 `evidential_ir` 里不许出现
`entities`、`relationships`、`attributes`、`constraints`、`policies`、`capabilities`、
`bindings`、`metrics`、`domain`、`bundle`、`declarations`——顶层不行，条目里也不行。
检查项 `layer_separation` 逐个键核。最常见的一种是在一条 step 上挂 `entities:`：
读流程读着读着，顺手把设计写下来了。

`events` 与 `lifecycles` **不在**禁列里——流程 §5.3 把事件和生命周期算作 Process 层
自己的内容。两层的事件靠形状区分：流程事件说谁在哪一步做了什么，本体事件带
definition 与 support，并用 `process_ref` 指回流程那一条。见 `references/process-ir.md`。

**3 · 每个声明都要有依据。** candidate 里每个对象至少一条 `support`。
`evidence` 型要能经 alignment 落到 `evidential_ir` 里一条带 `location` 与
`exact_snippet` 的事实上；落不到就改挂 `assumption`，再不行就删掉这个对象。
检查项 `trace_complete` 走这条链。「看起来应该有」不是依据。

**4 · 要建行为，不能只建名词。** candidate 至少一个 event 和一个 lifecycle，
否则 `behaviour_present` 报警告。只有实体和关系的本体能回答"这是什么"，
不能回答"在什么条件下可以做什么"——而后者才是 Agent 要用的那一半。
这个域确实没有状态变化时，在生成报告里写明理由。

## 四层各写什么

| 层 | 文件 | 参考 |
|---|---|---|
| Process | `process_ir.yaml` | `references/process-ir.md` |
| Evidence | `evidential_ir.yaml` | `references/evidential-ir.md` |
| Mapping | `alignment.yaml` | `references/alignment.md` |
| Ontology | `candidate.yaml` | `references/candidate.md` |

建模判据不在这里重复：构件类型看 `knowledge/ontology-components.md`，
八条建模规则看 `knowledge/modeling-rules.md`，识别启发看
`knowledge/discovery-heuristics.md`。

## 模板

`templates/process_ir.yaml`、`templates/evidential_ir.yaml`、
`templates/alignment.yaml`、`templates/candidate.yaml`。
字段名照抄，脚本按名字取值。

## 命令

```bash
PKG=<pkg>; WS=<ws>
python3 $PKG/scripts/revision.py new $WS --reason "首次生成" --by <你>
# → 写四层文件到 revisions/rNNNN/

python3 $PKG/scripts/validate.py $WS --gate candidate_ready --revision rNNNN
# 七项全过才往下走

python3 $PKG/tools/cypher/run.py $WS rNNNN        # 渲染并静态检查 candidate.cypher

python3 $PKG/scripts/revision.py seal $WS rNNNN   # 建索引 → 跑 ready_for_review → 写状态
```

`candidate_ready` 是 Cypher 之前的强制门（流程 §5.2），七项，不含 Cypher。
封存时跑的是 `ready_for_review`，在那七项之外再加 `cypher_generated_and_parses`
和 `reproducible`。**真正算数的是 `seal` 里跑的那一次**——它自己写 `status`，
你不替它宣布结果。

## 能读什么

| 目录 | 读 | 写 |
|---|---|---|
| `define/**` | ✅ 全部四份加快照 | ❌ |
| `revisions/**` | ✅ 父 revision，用于 id 稳定性比对 | ✅ 仅本次的 `rNNNN/` 与 `runs/` |
| `ontologizer.yaml` | ✅ pins | ❌ |
| `inputs/`、`reviews/`、`releases/` | ❌ | ❌ |
| 网络 | ✅ 仅 `candidate` 一步，且 URL 与访问日期都要记 | — |

封存之后目录只读。要改就开新 revision，不要就地改——
`revision_sealed_immutable` 会把改动报出来，而那时候已经没人知道改了什么。

## 失败与取消

blocking 失败给 `diagnose` 和 `retry`；取消时问保留还是丢弃已完成阶段。
失败和取消的运行都留在 `revisions/runs/` 下，可诊断、可恢复、可导出，
**永远不悄悄删掉**。时间线显示真实阶段状态与已用时间，
**不显示完成百分比**——一个编出来的 73% 比什么都不显示更糟。
详见 `references/failure-recovery.md`。

## 这个 Skill 不做什么

- **不宣布成功。** 状态由 `seal` 写，本 Skill 只转述。
- **不做语义审阅。** 对象对不对是 `review` 的四轮和人的处置，这里只保证结构成立。
- **不改 Define 的产出。** 生成时发现证据有问题，报出来回 `evidence`，不就地改。
- **不修订。** 已封存的 revision 上落审阅意见是 `revise` 的活。
- **不选候选发布。** 那是 `candidate_selection` 决策点，人定。
- **不显示假进度。**
