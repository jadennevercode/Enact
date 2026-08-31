---
name: sdlc-orchestrator
description: >-
  Use when answering requires a judgement across records rather than a read-out: ranking open items,
  resequencing a known cross-item blocker, reconciling .sdlc/ with disk state, accepting one phase's
  output for the next phase, closing an item, or changing family.yaml. Triggers include 排一下顺序,
  先做哪个, 谁先谁后, 核对记录, 验收上一环节, 这单收尾, 换个 Family, or 加一条阶段.
  Not for any status, risk, metric, or initial blocker question answerable by reading the ledger
  without deciding; those belong to sdlc-intake even when several Work Items are mentioned. Not for
  defining acceptance criteria (sdlc-contract) or producing any phase deliverable.
---

# SDLC Orchestrator —— 只调度，不产出交付物

八个环节各自管好自己那一段，但有些问题**不属于任何一个环节**：三个 Work Item 谁先做、记录说的和磁盘上的对不对得上、某个环节说"完成了"该由谁核验、这条交付链本身该长什么样。

这个环节回答这四类问题。它**不产出任何交付物**——不写 contract、不写代码、不写测试、不组装 Evidence Case。它读所有环节的产物，输出的是**判断和缺口清单**。

**REQUIRED**：动手之前读 `../sdlc-core/references/redlines.md`。本环节最容易滑的是铁律一——「验收」离「替人决定能不能过」只有一步。

---

## 每次回复先报状态

**本环节的每一次回复，开头都是一段状态行加一条分隔线，然后才是正文。** 它是给人看的进度跟踪：
一眼知道这单走到哪个**阶段**、卡在哪道 Gate、下一步该谁动。

它由脚本产出，**不要手写**：

```bash
python3 "$CORE/scripts/wi_status.py" --root . --header
```

原样贴出它的输出（状态行 + 空行 + `---`），再接正文。长这样：

```
`WI-002` · **QA** 阶段（Verifying） · lane full · 下一道 Gate **build-review**（待批） · **下一步：补 build-review**
另有 2 个 Work Item · 1 项待处理

---
```

**打头的是阶段名**（Intake / Explore / Design & Contract / Build / QA / Release），
括号里才是状态机取值。这是两套词，别混着用：阶段是人在说的那一套，
一个阶段可以对应两个状态（`Planned` 和 `Executing` 都是 Build）；状态是机器记的那一套，
Gate 校验、审计、回退全按它走。阶段名取自 `family.yaml` 的 `stage`，项目可以改成自己的叫法。

**Operate 和 Learn 不会出现在这里**——它们由事件触发（事故、复盘），挂在 `INC-*` / `LP-*` 上，
不是 Work Item 状态路径的一段。一个需求的阶段只会是上面六个之一。

**为什么必须来自脚本**：这一行看起来像是核对过的。一段凭记忆写出来的状态，
比没有状态行更糟——读的人会拿它当事实，而它可能停留在三轮对话之前。
每一个值都来自文件：状态来自 `work-item.yaml`，Gate 来自 `gates/*.yml` 里**有效的具名批准记录**
（不是来自状态字段——状态可以被人手改，一份签过字的 Gate 文件不能）。

几件事顺带说清：

- **它是读出来的，不是判断。** 状态行不表态"能不能过"，那是各环节责任人的事（红线一）。
- **「待批」优先于阶段序列。** 某道 Gate 欠着的时候，下一步显示的是"补这道 Gate"，
  而不是阶段表里的下一环节——那会把人指向欠检查的那一步之后。
- **`.sdlc/` 不存在、还没有 Work Item、或 `current.yaml` 谁都没指**——三种情况脚本都会照样给一行说明，
  不会报错中断，也不会随便挑一个 WI 当"当前"。
- **命令跑不起来（`$CORE` 解析不到、Python 缺 PyYAML）就说跑不起来**，正文照常写。
  **不要手写一行顶替**——一个看起来核对过、实际是猜的状态行，比没有状态行伤害大得多。
- 脚本只读不写，跑它不改变任何状态。

---

## 与 sdlc-intake 的分界

两者都碰"状态"，是全套件最容易抢触发的一对。分界**不是"问一件事还是一批事"**——
那条规则听起来顺，但会把「现在有哪些活在跑」（一批，却只是读出来）判错。

真正的分界是：**读出来，还是做判断。**

| 用户要的是 | 走哪个 |
|---|---|
| 把账本上已有的内容读回来——不管涉及几个 WI | **intake** |
| 在记录之间做一次判断，或改变什么 | **orchestrator** |

| 用户在问 | 走哪个 | 因为 |
|---|---|---|
| "WI-003 到哪了" / "谁在等我决定" | intake | 读出来 |
| "现在有哪些活在跑" / "本周有什么风险" | intake | 涉及多个 WI，但仍然只是读出来 |
| "最近交付得怎么样" | intake | 度量也是读出来（跑脚本 ≠ 做判断） |
| "这批活谁先谁后" | orchestrator | 要在几件事之间排序 |
| "WI-005 为什么一直动不了" / "谁卡着我" | **intake** | 把阻塞字段读出来仍然是读出来 |
| "WI-005 卡在 WI-003 上，这两个怎么排" | orchestrator | 阻塞源已知，现在要重排先后 |
| "记录和实际对得上吗" | orchestrator | 要比对两个来源并下结论 |
| "explore 的产物能交了吗" | orchestrator | 要代下游做一次接收判断 |
| "这单收尾" / "换个 Family" | orchestrator | 要改变状态或链条形状 |

**追因类问题一律从 intake 进。** 这不是例外条款，是规则本身的结论——
"谁卡着我"要的是把 `blocked_by` 字段读出来，那仍然是读出来。

分水岭在**阻塞源已知之后**：知道 WI-005 卡在 WI-003 上，接下来"这两个怎么排"才是判断，才归本环节。
这样切的另一个理由是：用户提问时并不知道原因是依赖别的 WI 还是等某人签字，
**不该要求他先完成归因才能问对人。**

拿不准时问自己：**回答这个问题，我需要下判断吗？** 不需要就是 intake。

---

## 输入：读什么

**Seed（必读）**：
- `.sdlc/current.yaml` —— 当前活跃指针
- `.sdlc/config.yaml` —— `approvers`、`data_policy`、`quick_lane_criteria`
- `.sdlc/family.yaml`（若存在）—— 阶段序列。不存在就是内置的 AI-native delivery 序列

**可发现范围**：所有 `work-items/*/`、`incidents/*/`、`lessons/*/` 下的产物。本环节天然要跨 WI 读，这是它的工作方式。

**扩展规则**：需要看某个具体产物的内容时直接读，不需要确认——只读不写。

**读排除**：`data_policy.never_read` 命中的路径不读。本环节没有任何理由碰密钥。

**版本固定**：读到的产物版本记进 `input_refs`。跨 WI 的判断尤其需要说清依据的是哪一版——三天后 WI-002 的 contract 改了，你当时给出的排程结论未必还成立。

## 能力集

实例化 `../sdlc-core/templates/family.yaml`（仅在声明或修改 Family 时）。判别清单用本 Skill 的 `references/acceptance-checklists.md`。

首次使用时落一条 `capability_bundle_pinned`（写入方式见 `../sdlc-core/references/evidence.md`）。

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

---

## 受控词表

本环节读别人的产物、产出自己的判断，两边的取值都不接受变体：

| 词表 | 取值 | 定义在 |
|---|---|---|
| `sdlc_audit.py` 的 `kind` | `bad-status` / `closed-with-open-amendment` / `dangling-pointer` / `empty-evidence` / `gate-status-mismatch` / `incomplete-hold` / `malformed-record` / `missing-build-review` / `missing-record` / `no-owner` / `not-synced` / `phase-not-reviewed` / `stale-pointer` / `status-artifact-mismatch` / `sync-misconfigured` / `unknown-role` / `unstaffed-role` / `write-scope-overlap` | `sdlc_audit.py` |
| `severity` | `high`（结构性不一致，必须处理） / `medium`（该处理但不阻塞） | 同上 |
| WI `status` | 十个合法状态 | `../sdlc-core/references/state-machine.md` |
| Gate 结论 | `PASS` / `CONCERNS` / `FAIL` / `WAIVED` | `../sdlc-core/references/gates.md` |

**你只读这两个 Gate 相关的词表，不写它们。** 报结论时用词表原值，不要换成同义词——
"这个 Gate 大概过了"这种说法会让下游无法机械核对。

## 一、排程：谁先做

```bash
python3 "$CORE/scripts/wi_status.py" --root .
```

输出里的 `schedule` 段有五样东西：

| 字段 | 说什么 |
|---|---|
| `actionable_now` | 现在就能推进的 WI——没有未完成的前置，也不在依赖环里 |
| `topological_order` | 满足依赖约束的一个合法顺序 |
| `inherited_blockage` | **自己没问题但前置卡住了**的 WI，含卡在谁那里、多久了 |
| `dependency_cycles` | 依赖环。环里没有任何一个能先开始 |
| `unknown_dependencies` | 依赖了不存在的 WI 编号 |

**拓扑序不是排期。** 它只说明"这个顺序不违反依赖"，不考虑紧急度、工作量、谁有空。把它当作约束条件交给人，而不是当作结论。

✅ 「WI-001 和 WI-003 现在都能做。WI-002 得等 WI-001——后者从 8-15 起卡在李四那里等 DBA 确认回填窗口，已经 9 天了。要不要先去推这一条？」

❌ 「建议顺序：WI-001 → WI-002 → WI-003。」（把约束说成了排期，而且没提那个真正该有人去推的阻塞）

依赖关系一多，文字就说不清谁卡住谁。要把结论配一张图时：

```bash
python3 "$CORE/scripts/render_review.py" status --root .
```

`.sdlc/review/status.html` 是 Work Item 依赖图（SVG 分层布局，阻塞传播高亮）加一张全部 WI 的表。跨 WI 的判断结论可以配它一起给。

**给路径 + 结论，不要把表在对话里重排一遍。** 结论仍然由你写成话；图只是让人自己核对那条阻塞链。HTML 是生成物：`.sdlc/` 变了重跑一次即可，**不手改 HTML**。

**它是快照，不是看板。** 按需生成、用完即弃，没有人维护它，也不排期刷新、不设常驻链接、不做"最新状态页"——D13 明确要守住的边界就在这里：本套件不产出需要有人维护的门户，那正是"退化成另一个 Jira"的起点。

**依赖环要当作发现报出去**，不是技术故障：A 依赖 B、B 依赖 A，通常意味着这两件事本来就该合成一件，或者其中一条依赖是想当然写上去的。

---

## 二、一致性核对：记录和实际对不对得上

```bash
python3 "$CORE/scripts/sdlc_audit.py" --root .
```

它检查的不一致分四组：**记录本身坏了**（读不出的 work-item.yaml、不在词表里的状态）、
**记录与磁盘对不上**（状态声称的阶段已出口但产物不存在、该有的 build-review Gate 没有、
evidence.jsonl 是空的）、**记录之间对不上**（Gate 已通过但状态没动、Held 缺三要素、
非 Proposed 却无 owner、终态却留着未处置的 Amendment、两个活跃 WI 的可写范围重叠）、
**项目级配置不成立**（`current.yaml` 指向不存在或已完成的 WI、Gate 要求的角色没有人担、config 里出现词表外的角色名、对外同步配置残缺）。

**准确的 `kind` 清单以上面那张词表为准**，不要在这里数个数——数字会和代码漂开，
指针不会。`check_suite.py` 会核对词表和 `sdlc_audit.py` 的实际取值是否一致。

核对结论要给人看时，同样可以配 `render_review.py status` 的那张依赖图与 WI 表——**同一份快照，重跑即重建，不手改、不维护**。

**这个脚本只报告，不修复。** 这条不是保守，是因为**不一致本身是证据**：一个 `status: Verifying` 却没有 contract 的 WI，说明有人跳过了一个环节——静默把状态改回去，就把"这里发生过跳步"这件事也抹掉了。

处置方式按类别分：

| 类别 | 谁去修 |
|---|---|
| 产物缺失、Gate 与状态不符 | 回到对应环节补，或退回上一个状态。**由那个环节的人决定是哪一种** |
| Held 缺三要素、无 owner | 找 WI owner 补 |
| 可写范围重叠 | 两个 WI 的 owner 一起决定：先后做，还是合并 |
| 指针失效、approvers 空缺 | 你可以直接提出建议，但改 `config.yaml` 是 Policy 级改动，走新 WI |

---

## 三、验收：某个环节说"完成了"

**你是接收方，不是裁判。** 验收产出的是**缺口清单**，不是"通过/不通过"的判定——那个判定属于下一个环节的人，他要基于这份清单决定接不接。

**REQUIRED**：读 `references/acceptance-checklists.md`，八个环节各自的出口产物、该跑哪个脚本、Done When 摘要都在那里。

三步：

1. **跑确定性脚本**（每个环节对应哪个，见清单）
2. **对照出口产物齐全性**——不是看文件在不在，是看关键小节有没有留白。留白和"确实没有"是两回事，模板里凡是要求"为空也要写无"的地方都是这个原因
3. **列缺口**，每条写清：缺什么、去哪补、不补的后果

**不做的三件事**：不替下游签字（铁律一）、不改上游的产物（那是它的所有权）、不把"缺口清单为空"说成"通过"——它只说明**机械可查的部分**没问题。

---

## 四、Family：这条链本身的形状

阶段序列在 `.sdlc/family.yaml`。文件不存在时用内置的 AI-native delivery 序列，所以多数项目不需要建它。

需要它的两种情况：改阶段序列（例如某项目要在 QA 前加一道安全评审），或声明第二个 Family（数据治理、MMM 之类）。

```bash
cp "$CORE/templates/family.yaml" .sdlc/family.yaml
```

改完立刻验证脚本能读：`wi_status.py` 输出的 `family` 字段应该显示你的 family 名而不是 `builtin`。

解析失败或 stages 无效时，脚本**回退到内置序列但会大声报警**——`family_warning` 字段和 `needs_attention` 第一条都会说明原因。这个组合是有意的：一个配置笔误不该把状态查询整个搞挂（回退），但也不能让路由悄悄换回内置序列还看起来一切正常（报警）。**看到 `family` 显示 `builtin` 而你明明建了文件，先读 `family_warning`。**

另外会校验你声明的 `status` 是否都在状态机词表内——写了 `Brainstorming` 这种自造状态会被点名，因为没有任何环节会把 WI 置成它，那条阶段永远不会被触发。

**改 family.yaml 是 Policy 级改动**：它改变的是所有后续工作的形状。走 `sdlc-learn` 的 Lesson 流程（`target_kind: policy`），不要就地改。

---

## 五、收尾

WI 进入 `Completed` 或 `Cancelled` 后核对四件事：

- [ ] `evidence.jsonl` 有终态事件（`gate_decided` 或状态变更）
- [ ] Lesson 候选移交了没——各环节的交接节都会产生候选，没人交就等于没发生
- [ ] `current.yaml` 该不该切到下一个活跃 WI
- [ ] 依赖它的 WI 现在解锁了吗，去告诉那些 owner

第二条最容易漏。**复盘不是终点，移交才是**——一条留在 qa-report 里没交出去的观察，下一个季度会被重新发现一遍。

---

## 工具边界

| 边界 | 内容 |
|---|---|
| **可读** | 整个 `.sdlc/`、项目代码与文档（只读） |
| **读排除** | `config.yaml` 的 `data_policy.never_read` |
| **可写** | **只写 `.sdlc/family.yaml`**（且仅在声明 Family 时），以及 `evidence.jsonl` 追加；`.sdlc/review/status.html` 由 `render_review.py status` 写——生成物，重跑即重建，不手改也不维护 |
| **受保护** | 所有环节产物（contract / change-scope / test-plan / build-evidence / qa-report / evidence-case / incident / lesson / gates）—— **一律只读**。它们各有所有者 |
| **禁止动作** | 写任何 Gate 文件、改任何 WI 状态、改业务代码、执行 deploy/push/publish；把 `status.html` 做成常驻看板并定期刷新（D13） |
| **升级条件** | 需要改环节产物 → 交回那个环节；需要改 config.yaml → 走新 WI；发现要改 family.yaml → 走 sdlc-learn |

**环境与凭据**：`environment: local`，`credentials: none`。本环节只读文件、跑校验脚本，不需要任何凭据。

**为什么写权限这么窄**：调度者一旦能改被调度对象的产物，"调度"就变成了"代做"，而代做的东西没有人复核——原本该由环节所有者承担的责任凭空消失了。

## Runtime 与配置来源

**不起 subagent。** 本环节的工作是读文件、跑脚本、把结果翻译成判断，没有需要隔离的上下文（对比 sdlc-qa 的 contract-only subagent——那是为了防止实现污染预期，是结构性需求）。

**并发**：一次处理一个问题。同时排程又验收会让两边的结论互相干扰。

**配置来源三层**，报结论时说清依据来自哪一层：

| 层 | 定义在 | 改它要找谁 |
|---|---|---|
| 套件级 | 内置 `PHASE_NEXT`、`STATUS_REQUIRES` | 走 sdlc-learn |
| 项目级 | `.sdlc/family.yaml`、`.sdlc/config.yaml` | 平台负责人 / 新 WI |
| 单次 | 各 WI 自己的产物 | 该 WI 的 owner |

---

## 交接

| 发现了什么 | 交给谁 |
|---|---|
| 某环节产物有缺口 | 那个环节的 Skill |
| WI 卡在人身上 | 具名那个人（把等了多久一起说） |
| 依赖环 / 范围重叠 | 相关 WI 的 owner 一起决定 |
| 记录与实际不符 | 造成它的那个环节，不要自己改 |

### 交给 sdlc-learn 的 Lesson 候选

本环节看得见的是**跨 WI 才会显形的模式**，其他环节在自己那一段里看不到：

- 同一类不一致反复出现（例如总是 Gate 通过了状态忘记改）→ 说明某个环节的出口动作不完整
- 同一对路径反复重叠 → 说明 WI 的切分方式有问题
- 依赖环反复出现在同几个模块之间 → 说明那几个模块的边界该重画
- 某个阶段总是要退回 → 说明它的入口条件定得不对

交观察和证据，不交结论。

---

## Done When

- [ ] 本次回复以 `wi_status.py --header` 的原样输出开头，状态行不是手写的
- [ ] 排程结论说清了"可以先做什么"和"卡在谁那里多久了"，不是一串编号
- [ ] 一致性核对跑过，findings 每条都有明确的去向（谁去修）
- [ ] 验收产出的是缺口清单，没有出现"通过/不通过"的判定
- [ ] 没有写过任何环节产物、Gate 文件或 WI 状态
- [ ] 改过 family.yaml 的话，`wi_status.py` 的 `family` 字段显示的不是 `builtin`
- [ ] 跨 WI 的判断记了 `input_refs`，说清依据的是哪一版
- [ ] 用到 `render_review.py status` 的话，给的是 `.sdlc/review/status.html` 的路径 + 结论；没有把它当成需要维护的看板
- [ ] 收尾四项核对过，尤其是 Lesson 候选有没有真的移交
- [ ] 九个配置面都能在正文里指认出落点
