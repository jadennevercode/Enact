---
name: sdlc-intake
description: Use when a new piece of work needs registering, or for any status question answerable by reading the ledger back without deciding anything - however many items it covers. Triggers include a fresh feature request, bug report or change request with no Work Item yet, and 到哪了 / 卡在哪 / 谁在等我决定 / 还差什么证据 / 本周有什么风险 / 现在有哪些活在跑 / 最近交付得怎么样. Any "why is this not moving, who is holding me up, what is it waiting on" question also starts here - reading a blocker off the record is still a read-out, and the user need not have worked out the cause before asking. Also use before any other sdlc-* skill when .sdlc/ does not exist yet. This skill reports; it never ranks items, accepts a deliverable or closes an item out, and hands off to sdlc-orchestrator only once a blocker is known to be another work item needing resequencing. Not for clarifying what a request means (sdlc-explore), acceptance criteria (sdlc-contract), doing the work (sdlc-build), or a live production problem (sdlc-operate).
---

# SDLC Intake —— 开单与报账

这个环节只做两件事：让每一件工作**有编号、有责任人、有状态**；以及在任何时刻回答**"到哪了"**。

它的价值在于"隐形项目管理"——登记这个动作自动发生，用户不必学任何工具；但被管理的对象是真实文件，可以随时被追问、被 diff、被审计。相对地，没登记的工作在两周后就只存在于某个人的记忆里。

Intake 不涉及三条铁律中的任何一条，也没有正式 Gate。它是轻的：**登记一件新工作正常应在一轮交互内完成**。

## 先分清是哪条路径

| 用户在说 | 走哪条 |
|---|---|
| 描述一件想做的事、一个要修的缺陷、一个要加的能力 | **A. 登记** |
| 问进度、问卡点、问谁在等、问风险、问证据缺什么 | **B. 报账** |
| 描述一件事，但明显是在追问一件已登记的工作 | 先 B 确认，再决定要不要 A |
| 要在记录之间**下一次判断**：谁先做、记录对不对、某环节能不能交、这单收尾 | **交给 `sdlc-orchestrator`** |

最后一行的判据是**读出来 vs 做判断**，不是涉及几个 WI。
「现在有哪些活在跑」涉及一批 WI，但仍然只是把账本读回来——本环节；
「谁先做」要在它们之间排序，那是一次判断——orchestrator。

**追因也在本环节**——「谁卡着我」「这事为啥推不动」要的是把 `blocked_by` 读出来，那仍然是读出来，
不是例外。用户提问时并不知道原因是依赖别的 WI 还是等人签字，不该要求他先归因才能问对人。

**转交的时点在阻塞源已知之后**：确认卡在另一个 WI 上、且现在要重排这两者的先后，才转 orchestrator。

---

## 输入：读什么

**必读**（两条路径都要）：`.sdlc/config.yaml`（`roles`、`quick_lane_criteria`、`data_policy`）、
`.sdlc/current.yaml`、`wi_status.py` 的输出。登记路径再加 `.sdlc/lessons/` 与同模块已完成 WI。

**可发现范围**：项目代码与 `docs/`，只为把 objective 与 trigger 写准，默认不读——
问用户一句比读十个文件便宜，而且读来的理解不构成任何下游依据。

**扩展规则**：确需读白名单外的内容时受 `config.yaml` 的 `context_budget` 约束（来源文件上限、
超过 `max_doc_age_days` 的文档注明可能已过期）；命中 `data_policy.never_read` 的一律不读。
版本固定见 A4 的 `capability_bundle_pinned`。

---

> **`$CORE` 指 sdlc-core 的 Skill 目录**。Bash 的工作目录是项目根，
> 所以每个会话第一次跑脚本前按 Codex/Enact、项目级、用户级的顺序解析一次：
>
> ```bash
> CORE=""
> if [ -n "${CODEX_HOME:-}" ] && [ -d "$CODEX_HOME/skills/sdlc-core" ]; then
>   CORE="$CODEX_HOME/skills/sdlc-core"
> else
>   for candidate in ./.agents/skills/sdlc-core ./.claude/skills/sdlc-core ~/.codex/skills/sdlc-core ~/.claude/skills/sdlc-core; do
>     if [ -d "$candidate" ]; then CORE="$candidate"; break; fi
>   done
> fi
> if [ -z "$CORE" ]; then
>   echo "sdlc-core Skill 未找到；请先挂载或导入 sdlc-core，然后停止当前任务。" >&2
>   exit 2
> fi
> ```

## A. 登记新工作

### A0. 确认地基

`.sdlc/` 不存在就先建：

```bash
python3 "$CORE/scripts/sdlc_init.py" .
```

幂等，已存在只报告现状。同时读一眼 `.sdlc/config.yaml`：`roles` 里如果 Gate 要求的角色没有人担，现在提出来——后面每个 Gate 都按角色要求签署，签不下去就卡住。**一个人可以担多个角色**，小团队照实写多个即可。

### A1. 先看有没有重复

**在开单之前**跑一次：

```bash
python3 "$CORE/scripts/wi_status.py" --root .
```

判断规则：**看的是结果，不是模块。** 两个请求指向同一个可观测的结果变化，就是同一个 WI；同一个模块但要改变的结果不同，是两个 WI。

| 情形 | 处置 |
|---|---|
| 已有 WI 目标相同，且未 Completed | 不新开。把新信息补进那个 WI 的 objective 或 notes，告诉用户它现在在哪个阶段 |
| 已有 WI 目标相同但已 Completed | 新开一个，并在 notes 里写明"承接 WI-0XX 的后续" |
| 目标不同，只是碰同一批文件 | 新开。文件重叠是 build 的 change-scope 要处理的事，不是开单的理由 |
| 拿不准 | 问（见"什么时候问"） |

顺带做一件便宜的事：如果 `.sdlc/lessons/` 或同模块的已完成 WI 里有相关记录，在开单时点一句"上次这块踩过 X"。经验传递的成本在这里最低。

**但说出口之前，先判断那条记录属于哪一档**——记忆层级，完整定义见 `../sdlc-core/references/objects.md` §9：

| 档 | 在这里能翻到的东西 | 引用规则 |
|---|---|---|
| `released` | `lesson.status: observed` 的已发布经验；`Completed` 的 WI 的 approved contract 与 Evidence Case | 可以当事实直接引用 |
| `current work` | 活跃 WI 的产物（exploration、contract draft、ledger） | 可以引用，但要带 WI 编号说明它还在进行中 |
| `experimentation` | **未发布的 LP**（observe / classify / validate 阶段）、`open_decisions.status: accepted` 这类带风险接受的决定、exploration 里的假设 | **必须标注为假设，不得写成事实** |

红线 4.2 拦的是"未验证的经验自动变成标准"，拦不住另一条更隐蔽的路径：未验证的经验以"上次这块踩过 X"
的形式，在下一单开单的第一分钟就被当成既定事实接受下来。开单这一刻正是这条泄漏路径的入口。

✅ `LP-004 观察到退款金额可能按订单全额计——它还在验证中没发布，算假设，本单要自己确认一遍`
❌ `退款金额按订单全额计，上次已经确认过了`（把 experimentation 档说成了事实）

### A2. owner 必填

`new_work_item.py` 的 `--owner` 是必需参数，这不是脚本设计上的偶然。

**没有 owner 的工作最终没有人验收。** 状态机把 `Exploring` 的转入条件写成"owner 已填"，就是因为：探索会产生假设和未决问题，未决问题需要有人拍板；契约需要有人批准；发布需要有人签字。这条链的第一环如果空着，后面每一环都会退化成"AI 说行就行"——而那正是整个套件要防的事。

owner 是**这件工作的负责人**，不必等于将来签 Release 的人。用户自己说"我来"就填用户的名字。

### A3. 定 lane

本环节维护两组**受控词表**，取值不接受变体——`wi_status.py` 与 `metrics.py` 都按字面匹配：

| 字段 | 取值 | 定义在 |
|---|---|---|
| `lane` | `full` / `quick` | 本节 |
| `status` | `Proposed` / `Exploring` / `Contracted` / `Planned` / `Executing` / `Verifying` / `Decision` / `Completed` / `Held` / `Cancelled` | `../sdlc-core/references/state-machine.md` |

intake 只负责把 `status` 置为 `Proposed`（建单）；其余状态由各自的出口环节改。**不要替下游改状态**——
状态是别人判断能否接手的依据，提前置位会让接手的人以为前一环节的出口动作已经做完了。


读 `.sdlc/config.yaml` 的 `quick_lane_criteria`，逐条对照。**四条判据全部成立才是 quick**，有一条不成立或说不准，就是 full。

默认项目的判据是：单点缺陷修复且不涉及接口或数据结构变更 / 变更范围 3 个文件以内 / 无新增依赖 / 有明确可验证的期望行为。

不确定时选 full。理由不对称：quick→full 的升级随时可做且不损失任何东西；full→quick 的降级要说明理由并记入 notes，而中途才发现"这事其实不小"通常意味着已经按 quick 的粗糙度做了几步。

**quick 省的是篇幅，不是责任链**——contract、change-scope、Release 决定与 Gate 记录一样都要有。这一点在告知用户 lane 选择时说清楚，避免他以为 quick 是"不走流程"。

### A4. 建单

```bash
python3 "$CORE/scripts/new_work_item.py" . "<objective>" --owner <人名> --lane <full|quick> --slug <短名>
```

编号、目录、模板实例化、`current.yaml` 指针全部由脚本完成。**不要手工建目录或自己数编号**——重号和漏文件是这类操作的典型产出。

**`--slug` 要自己给。** 不给时脚本从 objective 截，中文没有空格，截出来的是半句话
（`WI-001-优惠券在过期后不能再被使`），之后每条路径引用都拖着它。给一个 2–4 个词的短名：
`coupon-expiry`、`退款拆分`。

objective 写"要改变什么结果"，一到两句，不是任务清单：

✅ `退款报表能按门店维度拆分，财务不用再手工透视`
✅ `修复导出 CSV 在金额为负时丢失负号`
❌ `改 exporter.py，加一个 store_id 参数，然后更新前端筛选器`（这是任务，属于 contract 和 build）
❌ `优化报表模块`（说不出改变了什么结果，验收时无法判断做没做到）

建单后追加一条 Evidence Event（格式见 `../sdlc-core/references/evidence.md`）：

```bash
python3 -c "
import json,datetime
e={'ts':datetime.datetime.now(datetime.UTC).strftime('%Y-%m-%dT%H:%M:%SZ'),
   'actor':'sdlc-intake','action':'work_item_created',
   'input_refs':[],'output_refs':['work-item.yaml'],'result':'ok','notes':'lane=full'}
open('.sdlc/work-items/WI-00X-slug/evidence.jsonl','a').write(json.dumps(e,ensure_ascii=False)+'\n')"
```

再追加一条 `capability_bundle_pinned`，`input_refs` 填 `../sdlc-core/templates/work-item.yaml` 的路径 + git hash。
本 WI 后面每个环节都以这一版模板为基准；模板半年后会改，没有固定版本就只能拿今天的模板去审当时的产物。

### A5. 补两个脚本填不了的字段

`new_work_item.py` 把编号、目录、模板都建好了，但 `work-item.yaml` 里有两个字段只有此刻的对话里有答案。

**`trigger`——这件事因为什么发生。** 客户投诉、事故 INC-###、路线图承诺、复盘结论，写具体是哪一个。
它回答的是"为什么是现在"。三个月后没有人记得起因，而那时恰恰需要它来判断这单还该不该做——
一个由已经关闭的事故触发的 WI，和一个由季度承诺触发的 WI，在排期会上的命运完全不同。

✅ `trigger: 客户 A 8-18 投诉月度对账要手工透视，客服转来的第 3 起同类反馈`
✅ `trigger: INC-014 复盘结论第 2 条`
❌ `trigger: 用户提的`（等于没写，三个月后从它推不出任何东西）

**`dependencies`——WI 之间的结构性先后。** 只在多个 WI 并行且互相牵制时填，写 `WI-###`。

它和 `blocked_by` 说的是两件事，混用会让两边都失效：

| | 说的是 | 什么时候有值 | 靠什么解开 |
|---|---|---|---|
| `dependencies` | **结构性先后**：前置没完成，这件事根本做不了 | 开单时就知道，整个生命周期基本不变 | 靠前置 WI 自己往前走 |
| `blocked_by` | **当前实际卡在谁那里** | 只在 `status: Held` 时有值 | 靠具名的那个人做一个具体动作 |

一个 WI 可以有 dependencies 而不 blocked（前置还在跑，本单也还在做自己的前半段），
也可以 blocked 而没有任何 dependencies（等一个人签字，与别的 WI 无关）。只记 `blocked_by` 的后果很具体：
报账时给不出正确的推进顺序，"本周有什么风险"也会漏掉一整类——
"WI-005 自己一切正常，但它等的 WI-003 已经停了 9 天"。

### A6. 交接给下一个环节

告诉用户三件事：编号、owner、下一个 Skill。full lane 下一步是 `sdlc-explore`；quick lane 直接进 `sdlc-contract`（脚本的 `next_step` 字段已经给出这句话）。

**不要顺手开始探索或写 criteria。** 那是下一个环节的事，它有自己的维度清单和交互协议；在 intake 里草草做掉，等于跳过了那些清单。

---

## B. 报账：回答"到哪了"

```bash
python3 "$CORE/scripts/wi_status.py" --root .            # 全部
python3 "$CORE/scripts/wi_status.py" --work-item WI-002  # 单个
python3 "$CORE/scripts/wi_status.py" --blocked-only      # 只看有事要办的
```

**JSON 是原料，不是答案。** 用户问"到哪了"，想知道的是五件事：

1. **我们在做什么** —— objective，用人话，不是状态名
2. **依据什么** —— 当前生效的 contract 版本、谁批准的、什么时候
3. **谁要决定** —— 具体的人名和具体的事，不是"待人工确认"
4. **卡在哪 / 下一步是什么** —— 可以立刻去做的动作
5. **最终改变了什么** —— 已完成的 WI 要说得出结果。"做完了"不是答案

对照示例：

❌
```
WI-002 状态 Verifying，lane=full，artifacts_present 包含 Contract、Build Evidence、Test Plan，
awaiting_human_approval: ["release"]，pending_amendments: []。
```
（复述了字段，没回答任何一个问题。用户还得自己翻译一遍。）

✅
```
**WI-002 退款报表按门店拆分** —— 代码写完了，在独立验证阶段。

- 依据：contract.yaml v1，张三 8-19 批准，4 条 criteria
- 进展：build 已完成并交出 build-evidence；test-plan 覆盖了 criteria 1.1、1.2、3.1
- 卡点：criteria 2.1（退款为负时的显示）没有对应的 Test Intent。要么 QA 补一条，
  要么这条 criterion 本身写不清楚——那要提 Amendment 回 contract
- 等你：现在不用。下一次需要你签字的是 Release 决定，Release Authority 是李四
- 下一步：跑 sdlc-qa 补 2.1 的测试设计
```

### 第五问：已完成的 WI 到底改变了什么

前四问是给在跑的工作的，第五问是给已经收尾的。**"做完了"只说明流程走完了**，
没说明当初要改变的那个结果究竟变没变。这一问长期答不上来的项目，半年后无法解释这一串工作换来了什么，
而那时人们会开始怀疑这套流程本身。

答案的来源都在 WI 目录里现成，不需要推断：

| 问的是 | 读哪里 |
|---|---|
| 当初要改变什么、实际改变了什么 | `evidence-case.md` §1 的 outcomes 原文 |
| 承诺的每一条兑现了没有 | `evidence-case.md` §2 Contract 覆盖表（逐条 criterion + 结果 + 证据） |
| 留下了什么已知问题、谁接受的 | `evidence-case.md` §6 已知例外 |

✅
```
**WI-002 退款报表按门店拆分** 已完成，8-23 发布。

- 改变了什么：财务月度对账不再需要手工透视，原来每月约 4 小时的手工步骤取消了（outcome O1）
- 承诺兑现：4 条 criteria 全部通过，其中 2.1（负数金额显示）由王五人工确认
- 留下的：企业版超过 10 万行的导出仍走旧路径，张三接受了这个例外，记在 evidence-case §6
```

❌ `WI-002 已完成。`

还没走到 Release 的 WI 没有 evidence-case.md，那就直说"还没有结果，当初的目标是 X"。
**不要拿 build-evidence 里的"改了哪些代码"冒充"改变了什么结果"**——那是两个层次的东西，
把前者报成后者，与"从 git log 推断进度"是同一种失真。

### 多个 WI 时怎么组织

按"需要人动手的程度"排，不按编号排：

1. **需要你现在处理**：`status: Held`、缺具名批准的 Gate、未处置的 Amendment、缺 owner 的 WI。每条写清等谁、等什么、多久了（用 `blocked_by.since` 算天数——停了 9 天的阻塞和昨天刚记的阻塞是两回事）
2. **在跑**：一句话说清各自在哪个阶段、下一步是什么
3. **已完成 / 已取消**：给个数。这批里有刚发布的，或者用户问到某一单，按第五问给出结果而不是状态名

同一段之内，有 `dependencies` 关系的按前置在前排序。否则把一个做不动的 WI 排在了它的前置前面，
用户会照着列表去推一件根本推不动的事。

`wi_status.py` 的 `needs_attention` 数组就是第 1 段的原料，但**要把它翻译成人能直接行动的句子**：`"WI-003 的 release 缺具名批准"` → `"WI-003 的证据已经齐了，就差李四做 Release 决定——这单从 8-14 起就停在这里"`。

### "本周有什么风险"

这类问题问的不是状态，是**停滞**。四类信号：`Held` 且 `since` 较久的、缺批准超过几天的 Gate、
`updated` 很旧但状态不是终态的、以及**依赖阻塞**（自己正常但前置 WI 停住了）。

第 4 类 `wi_status.py` 不输出，要自己读 `dependencies` 把链连起来——**漏掉它的后果是
报账听起来一切健康，实际上一条链上的三个 WI 全在等同一个人**。四类的判据与呈报方式见
`references/metrics-reporting.md` 的「停滞怎么看」。

### 度量：交付得怎么样、哪里最卡

用户问的是趋势而不是某一单的状态时，跑 `"$CORE/scripts/metrics.py"`，把八项指标翻译成人话。

**一条不可协商的原则**：这些数字描述的是**交付系统**，不是某个人。返工多通常意味着 contract 没写清楚，
那是上游问题；Gate 等待长通常意味着批准人负载过高，那是排班问题。
**不得用任何一项推导个人绩效、不得按人拆分**，也不得用 token 消耗或 AI 使用率替代它们——
后者衡量的是"用了多少 AI"，与"交付得好不好"无关。用户要求按人排名时，说明这条原则并给出按环节的拆分替代。

**REQUIRED**：指标口径、调用方式、❌ 裸 JSON vs ✅ 人话翻译的成对示例，见 `references/metrics-reporting.md`。

### 找不到依据时

`wi_status.py` 只读文件，读不出来的东西就是不存在。产物缺失就说缺失，**不要从代码或 git log 推断进度**——"看起来实现了"和"有批准的 contract 与通过的验证"是两码事，把前者报成后者，正是这套流程要防的失真。

---

## 什么时候问，什么时候不问

本环节问得少，所以**不走 `../sdlc-core/references/interaction.md` 的完整三段式**——
议程先行是为了让用户看清一场长对话的形状，而登记环节最多问三题，摆议程比直接问还慢。
但那份协议里跟长度无关的两条照样适用：**每题带选项与推荐项**，**答完给回执逐题点名**。

使用当前运行时提供的结构化提问或用户输入接口，**只在这三种情况下问，且一轮问完**：

| 情况 | 怎么问 |
|---|---|
| owner 不明 | 给出候选（用户本人、config.yaml 的 `roles` 里的人）+ "待定"选项。选了待定就把 WI 留在 Proposed 并说明它不能往下走 |
| 疑似重复工单 | 把疑似的那个 WI 的 objective 和当前状态摆出来，让用户选"就是它"/"另开一单" |
| lane 判据有一条说不准 | 说明是哪一条说不准（例如"会不会动到接口"），给 full/quick 两个选项并标注推荐 full |

其余一律不问。objective 措辞、slug、要不要写 external_refs——这些自己定，用户不满意会说。

---

## 工具边界

| 面 | intake 的声明 |
|---|---|
| **可读** | `.sdlc/` 全部；项目代码与 `docs/` 可读，但**只用于把 objective 与 trigger 写准**，不用于下任何判断 |
| **可写** | 只写 `.sdlc/`：本次新建的 `work-items/WI-###-slug/` 与 `current.yaml`（都由脚本写入）、`evidence.jsonl` 的追加行 |
| **受保护** | `.sdlc/config.yaml` 由人维护——`roles` 缺人时提出来请人补，**不自己填一个名字**；`config.yaml` 的 `data_policy.never_read` 命中的路径**连读都不读**，`protected_paths` 管的是不可写，它拦不住把一个 `.pem` 读进上下文 |
| **禁止动作** | 任何业务代码、配置、测试文件的改动；手工建 WI 目录或自己数编号；`tool_actions.always_forbidden` 里的动作（deploy / push / publish / db-migrate） |
| **升级条件** | owner 说不准 / 疑似重复 / lane 判据有一条说不准 → 见"什么时候问"；`.sdlc/` 存在但结构不完整 → 停下来报告，不代替别的环节修它的产物；用户要求按人给绩效数字 → 说明为什么不给 |

intake 阶段**还没有 change-scope**，也就没有任何"批准过的写入范围"——此时的所有代码改动都在范围外，
不存在"这个改动很小所以还好"的情况。

**命令类别白名单**——本环节只跑这三类：

| 类别 | 具体命令 |
|---|---|
| `sdlc-init` | `sdlc_init.py`（幂等，已存在只报告现状） |
| `sdlc-read` | `wi_status.py`、`metrics.py`（只读，不改任何文件） |
| `sdlc-write` | `new_work_item.py`，以及追加 `evidence.jsonl` 一行的 python |

`git` 只用只读子命令（`log` / `show` / `status`）确认现状。**不跑 lint / test / build**——
那是 build 与 qa 的类别，intake 跑它们既没有授权，也不产生本环节需要的任何判断。
环境与凭据：全部命令跑在 local，`credentials: none`。intake 需要凭据本身就说明走错了环节。

---

## Runtime 与配置来源

当前编码 Agent 会话（Claude Code、Codex，或由 Enact 管理的 Runtime）就是本环节 Runtime。本环节**不起 subagent**：登记与报账都是单轮、低上下文的工作，
编排成本高于收益；更实际的原因是 subagent 拿不到刚才那轮对话里用户说的"owner 是我"。

告知用户某条限制时说清它来自哪一层——"这是项目定的"和"这是我的判断"是两句分量不同的话：

| 这条约束 | 来自哪一层 |
|---|---|
| `roles` 与各 Gate 的 `require`、`quick_lane_criteria`、`protected_paths`、`data_policy`、`tool_actions` | `.sdlc/config.yaml` 项目级 |
| 状态机允许的流转、模板字段 | `../sdlc-core/`（全套件级） |
| lane 判断、objective 措辞、是否疑似重复 | 本次会话的判断，可以被用户推翻 |

并发：一次只处理一个登记请求。用户一口气说了两件事，就顺序建两个 WI，**不要合并成一单**——
合并的那一刻这两件事就失去了各自的 objective 与验收边界，而它们后面还要各自被验收。

---


### 出口评审：交给 业务负责人

本环节没有 Gate，但**不等于没有人看过**。建单后把 objective / owner / lane 交给
`phase_review.intake` 的角色（默认 **业务负责人**）确认「这是不是该做的事，框对了吗」，
然后追加 `{"action": "phase_reviewed", "actor": "<真名>", "notes": "intake · 业务负责人 · ok"}`（有缺口写 `gaps：…`）。
**这不是 Gate**：不阻塞、无四值词表，只回答"有没有人真的看过"；缺了 audit 报 `phase-not-reviewed`。

## 交接与 Lesson 候选

**短期状态**：本轮对话里用户说的 owner、lane 判据的口头理由。会话一结束就没了——所以必须在这一轮写进 `work-item.yaml`。
**长期事实**：`work-item.yaml` 本身、`evidence.jsonl` 的 `work_item_created` 与 `capability_bundle_pinned`。

**向 sdlc-learn 交出什么**——这一面要双向声明，只有 learn 说"我要来取"而产地不说"我要交"，这条链就是断的：

| 观察到 | 为什么是 Lesson 候选 |
|---|---|
| 同一类工作反复开单（三次以上同模块、同类型的 WI） | 有一个结构性问题一直没被处理，每次都当成新工作重做一遍 |
| 反复缺 owner，开单时没人认领 | 这一块的责任归属本身是模糊的，靠每次追问解决不了 |
| 反复被判成重复工单 | 请求入口处缺一个共识，或者 objective 的写法让人认不出这是同一件事 |
| `metrics.py` 显示 Gate 等待或返工持续偏高 | 数字指向的是流程环节，不是人 |

按 sdlc-learn 的 Observe 阶段登记候选，来源写具体的 WI 编号。**不要自己改任何模板、清单或 Skill 文件**——
只有 sdlc-learn 拿到 `gates/lesson-approval.yml` 之后才可以（红线 4.2）。

---

## Done When

- [ ] `.sdlc/` 存在；`config.yaml` 的 `roles` 里各 Gate 要求的角色都有人（没有则已明确提出）
- [ ] 开单前跑过 `wi_status.py`，确认不是重复工单
- [ ] WI 目录由 `new_work_item.py` 创建，`current.yaml` 指向它
- [ ] `owner` 是具名的人（不是 "TBD"、不是 "AI"）；若留空，已明确告知用户这单不能进入 Exploring
- [ ] `lane` 已定，且判据成立；quick lane 已说明"省篇幅不省 Gate"
- [ ] `evidence.jsonl` 有一条 `work_item_created`
- [ ] 已告知下一个 Skill 是哪个
- [ ] `trigger` 已填，写的是具体那一件事（不是"用户提的"）
- [ ] 多 WI 并行且互相牵制时 `dependencies` 已填，且没有和 `blocked_by` 混用
- [ ] 引用 `.sdlc/lessons/` 或历史 WI 时判断过记忆层级，experimentation 档的内容标注成了假设
- [ ] 状态查询的回答里有具体人名和可以立刻去做的下一步，而不是状态名的罗列
- [ ] 五问都答到了；已完成的 WI 说得出最终改变了什么（引 `evidence-case.md`，不是"做完了"）
- [ ] 给过度量数字时，说明了它们描述的是交付系统而非个人，且没有按人拆分
- [ ] 九个配置面都能在正文里指认出落点
