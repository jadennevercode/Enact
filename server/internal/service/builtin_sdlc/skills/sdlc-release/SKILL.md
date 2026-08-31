---
name: sdlc-release
description: Use when a work item is ready for a release decision - assembling the Release Evidence Case, running the deterministic pre-flight before shipping, or when someone asks 能不能发 / 可以上线吗 / 走一下发布评审 / 组装发布证据 / 发版前还差什么 / release gate / go-no-go, and when a previously Held release needs to be decided again after evidence was added. Also use when someone asks who has to sign off before shipping. Not for designing or running the tests themselves and not for attributing test failures (that is sdlc-qa), not for writing the code (that is sdlc-build), and not for something that has already shipped and is now misbehaving in production (that is sdlc-operate).
---

# SDLC Release —— 预检与发布决定

这个环节的产出不是"发布"，是**一个负责任的决定**。

Release Authority 通常不读代码、不读测试日志、不知道 build 中发生过什么。他要承担的却是生产风险。让他负责任地决定的唯一办法，是把散在 contract、qa-report、build-evidence、evidence.jsonl、gates/ 里的东西，组装成一份**按决策组织**的 Evidence Case——他在同一个位置找到同样的东西，看完就能签。

这是 Pilot 完成定义之一：**只看一份 Evidence Case 就能决定**。

---

## 铁律一在这里落地

```
NO GATE PASSAGE WITHOUT A HUMAN APPROVAL RECORD
```

五个必须人工批准的 Gate 里，`release.yml` 是唯一一个**决定生产风险归属**的。前面四个错了还有下游能拦住，这个错了就直接落在用户身上。

**违反字面就是违反精神。** `approved_by` 填了 AI、填了一个当场没表过态的人名、或者你从"用户没反对"里推断出的同意——都是没有批准。

| 借口 | 现实 |
|---|---|
| "用户说了不用每件事都问我，直接发吧" | 他授权的是"不要为每个小决定打断我"，不是"替我承担生产风险"。Release 是他明确保留的三个决定之一。 |
| "预检 12 项全绿，Release 只是走个形式" | 预检判的是规则，人判的是风险。全绿恰恰意味着他只需要花一分钟——不是意味着不需要他。 |
| "他上周说过这个功能做完就发" | 他说的是那个版本的计划，不是这一版 Evidence Case。他没看过第 6 节里那条新增的已知例外。 |
| "先把 release.yml 写好，等他确认再改" | 那份文件一旦存在就会被当作已决。要么现在拿到确认，要么现在不写。 |
| "Release Authority 联系不上，但今天必须发" | 工作可以停在 `Held`。"发不出去"和"发出去了但没人负责"，后者贵得多。 |
| "我在 status_reason 里写清楚了这是 AI 判断" | 那是在诚实地记录一次无效的 Gate。诚实不能让它变有效。 |

**自检信号——出现以下任一情形立刻停下**：

- 你正要在 `approved_by` 填一个没有在这一轮对话里说出 Release / Hold / Reject 的人
- 预检有 FAIL，而你在想"顺便问一下用户要不要发"
- 你在 Evidence Case 里补了一条已知例外，但不打算重新请求决定
- 你正要说出第四个选项（"我看可以发"、"从证据上应该没问题"）

完整红线说明在 `../sdlc-core/references/redlines.md`。

---

## 两段式，顺序不能倒

```
第一段：确定性预检（脚本 + 规则序列）
   ├─ 任一 FAIL → 输出 Hold 清单，结束。不进入第二段
   └─ 无 FAIL   → 组装 Evidence Case → 第二段

第二段：人工决定（Release / Hold / Reject）
```

**预检不过就不要占用别人的判断力。** 拿一份自己都知道不完整的东西去请人签字，是把核对工作转嫁给最没有时间做核对的人。

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

## 输入：读什么

**Seed（必读，缺任一条就不要开始预检）**：

| 文件 | 读它拿什么 |
|---|---|
| `WI-###/contract.yaml` | 批准过的意图、criteria、`open_decisions`（含 `accepted` 的 `revisit_at`） |
| `WI-###/work-item.yaml` | 当前状态、`contract_version`、`blocked_by`、`notes` |
| `WI-###/qa-report.md` | 验证结论、失败归因、flaky、Evidence Assurance 七项 |
| `WI-###/test-plan.yaml` | `results`、**`regression_set`**、**`risk_based_selection`** |
| `WI-###/build-evidence.md` | 实现侧证据与 criteria 映射 |
| `WI-###/change-scope.yaml` + `gates/` | 边界，以及此前每一次批准 |
| `WI-###/evidence.jsonl` | 关键节点事件；`boundary_stop` 有没有下文 |
| `.sdlc/config.yaml` | `gates.release.require`（默认 业务负责人 + 运维）与 `roles`——谁有资格做 Release 决定 |

**可发现范围**：`.sdlc/` 全部只读；业务代码库只读，且只在核对某一条具体证据时定向打开。

**扩展规则**：责任人追问超出 Seed 的内容时可以现读，但读到的东西一旦进入 Evidence Case，
必须在那一节写出引用路径。**Release 里没有"我看过所以是这样"这种依据。**

### 版本固定

本环节实例化两份能力资产：`../sdlc-core/templates/evidence-case.md`（九章节结构）与
`../sdlc-core/templates/gate.yml`（Gate 记录格式）；裁决规则来自 `references/preflight-rules.md`，
脚本来自 `$CORE/scripts/`（`coverage_stats.py` / `check_scope.py` / `validate_gate.py`）。

首次实例化模板时向 `evidence.jsonl` 追加一条 `action: capability_bundle_pinned`，
`input_refs` 填模板路径 + git hash。理由很具体：三个月后有人问"这份 Evidence Case 是按哪一版模板组装的"，
这一条是唯一能回答的地方。模板改过而记录里没有版本号，就分不清当年是漏填了一栏，还是当年压根没有那一栏。

---

## 第一步：确定性预检

**REQUIRED**：读 `references/preflight-rules.md`。里面是完整的裁决规则序列（五组、逐条写明检查什么、怎么检查、不通过判什么、怎么修）与"规则 → 结论"裁决表。**按顺序机械执行，不要自由心证。**

先跑三个脚本，它们的 JSON 输出是大部分规则的原料：

```bash
python3 "$CORE/scripts/coverage_stats.py" --root . --work-item WI-00X --phase release
python3 "$CORE/scripts/check_scope.py"   --root . --work-item WI-00X
python3 "$CORE/scripts/validate_gate.py" --root . --work-item WI-00X
```

退出码 1 是有意义的结果（检查未通过），按 JSON 里的 `failures` / `violations` / `results` 处理；退出码 2 才是脚本自身出错，那要先修脚本调用。

`--phase release` 会额外报三类本环节独有的空缺，别把它们当成噪音——

| 脚本报的 | 对应规则 | 它在防什么 |
|---|---|---|
| `regression_set.selection_basis` 为空 | E8 | 一次通过全部其他预检的发布，可以完全没有验证过既有功能 |
| `risk_based_selection.covered` 为空 | E9 | 责任人分不清"想过并决定不做"和"根本没想到" |
| `accepted` 决策缺 `revisit_at` | C7 | 带风险接受变成永久埋在系统里的临时默认 |

`validate_gate.py` 另外校验 `merged_revision`（PASS/CONCERNS 必填）与 `publish_scope` 词表，
并在 `gate: FAIL` 时提示确认这是 Hold 还是 Reject——对应 G6 / G7 与下面的落盘映射。

脚本覆盖不到的部分（回退方案是否为空、Amendment 是否已处置、release 类测试是否被静默跳过、
**本次改动有没有触及共享路径因而回归集不能为空**、已知例外是否都有 owner）由 `preflight-rules.md` 的清单项逐条判。

**预检结论不是 Gate 结论。** 预检只有三种结果：

| 预检结论 | 动作 |
|---|---|
| **FAIL** | 停。输出 Hold 清单（见下），WI 退回 `Verifying`，**不写 `gates/release.yml`** |
| **CONCERNS** | 进入第二段，但每条 CONCERNS 连同 owner 必须出现在呈报的最前面 |
| **PASS** | 进入第二段 |

### 预检 FAIL 时输出什么

不是"预检未通过"五个字。是一份能直接派活的清单，每条三要素：

```
## 发布预检未通过 —— WI-003 退款报表按门店拆分

**结论**：4 项失败，暂不进入 Release 决定。

| # | 缺什么 | 来源 | 谁来补 |
|---|---|---|---|
| 1 | criterion 2.1 没有对应 Test Intent，也没标 manual | coverage_stats.py → failures[0] | sdlc-qa |
| 2 | TC-007 失败但 attribution 为空 | qa-report.md 失败归因表 | sdlc-qa |
| 3 | Evidence Case 第 7 节回退方式为空 | evidence-case.md §7 | WI owner 张三 |
| 4 | AMD-002 的"处置"仍是空 | amendments/AMD-002.md | sdlc-contract |

补齐后重新跑预检。第 3 条最关键：没有回退路径的发布是单向门，
它需要的是一个不同量级的决策，而不是一次常规 Release。
```

预检 FAIL 不需要人工批准——它是规则的结论，不是风险接受的决定。但要写一条 Evidence Event（`action: gate_decided` 不适用，用 `command_run` 记预检结果），并在 `work-item.yaml` 的 `notes` 追加一行回退说明（格式见 `../sdlc-core/references/state-machine.md`）。

---

## 第二步：组装 Evidence Case

**REQUIRED**：读 `../sdlc-core/references/evidence.md` 的 Evidence Case 一节，再整份复制 `../sdlc-core/templates/evidence-case.md` 填写。

九个章节固定不变、不增不减、不换顺序——责任人需要每次在同样的位置找到同样的东西：

| # | 章节 | 关键要求 |
|---|---|---|
| 1 | 业务目标与范围 | outcomes 原文 + 明确不包含项。让人想起来这是要干什么 |
| 2 | Contract 覆盖 | **逐条列全**。缺一行预检就 FAIL；未覆盖的写"未覆盖 + 理由"，不省略行 |
| 3 | 接口兼容 | 有无破坏性变更、受影响消费方、迁移要求 |
| 4 | 安全与隐私 | 是否触及认证/权限/个人数据/密钥 + 检查结果 |
| 5 | QA 结果 | 统计、flaky、未覆盖项。**指向 qa-report.md，不复制全文**。另含两小节：**回归**（重跑了哪些既有用例、依据、结果；为空要写明谁接受了这个风险）与**按风险选择的说明**（做了哪几类、有意不做哪几类及理由，引自 `test-plan.yaml`） |
| 6 | 已知例外 | 每条必须有 owner。写不出 owner 的不是例外，是缺口 |
| 7 | 部署与回退 | 部署方式 / 回退方式 / **回退后数据状态**。为空直接 FAIL |
| 8 | 监控与支持准备 | 看什么指标、看多久、异常时谁响应 |
| 9 | 批准 | 只引用 `gates/release.yml`，此处不重复记录 |

三条组装原则，每一条都对应一种真实发生过的失败：

- **每条结论指向证据引用，不复述内容。** 复述会与原件漂移；引用不会。
- **例外要显式。** 把已知问题藏在"总体通过"里，是最容易导致事后追责的做法。
- **不要粘贴原始 trace、contract 全文、完整 diff。** Release 不应该要求业务负责人读工具调用日志。他要看细节时会问，或者直接打开文件。

组装完成后 WI 状态 → `Decision`，追加一条 Evidence Event。

### 组装完就渲染

```bash
python3 "$CORE/scripts/render_review.py" release --root . --work-item WI-###
```

`review/release.html` 首屏是裁决 + 待决清单（回退为空、criterion 无通过结果、Gate 无具名批准），其后是逐条列全的 Contract 覆盖矩阵。**Release Authority 看的是这一份。**

**预检不过时不要渲染，也不要请求决定。** 渲染出来的东西看着像可以签字，那正是问题所在——拿一份自己知道不完整的材料去占用别人的判断力，是对批准这件事最大的损害。预检不过就按上一节的 FAIL 输出退回。

---

## 第三步：请 Release Authority 决定

**REQUIRED**：读 `../sdlc-core/references/gates.md` 的"请求批准的方式"与"呈报格式"两节。

### 呈报

**给路径 + 摘要，不要复述全文。** 呈报时把 `review/release.html` 的路径连同下面这份摘要一起给出去；把 Evidence Case 在对话里再倒一遍，等于没有解决"读不过来"这件事。HTML 是生成物，改了 `evidence-case.md` 重跑渲染即可，**不手改 HTML**；它是按需生成的快照不是门户（D13），没有人维护它。

按这个形状给，一屏能读完：

```
## Release 决定 —— WI-003 退款报表按门店拆分

**要决定什么**：是否把 WI-003 发布到生产。

**确定性预检**：12 项通过 / 0 项失败
**Contract 覆盖**：6 条 criteria 全部有结论（5 条自动验证通过，2.1 由王五人工确认 8-21）
**已知例外**：
  - 并发退款场景无自动化覆盖，依赖人工抽查 — owner 李四 — severity medium
**回退准备**：可回滚到 v2.4.1；回退后已导出的报表文件保留，无数据迁移
**监控**：发布后 24 小时观察导出接口错误率与 P95；异常由值班 SRE 响应

**如果 Release**：进入部署（人工执行），发布版本回填到 merged_revision，WI → Completed
**如果 Hold**：会给出待补清单，WI 退回 Verifying，补齐后重新呈报
**如果 Reject**：记录原因与允许重新进入的条件，WI 回 Explore 或 Contract
**如果 Reject 且这件事不该做**：条件写"不重新进入"，WI → Cancelled，这单就此关闭

Evidence Case 已就绪。请给出 Release / Hold / Reject。
```

最后一句是**固定话术**，不要改写、不要软化成"你看行不行"。

### 三条批准协议

1. **固定话术**：「Evidence Case 已就绪。请给出 Release / Hold / Reject。」
2. **只认显式肯定**。"Release" / "发" / "可以发" / "approved" 算。以下都不算，要继续澄清：
   - "看起来不错" / "应该没问题" / "你觉得呢" / "没什么问题吧"
   - 沉默、跳过、回答了别的问题
   - 之前对别的事说过的"随便你"
3. **改后重审**。Evidence Case 有**任何**补充或修改——补一条例外、改了回退方案、QA 又跑了一轮——都要重新呈报、重新请求决定。上一轮的批准不延续到新版本，因为他批准的是他看过的那一版。

**选项里没有"由 AI 决定"。** 你可以解释任何一条证据、可以说明规则判了什么、可以指出你认为哪条例外最值得关注。签字不行。

### 三种回答，四种落盘

问的时候用规格的词（**Release / Hold / Reject**），落盘用的是固定四值词表（`PASS / CONCERNS / FAIL / WAIVED`）。
**两套词之间的映射就是下面这张表，不要自行推断。** 也不要在对话里让责任人去选 `FAIL`：
他听到 "Hold" 和听到 "Reject" 时做的是两种不同的判断，把他推到词表上只会让这个区别在源头就丢掉。

细节见 `../sdlc-core/references/gates.md` 的「Hold 与 Reject 都落成 FAIL，靠一个字段区分」一节。
用 `../sdlc-core/templates/gate.yml` 写 `gates/release.yml`，写完跑 `validate_gate.py --gate release` 自检。

| 责任人说 | `gate` | `reentry_conditions` | 其余必填 | WI 状态 |
|---|---|---|---|---|
| **Release** | `PASS`（有已接受的例外时 `CONCERNS`） | 留空 | `approved_by` 具名、`merged_revision`、`publish_scope`、`status_reason`；`CONCERNS` 时 `top_issues` 逐条有 owner | → `Completed` |
| **Hold** | `FAIL` | **留空** | `top_issues` 逐条列明缺什么、severity、`suggested_owner`；`status_reason` 写明找谁补 | → `Verifying`（等外部条件则 `Held`，`blocked_by` 三项填全） |
| **Reject** | `FAIL` | **必填**：什么条件下允许重新提出 | 同上；`status_reason` 写明不可接受的是目标、边界还是风险 | → `Exploring` 或 `Contracted` |
| **Reject 且不再做** | `FAIL` | **必填**，写「不重新进入」 | 同上；`status_reason` 写明为什么这件事不该做 | → `Cancelled` |

三处最容易记错的地方：

- **`reentry_conditions` 留空不是"忘了填"，留空本身就是 Hold 的标志。** 所以 Hold 不要出于"写全一点更稳妥"的心理去填它——填了它就变成 Reject 了。
- **`merged_revision` 在 PASS/CONCERNS 时必填**：发布版本号 / git commit / tag，确实没有产生新版本就写"无"。留空和写"无"不是一回事，留空的含义是"没人填"。部署由人执行、版本号事后才知道时，先拿决定，拿到版本号立刻回填，**不要留空过夜**。
- **`publish_scope` 默认 `task`**——只对这个 Work Item 生效。往上填 `project` / `domain` / `organization` 意味着别的工作可以引用这次决定，那么 Evidence Case §1 的范围描述必须覆盖到那一档，否则就是拿一个 WI 的验证给一个领域背书。

### Reject 之后这单怎么关掉

Reject 有两种，别把第二种硬塞进第一种：

| 性质 | `reentry_conditions` 写什么 | WI 去哪 |
|---|---|---|
| **现在不该做，将来可能做** | 触发条件（"上游 X 接口稳定后"、"合规意见明确后"） | `Exploring` 或 `Contracted`，`notes` 记一行回退说明 |
| **这件事不该做** | 「不重新进入」+ 理由 | **`Cancelled`**，`notes` 记决定人与时间 |

**没有第二个出口时，一个"这件事不该做"的判断只能被写成一个永远回不来的 `Exploring`。**
它会一直挂在待办里，每次 intake 盘点都要被重新解释一遍，而做出这个判断的那次对话早就没人记得了。
`Cancelled` 不是失败记录，是一个被负责任地关掉的问题——它和"发出去了"一样是一个完整的结局。

落完 Gate 追加 Evidence Event：`action: gate_decided`，`input_refs` 指向 `gates/release.yml`。

---

## 工具边界

按五要素声明。三要素（读什么 / 写什么 / 不写代码）说的是"我干什么"，
后两项说的是"我撞到边界时怎么办"——治理在后两项里。

- **读**：全库只读（`.sdlc/` 全部 + 业务代码定向打开），用来核对证据条目、回答责任人的追问。
- **写**：只写 `.sdlc/` 下这四份——`evidence-case.md`、`gates/release.yml`、`work-item.yaml`、`evidence.jsonl`。外加 `review/release.html`：它由 `render_review.py` 写，**不手写、不手改**，改了源产物重跑即可。
- **受保护（读得到，但绝不写）**：`contract.yaml`、`change-scope.yaml`、`test-plan.yaml`、`qa-report.md`、`build-evidence.md`、以及 `gates/` 下此前已存在的任何 Gate 文件；全部业务代码、配置与测试文件。它们是这次决定的**证据**——证据的组装者不能同时是证据的编辑者。
- **禁止动作**：部署、push、publish、改测试、改代码、改上游产物、创建 `approved_by` 为空的占位 Gate 文件。
- **升级条件**：发现代码问题 → 开 defect 交回 `sdlc-build`；发现 Contract 有洞 → 提 Amendment 交回 `sdlc-contract`；发现验证不足（含回归缺口）→ 交回 `sdlc-qa`。**在 Release 环节顺手修一个小问题，会让刚刚被验证过的那份证据立即失效**——你改的那一行不在任何一次测试运行覆盖过的版本里。
- **Bash**：只跑 `$CORE/scripts/` 的校验与渲染脚本（含 `render_review.py release`）与只读 git 查询（`git log`、`git diff --name-only`、`git tag`）。

### Runtime 与配置来源

**Runtime**：当前编码 Agent 会话（Claude Code、Codex，或由 Enact 管理的 Runtime）。

**本环节不起 subagent。** 预检的每一条裁决、每一处"这算不算触及共享路径"的判断，
都要能被责任人当场追问、当场解释。把裁决过程放进一个只回传结论的子会话，
等于把整条链上最需要留痕的那一段变成黑盒；而这里的工作量（跑三个脚本 + 逐条走清单）
也从来不是需要并行才做得完的量级。qa 用 subagent 隔离 contract-only 视角是为了独立性，
release 没有对应的独立性问题——它本来就在读所有人的产物。

**降级**：脚本退出码 2（脚本自身出错）时，不要绕过它去人工估一遍。
预检失去确定性就不再是预检。修调用，或如实报告"预检无法完成"，WI 停在 `Verifying`。

**分层配置来源**：本环节的约束来自三层，说得出来源才说得清能不能改——

| 来源层 | 管什么 | 例子 |
|---|---|---|
| `.sdlc/config.yaml`（项目级） | approvers 名单、`always_forbidden` | `deploy` 是项目级永久禁止，不是本次工作的选择 |
| `change-scope.yaml`（本次工作） | 这个 WI 的可写路径与 protected | B1 / B2 判越界的依据 |
| 本 Skill（环节级） | 只写 `.sdlc/`、不执行部署、不起 subagent | 与本次工作无关，换一个 WI 也一样 |

### 不执行部署动作

**这个 Skill 不跑部署命令。** `Release` 决定之后，实际的部署由人执行，或按项目另行配置的通道执行。

理由不是谨慎，是边界定义：部署是 workspace 外的副作用，和 push / publish 同类。它不在任何 `change-scope.yaml` 的 tool actions 里声明过，也不该在这里被顺手加进去——一个刚刚组装完证据、正在等人签字的环节，同时握着执行按钮，是把"判断"和"执行"合并到了同一个不受约束的动作里。

用户说"发吧，你直接部署"时：确认 Release 决定并落 Gate，然后告诉他部署命令要由他执行（或指出项目配置的部署通道）。这不是拒绝帮忙，是这一步真的不属于这里。

---

## 交接

**下一步该谁接**：

| 决定 | 交给谁 | 带什么过去 |
|---|---|---|
| Release | 部署由人执行；之后 `sdlc-operate` 接管观察窗口 | Evidence Case §7 §8 与 `gates/release.yml` |
| Hold | `sdlc-qa` / `sdlc-build` / `sdlc-contract`，按 Hold 清单"谁来补"那一列 | 三要素 Hold 清单 |
| Reject | `sdlc-explore` 或 `sdlc-contract` | `reentry_conditions` 原文 |
| Reject 且不再做 | 不交给任何人 | `status_reason` 与 `Cancelled` 状态即是结论 |

### 交给 sdlc-learn 的 Lesson 候选

这一栏不是可选的。learn 已经声明了"我要来取"，**产地不声明"我要交"，这条链就是断的**。
本环节有四类信号是 Lesson 候选——共同点是它们跨 WI 才看得出来，单看这一单都像是偶发：

| 什么时候记 | 交出什么 | 为什么它是 Lesson 而不只是这一单的问题 |
|---|---|---|
| 同一类原因导致的 Hold 出现第二次 | 判 FAIL 的规则编号 + 两次的 `status_reason` | 一次是这单没做好；两次是流程里缺一个本该有人做的动作 |
| Evidence Case 的同一节反复要人回来补 | 章节号 + 反复缺的那个具体字段 | 说明模板那一栏问得不够具体，或者上游根本没有产出它的位置 |
| 预检判 FAIL 但责任人认为不该拦 | 规则编号 + 责任人的理由 | 规则过严会让人学会绕过它，比规则过松更难修 |
| 预检全绿而责任人给了 Hold/Reject | 他实际担心的是什么 | 这是规则清单缺了一条的直接证据——他看见了规则没看见的东西 |

### 交给 sdlc-learn 的对外同步

Release 决定为 Release、WI 进入 `Completed` 之后，**这一单的业务结论要向外发布**——交给 `sdlc-learn`
同步进 Project Intelligence Space。同样是双向声明的一环：learn 已声明"我要来取"，这里必须声明"我要交"。

交出什么：`contract.yaml` 的业务层（outcomes / requirements / criteria / scope / release.strategy）
与本次 Release 的结论。**不交** Evidence Case、Gate 记录、change-scope 与 ledger——
那些是本项目的问责材料，不是对外空间的内容。

前置条件由 learn 自己检查（`.sdlc/config.yaml` 的 `intelligence_space` 是否启用、目标 space 是否存在、
体裁是否相容）。本环节只负责声明"可以交了"，不预判它能不能同步成功。

记法：向 `.sdlc/lessons/` 登记候选（`sdlc-learn` 的 Observe 阶段），来源写
`WI-###/gates/release.yml#status_reason` 或 `WI-###/evidence-case.md#<章节>`，
并向 `evidence.jsonl` 追加 `action: lesson_proposed`。
**这一步只登记、不做判断**——该不该固化成标准由 learn 的六阶段决定，不在这里定。

---

## Done When

- [ ] 三个脚本都跑过，退出码与 JSON 结果已按 `references/preflight-rules.md` 逐条裁决（A 组 C1–C7、B 组 E1–E9、C 组 B1–B4、D 组 R1–R7、E 组 G1–G8）
- [ ] 预检结论是 PASS 或 CONCERNS；若为 FAIL，已输出三要素 Hold 清单且**没有**写 `gates/release.yml`
- [ ] `regression_set.selection_basis` 与 `risk_based_selection.covered` 已按 E8 / E9 裁决；判 CONCERNS 的两种情形都在 §6 有具名 owner
- [ ] contract 里 `status: accepted` 的决策都有未过期的 `revisit_at`（C7）
- [ ] `evidence-case.md` 九个章节齐全，第 2 节逐条列全 criteria，第 5 节有回归与按风险选择两小节，第 7 节回退方案与回退后数据状态非空
- [ ] 第 6 节每条例外都有具名 owner
- [ ] 呈报里没有 contract 全文、完整 diff 或原始 trace
- [ ] 预检 PASS/CONCERNS 之后才跑的 `render_review.py release`，呈报给的是 `review/release.html` 的路径 + 摘要
- [ ] 用固定话术请求了决定，且拿到的是 Release / Hold / Reject 三者之一的显式表态
- [ ] Evidence Case 在呈报后有任何修改的，已重新请求决定
- [ ] `gates/release.yml` 的 `approved_by` 是真实人名，`validate_gate.py --gate release` 通过
- [ ] `merged_revision`（PASS/CONCERNS 必填）与 `publish_scope`（四值词表）已填且合法
- [ ] Hold 的 `reentry_conditions` 留空、Reject 的已填；"这件事不该做"的 WI 已置为 `Cancelled`
- [ ] WI 状态已按决定更新；`evidence.jsonl` 有 `capability_bundle_pinned` 与 `gate_decided` 事件
- [ ] 跨 WI 反复出现的 Hold 原因或反复缺失的 Evidence Case 章节，已按 `## 交接` 登记为 Lesson 候选
- [ ] 没有执行任何部署命令，没有起 subagent
- [ ] 九个配置面都能在正文里指认出落点
