---
name: sdlc-explore
description: Use when clarifying what a piece of work actually needs before any contract or code exists - analyzing a requirement, mapping unknowns, hunting for edge cases and exception paths, checking which assumptions are safe, sorting out what is in and out of scope, or when someone asks to clarify the requirement, do requirement analysis, work out the boundaries, or says the request is still vague or underspecified. Also use when a Work Item enters Exploring, or when a later phase hands back a gap that needs re-exploration. Not for registering a request, assigning an owner or reporting status (that's sdlc-intake), and not for writing acceptance criteria, contract.yaml or its design and boundary blocks (that's sdlc-contract).
---

# SDLC Explore — 系统化发现缺口并收敛

**这个环节的价值在于系统化提问和收敛，不是自动写一份长 PRD。**

一份 AI 生成的长需求文档看起来很完整，但它的完整是靠填充生成的：不知道的地方被写成了合理的句子，读的人分辨不出哪句是查到的、哪句是编的。Explore 要做的恰恰相反——把"我们知道什么、不知道什么、假设了什么"三者分开摆出来，然后只在真正影响决策的地方打断人。

产物是 `exploration.md`，一份不长但每行都站得住的记录。

## 输入：读什么

**Seed（必读）**——读三样东西，不要多读：

- `.sdlc/work-items/WI-*/work-item.yaml` —— objective、owner、lane。**owner 为空时不要开始**，先回 sdlc-intake 补齐（状态机规定 owner 已填才能进 Exploring）。
- `.sdlc/config.yaml` 的 `explore_dimensions` —— 本项目启用了哪些维度。
- `exploration.md`（若已存在）—— 这可能是第二轮探索，别把上一轮的结论重问一遍。

**可发现范围**：代码库、docs/、git log 全都可查——事实盘点靠的就是它。读得宽是本环节的工作方式，
不是例外。`read_excluded`（继承 `data_policy.never_read`）之外没有其他读限制。

**扩展规则**：探索中发现需要读别的东西，直接读，不需要确认。这一步产出的是理解，不是变更。

然后把 WI 状态置为 `Exploring`。

## 工作流

### 第一步：事实盘点（在提问之前）

**能从代码和文档自行确认的，绝不问用户。**

这是本环节最能体现价值的一步。用户找你来是因为他不想把已经写在代码里的东西再口述一遍；问他一个他本可以不用回答的问题，是在花他的时间买你的懒惰。而且他的口头回答未必比代码准确——人会记错版本、记错默认值、记错谁在调用。

按 objective 涉及的领域去查：相关模块、接口定义、数据模型、既有文档、git log 里的近期变更。每条确认的事实写进 `exploration.md` §1，**带来源**。

✅ 有来源的事实：

| # | 事实 | 来源 |
|---|---|---|
| F1 | 退款单当前只有 `amount` 一个金额字段，无手续费拆分 | `src/models/refund.py:31-48` |
| F2 | `/api/v2/refunds` 有三个外部消费方（对账、客服后台、财务导出） | `docs/api-consumers.md#refunds`、`git grep 'api/v2/refunds'` |

❌ 无来源的断言：

| # | 事实 | 来源 |
|---|---|---|
| F1 | 系统采用标准的退款流程 | |
| F2 | 应该有幂等保护 | 一般都会有 |

第二张表里的两行没有一行是事实。第一行是废话，第二行是假设——它该写进 §3 Assumptions，或者花 30 秒 grep 一下变成真事实。**查不到来源就不要写进事实表**（红线 4.3）。

#### 翻历史资料时先判记忆层级

事实盘点会翻到 `.sdlc/lessons/` 和历史 WI 的产物。**引用它们之前先判断它属于哪一档**——三档定义见 `../sdlc-core/references/objects.md` §9：

| 层级 | 你在这里会读到什么 | 能怎么引用 |
|---|---|---|
| `released` | `contract.status: approved`、WI 状态 `Completed`、`lesson.status: observed` | 当事实直接引用，来源写产物路径 |
| `current work` | 活跃 WI 的 exploration / contract draft / ledger / test-plan | 可以引用，但要带 WI 编号说明它还在进行中 |
| `experimentation` | 别人 `exploration.md` §3 的假设、`open_decisions.status: accepted`、仍处于 observe/classify/validate 的 LP | **必须标注为假设，不得写成事实**——它进 §3 Assumptions，不进 §1 事实表 |

红线 4.2 拦的是"未验证的经验自动变成标准"。它拦不住一条更隐蔽的路径：上一个 WI 里一条从没被确认过的假设，以"上次这块是这么处理的"的形式进了你的 §1，从此它就是事实了。事实表要求带来源，而这条**来源确实存在**——没有第二个人会再去查那个来源本身是不是事实。

✅ 继承一条 experimentation 档的内容：

> §3 Assumptions —— A2：退款金额按订单全部退款计。**继承自 WI-001 exploration.md §3 的假设 A2，该假设从未经财务确认**（experimentation 档），本次沿用。如果错了：对账口径全错，已产生的数据需重新迁移。

❌ 同一条内容写进事实表：

| # | 事实 | 来源 |
|---|---|---|
| F3 | 退款金额按订单全部退款计 | `WI-001/exploration.md#3` |

引用格式完全合规，这正是它危险的地方。被引用的那一行是假设，跨过一次 WI 边界之后它变成了"有出处的事实"，再往下游就没人能把它认回来了。

每确认一条重要事实，向 `evidence.jsonl` 追加一条 `fact_confirmed`，`input_refs` 指向来源文件。写法见 `../sdlc-core/references/evidence.md`。

### 第二步：选维度

十个探索维度：Outcome & value / Stakeholder & journey / Scope & behavior / Data & semantics / Integration & compatibility / Architecture & NFR / Security & compliance / Operations & SLA / Acceptance & rollout / Constraints & decisions。

`config.yaml` 决定哪些维度启用，本次 WI 的性质决定哪些需要深挖。**这是一份按需取用的清单，不是问卷**——系统维护的是 coverage map，不是"每个维度都问一遍"的执行记录。

**REQUIRED**：读 `references/dimensions.md`，里面逐个维度写了核心问题、典型问题、什么信号说明这个维度有风险要深挖、什么情况可以判"不适用"。不要凭印象展开维度。

一个维度判"不适用"是完全正当的结论，但**必须带理由**。coverage map 里写"不适用"而理由栏空着，等于没人想过这件事——那比未决更危险，因为它看起来已经处理完了。

### 第三步：只问缺失的高价值问题

事实盘点之后剩下的缺口，按"这个答案会改变什么"排序。只有会改变 scope、数据语义、接口契约、验收方式的缺口值得打断人。

**REQUIRED**：读 `../sdlc-core/references/interaction.md`。澄清提问的协议定义在那里，
本环节是它最主要的使用场景。要点复述如下，细节与理由以那一份为准：

1. **议程先行。** 缺口排完序之后，先把**完整的问题清单**亮出来（每条写清影响面），
   再开始问第一题。用户看不到全貌就无法判断先答哪个——第 3 题的答案常常取决于他对第 5 题的倾向。
   议程**先写进 `exploration.md` §5，再出现在对话里**。
2. **成批问，一轮 ≤4 题**，同一主题的放一轮。用户在一条消息里答完整批是正常的。
3. **每题给 2–5 个选项，标注推荐项。** 开放式问题把设计负担推回给用户；选项让他做的是判断而不是撰写。
4. **每题说清三件事**：各选项的影响、这个信息的来源（或"查不到"）、以及**为什么要问这个**。用户能看出你已经查过了，回答质量会不一样。
5. **每轮答完给回执**，逐题点名处置结果，**含糊回答（"都行""你看着办"）按未答处理**，下一轮标「上一轮未答」重问。
   回执是这套协议的承重结构——没有它，成批提问就退化成抛一堆问题然后假装都答了。
6. **答案立即写回 `exploration.md`**，并**消灭与之矛盾的旧内容**。不要留着两个版本等最后统一整理——中途上下文一压缩，你会不知道哪个是新的。
7. **`NEEDS CLARIFICATION` 标记全程上限 3 个。** 这是硬上限。超过 3 个说明问题在发散，先收敛已有的。
8. **三类不进批次，单独问**：不可逆的（删数据、改线上配置）、授权类的（任何 Gate，走 `gates.md` 不走本协议）、
   以及**前一题的答案会决定后一题存不存在**的。最后一类要在议程里就写明「先定 1，1 的答案决定 2–4 还问不问」，
   否则会逼用户回答一个可能根本不存在的问题。

✅ 好的澄清问题：

> **退款拆分后，已存在的 1.2 万条历史退款单怎么处理？**
> 问这个是因为：`src/models/refund.py:31` 现有 `amount` 是非空字段，加拆分列必然要决定历史数据填什么，这个决定会传导到迁移脚本和对账口径。
> - **A（推荐）**：历史单 `fee=0`、`principal=amount`。对账口径不变，迁移最简单。风险：如果历史上真收过手续费，账就是错的。
> - **B**：历史单三个字段都置 NULL，查询侧区分新旧。对账要改。
> - **C**：回填真实手续费。需要 DBA 确认能否从支付流水关联，工期不可控。
> - **标记未决**：留给 DBA 判断，进 open decisions。

❌ 坏的澄清问题：

> 关于这次的退款功能，我想确认几点：1）业务背景是什么？2）有哪些用户角色？3）性能要求如何？4）需要考虑安全吗？5）什么时候上线？

坏在四处：全是开放式、没有选项、没有一个说明了为什么要问、而且第 1 和第 2 问在 objective 和代码里本来就查得到。这是把问卷念了一遍，不是探索。

**注意它坏的地方不是"一次五问"。** 把这五个问题拆成五轮一个一个地问，五个毛病一个都没少，
只是把一次糟糕的提问摊成了五次打断。

用户的合法回答有三种：**选一个 / 改一个 / 标记未决**。未决是合法状态——带着已知的未决往下走，好过假装它不存在。未决问题进 §5，将来成为 contract 的 `open_decisions`。

每个被回答的问题向 `evidence.jsonl` 追加 `question_answered`。

### 第四步：有节制地猜

不是所有缺口都值得问。低风险、有明确行业默认值的缺口，直接采用默认值往下走——但**必须记入 §3 Assumptions**。

记账的意义是：将来出问题时能一秒定位到是哪个假设错了，而不是重新推导一遍整条链路。所以"如果错了会怎样"那一栏必须真的填写。

| 缺口 | 处理 |
|---|---|
| 列表接口默认分页大小没写 | 猜。取 20，记 A1。错了改一个常量。 |
| 金额字段的小数位数没写 | **问**。错了要迁移数据，且对账会静默错账。 |
| 新增日志的级别 | 猜。取 INFO，记账。 |
| 新字段是否进入对外 API 响应 | **问**。这是接口契约，错了影响消费方。 |

判据是**猜错的代价**，不是"我有多确定"。代价可逆且局部 → 猜；代价涉及数据、接口、钱、权限 → 问。

### 第五步：冲突显式记录

两处来源说法不一致时（文档说 A、代码是 B；两个接口定义对不上；用户说的和现状不同），写进 §4，两个来源都写出来。

**不要静默选最新，也不要静默选代码。** 代码是当前行为，不一定是期望行为；文档是期望，不一定被实现过。选哪个是人的决定，你的工作是让这个决定被看见。冲突未处置时它同时也是一个未决问题。

### 第六步：维护 coverage map

每轮问答之后更新 §6。每个启用维度取四个状态之一：`已确认` / `有假设` / `未决` / `不适用`，并写结论或理由。

coverage map 是这份产物真正的骨架——它让下一个人一眼看出哪里薄，而不必通读全文自己判断。

## 工具边界

五要素：**可读 / 可写 / 受保护 / 禁止动作 / 升级条件**。前两条说的是"我干什么"，后三条说的是"我撞到边界时怎么办"——后者才是治理。

| 要素 | 本环节 |
|---|---|
| 可读 | 全库、`docs/`、`git log`、`.sdlc/` 全部 —— 理解全局是这个环节的本职 |
| 读排除 | `config.yaml` 的 `data_policy.never_read` 命中的路径（密钥、凭据、`.env`、真实个人数据）。事实盘点要的是**结构与口径**，不是值——字段有没有、叫什么、什么类型，看 schema 和代码就够了 |
| 可写 | **只有** `.sdlc/work-items/WI-*/exploration.md` 和 `evidence.jsonl`；`work-item.yaml` 仅限状态字段；`review/exploration.html` 由渲染脚本写，**不手写、不手改** |
| 受保护 | `contract.yaml`（含它的 design / boundary / release 块）、`change-scope.yaml`、任何业务代码与配置、本套件自身的模板与 Skill 文件 |
| 禁止动作 | 一切有写副作用的命令：`git commit` / `git push`、包管理器的 install / update、任何数据库写、部署类命令 |
| 升级条件 | 要跑一条白名单外的命令 / 要改代码才能确认某件事 / 要读 `never_read` 命中的内容 —— 停下来，写成未决问题或请用户代跑，不要自己开一条口子 |

**命令类别白名单**：本环节只跑**只读查询类**——`git log` / `git show` / `git grep` / `git diff`，`grep` / `rg` / `find` / `ls` / `cat` / `head`。

加一类 `sdlc-render`：`render_review.py explore`。它只读 `.sdlc/` 并把结果写成 `review/exploration.html`，不碰工作区、不产生构建副作用。

`lint` / `unit-test` / `build` 这三类**也不在**白名单里，尽管它们看起来无害。理由是：它们属于 build 的 `tool_actions.allowed`，在探索期跑既产生不了可写进事实表的东西（一次通过的测试不构成"系统做到了 X"的证据，它只说明这次跑通了），又会往工作区落下构建产物和缓存，让"探索期无执行副作用"这条边界失去意义。需要跑一下才知道的事，写成未决问题。

**环境与凭据**：全部动作在本地工作区完成，`environment: local`、`credentials: none`。本环节不需要任何凭据——需要连线上环境才能确认的事实（真实数据分布、生产配置的当前值），写成未决问题请用户核实，不要为此申请一份访问权限。

**约束的来源分层**：`never_read` 与写副作用命令的禁止来自 `config.yaml` **项目级**；"不写 `contract.yaml`" 来自本环节自身的职责划分（见下）。被拦下时要说清是哪一层——项目级要找平台负责人改，环节职责要走 sdlc-learn。

**为什么不能顺手写 contract.yaml**：contract 是 Build、QA、Release 三个环节的唯一锚点，它的生效方式是一次具名的人工批准（`gates/contract-approval.yml`）。探索期把结论写成 criteria 形式，会让"看起来已经定了"和"真的批准了"混为一谈——下游拿着一份没人签过字的契约干活，而 Gate 记录里查不到任何人对它负责。探索的结论用 exploration.md 的自然语言承载就够了，翻译成可验证 criteria 是 sdlc-contract 的工作。

发现需要改代码才能确认某件事时（比如"跑一下才知道"），不要改。写成未决问题，或请用户运行。

## 能力与 Runtime

**本环节用哪些能力资产**：`../sdlc-core/templates/exploration.md`（产物模板）、`references/dimensions.md`（十维度清单）、`.sdlc/config.yaml` 的 `explore_dimensions`（本项目启用了哪几个）。首次实例化 `exploration.md` 时向 `evidence.jsonl` 追加一条 `capability_bundle_pinned`，`input_refs` 填模板路径 + 当前 git hash。

为什么要钉版本：coverage map 是"哪些维度被想过了"的凭据，而维度清单本身会被 sdlc-learn 改。半年后有人问"当时为什么没考虑韧性"，答案可能是"那一版清单里还没有这一条"——这和"想过但判了不适用"是完全不同的两回事，不钉版本就分不出来，而它们该追究的对象也不同。

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

**Runtime**：当前编码 Agent 会话（Claude Code、Codex，或由 Enact 管理的 Runtime），不做多 Runtime 主备。本环节**不起 subagent**——澄清协议要求议程贯穿全程、每轮回执点名未答项、答案立即写回并消灭与之矛盾的旧内容，这依赖一条连续的对话上下文。拆进子会话会丢掉"已经问过什么、用户已经否掉了哪个选项"，而重复提问比不提问更快消耗掉用户的配合度。sdlc-qa 使用独立 QA 上下文是为了隔离实现上下文，这里没有要隔离的东西。

**并发与降级**：一次只探索一个 WI。`config.yaml` 缺失或 `explore_dimensions` 未配置时，按十个维度全启用，并在 `exploration.md` 顶部注明"维度集合取默认值，非项目决定"——默认值和项目决定在产物里长得一样，但只有后者是有人想过的。

## 出口自检

进 sdlc-contract 之前逐条核对：

- 每个启用维度在 coverage map 里有结论，或有"不适用 + 理由"
- 事实表每条有来源；没来源的已经移到假设或未决
- 每条假设填了"如果错了会怎样"
- 每个未决问题有建议 owner
- 冲突都已显式记录，没有静默择一
- 引用历史 WI 或 `.sdlc/lessons/` 的内容都判过记忆层级；experimentation 档的已标注为假设并落在 §3，没有混进 §1
- `NEEDS CLARIFICATION` ≤ 3

`exploration.md` 完稿后渲染一次覆盖树：

```bash
python3 "$CORE/scripts/render_review.py" explore --root . --work-item WI-###
```

`review/exploration.html` 把十个维度画成一棵树，未决置顶、不适用沉底——**coverage map 的缺口在这里一眼可见**，比在 Markdown 里逐行数要快得多。交接或呈报时给路径 + 缺口摘要，不要把 exploration 全文倒进对话；长材料在对话里再走一遍，"读不过来"这个问题原样还在。HTML 是生成物：改了 `exploration.md` 重跑渲染即可，**不手改 HTML**；它是按需生成的快照不是门户（D13），没有人维护它。

**不满足时不要自己补齐凑数。** 明确告诉用户还缺什么、缺口的风险是什么，然后让他决定：是继续澄清，还是带着风险往下走。

带风险继续是合法选择，但**这个决定本身要记录**——写进 `exploration.md` 顶部的一行说明（哪些维度未闭合、是谁决定继续的），并向 `evidence.jsonl` 追加一条 `status_changed`，notes 写明未闭合项。将来 Release 责任人看到证据链上的缺口时，能看见是谁在什么时候接受了它。


### 出口评审：交给 业务负责人

本环节没有 Gate，但**不等于没有人看过**。产出就绪后交给 `config.yaml` 的
`phase_review.explore` 指定的角色（默认 **业务负责人**）评审，他判断的是「这些结论和假设成立吗」。

呈报给**路径 + 摘要**，不是全文。拿到回应后向 `evidence.jsonl` 追加一条：

```json
{"action": "phase_reviewed", "actor": "<评审人真名>", "notes": "explore · 业务负责人 · ok"}
```

有缺口就写 `"explore · 业务负责人 · gaps：<缺什么>"`，并说明是补齐还是带着缺口往下走。

**这不是 Gate**：不接受风险、不阻塞、没有四值词表。它只回答一件事——**有没有人真的看过**。
缺了 `sdlc_audit.py` 会报 `phase-not-reviewed`（medium）。

## 交接

完成后告诉用户：下一步是 `sdlc-contract`，它会把这里的结论翻译成可验证的 criteria，并主持一次具名的 Contract Approval。§5 的未决问题会成为它的 `open_decisions`——每一条都必须被"明确接受（带风险声明）"或"关闭（有答案）"，Contract 才能进 Approved。

### 顺手交给 sdlc-learn 的东西

本环节是 Lesson 的**产地**之一，不是只有 learn 会来取。以下三类观察，发现了就连同证据引用交出去（你不自己改任何清单或模板）：

- **同一类澄清问题反复出现**。连着三个 WI 都要问"这个金额含不含税"，缺的就不是这次的答案，而是一份数据口径文档，或 exploration 模板里少了一栏。每次重新问一遍是纯损耗，而且每次的答案未必一致。
- **同一个维度反复被判"不适用"，且理由雷同**。那它可能该在 `config.yaml` 的 `explore_dimensions` 里关掉——这是项目级判断，一次做完好过每个 WI 重判一次。反向的信号同样值钱：某维度反复留成"未决"、每次都拖到 contract 或 qa 才补，说明它在本环节问得不够早。
- **十维度清单本身有缺口**：本次遇到的一类真实风险，在 `dimensions.md` 里找不到任何对应的典型问题或风险信号。

交出去的形式是观察 + 证据（哪几个 WI、各自的 exploration.md 引用），不是结论。判断适用边界是 sdlc-learn 的 Validate 阶段的事。

**怎么落盘**：命中的候选按 sdlc-learn 的 Observe 登记——建 `.sdlc/lessons/LP-###-slug/`，
复制 `../sdlc-core/templates/lesson.md` **只填 §1**，追加一条 `action: lesson_proposed`。
**确认本次没有候选时，在 `exploration.md` §5 末尾 写明"本次无 Lesson 候选"**——
只在对话里说过等于没说，下一个环节读文件时看不到你确认过这件事。


## Done When

- [ ] `exploration.md` 六节都填了，没有占位符残留
- [ ] 事实表每条带来源引用；假设与事实分开摆
- [ ] coverage map 每个启用维度有状态和结论/理由，没有空行
- [ ] 未决问题各有建议 owner；`NEEDS CLARIFICATION` ≤ 3
- [ ] 关键动作已写入 `evidence.jsonl`（`fact_confirmed` / `question_answered` / `capability_bundle_pinned`）
- [ ] 引用的历史内容按记忆层级归位，experimentation 档没有被写成事实
- [ ] 没有写过 `.sdlc/` 以外的任何文件，也没有写 `contract.yaml`；没跑过只读查询以外的命令
- [ ] 反复出现的澄清问题、反复判"不适用"的维度已作为 Lesson 候选交出（或确认无此类观察）
- [ ] 已跑 `render_review.py explore`，缺口按 `review/exploration.html` 复核过；呈报给的是路径 + 摘要
- [ ] WI 状态为 `Exploring`，且用户知道下一步是 sdlc-contract
- [ ] 九个配置面都能在正文里指认出落点（见 `../sdlc-core/references/authoring-conventions.md` §0）
