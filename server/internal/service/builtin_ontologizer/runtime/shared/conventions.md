# 通用约定

每个 Skill 开工前读这一份。它规定活儿在哪里干、能读什么、什么算做完。

## 1 · 工作区

**一个本体项目就是一个目录。** 没有数据库，没有服务器，这个目录就是全部。
工作区就是含有 `ontologizer.yaml` 的那个目录：当前目录，或者用户在请求里点名的那个。

```
<工作区>/
├── ontologizer.yaml   身份：slug · 领域 · 目标 · 负责人 · pins
├── history/           decisions.log（只追加）· runs.jsonl · comments.yaml
├── inputs/            人提供的原始材料。任何脚本不许往这里写。
├── define/            证据快照、FAGC 登记、访谈状态、模型卡、readiness
├── revisions/         rNNNN/（封存后只读）· HEAD · runs/
├── reviews/           review-rNNNN.yaml
├── evaluation/        cq-register.yaml · runs/
├── releases/          rel-NNNN/
└── exports/           handoff 包（脱敏、有 digest）
```

目录树的权威版本在 `shared/revision-model.md` 与 `shared/manifests/stages.yaml`。

```bash
python3 <pkg>/scripts/state.py list            # 这台机器知道的项目
python3 <pkg>/scripts/state.py status <工作区>  # 阶段、revision、等谁决定、有什么问题
```

所有脚本都显式接收工作区路径，你不必站在里面。一个都没有时，**只有 `orchestrator` 能新建**。
别的 Skill 停下来说明情况——一个自己造项目目录的 Skill，已经把审计线索弄丢了。

## 2 · 状态是推导的，不是记的

没有进度文件。`state.py status` 每次对着磁盘重算阶段（`stages.yaml` 的 `derived_phases`）。
记下来的状态会和产物分叉，推导出来的不会。

`history/decisions.log` 只追加，一次人的决策一行，竖线分隔：

```
2026-09-03T10:04:00+08:00|evidence_sufficiency|DE|proceed_with_warnings|-|软关账冲突未裁决，接受带 warning 继续
```

**决策先写日志再改状态。** 日志是审计线索，其他一切只是它的索引。写日志只能通过
`state.py decide`——它拒绝不认识的决策点和不合法的裁决词，因为日志不可回改，
一个笔误会永久留在那里，并在以后表现为"没有有效裁决"这条假消息。

## 3 · 取材范围

每个阶段在 `stages.yaml` 里声明 `read_scope`。**读了什么要如实申报**，
截断要留痕。一个越界去捞材料的步骤，产出的东西人没看过依据。

尤其：**只有 `generate` 的 `candidate` 步骤和 `evidence` 的 `register` 步骤可以联网**，
并且网络引用必须同时记 URL 和访问日期，两样缺一不可。确认与审阅那几步在人已经看过的
东西上做判断，中途去捞新材料，人批的就不是他看见的那份了。

## 4 · 开工前先澄清

每个 Skill 的第一步固定是澄清：**先读完输入，只问"答案会改变产出"的问题**，
形式是选择题 + 推荐 + 每项后果，一次问完，答案登记留档不重复问。

已经写在章程、证据登记或访谈状态里的，不要重新问。不澄清就动手只能靠猜，
猜出来的东西必须用一堆限定词包装——那正是"说了一堆听不懂的话"的来源。

## 5 · 空结果也是结论

召回是空的就说是空的。没有找到行业先例、没有冲突、没有异常路径——这些都是结论，
要报出来，不要用"未发现明显问题"含糊过去。假装有依据比没有依据危险。

## 6 · 依赖分层

Define、Review、Trace 只用标准库。`generate`/`revise` 需要本包自带的
`tools/cypher`（纯 Python）。`submit` 的 checkout 检查需要 `git`，创建 PR 需要 `gh`。
`python3 <pkg>/scripts/doctor.py` 报这台机器分阶段能跑什么。

**缺依赖是明确阻塞，永远不是悄悄降级。** 抽取路径从 native 降到 vision 也要写进
manifest 的 `extraction_path`，因为它改变了证据的可信度。

## 7 · 说话的规矩

1. 先说结论，再说依据，不铺垫。
2. 只说业务语言。不要对用户说 gate、predicate、validator、artifact 这些词；
   说「检查项」「机器门」「决策点」「交付物」「这一版」。
3. 每一步三句话内交代：做了什么 / 结果是什么 / 需要你什么。
4. 要人拍板时永远给选择题：候选 + 每项后果。**只有一个例外：Patch/Version 不给推荐**
   （见 `shared/decision-points.md`）。62 个对象不要问 62 次——按层或按类型分组，
   给整组建议，让人改例外。
5. 数字要报出处（哪一次检查、哪个 revision 算出来的）。说不出出处的数字就不说。
6. 拿不准就问。"大致""可能""建议进一步确认"这类词，通常是该问没问留下的痕迹。
