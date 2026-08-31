# Gate 规则

Gate 是把"能不能往下走"这件事，从感觉变成可检查的记录。

## 两段式结构

每个 Gate 都是**先确定性预检，后人工授权**，顺序不能倒：

1. **确定性预检**：规则可计算的条件由脚本或逐项清单判定。不通过就直接给出待补清单，**不进入人工环节**——不要拿一份自己都知道不完整的东西去占用别人的判断力。
2. **人工授权**：涉及风险接受的条件由具名责任人决定。

LLM 在其中的角色是收集证据、解释证据、指出缺口、给出建议结论。**不包括签字**（红线 1）。

## 五个必须人工批准的 Gate

| Gate 文件 | 环节 | 决定什么 | 为什么必须人工 |
|---|---|---|---|
| `contract-approval.yml` | contract | 意图与边界是否正确 | 后面所有工作以它为准，错了全错 |
| `scope-expansion-###.yml` | build | 是否允许改保护范围外的东西 | 一次不可逆的信任扩大 |
| `build-review.yml` | build → qa | 做法方向对不对，值不值得进 QA | 见下节 |
| `release.yml` | release | 是否接受生产风险 | 责任必须落到具体的人 |
| `lesson-approval.yml` | learn | 是否把一次经验固化为标准 | 会影响之后所有工作 |

其余环节的出口检查是自检清单（确定性），不需要人工签字，但不通过同样不能往下走。

## 谁来评审：角色

这套流程的基本形态是**每个阶段由 Agent 执行、由人评审**。所以问题不是"谁签这个 Gate"，
而是**这个阶段的产出结束时，该由谁看**。Gate 只是其中四个阶段记录这次评审的方式——
签署本身就是那次评审，不是额外的一道手续。

**要的不是"一个人"，是"某几种判断"。** 一份 Contract 同时装着业务意图、技术方案和
发布风险，底下签一个名字，意思要么是这个人复核了三样，要么——更常见——是没人问过
他专业范围之外那几块由谁负责。

角色是受控词表，五个，不能自造：

| 角色 | 对什么负责 | 在 contract 里看哪几块 |
|---|---|---|
| `业务负责人` | 业务结果与验收标准 | outcomes、requirements、criteria、scope |
| `架构` | 方案、变更边界、技术决定 | design、boundary、policies |
| `开发` | 实现方式 | criteria、design、boundary |
| `QA` | 验证充分性 | criteria、scope、design.impact、release.rollback |
| `运维` | 发布、回退、监控 | release、design.nfr、design.impact |

### 八个阶段各由谁评审

配置在 `config.yaml` 的 `phase_review`。**四个阶段出口 Gate 的签署角色由它派生**，
不在 `gates:` 下重复声明——一件事两处配置，迟早会漂开。

| 阶段 | 评审角色 | 判断的是什么 | 落成什么 |
|---|---|---|---|
| intake | 业务负责人 | 这是不是该做的事，框对了吗 | `phase_reviewed` 事件 |
| explore | 业务负责人 | 这些结论和假设成立吗 | `phase_reviewed` 事件 |
| contract | 业务负责人 + 架构 + 运维 | 三块内容各有人认领 | **`gates/contract-approval.yml`** |
| build | 开发 | 做法方向对不对 | **`gates/build-review.yml`** |
| qa | QA | 验得够不够 | `phase_reviewed` 事件 |
| release | 业务负责人 + 运维 | 面向用户的风险 + 运行时风险 | **`gates/release.yml`** |
| operate | 运维 | 处置与根因判断对不对 | `phase_reviewed` 事件（记在 INC 上） |
| learn | 架构 | 该不该固化成标准 | **`gates/lesson-approval.yml`** |

`scope-expansion` 不在表里：它不是阶段出口，而是 build 中途有东西要越出已声明范围时才发生的，
所以在 `gates.scope-expansion.require` 里单独声明，默认 `架构`。

### 评审和 Gate 不是一回事

| | 评审（`phase_reviewed`） | Gate（`gates/*.yml`） |
|---|---|---|
| 回答的问题 | 有没有人真的看过 | 有没有人接受这个风险 |
| 阻塞吗 | 不阻塞 | 不通过就不能往下走 |
| 词表 | 无。notes 写「<阶段> · <角色> · ok / gaps：…」 | `PASS / CONCERNS / FAIL / WAIVED` |
| 缺了怎么判 | `sdlc_audit.py` 报 medium | 铁律一，下游全部无效 |

把无 Gate 的四个阶段也做成 Gate 是错的——**Gate 是风险转移，不是"看过了"的收据**。
四个已经足够多，再加只会让每一个都变轻。但"没有 Gate"不该等于"没有人看过"，
这正是 `phase_reviewed` 补的那一格。

### 为什么 contract 要三个角色

**实测出来的，不是为了隆重。** 只要 业务负责人 + 架构 时，`release` 块——发布策略与回退方案——
会落在没有任何签署人的视野里。`coverage_stats.py --phase contract` 现在会把这种情况报出来：
**签署角色的 `role_views` 合起来必须盖住 contract 的每一块。**

release 只要 业务负责人 + 运维，是因为方案本身在 contract 就批过了；变了会走 Amendment 回到 contract，
不必在发布前重签一次。团队希望架构在发布前再确认一次的，往 `phase_review.release` 里加就是了。

### 一个人可以担多个角色

**这是常态，不是将就。** 小团队里同一个人既定业务又定架构，如实在 `config.yaml` 的
多个角色下写他的名字即可。签的时候写成**一条记录、多个 roles**：

```yaml
approvals:
  - by: 张三
    roles: [业务负责人, 架构, 运维]
    at: 2026-08-25T14:30:00Z
```

**不要拆成三条假装是三个人看的**——那是把一次判断打扮成三次独立判断，
而记录的全部价值就在于它说的是真的。写成一条，审计时一眼看出这三件事是同一个人拍的板，
这个信息本身是有用的。

### 机器在检查什么

`validate_gate.py`：require 里的每个角色都有人签；签的人在 config 里确实担这个角色；
角色名在词表内；`approved_by` 本人也在签署列表里（宣布结论的人得有自己的判断在里面）。

`coverage_stats.py --phase contract`：**签 contract-approval 的角色，其 `role_views` 合起来
盖住 contract 的每一块**。盖不住就报出来——那一块内容没有任何签署人看过，
落在它上面的签字签的不是它。

只要一个角色的 Gate（scope-expansion、build-review、lesson-approval），
`approvals` 可以整段省略，`approved_by` 就够了。

---

### build-review：为什么在进 QA 之前要停一次

这个 Gate 补的是一个真实的缺口：**在它之前，从 Contract 批准到 Release 决定之间，
人一次都不看代码。** Build 自检全绿就直接切 `Verifying`，QA 接手，等人再次被请来做判断时，
已经是 Release 前的 Evidence Case——那时候方案已经被测过一轮，说"方向不对"的代价
比在这里说贵一个数量级。

三条理由：

1. **QA 是最贵的环节**。独立上下文、冻结 Test Intent、搭环境、写测试、跑回归。
   方向性错误在这里拦下，成本是一次 build 返工；漏进 QA，成本是一整轮 QA 加返工加重测。
2. **确定性检查检不出"做法不对"**。`check_scope.py` 能证明没越界，`coverage_stats.py`
   能证明每条 criterion 都有映射——两者全绿，实现方式依然可能是错的。
   一个用轮询实现了本该用事件的功能，所有机械检查都会通过。
3. **"已验证"会硬化判断**。QA 通过之后再推翻方案，推翻的不只是代码，还有一份别人做完的
   验证工作。人在那个位置上更倾向于接受而不是质疑——这不是谁不负责，是沉没成本的正常作用。
   所以要在它硬化之前设一个观看点。

**它批的是方向，不是正确性。** 正确性是 QA 的工作，别在这里预演。批准人要回答的是：
这个做法是我们想要的做法吗？有没有明显更简单的路子？build-evidence 第 5 节点出来的风险，
我接受吗？

### 权重随 lane 变，但不跳过

`lane: quick` 时呈报可以压到三行（改了哪些文件、做法一句话、风险有没有），
但 **Gate 文件照样要有，`approved_by` 照样要具名**。

项目确实认为 quick lane 不需要这一停时，在 `.sdlc/config.yaml` 里声明：

```yaml
gates:
  build_review:
    quick_lane: self-check          # required（默认）| self-check
    self_check_decided_by: 李四      # 选 self-check 时必填，否则视为 required
```

**为什么关掉它需要签名**：不签名就能关掉的人工审查，等于没有人工审查——
第一次赶工就会被关掉，而且没有人记得是谁关的、当时为什么觉得可以。
写一个名字的成本很低，它换来的是这个决定有主。

`lane: full` 没有这个开关。full lane 的定义就是"这件事值得走完整流程"。

## Gate YAML 格式

一个 Gate 一个文件，放在 `work-items/WI-###-slug/gates/`。

```yaml
gate: PASS                    # PASS | CONCERNS | FAIL | WAIVED —— 固定四值，无变体
approved_by: 张三              # 具名。AI/system/空 均无效
decided_at: 2026-08-21T14:30:00Z
status_reason: 三条 criteria 均可自动验证，历史回填的未决问题已明确接受不做
scope: contract-approval      # 这个 Gate 管什么
merged_revision: contract v1  # PASS/CONCERNS 时必填：这次批准产生了哪个版本。
                              # contract 填版本号，build-review 填 commit range，
                              # release 填发布的 revision，确实没有就写"无"。
                              # 空着 validate_gate.py 直接判失败——审计时要能答出
                              # "当时批准的到底是什么"，一个没有对象的批准记录等于没有
publish_scope: task           # task | policy | skill —— 这次决定的影响半径
deterministic_checks:         # 预检结果，脚本产出
  passed: 6
  failed: 0
  details: coverage_stats.py --all-criteria-have-verification → ok
top_issues:                   # 可为空；CONCERNS/FAIL 时必填
  - id: TEST-001
    severity: medium          # low | medium | high —— 固定三值，无变体
    text: 退款并发场景无自动化覆盖，依赖人工确认
    suggested_owner: qa       # explore | contract | build | qa | release | operate
history:                      # 追加，不覆盖
  - decided_at: 2026-08-20T09:00:00Z
    gate: FAIL
    approved_by: 张三
    status_reason: criteria 1.2 无验证方式
```

**词表是固定值，不接受变体**：`gate` 只能是那四个词（不能写 `passed`、`approved`、`ok`）；`severity` 只能是那三个（不能写 `critical`、`P0`）。词表固定是为了让统计和审计能机械进行。

`validate_gate.py` 会校验：词表合法、必填字段齐全、`approved_by` 非空且不属于 AI 标识、
CONCERNS/FAIL 时 `top_issues` 非空、`history` 每条记全了「谁在什么时候判了什么」、
以及 `history` 里没有比当前决定更晚的记录。

**「只增不减」要和已提交版本比对才检得出来**：单看一份文件，被改写过的和正确的长得一模一样。
所以这一条走 git——文件已被跟踪时和 `HEAD` 版本比，历史变短或旧记录被改写都判失败。
不在 git 仓库里、或文件还没提交过时，这一条**不运行**，也不假装运行过。

## 「等待批准」没有对应的值——这是有意的

词表里没有 `PENDING`。**等待批准的表示方式是这个文件还不存在。**

原因：Gate 文件一旦存在就会被当作一次已经发生的决定——被 `validate_gate.py` 统计、被 release 预检读取、被审计当作证据。先建一个占位文件等着回填 `approved_by`，等于制造一份看起来像决定的东西。

所以在拿到人工批准之前：
- 不要创建 Gate 文件
- 不要创建 `approved_by: ""` 的空壳
- 不要为了"先走完流程"填任何一个词表值

要记录"我走到这里、在等谁"，用这三个地方：`work-item.yaml` 的 `blocked_by`、`evidence.jsonl` 的 `boundary_stop` 事件、以及你给用户的批准请求本身。`wi_status.py` 会把它们汇总成待办。

## 四个结论的语义

| 值 | 对应规格用语 | 含义 | 下一步 |
|---|---|---|---|
| `PASS` | approve / Release | 规则通过，责任人接受风险 | 进入下一环节 |
| `CONCERNS` | approve with conditions | 通过但有已知问题 | 可以继续，`top_issues` 必须写清楚并有 owner |
| `FAIL` | request change / **Hold** / **Reject** | 不通过 | 见下方区分 |
| `WAIVED` | override | 豁免（红线 §5 流程） | 必须有 `waiver` 段与补齐动作截止时间 |

### Hold 与 Reject 都落成 FAIL，靠一个字段区分

责任人回答的是「Hold」还是「Reject」，落盘用的都是 `gate: FAIL`。**区分它们的是 `reentry_conditions` 有没有值**：

| 责任人说 | 性质 | 怎么落盘 |
|---|---|---|
| **Hold** | 证据不够，补齐就能再来 | `gate: FAIL` + `status_reason` 写明缺什么、找谁补；`reentry_conditions` 留空 |
| **Reject** | 目标、边界或风险本身不可接受 | `gate: FAIL` + **`reentry_conditions` 必填**——写清楚什么条件下允许重新提出 |
| **Reject 且不再做** | 这件事不该做 | 同上，`reentry_conditions` 写「不重新进入」，WI 状态 → `Cancelled` |

为什么不给 Hold/Reject 各设一个词表值：因为它们在流程上是同一件事（**这次不通过**），
区别只在"还回不回得来"。用一个字段表达这个区别，比用两个近义词更不容易记错。
但**问法必须用规格的词**——责任人听到"Hold"和"Reject"的心理判断是不同的，不能让他去选 `FAIL`。

`CONCERNS` 不是"差不多能过"的委婉说法。它的准确含义是：**这些问题我看见了、我接受、并且我知道它们由谁负责**。写不出 owner 的问题不能算 CONCERNS，那是 FAIL。

## 请求批准的方式

三条协议，全部来自实践验证：

**0. 问对人。** 呈报之前先看这道 Gate 要哪几个角色（`config.yaml` 的 `gates.<name>.require`），
把对应的人**逐个点名**请到：「这次需要 <角色A> 和 <角色B> 各确认一次。<角色A> 请看 <哪几块>，
<角色B> 请看 <哪几块>。」——哪几块由 `role_views` 决定，不要让人自己去猜该看什么。

同一个人担多个角色时说清楚：「你同时担 <角色A> 和 <角色B>，这两块都要你确认。」
**不要因为是同一个人就把两个判断合并成一句「你看行吗」**——他要分别想的仍然是两件事。

**1. 固定话术。** 每个 Gate 用稳定的问法，让人一眼知道现在是在批什么：

- contract：「Contract 内容确认无误吗？确认后进入 Build，之后修改需要走 Amendment。」
- scope：「需要把 <路径> 加入可写范围，原因是 <理由>。确认扩大范围吗？」
- build-review：「实现已完成，自检全绿。做法是 <一句话>，改了 <N> 个文件。请看一下方向对不对——通过就进 QA。」
- release：「Evidence Case 已就绪。请给出 Release / Hold / Reject。」
- lesson：「确认把这条经验固化到 <目标文件> 吗？之后所有工作都会受影响。」

**2. 只认显式肯定。** 接受"是/确认/同意/approved/可以发"这类明确表态。以下都不算批准，要继续澄清：

- "看起来不错" / "应该没问题" / "你觉得呢"
- 沉默、跳过、回答了别的问题
- 之前对别的事说过的"随便你"

**3. 改后重审。** 产物任何修改后必须重新请求批准，上一轮批准不延续到新版本。理由很直接：他批准的是他看过的那个版本。

## 呈报格式

请求批准时，给出的信息量应该让人能在不打开一堆文件的情况下做决定：

```
## <Gate 名称>

**要决定什么**：一句话

**确定性预检**：6 项通过 / 0 项失败
**关键内容**：3-5 条摘要（不是全文粘贴）
**已知问题**：有就列，没有就写"无"
**如果通过**：接下来会发生什么
**如果不通过**：回到哪里、需要补什么

请给出：<明确的选项>
```

不要把 contract 全文、完整 diff、原始日志倒进对话里。责任人需要的是组织过的判断材料，不是原材料。要看细节时他会问，或者直接打开文件。
