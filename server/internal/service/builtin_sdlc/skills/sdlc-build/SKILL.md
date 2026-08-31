---
name: sdlc-build
description: Use when implementing an approved Execution Contract - writing the code, config, migration or self-test for a work item whose contract has passed approval, declaring or expanding a Managed Change Area, recording progress in the build ledger, or when someone says 开始实施 / 写代码 / 开始开发 / 实现这个 contract / 按 contract 做 / 把这个功能做出来 / continue the implementation. Also use when an implementation run hits a file outside the write whitelist, needs a command class that was never authorized, or discovers the contract is incomplete or self-contradictory. Not for deciding what to build or writing acceptance criteria (that is sdlc-contract), and not for independently verifying the result afterwards (that is sdlc-qa).
---

# SDLC Build — 受控变更，不是一次性 Context Dump

Build 的特点是：你可以读懂整个系统，但只能在明确声明过的写入边界和动作边界内改变它。

理由不是不信任你的判断。是 AI 一次能改几十个文件，而人的复核带宽没有同步增长。范围边界是让复核成为可能的前提——复核者需要知道该看哪里。

**REQUIRED**：动手之前读 `../sdlc-core/references/redlines.md`。第三条铁律是本环节的主场，第 4.1 条（不在下游补意图）同样在这里生效。

---

## 铁律：不得在批准范围外写入

```
NO WRITES OUTSIDE THE APPROVED CHANGE SCOPE
```

**违反字面就是违反精神。** "顺手改一下"不在白名单里的文件，就是越界，哪怕那个改动是对的。新建文件的落点不在白名单里，也是越界。跑一条没在 `tool_actions.allowed` 里声明的命令，同样是越界。

| 借口 | 现实 |
|---|---|
| "这个改动很小很安全" | 范围的意义不是防止你改错，而是让复核者知道该看哪里。小改动藏在大 diff 里最危险。 |
| "不改这个文件功能就不完整" | 那说明 change-scope 定小了。这是一次正常的范围扩大，走升级流程只需要一轮交互。 |
| "protected 目录里明显有 bug" | 记下来，作为独立发现交出去。在别人的保护区里修 bug，你既不知道它是不是有意的，也没人在复核你。 |
| "已经改完了，回退太麻烦" | 那就在 ledger.md 的边界事件里如实记录，并立即补一次范围确认。掩盖比越界本身严重得多。 |
| "白名单里没写但同一个目录下" | 白名单是路径级的，不是目录精神级的。 |
| "测试目录没进白名单，但不写测试就没法自证" | 那是 change-scope 漏了测试落点。漏了就补一版，这是最常见也最容易走的一次扩大。 |
| "lockfile / 迁移文件是工具生成的，不算我改的" | git diff 里它就是你改的。工具产生的写入照样要落在白名单内。**别拿 `check_scope.py` 的 `generated_note` 当依据**——它豁免的只是构建缓存（`__pycache__`、`node_modules` 这类跑一次命令就重写的东西），lockfile 与迁移文件是要被评审的产物，不在豁免列表里。 |
| "先改了再说，反正 QA 会 review" | QA 复核的是 build-evidence 声明过的内容。没声明的越界改动正好是它看不见的那部分。 |

**自检信号——出现以下任何一条就停下**：

- 你正要编辑的文件，不在 `change-scope.yaml` 的 `write` 列表里
- 你在心里说"这个先记着，等下一起提范围扩大"，然后继续改了
- 你要跑的命令类别没在 `tool_actions.allowed` 里（尤其是任何 push / publish / deploy / db-migrate）
- 你发现自己在解释"为什么这次的边界不该按字面理解"

---

## 输入：读什么

**Seed（必读）**：
- `work-item.yaml` —— 状态、lane、owner
- `contract.yaml` —— **必须是 approved 版本**，记下版本号，整个 Build 期间锁死这一版
- `.sdlc/config.yaml` —— `protected_paths`、`tool_actions`、`commands`、`data_policy`、`context_budget`

契约还是 `draft`？停下，回 sdlc-contract。没有批准的 contract 就没有可实施的意图。

**Discoverable（可查）**：代码库、docs/、git log。读得宽是好事——不理解现有模式就写不出符合项目习惯的代码。读到的东西只用于理解，不构成写入授权。

### read_excluded：写保护不等于读保护

这是套件里最反直觉的一处。`protected_*` 管的是**不可写**——按"可读范围宽、可写范围窄"的建模原则，
写保护**恰恰不约束读取**：一个 `.pem` 躺在 protected 里，按字面规则它仍然可读。

而风险正在读这一侧：`evidence.jsonl` 与 `ledger.md` 永久保留、进 git、可 PR 评审，
套件所有规则都在鼓励"不删除"。一次疏忽写进去的连接串或 token 就是永久泄露——
**治理机制会把一次疏忽放大成不可撤销的后果。** 所以密钥必须靠一条独立的读边界拦住，
那条边界就是 `change-scope.yaml` 的 `read_excluded`，默认继承 `data_policy.never_read`。

命中时**立刻停止读取**——不要"先看一眼再说"，看过就已经在上下文里了，没有撤回动作。
完整四步处置、以及替代信息从哪里取，见 `references/change-scope-guide.md` 的「read_excluded 命中之后」。

**REQUIRED**：写第一条 evidence 之前读 `../sdlc-core/references/evidence.md` 的「硬规则：证据里不得出现密钥」。

### 想读 read 列表外的东西

`read` 是宽范围而不是白名单。读它之外的路径**不需要人工确认**（为一次 Read 打断责任人，
是在消耗他之后真正需要判断时的注意力），但要在 `ledger.md` 的「边界事件」表留一行，
下次生成 change-scope 新版本时并进 `read`。**唯一例外**是命中 `read_excluded` 的路径，
走上面那条读边界，不适用这条宽松规则。

### Context Budget：超过阈值就换个读法

`config.yaml` 的 `context_budget` 给了两个阈值（单任务来源文件数、文档年龄），超限不是硬停，
是必须换个读法。阈值含义、`on_exceed` 的三种动作、以及为什么没有预算渐进加载就不稳定，
见 `references/change-scope-guide.md` 的「Context Budget」一节。

---

## 第一步：先提 Managed Change Area，再写代码

顺序不能反。范围是先声明的边界，不是事后对已发生改动的追认。

**起点是 `contract.boundary`，不是你自己的判断。** change-scope 是那份意图级边界的**物化**，
不是一份独立的边界声明——让执行者划自己的边界，边界就没有意义了。

1. 复制 `../sdlc-core/templates/change-scope.yaml`，先填 `derived_from`：把
   `contract.boundary.may_change` 与 `must_not_change` **逐条原样抄进来**，一条不落、不合并、不改写；
2. 逐条 criterion 反推受影响的模块，用 Grep / 依赖关系把 `derived_from.may_change` 的每个模块
   落到具体文件，写进 `write`；`derived_from.must_not_change` 的每一项必须被 `protected` 覆盖住；
3. `write` 列到"复核者知道该看哪里"的粒度——不是 `src/**`，也不能漏掉测试落点；
4. `protected_from_project` 原样继承 config.yaml 的 `protected_paths`（**不要在这里删条目**），
   本次额外收紧的写进 `protected_local`：本次接触到的共享接口、数据模型、基础设施、安全配置、CI 配置；
5. `read_excluded` 继承 `data_policy.never_read`，本次涉及的其他敏感路径再补进去；
6. `tool_actions.allowed` 必须是 `contract.boundary.allowed_actions` 的**子集**——可以收紧，不能放宽；
7. `base_revision` 填 `git rev-parse HEAD`。**空着 `check_scope.py` 就看不见已提交的越界**——`vcs-commit` 是允许的动作，一次越界可以被 commit 掉，工作区随之变干净。

`check_scope.py` 会校验这层包含关系：`derived_from` 有没有抄全，`allowed` 有没有超出 contract 的
`allowed_actions`。**从 boundary 推导不出文件级范围，说明 Contract 的 boundary 写得太模糊**——回
sdlc-contract 补（走 Amendment），不要自己扩大解释：自解释出来的范围在 QA 归因和 Release 决策时都没有授权来源。

**REQUIRED**：推导方法、风险分级、默认 protected 的五类区域与各自原因、白名单粒度的 ✅/❌ 例子，见 `references/change-scope-guide.md`。第一次写 change-scope 或拿不准粒度时读它。

**要不要人工确认 v1**：

| 情况 | 处理 |
|---|---|
| 白名单只碰本次功能自己的文件与测试；无 protected 相邻；`tool_actions` 只有 lint/test/build | 建议默认接受，在 change-scope 里写明"低风险，owner 默认接受"，直接开工 |
| 触及共享接口、数据模型、迁移、安全或权限相关路径；或需要 config 默认之外的命令类别 | 必须拿具名确认，写 `approved_by` |

确认话术固定：「本次可写范围是 <路径清单>，保护范围是 <路径清单>，允许的命令类别是 <清单>，
跑在 <environment>、使用 <credentials> 凭据。确认这个范围吗？」

范围就位后写**三条** evidence（写入方式见 `../sdlc-core/references/evidence.md`）：

| action | 记什么 | 为什么这时候记 |
|---|---|---|
| `scope_declared` | change-scope 版本与批准人 | 边界从此刻起生效 |
| `context_resolved` | 本轮实际依据的文件与版本：`contract.yaml#<版本>`、`src/x.py@<hash>`、`docs/y.md@<hash>` | 范围决定了可依据的事实集合。不固化，之后就无法区分一条结论是范围扩大前还是扩大后得出的 |
| `capability_bundle_pinned` | 本次实例化的模板版本：`templates/change-scope.yaml@<hash>`、`templates/build-evidence.md@<hash>`、`templates/ledger.md@<hash>` | 模板改版之后，回看这次产物才知道它当时对着哪一版填的 |

WI 状态 → `Planned`。

---

## 第二步：拆任务，写成自包含 brief

**先把 ledger 建出来**——它不由脚本创建，`new_work_item.py` 只建 `work-item.yaml`：
`cp "$CORE/templates/ledger.md" .sdlc/work-items/WI-###-slug/ledger.md`。
漏了这步只能凭印象现编，模板那四节（任务 / 裁决 / 修复轮次 / 边界事件）的纪律会一起丢掉，
而它们正是上下文压缩后唯一能恢复现场的东西。

任务清单写进 `ledger.md` 的「任务」节，层级最多两级。

**每个任务尾部标 criterion 编号**：

```
- [ ] T03 报表导出增加 refund_amount 列 _Criteria: 1.1, 1.3_
```

编号是全套件的连接坐标。没有编号的任务，QA 不知道它在验什么，Release 不知道它凭什么算数。反过来，映射不到任何 criterion 的任务有两种可能：它是必要的支撑改动（在 build-evidence 里写明），或者它超出了本次范围（拿掉）。

**任务包要自包含**：执行时不应该需要重读 contract 全文、exploration 全文或整篇架构文档。把这个任务需要知道的接口签名、数据结构、命名约定、错误处理要求直接写进 brief。

**引用来源数超预算就先出摘要**：一个 brief 引用的来源文件超过 `config.yaml` 的
`context_budget.max_source_files_per_task`，说明这个任务要么该拆，要么该先产出一份定向摘要产物再执行。
按 `on_exceed` 处理，不要直接把二十个文件塞进 brief。引用超过 `max_doc_age_days` 的文档时注明"可能已过期"。

**示例代码是可配置的 Capability，不是强制项**：

| 状态 | brief 里允许出现什么 |
|---|---|
| 启用 | 可以引用参考实现片段——既有代码里的**真实**片段并注明来源，不是现编的伪代码 |
| 未启用（默认） | 只允许定位引用：`[Source: src/api/errors.py#ApiError]`，让执行者自己去读那一处 |

后半句比前半句重要得多。**必须进 brief 的是标准、接口、约束和现有模式的可定位坐标**——
有坐标，执行者读到的是当前的真实实现；给片段，他可能照着一段已经过时的代码写，而且看不出来。
示例代码省的是一次跳转，坐标保的是事实的时效性。

**反幻觉引用制**——brief 里每条技术细节都带来源：

```
- 错误响应格式沿用 `ApiError`  [Source: src/api/errors.py#ApiError]
- 金额一律用 Decimal 不用 float  [Source: docs/coding-standards.md#金额处理]
- 分页默认页长：未找到具体指引
```

查不到就写"未找到具体指引"，**不要编造一个看起来合理的值**。下游拿着错误的"事实"去实现，比拿着"不知道"更糟——"不知道"会引发一次澄清，错误的"事实"会一路传导到测试和发布证据，而且看起来和真事实一模一样。

---

## 第三步：实施

### 交互纪律：前重后轻

change-scope 确认之后，**执行期禁止"要继续吗？""我接下来打算…可以吗？"式请示**。进度汇报和逐步请示会耗掉责任人的注意力，而他真正需要判断的事情反而被淹没在里面。

只有四类事必须停下来找人：

1. **不可逆或破坏性操作**（删数据、改历史、覆盖无备份的文件）
2. **安全敏感**（认证、权限、密钥、个人数据处理方式的改变）
3. **workspace 外的副作用**（push / merge / publish / deploy / 对外部服务写入）
4. **Contract 烂到每条路都是猜**（此时走 Amendment，见下）

其余情况自主裁决，把决定记进 ledger 的 Ruling：

```
Ruling: 导出超过 12 个月时返回 400 而不是截断 — criterion 1.1 只说"拒绝"，400 与现有 ApiError 用法一致 — 如果错了，前端错误分支要改一处，成本约半小时
```

**第三段是判据本身。写不出"如果错了代价是什么"，说明这件事不该自主决定，应该去问。** 代价说不清通常意味着影响面没摸清楚，或者它其实是个需求问题。

### 每完成一个任务

1. `ledger.md` 追加一行：任务号、criterion 编号、commit range、结果；
2. 有实质变更就写一条 evidence（`file_modified` / `file_created`，`input_refs` 指向 criterion 编号）；
3. 跑到自测命令就写 `command_run`。

追加，不重写。已写的行不修改、不删除、不重排。

### 上下文压缩之后

**相信 ledger.md 和 git log，不要相信自己的记忆。**

会话上下文会被压缩，压缩之后你会不记得哪些任务已经做完。重复执行已完成的任务是这类工作中观测到的最昂贵的失败——它会把已经正确的代码改坏，而且没有任何提示告诉你正在发生这件事。

恢复工作的第一个动作永远是：读 ledger.md 的任务节 → `git log --oneline` 核对 commit range → 从第一个未打勾的任务继续。不要凭印象判断"应该做到哪了"。

---

## 越界：停 → 说理由 → 拿确认 → 新版本 → 重固化上下文 → 继续

需要改 write 白名单外的文件、碰到 protected、或需要未授权的命令类别时：

1. **停**。不要"先改了再说"。
2. 写 evidence：`boundary_stop`，notes 记清楚想做什么、为什么停。这条事件是边界真的在起作用的证据。
3. `ledger.md` 的「边界事件」表追加一行。
4. 说明理由并请求扩大：「需要把 `<路径>` 加入可写范围，原因是 `<理由>`。确认扩大范围吗？」——理由要说清楚为什么绕不开，不是"这样比较方便"。
5. 拿到具名确认后，生成 `change-scope.yaml` 的 **version+1**（原版本内容保留在 `history`），并写 `gates/scope-expansion-###.yml`（模板 `../sdlc-core/templates/gate.yml`，`approved_by` 只能在真实确认之后填）。
6. 跑 `python3 "$CORE/scripts/validate_gate.py" --gate scope-expansion` 确认 Gate 记录有效，写 `scope_expanded` 与 `gate_decided` evidence。
7. **再落一条 `context_resolved`**，`input_refs` 记扩大后本轮实际依据的文件与版本。范围变了意味着可依据的事实集合也变了——
   不重新固化，之后就无法区分某条结论是扩大前还是扩大后得出的。同时把这期间读过的 read 列表外路径并进新版本的 `read`。

批准人不可达时进 `Held`，`blocked_by` 写清 what / who / since / unblocks_to。工作停在 Held 是合法的诚实状态，越权推进不是。

---

## Contract 缺口：提 Amendment，不补意图

发现 contract 不完整、自相矛盾、或与代码现实不符时，**不允许自己决定"应该是什么意思"然后写进代码**。

复制 `../sdlc-core/templates/amendment.md` 到 `amendments/AMD-###.md`，写清：发现了什么（附证据：冲突的两处说法各自在哪里）、为什么不能在实现里解决、影响、建议怎么改。写 `amendment_raised` evidence，WI 退回 `Contracted` 由 sdlc-contract 处置。

为什么这条不能通融：contract 是 QA 与 Release 的唯一锚点。实现里一旦悄悄夹带了没写进 contract 的意图，QA 测不到它，Release 也不知道自己批准了什么——这个缺口要到线上才会被发现。

一个判别方法：如果你正在想"这里 contract 没说清楚，我按最合理的理解做"，那就是在补意图。合理的理解可能是对的，但它没有经过任何人确认，也没有留下痕迹。

---

## 从 QA 接回缺陷

WI 从 `Verifying` 退回 `Executing` 时，QA 会留下 `defects/DEF-###.md`。这不是一份重来的工单，是一条已经定位过的线索：

1. 读 DEF 的「归因依据」节。QA 已经排除过 environment / test / requirement / design——**不要重新论证一遍**，除非你发现它排错了（那本身是重要发现，写回 DEF 而不是私下改代码）。
2. 修复只针对 DEF 定位的那处。顺带发现的其他问题另开，不要塞进同一次修复——复验的人需要知道这次改动为什么足以让那几条用例转绿。
3. 填 DEF 的「处置」节：修复方式、commit、复验结果。**不要改 QA 写的任何一节**，那是交接单也是证据。
4. 同一个 WI 里如果还挂着 AMD，先看 DEF 有没有说明两者的因果关系。**说了无关就当无关**——不要为了迎合一个尚未裁决的需求缺口去改代码。

修完仍回 `Verifying` 交给 QA 复验。自己跑通不等于复验通过：判断"这条 criterion 现在满足了"的权限在 QA，不在你。

## 熔断：3 次不同方法仍失败就停

同一个问题尝试三种**不同**方法（不是同一方法调三次参数）仍未解决时，停止尝试第四种：

1. `ledger.md` 的「修复轮次」表记录三次尝试各自是什么、为什么失败；
2. WI 进 `Held`，标 `⚠️ Blocking issue`，`blocked_by` 写清卡在哪；
3. 如果三次失败指向同一个方向（例如都撞在同一个架构约束或同一个缺失的接口上），把这个观察写出来——它通常比继续试更有价值。

**合法终态只有两个：完成，或已记录的阻塞。** 不存在"大概好了""基本能跑""应该没问题"。一个诚实的阻塞记录能让别人接手；一个含糊的"完成"会让所有下游检查建立在错误前提上。

---

## 工具边界

五要素，缺一不可。三要素（读什么 / 写什么 / 不写代码）说的是"我干什么"，
五要素说的是"我撞到边界时怎么办"——后者才是治理。

| 要素 | 本环节取值 |
|---|---|
| 可读 | `change-scope.read` 内，宽。Read / Grep / Glob。列表外的路径可读，但要在边界事件表留一行 |
| 可写 | **仅限 `change-scope.write` 白名单内路径 + `.sdlc/`**。Edit / Write |
| 受保护 | 写侧：`protected_from_project` + `protected_local`；**读侧：`read_excluded`**（命中即停，不带入上下文） |
| 禁止动作 | `tool_actions.forbidden` 加上 config.yaml 的 `always_forbidden`。deploy / push / publish / db-migrate 永远不由 Build 执行 |
| 升级条件 | `change-scope.escalation` 四条。触发即走「越界」七步，不去找一条绕开它的等价命令 |

Bash 还有两个维度要声明。它们是边界的一部分，不是环境细节：`tool_actions.environment`
（这次跑在哪：local / ci / staging）与 `tool_actions.credentials`（能用哪套凭据，默认 `none`）。
同一条命令在 local 和 staging 上是两件不同的事，带不带凭据也是。

自测（lint / build / unit）是 Build 自证，**不替代独立 QA**。自测全绿只说明代码符合你自己的理解，不说明它符合 contract。

### Runtime 与配置来源

当前编码 Agent 会话（Claude Code、Codex，或由 Enact 管理的 Runtime）就是本环节 Runtime，不做多 Runtime 主备。本环节**不派 subagent**：change-scope 是会话级的边界，
子会话不共享这份边界，它的写入也不会记进同一份 ledger——那正是第三条铁律要防的情况。

约束分三层。报出一条约束时要能说清它来自哪一层，因为**申诉对象不同**：

| 层 | 例子 | 谁能改 |
|---|---|---|
| 项目级 `config.yaml` | `protected_paths`、`always_forbidden`、`data_policy`、`context_budget` | 平台/项目负责人 |
| 本次 `change-scope.yaml` | `write`、`protected_local`、`tool_actions.allowed` | WI owner，走一次范围扩大 |
| Contract | criterion 本身的要求 | 走 Amendment，回 sdlc-contract |

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

## 出口

### build-evidence.md 五要素，缺一不可

复制 `../sdlc-core/templates/build-evidence.md`，五节全填：

1. **变更摘要** —— 让复核者在读 diff 之前知道该期待看到什么
2. **需求与标准映射表** —— 每个实质变更 → criterion 编号 + 适用标准
3. **未执行事项** —— contract 里有但本次没做的。**为空也要写"无"**，留白无法区分"没有"和"忘填"
4. **工具与测试结果** —— 命令与结果原样记录
5. **需要 QA 或人工重点复核的风险** —— 主动指出你自己不确定的地方

第 5 节的价值与诚实度成正比。掩盖不确定性能让本次 review 更快通过，代价是把问题推到更贵的阶段去暴露。

### 确定性自检（交付前必跑）

```bash
python3 "$CORE/scripts/check_scope.py"    --root <项目根> --work-item WI-###
python3 "$CORE/scripts/coverage_stats.py" --root <项目根> --work-item WI-### --phase build
```

- `check_scope.py` 无 violations —— 有 violations 就按它的 `next_step` 处理：撤销，或补一次范围扩大
- `coverage_stats.py --phase build` 无 failures —— 每条 criterion 都有任务或变更映射，确实不做的写进「未执行事项」
- fast checks（lint / build / unit）通过

退出码 1 是有意义的检查结果，不是故障；退出码 2 才是脚本本身出了问题，需要停下来修。

**动手前也跑一次 `check_scope.py`**——它会告诉你工作区里有没有上一轮遗留的越界改动。

### Build Review Gate —— 进 QA 之前停一次

自检全绿之后**不要直接切状态**。这里有一个必须人工批准的 Gate：`gates/build-review.yml`。

它批的是**方向**，不是正确性。在这个 Gate 之前，从 Contract 批准到 Release 决定之间
**人一次都不看代码**；而 QA 是最贵的环节，方向性错误漏进去，成本从"一次返工"变成
"一整轮 QA 加返工加重测"。确定性检查也检不出"做法不对"——一个用轮询实现了本该用事件的功能，
`check_scope.py` 与 `coverage_stats.py` 都会全绿。

**REQUIRED**：读 `references/build-review.md`（呈报格式、四种结论怎么落盘、quick lane 降级条件）。
**把 diff 倒进对话是最常见的失败**——批准人要的是组织过的判断材料。
拿到批准前不建 Gate 文件；批准后落 `gates/build-review.yml`、跑 `validate_gate.py --gate build-review`、
追加一条 `action: gate_decided`。

### 交接

Gate 通过后 WI 状态 → `Verifying`，交给 **sdlc-qa**。QA 需要的前置产物：approved `contract.yaml`、
`gates/build-review.yml`、`build-evidence.md`、`ledger.md`、有效的 change-scope（含所有扩大版本）。

**同时要交给 sdlc-learn 的东西。** 只有接收端声明"我要来取"、产地不声明"我要交"，这条链就是断的。
本环节的 Lesson 候选有三类，在 build-evidence 第 5 节点名，不要等 learn 自己去 grep：

| 候选 | 信号 | 为什么值得沉淀 |
|---|---|---|
| `boundary_stop` 事件 | evidence.jsonl 里本 WI 的每一条 | 被拦下说明边界起作用了；**反复被拦说明范围推导规则漏了声明** |
| 反复越界的同一类路径 | 多个任务撞在同一类文件上（最常见：测试落点、配置、迁移） | 这是 change-scope 推导规则的缺口，属于 Policy 级经验，不是本次 WI 的个案 |
| 3 次熔断的共同指向 | 「修复轮次」表三行指向同一个架构约束或同一个缺失的接口 | 三种不同方法都撞在同一处，那一处就是真问题，比继续试第四种有价值得多 |

**候选怎么落盘**：在 build-evidence 第 5 节点名之外，命中的候选按 sdlc-learn 的 Observe 登记——
建 `.sdlc/lessons/LP-###-slug/`，复制 `../sdlc-core/templates/lesson.md` 只填 §1，追加 `action: lesson_proposed`。
**确认没有候选时，在 build-evidence 第 5 节写明"本次无 Lesson 候选"**：
只在对话里说过等于没说，下一个环节读文件时看不到你确认过这件事。

短期状态在 `ledger.md`（上下文压缩后靠它恢复），长期事实在 `evidence.jsonl` 与 `build-evidence.md`。
命中 `read_excluded` 的内容两者都不进——**它不是"记在别处"，是不记录**。

QA 会对 build-evidence 的每条声明采取"未验证声明"的立场逐条核实。这是设计如此，不是不信任——独立验证只有在不采信被验证方的结论时才成立。

---

## Done When

- [ ] `change-scope.yaml` 在写第一行代码之前就已存在；`derived_from` 抄全了 `contract.boundary` 的两个清单；高风险范围有具名 `approved_by`
- [ ] 每个任务在 ledger.md 里有 `_Criteria: x.y_` 标注和 commit range
- [ ] 任务 brief 里每条技术细节有 `[Source: ...]`，查不到的写了"未找到具体指引"而不是编造
- [ ] 所有自主裁决在 ledger 的 Ruling 里写全三段，包括"如果错了代价是什么"
- [ ] 每次越界都有 `boundary_stop` evidence + 边界事件记录 + scope-expansion Gate（如已扩大）
- [ ] 发现的 contract 缺口走了 `amendments/AMD-###.md`，没有一处是在代码里自行补的意图
- [ ] `change-scope.yaml` 的 `base_revision` 已填；`check_scope.py` 的输出里**没有** `baseline_note`
- [ ] `check_scope.py` 无 violations
- [ ] `coverage_stats.py --phase build` 无 failures
- [ ] `ledger.md` 由模板复制而来，四节结构完整（不是现编的）
- [ ] `build-evidence.md` 五节齐全，第 3 节为空时写了"无"
- [ ] 命中 `read_excluded` 时停止了读取，内容没有进入上下文、`refs` 或 `notes`；给出了缺什么与替代方案
- [ ] change-scope 声明时与每次范围扩大后都落了 `context_resolved`；首次实例化模板落了 `capability_bundle_pinned`
- [ ] 每个任务 brief 的来源文件数在 `context_budget.max_source_files_per_task` 内，超限的先出了摘要
- [ ] 自检全绿后走了 **build-review Gate**，`gates/build-review.yml` 有具名 `approved_by`，`validate_gate.py --gate build-review` 通过（quick lane 降级为自检的，config 里有具名声明）
- [ ] 状态是在 build-review 通过**之后**才切到 `Verifying` 的
- [ ] 向 learn 交出的三类 Lesson 候选已在 build-evidence 第 5 节点名；无候选时写了"本次无 Lesson 候选"，没有只停在对话里
- [ ] 每个任务的 commit range 是真值；`vcs-commit` 未获授权时写的是"(未提交)"而不是编造的哈希
- [ ] 当前状态是「完成」或「已记录的阻塞」，没有"大概好了"
- [ ] 九个配置面都能在正文里指认出落点（`../sdlc-core/references/authoring-conventions.md` §0）
