---
name: sdlc-qa
description: Use when verifying that an approved Execution Contract actually holds in the target environment - someone asks to test it, verify it, write tests, run the tests, do QA, check whether the build is really correct, decide which existing tests must be re-run as regression, chase a failing or flaky test, attribute a failure, or audit the build evidence of a work item ("测一下", "验证一下", "写测试", "跑一下测试", "QA 一下", "回归测一下", "这个真的好了吗"). Also use when choosing which test type a criterion needs, when scheduling or sharding a test run, when a browser or DOM check is needed on a critical path, or when someone asks whether the change stayed inside its declared scope. Not for writing or repairing implementation code and not for the builder's own lint/unit self-checks (that's sdlc-build), and not for deciding whether to ship (that's sdlc-release).
---

# SDLC QA —— 独立验证，证据决策

QA 不证明"代码看起来不错"，而是证明**已批准的意图在目标环境中成立**，并且**既有功能没有被这次改动弄坏**。这几件事经常被混为一谈，代价是：从实现长出来的测试永远通过，而需求被误解这一最贵的缺陷类别一次也测不出来。

本环节做两条工作线，**两条都必须做**：验证 Contract + 回归（工作线一）、核验 Build 交上来的证据本身（工作线二）。只做前者会漏掉"证据链断了"这类问题——比如某条 criterion 根本没人动过，或者有一批越界修改没被声明。

## 铁律二在这里落地

```
NO TEST EXPECTATIONS DERIVED FROM IMPLEMENTATION
```

**违反字面就是违反精神。** "参考了一下实现的边界值"就是从实现推导；"先跑一遍看看挂在哪"再写预期，也是从实现推导。

**REQUIRED**：读 `../sdlc-core/references/redlines.md` §2（含通用借口对照表）。下面这张表是 QA 环节特有的补充：

| 借口 | 现实 |
|---|---|
| "先跑一遍现有测试看看挂在哪，再补 Test Intent" | 你已经用实现的当前行为定义了预期。挂的那几条恰恰可能是唯一测对了的。 |
| "起 subagent 太麻烦，我自己写 Test Intent 也能保持中立" | 保持中立做不到——你的上下文里已经有实现了。隔离靠结构，不靠自觉，这就是它写成结构要求而不是态度要求的原因。 |
| "实现里已经有单元测试，直接复用就行" | 那些测试是实现的自证，复用等于继承它的盲区。**它们要跑（那是回归），但不算任何 criterion 的覆盖。** |
| "这条 criterion 太抽象，我看看实现是怎么理解的" | 实现的理解可能正是那个缺陷。抽象到无法出测试的 criterion 是 Contract 缺陷，提 AMD。 |
| "字段名 Contract 里没写，我照实现里的填" | 绑定字段名可以，那是绑定。**断言字段的值**必须来自 Contract。分不清就问自己：换一个符合 Contract 的实现，这条断言还成立吗？ |
| "release 类跑一次要 40 分钟，这次先跳过" | 成本不是跳过 Gate 测试的理由。跳过要有具名责任人接受风险并落 Gate 记录，否则就是静默跳过。 |

**自检信号——出现以下任一情况就停下**：

- 你在写 Test Intent 时打开了实现文件
- `intents_frozen_at` 的时间晚于你第一次读实现文件的时间
- 某条预期值你说不出它来自 contract 的哪条编号
- 一条断言失败后，你的第一反应是把期望值改成实际输出
- 你要跳过一个不可延后类别的用例，理由里出现"耗时""环境麻烦""上次也没跑"

## 输入：读什么

| 输入 | 用途 | 注意 |
|---|---|---|
| `contract.yaml`（approved 版本） | **测试期望的唯一来源** | 版本记进 test-plan.yaml 的 `based_on_contract_version`，本轮固定不换 |
| `build-evidence.md` | 工作线二的核验对象 | 采取"未验证声明"立场：逐条核实，不采信 |
| `gates/build-review.yml` | **进 QA 的前置 Gate** | 没有它、或 `approved_by` 为空，就是没人看过方向就送来了——退回 build，不要开工 |
| `change-scope.yaml` | 越界复查基线 + 回归集的判断依据 + 你自己可写的 test 路径白名单 | |
| `ledger.md` / `evidence.jsonl` | 证据链完整性 | |
| `.sdlc/config.yaml` | 不可延后类别、并发预算、密钥屏蔽模式 | 项目级约束，不由本次 change-scope 决定 |
| **环境与种子数据** | 执行前置 | **未就绪不是"失败"，是"阻塞"**：状态记 `blocked`，不要归因成 `implementation`，也不要用重试掩盖 |
| 实现代码 | **只用于绑定与一致性核验** | 冻结 Test Intent 之后才能读 |

contract 未 approved 就不要开工——没有锚点的测试测的是猜测。

**同样地，`gates/build-review.yml` 不存在也不要开工。** QA 是最贵的环节，
而 build-review 正是为了不让方向性错误消耗这个环节才设的。
唯一的例外是项目在 `config.yaml` 的 `gates.build_review` 里为 quick lane 具名声明了自检——
那种情况下 `self_check_decided_by` 里有名字，翻一眼就知道。

## 能力集：用哪些模板，版本怎么固定

本环节实例化 `$CORE/templates/` 下的 `test-plan.yaml`、`qa-report.md`、`defect.md`、`amendment.md`，判别清单用本 Skill 的 `references/test-strategy.md` 与 `references/attribution.md`。

首次实例化时落一条 evidence：`action: capability_bundle_pinned`，`input_refs` 填模板路径 + git hash。之后本 WI 一律用这个版本。**模板中途换了而报告结构没跟着换，会让同一个 WI 的两轮验证不可比**——而 build↔qa 往返本来就常常发生两轮以上。判别清单要改，走 `sdlc-learn` 的 Lesson 流程，不在这里就地改。

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

## 工作线一：验证与回归

### 步骤 1 —— 冻结 Test Intent（读实现之前）

Test Intent 只写"应该发生什么"，不写"怎么测"。每条绑定一个 criterion 编号：**找不到来源编号的预期是凭空想出来的**。

在 Enact 的角色隔离部署中，由独立的 QA Agent 执行本步骤；上游只交给它已批准的 contract 与必要项目配置，不交 Builder 的会话或实现上下文。在没有独立 QA 角色的部署中，使用当前运行时可用的 subagent/委派能力创建全新上下文，并只传下面的任务载荷：

```text
任务：Freeze test intents

  你的任务是从一份已批准的 Execution Contract 派生预期行为（Test Intent），
  供独立 QA 使用。

  硬约束：你**不得读取任何实现代码**（不要 Read/Grep/Glob 源码目录）。
  你唯一的依据是下面粘贴的 contract 内容。如果某条 criterion 抽象到
  无法派生可观察的预期，**不要猜**——把它列进 "unverifiable" 并说明缺什么。

  <contract.yaml 全文粘贴在此>

  对每条 criterion 产出：
    - criterion 编号
    - expected_behavior：用业务语言描述的可观察结果（不含函数名/路径/选择器）
    - strategy 建议：unit|schema|static|api-contract|integration|browser|e2e|performance|security|manual
    - execution_class 建议：fast|integration|browser|release|heavy|human
    - rationale：为什么选这个策略
    - 一条 criterion 最多 3 条 Intent。正常路径、边界、异常路径各一条通常就够。
  另外产出 unverifiable 清单。
```

把 contract **内容粘贴进 prompt**，而不是只给路径——给路径它就会去读目录，顺手读到实现。

回来后：

1. 写入 `test-plan.yaml` 的 `test_intents`，填 `intents_frozen_at`（ISO 8601 UTC）。
2. 追加 evidence event：`action: test_intent_frozen`，`input_refs: ["contract.yaml#<版本>"]`。

`coverage_stats.py --phase qa` 会检查 `intents_frozen_at` 非空——它是铁律二唯一可机械检查的痕迹。

### 步骤 2 —— 呈报 Test Intent（轻量，不是 Gate）

subagent 冻结完就直接进执行，等于**整轮验证的预期没有任何人看过**。把两样东西摆给用户，一次说完：

- Test Intent 清单：一行一条 `criterion → expected_behavior`
- unverifiable 清单：哪几条 criterion 派生不出可观察预期、缺什么

这不是 Gate：不阻塞、不写 `gate_decided`、用户没有异议就继续。但 **unverifiable 转 AMD 之前必须呈报过一次**——AMD 把问题退回 Contract，成本落在别人身上，不该由 QA 单方面发起而不告知。

用户提出的修改按来源处理：改 `expected_behavior` 要能指回 criterion 原文。**指不回去的修改不接受**——那是在用人的直觉替代 Contract，和从实现推导是同一类错误，只是来源换了个人。

unverifiable 条目走 `amendments/AMD-###.md`（模板见 core），**不要自己补意图**。

### 步骤 3 —— 绑定实现

**现在才读代码。** 绑定的是执行方式：endpoint、fixture、测试数据、环境、locator。

TestCase 的 `expected` 必须与对应 TI 的 `expected_behavior` 一致。**这一步不允许"调整"预期**——发现预期和实现对不上，那是一个发现，不是一个笔误。

browser 用例的语义 locator 规范与失败时必须留下的证据（trace / DOM snapshot / network log）在 `references/test-strategy.md` §7。**CSS 路径不是业务契约**——它失效时给你的信息是"选择器变了"，不是"功能坏了"。

### 步骤 4 —— 按风险选类别，不按 criterion 平均覆盖

主规格的原话是「按风险选择，**不要求每次平均覆盖**」。所以起点不是"这条 criterion 该配齐哪几种测试"，而是"本次变更的风险面在哪，哪几类验证能压住它"。八类验证（正常 / 异常 / 边界 / 兼容 / 性能 / 安全 / 恢复 / 运维准备）是可选项，不是待办清单——挨条配齐的结果是危险的那条和无关紧要的那条得到了同样的对待。

先填 `test-plan.yaml` 的 `risk_based_selection` 三个字段：

- `risk_profile`：本次触及的风险面（数据破坏 / 资金 / 权限 / 可逆性 / 影响面）
- `covered`：本轮做的类别
- `skipped`：**有意不做的 + 理由**

**`skipped` 为空比它有三条更可疑**——它通常意味着没做判断，而不是八类全做了。不写理由的省略是静默省略：Release 责任人看到一份没有性能测试的报告，分不清是判断过不需要，还是根本没想到。

风险分级判据、八类的必做/可不做判别、以及从 criterion 特征到具体策略的对照表在 `references/test-strategy.md` §1–§3。**选策略前读它**，尤其是当你正打算给一条集成语义的 criterion 写单元测试的时候（那是最常见的假覆盖）。

### 步骤 5 —— 选定回归集

步骤 1–4 验证的是"新意图成立"。回归集验证的是**"既有功能没被弄坏"**。这两件事没有一件能替代另一件——缺了后者，一次通过全部预检的发布可以完全没有验证过既有功能。

从 `change-scope.yaml` 的 files 与 `build-evidence.md` 的变更映射判断本次触及了什么，据此定重跑范围：

| 本次改动 | 该重跑什么 |
|---|---|
| 触及**共享路径**（公共模块、共享数据表、被多处引用的工具函数、中间件） | 该路径的既有用例**全跑**，不做挑选 |
| 改了**公共接口**（对外 API、事件结构、DB schema、配置契约） | **所有消费方**的契约用例 |
| 只动了本功能**私有代码** | 同模块用例即可 |

判断依据来自文件清单，不是凭印象。"我觉得这块没人用"是一个需要被 grep 验证的假设。

写进 `test-plan.yaml` 的 `regression_set`：`selection_basis` 写清"为什么是这些"，`cases` 列具体用例，结果回填 `regression_set.results`（与 `results` 同结构，单独成节是为了让"回归有没有跑"能被一眼看出来）。落一条 evidence：`action: regression_selected`，notes 记选择依据。

**复用实现自带的单测不算任何 criterion 的覆盖**（那是实现的自证，复用等于继承它的盲区）——**但它们是回归的一部分：要跑，要记结果，跑挂了要归因。** "不算覆盖"和"不用跑"是两件事，把这两件事混起来，正是回归在整条链上消失的原因。

### 步骤 6 —— TestCase + RunPlan，填齐调度输入

每条 TestCase 填五项调度输入：`criticality` / `data_sensitivity` / `env_exclusive` / `parallel_safe` / `human_dependency`。每个 run_plan 填 `runner` / `resource_profile` / `run_window` / `max_workers` / `shards`。`results` 每次记 `duration_sec`。

这九项是调度决定的确定性依据——**没有它们，"为什么这批用例是这么跑的"事后无人答得上来**，而且填错的代价严重不对称：漏掉 `parallel_safe` 与 `env_exclusive`，并行跑 integration/browser 时用例会互相破坏，产生的失败看起来完全像环境问题，于是被归因为 `environment`、重跑一次、绿了、结案。**一个真实的并发缺陷就这样被调度参数制造出来、又被重试策略掩盖掉。** 每项怎么填、填错的后果、off-peak 排期与 AI 调度建议的格式，见 `references/test-strategy.md` §4–§6。

两条不可协商的：

- **不可延后的类别不允许因成本静默跳过**。要跳，走具名批准 + Gate 记录。哪些类别不可延后由 `config.yaml` 的 `test_policy.non_deferrable_classes` 决定（默认 `fast` + `release`），并发上限受 `test_policy.budget` 约束——这是项目级判断，不写死在本 Skill 里。
- **human 类不伪装成自动测试**。指派责任人和期限，在 qa-report 里如实标"待某人确认"。

### 步骤 7 —— 执行与解释，分成两步做

**执行者不解释结果。** 换一个 runner（换 CI、换测试框架、换成远端执行）不应该改变 QA 的任何判断逻辑；反过来，执行的人顺手解释结果，最常见的结局是"挂了 → 重跑一次 → 绿了 → 过"——一个没被理解的非确定性就这样进了生产。

1. **声明**：每个 run_plan 的 `runner` 写具体命令 + 产物落盘路径。
2. **执行**：按 `runner` 声明跑（Bash），只做三件事——跑、收集产物（日志 / trace / 报告文件 / DOM snapshot）、记录 exit code 与 `duration_sec`。**这一步不判断失败原因，不改测试，不改代码，不重跑。**
3. **解释**：另起一步读产物，判 `pass` / `fail` / `flaky` / `skipped` / `blocked`，做归因，填 `evidence_ref`。

结果写进 `test-plan.yaml` 的 `results`、回归的写进 `regression_set.results`，并同步 qa-report 的执行结果表与回归节。落一条 evidence：`action: test_executed`，notes 记 pass/fail 数。

失败的用例 `attribution` 必填，见下节。重试通过的标 `flaky`，不标 `pass`。

## 工作线二：Evidence Assurance

核验 Build 提交的证据本身。这不是走形式——build-evidence.md 是**实现者对自己工作的自述**，而自述最常见的失效不是撒谎，是遗忘。

逐项核实，把结果填进 qa-report 的对应表（**七项**）：

| 检查项 | 怎么做 |
|---|---|
| 每条 criterion 都有对应变更或明确的未执行说明 | `coverage_stats.py --phase qa`，再人工核对"未执行事项"那一节 |
| 变更与 criterion 的映射真实成立 | **抽查 diff**：挑 2–3 条映射，打开实际改动确认它确实服务于那条 criterion |
| 无越界修改 | `python3 "$CORE/scripts/check_scope.py" --work-item <WI> --base <基线>` |
| 无未声明的工具动作 | 对照 change-scope 的 tool actions 与 evidence.jsonl 的 `command_run` 事件 |
| build-evidence 的"未执行事项"与实际一致 | 声明"未执行"的东西，代码里确实没做；反过来，做了却没写进映射表的变更也要揪出来 |
| Evidence Event 链条完整无断点 | 有 `file_modified` 却没有对应 commit、有越界却没有 `boundary_stop`、有 Gate 却没有 `gate_decided`——都是断点 |
| **抽验 `output_refs` 指向的原始 trace** | 挑 2–3 条事件，打开它 `output_refs` 指的原件，确认**存在**且**内容与 notes 相符**。只核到 Event 层不够：**Event 是自述，trace 是原件**——一条写着 `result: ok` 的事件，和一份真的显示测试通过的日志，是两个不同的断言 |

发现的问题按性质分流：越界修改 → 要求补 scope-expansion Gate 或撤销；映射造假/遗漏 → 打回 build 补 evidence；证据链断点 → 在 qa-report 里显式记为遗留问题，不要替 build 补写历史。

**你不能替 build 修补它的证据。** 追认别人的记录会让整条链失去意义。

## 失败归因

每个失败必须归到五个来源之一：

| 归因 | 一句话判据 | 产出 |
|---|---|---|
| `requirement` | Contract 本身错了、缺了或自相矛盾 | `amendments/AMD-###.md` |
| `design` | Contract 对，但设计方案达不到它 | 回 contract/design 评审 |
| `implementation` | Contract 和设计都对，代码没做到 | defect，交还 build |
| `environment` | 环境、数据、依赖、配置的问题 | 修环境后重跑，记录 |
| `test` | 测试自身写错了 | 修测试（这是你可以自己改的） |

**归到 `requirement` 的失败比归到 `implementation` 的更有价值**——它拦住的是一整类将来还会重复发生的问题，而一个 implementation defect 只拦住这一次。所以不要图省事：`implementation` 是默认答案的时候，通常说明判别没做完。

回归集的失败同样走这张表。回归挂了最常见的两种归因是 `implementation`（本次改动确实弄坏了它）和 `test`（那条老用例本来就绑在实现细节上）——**这两者要分清，不要因为"它是老测试"就默认归到 `test` 然后改掉它**。

判别顺序、每类的典型信号与反例在 `references/attribution.md`。**遇到"看起来就是实现写错了"的失败时读它**——那正是最容易归错的时刻。

**重试后通过 ≠ 稳定。** 标 `flaky`，记录重试次数与现象，flaky 项进 qa-report 的独立小节。把 flaky 当 pass 处理，等于把一个尚未理解的非确定性带进生产。

## 工具边界

五要素，缺一不可：

| 要素 | 内容 |
|---|---|
| **读** | 全库。理解上下文不受限。例外：`config.yaml` 的 `data_policy.never_read` 命中的文件不得读入上下文，也不得进入任何 refs |
| **写** | `.sdlc/` + change-scope 里声明的 test 路径白名单。其中 `review/qa.html` 由 `render_review.py` 写，**不手写、不手改** |
| **受保护** | 业务代码、`build-evidence.md`、别人的 Gate 记录、既有的 evidence 事件行。**受保护不等于禁止：**它们是"要改必须换个人或换条路"，不是"永远不能动" |
| **禁止动作** | 修业务代码；替 build 补写或追认证据；改 Contract；写 `gate_decided`（Release 决定不由 QA 做）；把 flaky 改判为 pass；把测试预期改成实际输出 |
| **升级条件** | 测试文件不在白名单里 → 走范围扩大流程；要提高并发超过 `test_policy.budget` → 具名批准；同一个失败尝试 3 种排查方法仍无法归因 → 停下，标 `blocked` 并升级 |

这条边界是 QA 独立性的物理保证：**既写实现又写测试的人无法验证自己的理解**——他会把同一个误解同时写进两边，然后看到绿灯。

合法终态只有"已归因"或"已记录的阻塞"，没有"大概是环境问题吧"。

## Runtime 与隔离

Runtime 是当前编码 Agent 会话（Claude Code、Codex，或由 Enact 管理的 Runtime），不做多 Runtime 主备。本环节要额外声明两件事：

**为什么使用 contract-only 独立上下文。** 它是**结构性隔离手段**，不是为了省 token。Enact 部署由独立 QA Agent 提供这层隔离；非角色隔离部署才使用运行时可用的 subagent/委派能力。主实现会话迟早会读到代码，而"看过实现还能保持中立"是一条靠自律执行的要求——换成从未接触实现的上下文，铁律二才不依赖克制。

**降级路径。** 独立 QA 角色与隔离委派都不可用时，唯一合法的降级是：**在本会话尚未读任何实现文件之前**冻结 Test Intent，并在 `test_intent_frozen` 的 notes 里注明隔离降级风险。已经读过实现再来冻结，不是降级，是违反铁律二。

**约束来自哪一层。** 不可延后的类别、并发预算、密钥屏蔽模式来自 `config.yaml`（项目级），不是本次 change-scope 定的。一条约束挡住你时先说清它的层级：项目级的要改得走项目决定，change-scope 级的可以走范围扩大——**分不清层级，最后总是就地把约束改掉。**

## 出口自检（确定性）

```bash
python3 "$CORE/scripts/coverage_stats.py" --work-item <WI> --phase qa
```

退出码 1 是有意义的结果，按 `failures` 逐条处理。除脚本外还要人工确认：

- 每条 criterion 有 Test Intent，或在 contract 里标了 `verification: manual` + `verified_by`（人工确认要有名字，"待确认"不是名字）
- `risk_based_selection` 三个字段都有内容，`skipped` 每条带理由
- **`regression_set` 已选定并跑完，`selection_basis` 写明了依据**；本次触及共享路径而 `regression_set` 为空 = 不通过
- 无静默跳过的不可延后类别（见 `config.yaml` 的 `test_policy.non_deferrable_classes`）
- 所有失败已归因，flaky 已单独列出
- 工作线二**七项**检查全部有结论


### 出口评审：交给 QA

本环节没有 Gate，但**不等于没有人看过**。产出就绪后交给 `config.yaml` 的
`phase_review.qa` 指定的角色（默认 **QA**）评审，他判断的是「验得够不够」。

呈报给**路径 + 摘要**，不是全文。拿到回应后向 `evidence.jsonl` 追加一条：

```json
{"action": "phase_reviewed", "actor": "<评审人真名>", "notes": "qa · QA · ok"}
```

有缺口就写 `"qa · QA · gaps：<缺什么>"`，并说明是补齐还是带着缺口往下走。

**这不是 Gate**：不接受风险、不阻塞、没有四值词表。它只回答一件事——**有没有人真的看过**。
缺了 `sdlc_audit.py` 会报 `phase-not-reviewed`（medium）。

## 出口产物与交接

- `test-plan.yaml`：TestIntent / TestCase / TestRunPlan / regression_set / TestResult
- `qa-report.md`：两条工作线各自成章 + 回归节 + 结论
- 归因为 `implementation` / `design` → `defects/DEF-###.md`（模板 `$CORE/templates/defect.md`），WI 状态回 `Executing`
- 归因为 `requirement` → `amendments/AMD-###.md`，WI 状态回 `Contracted` 或 `Held`

`qa-report.md` 写完之后渲染一次人类视图：

```bash
python3 "$CORE/scripts/render_review.py" qa --root . --work-item WI-###
```

`review/qa.html` 首屏是裁决 + 待决清单（intents 未冻结、失败未归因、回归集无依据），其后是 KPI 与 标准×（Test Intent／用例／已执行）覆盖矩阵。**交给下游时给这个路径 + 三五条摘要，不要把报告在对话里复述一遍**——长材料倒进对话，"读不过来"这个问题原样还在。HTML 是生成物：改了 `qa-report.md` 或 `test-plan.yaml` 重跑渲染即可，**不手改 HTML**；它是按需生成的快照，不是要维护的门户（D13），没有人维护它。

DEF 单独成文件而不是只写进 qa-report：一个缺陷的生命周期可能跨越多轮 build↔qa 往返，而 qa-report 是某一轮验证的快照。混在一起会让"这个缺陷修好了没有"变成需要比对两份报告才能回答的问题。

同一个 WI 里 AMD 和 DEF 可以并存，但要说清**它们有没有因果关系**——无关就明说无关。把一个实现缺陷和一个需求缺口混在一起描述，会让 build 去改代码来迎合一个本来就该重新定义的需求。

**QA 报告不做 Release 决定，只给建议状态**（通过 / 有条件通过 / 不通过）。Release 由 `sdlc-release` 组装 Evidence Case，由具名责任人在 `gates/release.yml` 里决定。把"建议通过"写成"通过"，是在替别人签字。

### 向 sdlc-learn 交出什么

只有 learn 声明"我要来取"是不够的——**产地不声明"我要交"，这条链就是断的**。本环节的 Lesson 候选有四类，写进 qa-report 的遗留问题并在 `ledger.md` 留痕：

- **反复出现的 flaky**：同一用例跨 WI 多次 flaky。那是一个未被理解的非确定性，不是运气
- **反复归因到 `requirement` 的模式**：同一类 criterion 反复写不清（例如所有涉及时间窗的 EARS 都缺边界侧）——这是 Contract 写法的问题，不是这一次的问题
- **反复归因到 `environment` 的同一条件**：环境的不可复现性本身就是缺陷
- **反复被判 unverifiable 的 criterion 类型**：说明某类需求在 contract 阶段就无法被写成可验证的形式

短期状态（本轮的 intents、cases、results）留在 `test-plan.yaml`；长期事实（上面四类）才是 learn 的输入。**把每次失败都当 Lesson 交上去，等于没交**。

下一步：证据齐了走 `sdlc-release`；有 implementation defect 或 AMD 被接受，回 `sdlc-build` / `sdlc-contract`。

## Done When

- [ ] `intents_frozen_at` 已填，且它早于任何实现文件的读取
- [ ] Test Intent 与 unverifiable 清单已向用户呈报过一次（unverifiable 转 AMD 前必须）
- [ ] 每条 criterion 有 Test Intent，或有 `verification: manual` + 具名 `verified_by`
- [ ] TestCase 的 `expected` 与对应 TI 的 `expected_behavior` 一致，没有被"调整"过
- [ ] `risk_based_selection` 的 `covered` / `skipped` 都有内容，`skipped` 每条带理由
- [ ] `regression_set` 已选定、跑完、记了结果，`selection_basis` 写明依据
- [ ] 每条 TestCase 的五项调度输入已填；run_plan 有 `runner` / `resource_profile` / `run_window` / `max_workers` / `shards`；`results` 有 `duration_sec`
- [ ] 执行与解释分成了两步：先按 `runner` 跑并收产物，再单独解释结果
- [ ] 不可延后类别（`test_policy.non_deferrable_classes`）无无批准的跳过
- [ ] 所有失败已归因五选一；flaky 单独列出，未被计为 pass
- [ ] 工作线二**七项**检查全部有结论，`check_scope.py` 已跑，trace 抽验做过
- [ ] `coverage_stats.py --phase qa` 的 failures 已清空或已在报告中显式记为遗留
- [ ] qa-report 给的是**建议状态**，不是 Release 决定
- [ ] 已跑 `render_review.py qa`，交接时给的是 `review/qa.html` 的路径 + 摘要，不是全文
- [ ] evidence.jsonl 有 `capability_bundle_pinned`、`test_intent_frozen`、`regression_selected`、`test_executed`，有缺陷时有 `defect_found`
- [ ] 九个配置面都能在正文里指认出落点
