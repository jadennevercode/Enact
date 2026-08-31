---
name: sdlc-operate
description: Use when something has gone wrong in a live or production environment - a user reports an outage, errors or alerts firing, degraded performance, data looking wrong after a release, a rollback that just happened, or someone asks to triage, diagnose or run a post-mortem on a production problem. Also use when an incident needs to be opened and linked back to the work item, contract version and release that produced it, when deciding what to mitigate now versus what to fix at the root, or when a confirmed root cause has to be routed back to the upstream object it actually came from. Not for implementing a planned change (that is sdlc-build), not for verifying a change before it ships (that is sdlc-qa), and not for turning the lesson into a standard (that is sdlc-learn).
---

# SDLC Operate —— 把线上事实回写到同一条意图与证据链

线上出问题时，最快的做法永远是改一行代码让报警消失。这个环节存在的理由是：**那样做，同一类问题会在下一次工作里原样重现**。

事故是真实世界对一条意图链的反馈。它告诉你的不只是"哪行代码写错了"，而是"哪个 Contract 没写清楚 / 哪条边界条件没人想到 / 哪个测试标准漏了一整类场景 / 哪份模板放任了这个错误"。把这个反馈丢掉，等于每次都用停机时间买一个教训，然后不要它。

所以本环节的出口产物不是补丁，是 `incident.md`——尤其是它的**第 6 节上游归位**。

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

## 开工前

**REQUIRED**：读 `../sdlc-core/references/redlines.md`——特别是 §5 的豁免记账流程。事故是这套体系里唯一常见的合法豁免场景，也正因为如此，它是红线最容易被永久性绕过的地方。

必读输入：

| 来源 | 读它拿什么 |
|---|---|
| 用户的事故描述、报警、日志 | 现象事实 |
| `.sdlc/current.yaml` + `.sdlc/work-items/*/work-item.yaml` | 最近发布了什么、哪个 WI 覆盖了这块 |
| 相关 WI 的 `contract.yaml`、`evidence-case.md`、`qa-report.md` | 当时批准的意图是什么、验证到什么程度 |
| `git log` | 近期变更范围 |

快速定位相关 Work Item：

```bash
python3 "$CORE/scripts/wi_status.py" --root <项目根>
```

## 两条边界，事故中比平时更重要

### 诊断只读

本环节可以读全库、读日志、跑只读的诊断命令。**任何实际修改走新 Work Item 的 change-scope**（红线 3）。

这条边界在事故压力下最容易被突破，而它恰恰在事故中最有价值：**事故期间是判断质量最低的时刻，同时是变更风险最高的时刻**。你手上的信息不完整、时间压力真实存在、注意力全在"让它停下来"上——这正是最容易改错地方的状态。而生产系统此刻已经不健康，一次盲改可能把一个可回滚的故障变成一个不可回滚的故障。

平时越界的代价是复核变难；事故中越界的代价是把小事故做大。

### 建议不等于执行

你的产出是**处置建议**，分三类呈现。执行任何缓解动作之前先确认。

不是因为你的判断不值得信任，而是因为事故中的处置动作往往不可逆（重启丢现场、回滚丢数据、清缓存丢证据），而做决定的人掌握着你看不到的信息：这个服务此刻有没有人在用、能不能停、业务方愿意承受哪种损失。

## 八步

### 1. 建 INC-### 并做关联

`.sdlc/incidents/` 下没有编号脚本，取现有目录的最大号 +1：

```bash
ls .sdlc/incidents/ 2>/dev/null
mkdir -p .sdlc/incidents/INC-00N-<slug>
cp <core>/templates/incident.md .sdlc/incidents/INC-00N-<slug>/incident.md
```

**关联先于诊断。** 填 incident.md 第 2 节的七行关联表，在你开始猜原因之前：

| 关联对象 | 怎么找 |
|---|---|
| 相关发布 | 最近一次 `gates/release.yml` 为 PASS 的 WI |
| 原 Work Item | 故障功能属于哪个 WI 的 scope.included |
| 相关 contract 版本 | 该 WI 的 `contract_version` |
| 相关 Evidence Case | 该 WI 的 `evidence-case.md` |
| 出问题的产物修订 | 从报错栈/日志里的文件反查 `git log -1 --format=%H -- <文件>`，或取该次发布 gate 的 `merged_revision` |
| 相关监控 | 哪条告警规则先响的、哪个看板能看到、哪个指标偏离了 |
| 近期变更 | `git log --oneline --since=<上次发布>` |

后两行是最容易被当成重复而略过的，但它们各自回答一个别处答不出的问题：

- **产物修订**不是"近期变更"的缩写。`git log` 给的是一个范围，范围里可能有十几个 commit；上游归位要问的是"**哪一版**引入了它"，范围答不了这个问题，具体 commit 才能。修复之后的验证也要拿它做对照。
- **监控**不是第 1 节"监控报了什么"的重复。第 1 节记的是现象，这一行记的是**观测面本身**：有没有一条规则本该先于用户发现它。填不出来时写"无对应告警，由用户投诉发现"——**这句话本身就是一条上游归位结论**，直接进第 6 节。

关联为什么要放在最前面：一旦你先形成了假设，就会只去找支持它的证据。而且找不到关联对象本身就是重要信息——**如果这次故障对应不上任何一个 WI，说明它来自一条没有走治理链的变更，这本身就是根因的一部分**。

向该 WI 的 `evidence.jsonl` 追加一条 `action: incident_linked`，并给它填 `correlation`——**取本事故编号 `INC-###`，不是 WI 编号**。

本事故引发的每一条事件都带这同一个 correlation：第 7 步建了修复 WI 之后，向**修复 WI 的 `evidence.jsonl` 再写一条 `incident_linked`**，correlation 仍是 `INC-###`；第 8 步移交 learn 时，LP 的证据引用也带上它。

为什么必须这样：`evidence.jsonl` 是按 WI 目录分片的，而"事故 → 原 WI → 修复 WI → LP"这条因果链横跨至少两个目录。主规格 §19 规定的 Provenance 验证方式是**从 Evidence Case 反查所有引用**——这条反查在跨 WI 的那一跳会断，机器读不出这两个 WI 说的是同一件事，人只能靠 notes 里的自然语言猜。`correlation` 是唯一把它们缝起来的字段（字段说明见 `../sdlc-core/references/evidence.md`）。

### 2. 写现象与时间线

第 1 节写现象：**用户看到什么、监控报了什么**。写事实，不写推测。

✅ `13:42 起 /api/export 返回 500，错误率 100%，日志中 KeyError: 'refund_amount'`
❌ `导出功能因为字段缺失崩溃了`（这已经是结论了，而且可能是错的）

第 3 节时间线随诊断持续追加，包括你自己做的每个动作。事后复盘时，"什么时候做了什么"往往比"最终结论"更能说明问题。

### 3. 形成假设并三分类

第 4 节，每条假设要有依据（日志行、diff、指标），不能是"感觉是缓存问题"。

处置建议按下表分类呈现：

| 分类 | 含义 | 呈现方式 |
|---|---|---|
| **立即缓解** | 让损失停止扩大，不解决根因 | 说清楚代价：丢什么、影响谁、可逆吗 |
| **根因修复** | 真正的修复，走新 WI | 说清楚需要多久、能不能等 |
| **需人批准** | 涉及数据、资金、对外通告、不可逆动作 | 只能由具名的人决定，你不替他选 |

呈报格式：

```
## INC-00N 处置建议

**现在的状态**：<一句话，损失是否还在扩大>

**立即缓解**（选一个）
1. 回滚到 <版本>：约 3 分钟恢复；代价是 <本次发布的功能全部下线>；可逆
2. 关闭 <feature flag>：约 30 秒；代价是 <该入口对全量用户不可用>；可逆

**根因修复**（不阻塞缓解）
- 假设 H1 成立时：新建 WI 修 <具体什么>，预计 <多久>

**需人批准**
- 是否需要给受影响的 <N> 个客户发通告

需要我执行哪一项缓解？还是先继续诊断？
```

### 4. 缓解执行前确认

拿到明确指令再动手，而且动手的方式仍然是**新 WI 的受控通道**——事故中的 `lane: quick`：

```bash
python3 "$CORE/scripts/new_work_item.py" <项目根> "<缓解动作>" --owner <指挥人> --lane quick
```

真正无法等待的情况（损失在扩大、批准人不可达）走红线 §5 的豁免流程：在 Gate YAML 里写 `gate: WAIVED` + 完整的 `waiver` 段，**`deadline` 必须是一个具体日期**。见第 6 步。

执行后向 evidence.jsonl 追加 `action: command_run` 或 `file_modified`，`notes` 写清是在事故处置中做的。

### 5. 确认根因，区分触发条件与根本原因

第 5 节。这一步最常见的失败是把**触发条件**当成根本原因。

| 触发条件（表象） | 根本原因（可能） |
|---|---|
| 重启后恢复了 | 连接池泄漏；重启只是清了状态 |
| 流量峰值时崩 | 某个 O(n²) 路径一直存在，只是平时没被压到 |
| 上游返回了 null | 我方对上游契约的假设从未被验证过 |
| 某个客户的数据格式特殊 | 输入校验的边界条件在 Contract 里就没写 |

自检一句话：**"如果这个触发条件明天再来一次，同样的故障会不会再发生？"** 答案是"会"，你找到的就还是触发条件。

找不到确定根因时如实写"根因未确认 + 已排除哪些 + 还需要什么证据"，不要写一个说得通的故事（红线 4.3）。带着未确认根因关闭事故是允许的；伪造一个不是。

### 6. 上游归位 —— 本环节的核心产出

**REQUIRED**：读 `references/upstream-mapping.md`。那份文件是"根因类型 → 该更新哪个上游对象"的判别指南，本步骤按它逐项判断。

第 6 节的表格填完之后，问自己一个问题：**如果只做第 7 节的代码修复，同一类问题下次会不会以另一种形式再出现？**

- 会 → 上游归位表里一定有东西要填。
- 不会 → 也要在表里写清楚"无上游对象，理由是……"。

只填了"改了某行代码"而这张表全空的事故，等于没有从中学到东西。**"没有上游对象要改"是一个合法结论，但它必须是一个判断，不能是一次省略**——判别依据见 upstream-mapping.md 最后一节。

### 7. 修复作为新 WI，并把加速通道的记录补齐

第 7 节。修复用新的 `lane: quick` Work Item 进入同一 Family，保留与原 WI、原 contract 版本、本事故的关联（写进新 WI 的 `work-item.yaml` 的 `refs` 与 `notes`）。

**不要在原 WI 上直接改**。原 WI 记录的是"当时批准了什么、验证到什么程度"，那是事故分析的证据。改掉它就销毁了证据。

新 WI 建好之后立刻向**它自己的** `evidence.jsonl` 追加一条 `incident_linked`，`correlation` 填 `INC-###`（与第 1 步那条完全相同），`input_refs` 指向 `incident.md`。写进 `work-item.yaml` 的 `notes` 只有人读得懂；同一个 correlation 才让"原 WI 出的问题、由这个 WI 修"这层关系被机器读出来。

补记录清单——事故期间可以先做后补，但每项要有截止时间且真的完成：

- [ ] 缓解动作对应的 change-scope 已补
- [ ] 越界或跳过的 Gate 已按红线 §5 写成 `gate: WAIVED` + `waiver` 段 + `deadline`
- [ ] `waiver.compensating_record` 里承诺的补签、补测、补 Amendment 已完成
- [ ] 上游归位表里的 AMD / 新 criterion / LP 已实际提出
- [ ] 修复 WI 的 `incident_linked` 已写，`correlation` 与原 WI 那条一致

**事故期间跳过的记录，事后不补就是永久的证据缺口。** 三个月后没人能重建当时的判断依据，而 `gate: WAIVED` 会一直留在 history 里——那正是它该有的成本。到了 `deadline` 还没补齐的项，把 WI 置为 `Held` 并写清 `blocked_by`，不要让它静默过期。

### 8. Lesson 候选

第 8 节。上游归位表里指向"Skill / 模板 / 清单"的那一行，就是 Lesson 候选，移交 **sdlc-learn**。

移交时带上：现象、根因、你认为哪个能力资产该改、以及**这次的证据**（incident.md 路径 + 相关 evidence.jsonl 引用，注明 `correlation: INC-###`）。learn 靠这个锚点一次捞出两个 WI 上的全部相关事件，不必人工拼。没有可沉淀的经验就写"无"——一次成功的处置不等于一条普遍规律，凑数的 Lesson 会污染之后所有工作（红线 4.2）。

你不修改任何模板或 Skill 文件。那是 sdlc-learn 在拿到 `lesson-approval.yml` 之后才做的事。

## 事故关闭前自检

不是人工 Gate，但不通过不能标"已关闭"：

- [ ] 第 2 节关联表七行都有结论（找不到的写"无对应对象"+ 理由）；产物修订是具体 commit，监控行填不出时已写成一条发现
- [ ] 原 WI 与修复 WI 的 `evidence.jsonl` 各有一条 `incident_linked`，`correlation` 相同
- [ ] 第 5 节根因区分了触发条件与根本原因，或如实标注"未确认"
- [ ] **第 6 节上游归位有结论**——有对象则每行有具体处置，无对象则有判断依据
- [ ] 第 7 节的补记录清单全部勾完，或未完成项有 `deadline` 且 WI 处于 `Held`
- [ ] 状态改为"已关闭"，向 evidence.jsonl 追加最终事件

## 工具边界

五要素：**可读 / 可写 / 受保护 / 禁止动作 / 升级条件**。前两条说的是"我干什么"，后三条说的是"我撞到边界时怎么办"。

- **可读**：全库、日志、`git log`、`.sdlc/` 全部、只读诊断命令类别（`curl` 查询、`kubectl get/logs/describe`、只读 `SELECT`、`grep` 日志）。
- **读排除**：`config.yaml` 的 `data_policy.never_read` 命中的路径（`.env`、密钥、凭据文件）。**事故中这条比平时更容易破**——排障时"看一眼配置里的连接串"是最自然的动作，而它会顺着时间线或 notes 永久留在 git 里。需要核对某项配置时，请有权限的人去查，只回报"对/不对"。
- **可写**：仅 `.sdlc/incidents/INC-###/` 与 `.sdlc/**/evidence.jsonl`。
- **受保护**：任何业务代码、配置、基础设施（走新 WI 的 change-scope）；本套件自身的模板与 Skill 文件（sdlc-learn 的唯一入口）。
- **禁止动作**：一切有副作用的命令——重启、回滚、清缓存、改配置、发布、`db-migrate`。它们是第 4 步的**缓解建议**，不是本环节的执行动作。
- **升级条件**（出现任一就停下呈报，不要自行决定）：要跑一条有副作用的命令；要写 `.sdlc/incidents/` 之外的文件；要读 `never_read` 命中的内容；要在没有对应 WI 的情况下改动生产状态。

**环境与凭据**：诊断命令跑在**生产只读**上下文（`environment: production`、`access: read-only`）。凭据由执行人提供或代跑，**不写入 `.sdlc/` 的任何文件**。没有只读凭据时把命令交给有权限的人执行并回报输出摘要——不要为了省一轮交互去要一份带写权限的凭据，事故中拿到的临时权限往往没人记得回收。

**约束的来源分层**：`always_forbidden`（deploy / push / publish / db-migrate）与 `never_read` 来自 `config.yaml` **项目级**，不是本次事故自己收紧的。被拦下时要说清是哪一层——项目级要找平台负责人改，本次处置的收紧找指挥人就行。

## 能力与 Runtime

**本环节用哪些能力资产**：`../sdlc-core/templates/incident.md`（产物模板）、`references/upstream-mapping.md`（第 6 步的判别清单）、`../sdlc-core/references/redlines.md` §5（豁免记账流程）。首次从模板实例化 `incident.md` 时，向 evidence.jsonl 追加一条 `capability_bundle_pinned`，`input_refs` 填模板路径 + 当前 git hash。

为什么要钉版本：事故复盘常常发生在几周之后，那时模板可能已经被 sdlc-learn 改过几版。不记下"当时用的是哪一版清单"，就答不出"为什么当时那一栏是空的"——它可能根本还不存在。

**Runtime**：当前编码 Agent 会话（Claude Code、Codex，或由 Enact 管理的 Runtime），不做多 Runtime 主备。本环节**不起 subagent**——诊断是只读的，没有需要隔离的写入面；而事故上下文（时间线、已排除的假设、已确认的关联）必须连续，拆进子会话反而会丢掉"什么已经试过了"。sdlc-qa 使用独立 QA 上下文是为了把实现上下文隔离在外，那个理由在这里不成立。

**并发与降级**：一次只处置一个 INC。同时来两个事故时，先各自建 INC 把现象与关联记下来，再由指挥人决定处置顺序。并行诊断会让两条时间线互相污染，而时间线是事后唯一能重建判断过程的东西。


### 出口评审：交给 运维

本环节没有 Gate，但**不等于没有人看过**。产出就绪后交给 `config.yaml` 的
`phase_review.operate` 指定的角色（默认 **运维**）评审，他判断的是「处置与根因判断对不对」。

呈报给**路径 + 摘要**，不是全文。拿到回应后向 `evidence.jsonl` 追加一条：

```json
{"action": "phase_reviewed", "actor": "<评审人真名>", "notes": "operate · 运维 · ok"}
```

有缺口就写 `"operate · 运维 · gaps：<缺什么>"`，并说明是补齐还是带着缺口往下走。

**这不是 Gate**：不接受风险、不阻塞、没有四值词表。它只回答一件事——**有没有人真的看过**。
缺了 `sdlc_audit.py` 会报 `phase-not-reviewed`（medium）。

## 交接

| 去哪 | 什么时候 | 带什么 |
|---|---|---|
| `sdlc-build` | 缓解或修复要实施 | 新 WI（lane: quick）+ contract 或 AMD 引用 |
| `sdlc-contract` | 根因是 Contract 缺陷 | `amendments/AMD-###.md` 提到原 WI 下 |
| `sdlc-qa` | 根因是测试覆盖盲区 | 要补的 Test Intent 与它对应的 criterion 编号 |
| `sdlc-learn` | 根因指向流程、模板、Skill | Lesson 候选 + incident.md 证据引用 |

## Done When

- [ ] `INC-###/incident.md` 已建，七行关联表在诊断开始前就填了（含出问题的产物修订与相关监控）
- [ ] 现象写的是事实，时间线包含你自己做过的动作
- [ ] 处置建议按 立即缓解 / 根因修复 / 需人批准 三分类呈现，每条带代价说明
- [ ] 执行任何缓解动作之前拿到了明确指令，动作本身走了新 WI 或有 `gate: WAIVED` 记账
- [ ] 根因区分了触发条件与根本原因，或如实写"未确认 + 还缺什么证据"
- [ ] **上游归位表有结论**：每行有具体处置，或有"无上游对象"的判断依据
- [ ] 修复是新的 `lane: quick` WI，原 WI 未被改动
- [ ] 加速通道补记录清单全部完成，或未完成项有 deadline 且 WI 为 `Held`
- [ ] 本事故的全部事件共用一个 `correlation: INC-###`，原 WI 与修复 WI 上各有一条 `incident_linked`
- [ ] Lesson 候选已移交 sdlc-learn（或明确写"无"）
- [ ] 全程未修改任何业务代码、配置或本套件文件，也未读入 `never_read` 命中的内容
- [ ] 九个配置面都能在正文里指认出落点（见 `../sdlc-core/references/authoring-conventions.md` §0）
