---
name: sdlc-contract
description: Use when an Exploration Record is ready and the work needs a locked-down Execution Contract - deriving or revising contract.yaml, turning findings into EARS acceptance criteria with hierarchical ids, declaring scope inclusions and explicit exclusions, filling in the technical design, change boundary and release rollback blocks of the contract, running the contract approval gate, or ruling on a Contract Amendment that sdlc-build or sdlc-qa has already raised - they are the entry point when a gap is first discovered mid-implementation, so come here only to decide on an amendment that already exists. Also use when someone asks to define acceptance criteria, write the spec, pin down acceptance conditions or what "done" means, freeze the requirements, or approve the contract. Not for discovering unknowns and asking clarifying questions (that is sdlc-explore), and not for writing implementation code or declaring a change scope (that is sdlc-build).
---

# SDLC Contract —— 把探索结论固化为可验证的意图与边界

这个环节产出的 Execution Contract 是**全套件唯一的锚点**：Build 照它做，QA 照它测，Release 照它决定。它错了，后面全错，而且错得很像对的——因为下游每个环节都会忠实地实现、测试、批准一个错误的意图。

所以这里的产出标准不是"文档写完了"，而是"每条承诺都能被独立验证，每个未决问题都被明确处置"。

## 开工前

**REQUIRED**：读 `../sdlc-core/references/gates.md`——批准协议三原则与呈报格式在那里，本环节必须逐条执行。

必读输入：

| 文件 | 读它拿什么 |
|---|---|
| `.sdlc/work-items/WI-###-slug/work-item.yaml` | objective、owner、lane |
| `.sdlc/work-items/WI-###-slug/exploration.md` | 已确认事实、澄清结论、假设、冲突、未决问题 |
| `.sdlc/config.yaml` | `roles`（谁担哪个角色）、`gates.contract-approval.require`（这道 Gate 要哪几个角色签）、保护路径、风险默认值 |

需要展开时才读：`../sdlc-core/references/objects.md` §3（Execution Contract 完整字段）、`../sdlc-core/references/redlines.md`（觉得 Gate 这次可以变通时）。

**版本固定**：以本次会话开始时的 git 状态为准；模板版本由第 1 步的 `capability_bundle_pinned` 记下。
**扩展规则**：可以读全库来理解现状，但受 `config.yaml` 的 `context_budget` 约束——
单份任务引用的来源文件有上限，超过 `max_doc_age_days` 的文档引用时注明可能已过期；
命中 `data_policy.never_read` 的路径一律不读（`protected_paths` 管的是不可写，拦不住读）。

没有 exploration.md 就不要凭空开 contract。`lane: quick` 时它可以只有几句事实确认，但**必须存在**——contract 的每条内容都要能说出它来自哪条事实、哪条澄清结论、还是哪条假设。

## 七步

### 1. 派生 contract.yaml

整份复制 `../sdlc-core/templates/contract.yaml` 再填，不要凭记忆重建结构。模板里的字段注释是后面 Gate 校验的依据。

本环节一共实例化两份模板：`../sdlc-core/templates/contract.yaml` 与 `../sdlc-core/templates/gate.yml`。
第一次实例化时向 `evidence.jsonl` 追加一条 `capability_bundle_pinned`，`input_refs` 填两个模板路径 + git hash。
这不是仪式：模板半年后会改，而 Amendment 裁决要判断"当初这一版模板要求填什么"——
没有固定版本，就只能拿今天的模板去审当时的产物。

映射关系是固定的，不要自由发挥：

| exploration.md | → | contract.yaml |
|---|---|---|
| objective + 已确认事实中的业务背景 | → | `outcomes`（1-3 条） |
| 澄清结论 + 已确认事实 | → | `requirements` |
| 每条 requirement 的可验证形式 | → | `criteria` |
| 澄清结论中"排除了什么" | → | `scope.excluded` |
| 假设（Assumptions） | → | `criteria.notes` 或 `open_decisions` |
| 冲突 + 未决问题 | → | `open_decisions` |
| 现状调研中确认的技术约束与已有模式 | → | `design.approach` / `design.decisions` |
| 探索中确认的"这块不能碰" | → | `boundary.must_not_change` |

`outcomes` 写"世界会有什么不同"，不写"系统会有什么功能"。

✅ `财务月度对账不再需要手工补退款数据`
❌ `报表导出模块增加 refund_amount 字段`

**exploration.md 里没有的内容不能进 contract**。想写一条却找不到来源时，那说明探索没做完——回 sdlc-explore 补，或把它记为 `open_decisions`。凭空补上的意图会一路传导到实现、测试和发布证据，而且看起来和真的一模一样（红线 4.3）。

### 2. 每条 criterion 写成 EARS + 层级编号

**REQUIRED**：写 criteria 之前读 `references/ears.md`。这是本环节最实质的工作，也是最容易写成一堆无法验证的形容词的地方。
习惯 Given/When/Then 的人先看它的 §2b——本套件用 EARS 替代 GWT，那一节给出逐项映射，
省得每个人自己在心里换算一遍（而各人换算出来的还不一样）。

三条硬要求，缺一不可：

1. **EARS 语法**——五模式之一，含 `SHALL`
2. **层级编号**——`1.1`、`2.3`，按 requirement 分组。这是全套件的连接坐标：build 的任务写 `_Criteria: 1.1_`，qa 的 Test Intent 绑定 `criterion: "1.1"`，release 的 Evidence Case 按它组织
3. **可独立验证**——读的人能说出怎样算通过

✅ `WHEN 导出请求的时间范围超过 12 个月 THEN 系统 SHALL 拒绝并返回可读的错误说明`
❌ `系统应该有良好的性能`（不可验证，也不是 EARS）
❌ `优化报表导出逻辑`（是任务，不是标准）

编号一旦被下游引用就不要改。删掉一条 criterion 时，`coverage_stats.py` 会报出"引用了不存在的编号"——那是提醒你去处理下游引用，不是让你把编号补回去。

### 3. 标注验证方式

每条 criterion 必须声明 `verification`：

- `automated`——可以由脚本、测试、静态检查判定
- `manual`——需要人看一眼才能确认（视觉呈现、文案措辞、主观体验、外部系统联调结果）

`manual` 的**必须**填 `verified_by`，写具名责任人。

**不要为了让 Gate 好过而把 manual 标成 automated**。QA 到时候会生成一条测不出真实意图的自动化测试，然后它永远通过。一条诚实的 manual + 具名责任人，比一条假装自动化的 criterion 有用得多。

反过来也别滥用 manual：能自动验证的标 manual，等于把成本推给了每一次回归。

### 4. 填 design 块：打算怎么做，为什么这么做

技术设计不是另一份文件，它是 contract 的 `design` 块。合进来的理由很实在：两份手写视图会各自
漂移成两份真相，而主规格要求「两种视图不能各自编辑」。现在只有 contract.yaml 手写。

| 字段 | 写什么 | 容易写砸的地方 |
|---|---|---|
| `approach` | 一段话说清做法，读完知道大致会发生什么变化 | 复述了 requirements，没讲做法 |
| `diagrams` | mermaid 图 + `relates_to` 标出它在解释哪几条 | 画了图但不说它对应哪条 |
| `decisions` | 决定 / 选择 / `alternatives_rejected` / `impact` / `revisit_at` | 只填前两项 |
| `impact` | interfaces / data / dependencies / operations 四项 | 只想到代码，忘了运维要跟着改什么 |
| `nfr` | performance / availability / security / capacity | 写"高性能"这种验证不了的形容词 |

**什么时候必须给图**：多角色流转 / 状态迁移 / 跨服务调用 / 数据流向。这四种纯文字说不清楚，
读的人会各自脑补一个版本，而脑补的差异要到 build 阶段才暴露。四种都不涉及时，在 `diagrams`
里写一条 `title: 不适用：<一句理由>`，**不要留空**——空着分不清"不需要"和"忘了"。
`relates_to` 只能填 contract 里真实存在的编号（`O1`、`R1`、`1.1`），预检两个方向都查。

**`decisions` 必须记被放弃的备选**：三个月后有人问"为什么不用 X"，这是唯一的答案来源。
`impact` 写这个选择让什么变难或变贵——说不出影响的决定不是决定，是偏好。

**硬约束：design 块不允许出现 criteria 里没有的承诺。** 写完自查一遍：有没有哪句是"顺便说明
一下我们还会……"？那句要么该变成一条 criterion，要么该删掉。没有编号的承诺谁都不会去验证，
但用户会记得你答应过。

`lane: quick` 可以把 `approach` 压成一句、`diagrams` 写不适用，但 design 块不能整块留空。

### 5. 填 boundary 块：什么可以动，什么绝对不能动

这里声明的是**意图级**边界，不是文件清单。它此前由 build 自己写，等于让执行者划自己的边界。

| 层 | 在哪 | 说什么 | 谁写 |
|---|---|---|---|
| 意图级 | `contract.boundary` | 可以动哪些模块 / 接口，绝对不能动什么 | 本环节 |
| 文件级 | `change-scope.yaml` | 具体动哪几个文件路径 | sdlc-build |

`may_change` 写模块或子系统（`报表导出模块（src/reports）`），**不写文件名**——契约阶段还猜不出
文件名，硬猜的清单到 build 里会被全部改写。`must_not_change` 写显式禁区（`Order/Refund 共享数据
模型`）；确实没有额外禁区就写"仅默认保护区"，默认禁区是共享接口 / 数据模型 / 基础设施 /
安全与密钥配置 / CI 配置。`allowed_actions` 是上限，build 可以收紧不能放宽。
`escalation` 是 Build 的停止条件，不是提醒。

`check_scope.py` 会校验 change-scope 的 `derived_from` 把这两个清单逐条抄全了，且
`tool_actions.allowed` 不超出 `allowed_actions`。**build 推导不出文件级范围，说明这里写得太模糊**——
那是回本环节补的信号，不是让 build 自己扩大解释。

### 6. 填 release 块：出事怎么退

**"怎么退"是设计问题，不是发布问题。** 某些方案根本回不去——不可逆的数据迁移、已经发出去的
通知、外部系统已经消费掉的事件。这件事应该在契约阶段就影响技术选型，而不是发布前夜组装
Evidence Case 时才第一次被问到。这一块此前正是那时候才第一次出现。

| 字段 | 写什么 |
|---|---|
| `strategy` | 一次性 / 灰度 / 开关控制 / 分批 |
| `rollback` | 怎么退。**退不回去的方案要在这里说明白**，不要写"回滚到上一版本"了事 |
| `rollback_data_state` | 退回后数据处于什么状态；有不可逆写入要点名 |
| `monitoring` | 发布后看什么指标、看多久 |
| `support` | 异常时谁响应、走哪条升级路径 |

`rollback` 写不出来时，正确的反应是回头改 `design.approach` 或某条 `decisions`——让方案变成退得
回去的；或者把"这条路退不回去"作为一条 `open_decisions` 交给人明确接受。不要空着往下走。

### 7. 逐条处置 open_decisions

这一步是本环节真正的完成标志。**文档写完不等于设计完成。**

每个 open decision 必须落到两种终态之一：

| 终态 | 含义 | 必填 |
|---|---|---|
| `closed` | 有答案了 | `resolution` 写答案 |
| `accepted` | 没有答案，但明确接受这个风险 | `resolution` 写**接受了什么风险**、`owner` 写谁接受的、**`revisit_at` 写什么时候回来重看** |

还有两个时点字段，它们回答不同的问题，不要互相替代：

| 字段 | 回答 | 什么时候填 |
|---|---|---|
| `deadline` | **什么时候必须有答案** | 还是 `open` 时就该有。没有截止的未决问题不会被处理，它只会在 Gate 前一晚被临时"接受"掉 |
| `revisit_at` | **什么时候回来重新看这个决定** | `status: accepted` 时**必填** |

**为什么 accepted 必须有 revisit_at**：带风险接受的决定如果没有复查时点，就会变成永久埋在系统里的
临时默认。半年后没有人记得这是一个"当时先这样"的权宜，它看起来和一个正经设计一模一样——
那正是主规格 D16 要防的事。写一个真实日期，不写"下个季度"。

✅ `status: accepted / resolution: 不回填历史数据，仅新数据生效；财务已确认可接受三个月的对账缺口 / owner: 张三 / revisit_at: 2026-11-30`
❌ `status: accepted / resolution: 先这样`（接受了什么风险？谁接受的？什么时候回来看？）
❌ `status: accepted / ... / revisit_at: 视情况`（不是时点。没有人会在"视情况"那天回来）
❌ `status: open / deadline: null`（还是 open，而且没人知道它什么时候该有答案）

`coverage_stats.py --phase release` 会检查每条 `accepted` 有没有 `revisit_at`。它在 release 阶段拦，
是因为一条决定可能在 contract 批准之后才转成 accepted——但这不是"到 release 再补"的许可：
在这里顺手填一个日期，和在发布前夜翻出来问"当初是谁接受的、说好什么时候看"，是两件成本差很远的事。

处置方式见 `../sdlc-core/references/interaction.md`：先给议程（**议程直接写进 `open_decisions`，
再呈报**——本环节没有 exploration.md §5 那个落点），再**一轮 ≤4 条、每条带选项**成批问，答完**逐题回执**。
关键在回执不在轮次——打包成一段话问，得到的通常是一句"都行"，而"都行"在回执里**按未答处理**，
下一轮标「上一轮未答」重问；少了这一步，一次问一个和一次问五个拿到的都是假决定。
不可逆的决定不进批次，单独问。

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

## Gate：两段式，顺序不能倒

### 第一段：确定性预检

```bash
python3 "$CORE/scripts/coverage_stats.py" --root <项目根> --work-item WI-### --phase contract
```

退出码 0 通过 / 1 有 failures（有意义的结果，按 JSON 里的 `failures` 逐条修）/ 2 脚本自身出错（停下来修）。

它检查：每条 requirement 至少关联一条 criteria；每条 criterion 有 id、有 EARS（含 SHALL）、
`verification` 合法；`manual` 的有 `verified_by`；编号不重复；所有 `open_decisions` 已离开 `open`。
三块新内容同样在预检范围内：`design` 的 `approach` 非空、`diagrams` 有图或写了"不适用"、
`relates_to` 指向 contract 里真实存在的编号、每条 `decisions` 记了 `alternatives_rejected`；
`boundary` 的 `may_change` 与 `must_not_change` 都非空；`release.rollback` 非空。

脚本管不到、需要你自己逐项核对的三条：

- [ ] `scope.excluded` 非空——显式排除项不是可选装饰，它是 Build 判断"哪些看起来该顺手做的事不该做"的唯一依据
- [ ] `design.diagrams` 的 `relates_to` 指得**对**——脚本只能验编号存在，验不了这张图讲的确实是那条的事
- [ ] `boundary.may_change` 的粒度够 build 推导出文件级 change-scope——"整个后端"太粗，直接列文件又太细

**预检不通过就不进入人工环节。** 拿一份自己都知道不完整的东西去占用别人的判断力，是对批准这件事最大的损害——批准人第二次看到不完整的材料时，就不会再认真看了。

### 预检与批准之间：先渲染呈报页

预检全绿之后、开口请求批准之前，跑一次：

```bash
python3 "$CORE/scripts/render_review.py" contract --root . --work-item WI-###
```

生成 `review/contract.html`：首屏是裁决横幅 + 「需要你决策的 N 件事」（未决问题、`accepted` 缺 `revisit_at`、`manual` 缺验证人、`rollback` 为空），其后是 KPI 卡、需求×标准追溯矩阵（没有标准的需求整行高亮）与按 `role_views` 生成的角色标签页。

### 第二段：人工批准

固定话术，一字不改：

> **Contract 内容确认无误吗？确认后进入 Build，之后修改需要走 Amendment。**

**只认显式肯定。** 以下对照来自 `../sdlc-core/references/gates.md`：

| 算批准 | 不算批准（要继续澄清） |
|---|---|
| 「是」「确认」「同意」「approved」「可以」 | 「看起来不错」「应该没问题」「你觉得呢」 |
| 「按这个来」 | 沉默、跳过、答了别的问题 |
| | 之前对别的事说过的「你看着办」「随便你」 |

含糊回应时，回一句具体的澄清，而不是把它当成同意往下走：「这句我理解为对 criteria 1.1–2.3 全部认可，是这样吗？还是有哪条想改？」

**改后重审。** 批准之后又改了任何一个字——补一条 criterion、调一个 excluded 项、修一个 typo 之外的内容——都要重新请求批准。他批准的是他看过的那个版本。上一轮批准不延续到新版本，不管改动多小。

### 呈报格式

**REQUIRED**：读 `references/approval.md`，里面是这次批准的呈报模板与角色视图的用法。

要点：给**路径 + 组织过的摘要**（3–5 条），不要把 contract 全文或 HTML 内容倒进对话——
Gate 退化成扫一眼签字，通常不是因为人不负责，是因为材料读不过来。
**角色既是视图也是权限**：`role_views` 决定谁看哪几块，`gates.contract-approval.require` 决定谁必须签，两者用同一套词表。

### 落盘

拿到显式肯定后，复制 `../sdlc-core/templates/gate.yml` 写 `gates/contract-approval.yml`：`scope: contract-approval`、`approved_by` 填**刚才那个人的名字**、`deterministic_checks` 填预检真实结果。然后校验记录本身有效：

```bash
python3 "$CORE/scripts/validate_gate.py" --root <项目根> --work-item WI-### --gate contract-approval
```

通过后：contract.yaml 的 `status: approved` + `approved_by` + `approved_at`；work-item.yaml 状态 → `Contracted`、`contract_version: 1`；向 evidence.jsonl 追加一条 `action: gate_decided`。

**从这一刻起 contract.yaml 冻结。**

## Amendment 裁决

build 或 qa 发现 Contract 不完整、矛盾或与现实不符时，会提 `amendments/AMD-###.md` 回到这里（红线 4.1：不允许在下游补意图）。裁决在本环节做。

1. 读 AMD 的"发现了什么"与证据。**先判断它是不是真的上游缺口**——实现难题、技术选型分歧、"这样写更方便"都不是 Contract 缺陷，那些应该 rejected 并说明理由。
2. 决定 `accepted` / `rejected` / `deferred`，填进 AMD 的处置节（决定人、时间、理由）。
3. `accepted` 的：生成 contract **新版本文件**（`contract-v2.yaml`），原 v1 标 `status: superseded` 但**不删**——审计时需要知道当时批准的是什么。
4. 新版本重新走完整的两段式 Gate。`gates/contract-approval.yml` 的 `history` 追加旧结论，不覆盖。
5. work-item.yaml 的 `contract_version` 指向新版本，`notes` 记一行回退：`YYYY-MM-DD 从 Executing 退回 Contracted：AMD-001 接受 / 处理人 张三`。

被 rejected 的 Amendment 同样保留——它是审计线索，也是 Lesson 的来源。

## 工具边界

| 面 | contract 的声明 |
|---|---|
| **可读** | 全库与 `docs/`——理解现状是为了把 criterion 写准。读到的内容只作理解用，**不作为 contract 内容的来源**，来源只能是 exploration.md |
| **可写** | 只写 `.sdlc/work-items/WI-###-slug/`：`contract.yaml`（及后续版本文件）、`gates/contract-approval.yml`、`amendments/AMD-###.md` 的处置节、`evidence.jsonl`；`review/contract.html` 由渲染脚本写，**不手写、不手改** |
| **受保护** | **已批准的 contract.yaml**——`status: approved` 之后一个字都不能改，要改走 Amendment 生成新版本文件；被 rejected 的 AMD 与 superseded 的旧版本同样不删；`config.yaml` 的 `data_policy.never_read` 命中的路径连读都不读 |
| **禁止动作** | 任何业务代码、配置、测试文件；写 `change-scope.yaml`——本环节只声明 `boundary` 的意图级边界，文件级白名单是 sdlc-build 的出口产物；写 `test-plan.yaml`——**尤其不要"顺手把测试怎么测也想好"**，QA 的 Test Intent 必须从 contract 独立生成，你在这里预设了测法就等于替 QA 决定了预期（红线 2）；`tool_actions.always_forbidden` 里的动作（deploy / push / publish / db-migrate） |
| **升级条件** | 想写一条 criterion 却找不到来源 → 回 sdlc-explore 补，或记为 `open_decisions`；未决问题无人能决 → WI 置 `Held` 并写全 `blocked_by` 四项；批准人不可达 → 停在 `Held`，不设代签；批准之后又改了内容 → 重新走完整两段式 Gate |

**命令类别白名单**——本环节只跑这两类：

| 类别 | 具体命令 |
|---|---|
| `sdlc-check` | `coverage_stats.py`、`validate_gate.py`（只读校验，不改文件） |
| `sdlc-render` | `render_review.py contract`（只读 `.sdlc/`，只写 `review/contract.html`） |
| `git-read` | `git log` / `show` / `diff`，只用于确认现状 |

**不跑 lint / test / build**：本环节没有 change-scope 授权，而且就算跑通了也不构成 contract 的任何依据——
contract 说的是"应该做到什么"，跑测试说的是"现在是什么"。用后者去推前者，正是这一环要防的事。
环境与凭据：全部命令跑在 local，`credentials: none`。

## Runtime 与配置来源

当前编码 Agent 会话（Claude Code、Codex，或由 Enact 管理的 Runtime）就是本环节 Runtime。本环节**不起 subagent**：写 criteria 需要 exploration 的全部上下文，
拆出去要么带不全，要么把同一份上下文复制成两份，两种都会让 contract 与探索结论悄悄漂移。
（qa 的 contract-only 隔离是反过来的场景——在那里，隔离本身就是目的。）

配置来源要能说清层级。说不出来源的约束，在 Gate 上会被当成个人偏好驳回：

| 这条约束 | 来自哪一层 |
|---|---|
| `roles` 与各 Gate 的 `require`、`protected_paths`、`data_policy`、`tool_actions` | `.sdlc/config.yaml` 项目级 |
| `policies` 字段指向的编码规范、安全策略、发布规则 | 项目文档。contract 只引用路径，不复述内容 |
| criteria 与 scope 的具体内容 | 本 WI 的 exploration.md |
| 批准协议、受控词表、EARS 五模式 | `../sdlc-core/references/gates.md` 与 `references/ears.md`（全套件级） |

并发：一次只处置一个 WI 的 contract。同时开两份 criteria 会串味——编号、excluded、未决问题
都会互相污染，而这两份各自都是下游唯一的锚点。

## 交接

批准完成后交给 **sdlc-build**：它需要 approved 的 contract.yaml（固定版本号）+ work-item.yaml。告诉它 contract 版本号、`scope.excluded` 里最容易被误踩的那几条，以及 `boundary` 要被它物化成文件级 change-scope 这件事。

预检不过或未决问题无人能决时，回 **sdlc-explore** 补事实，或把 WI 置为 `Held` 并写清 `blocked_by`（what / who / since / unblocks_to）——见 `../sdlc-core/references/state-machine.md`。

**短期状态**：与批准人往返的措辞、还没落进文件的调整。会话一结束就没了——所以拿到显式肯定的那一刻就落盘。
**长期事实**：approved 的 `contract.yaml`（本环节唯一的手写出口产物，此后属 released 档，可当事实直接引用）、
由它生成的 `review/contract.html`、`gates/contract-approval.yml`、`amendments/` 下的全部裁决（含被 rejected 的）。

**向 sdlc-learn 交出什么**——这一面要双向声明，只有 learn 说"我要来取"而产地不说"我要交"，这条链就是断的：

| 观察到 | 为什么是 Lesson 候选 |
|---|---|
| 同一类 criterion 写法反复被 Amendment 打回 | `ears.md` 缺了这一类的写法示例，不是每次写的人都恰好不小心 |
| 同一个 open_decision 在多个 WI 里反复出现 | 它根本不是单个 WI 的未决问题，是一条该被定下来的项目级 policy |
| `revisit_at` 到期后从没人回来看的 accepted 决定 | 复查这件事缺一个提醒机制，光靠字段本身不成立 |
| 预检反复卡在同一条规则 | 模板或规范在这一处表达得不清楚 |

按 sdlc-learn 的 Observe 登记：建 `.sdlc/lessons/LP-###-slug/`，复制 `../sdlc-core/templates/lesson.md` **只填 §1**，
来源写具体的 WI 与 AMD 编号，追加 `action: lesson_proposed`；**无候选时在 `work-item.yaml` 的 `notes` 里写一行"本次无 Lesson 候选"**——只在对话里说过等于没说。
落点选 work-item 而不是 contract，是因为 **contract 批准之后就冻结了**，再往里写一个字都要重新走一次批准；而这条记录本身不改变任何承诺。
**不要自己改 `references/ears.md` 或任何模板**——只有 sdlc-learn 拿到 `gates/lesson-approval.yml` 之后才可以（红线 4.2）。

## Done When

- [ ] contract.yaml 的每条 requirement 至少关联一条 criteria
- [ ] 每条 criterion 是 EARS 语法、有层级编号、能独立验证
- [ ] `verification: manual` 的每条都有具名 `verified_by`
- [ ] `scope.excluded` 非空且写的是真会被误踩的东西
- [ ] 所有 `open_decisions` 为 `closed` 或 `accepted`，`accepted` 写清接受了什么风险、由谁接受
- [ ] 每条 `open_decisions` 有 `deadline`；`accepted` 的有具体日期的 `revisit_at`
- [ ] `design` 块：`approach` 非空、给了图或写了"不适用 + 理由"、`relates_to` 指向真实编号、每条 decision 记了被放弃的备选与 `impact`，且没有 criteria 之外的承诺
- [ ] `boundary` 的 `may_change` / `must_not_change` 非空且是意图级，粒度够 build 推导出文件级范围
- [ ] `release.rollback` 写清了怎么退；退不回去的已在这里点名，或转成 accepted 的未决问题
- [ ] `coverage_stats.py --phase contract` 退出码 0
- [ ] 预检全绿后已跑 `render_review.py contract`，呈报时给的是 `review/contract.html` 的路径 + 摘要，不是全文
- [ ] 用固定话术请求过批准，并拿到**显式肯定**（不是"看起来不错"）
- [ ] `gates/contract-approval.yml` 的 `approved_by` 是刚才那个人的真名，`validate_gate.py` 通过
- [ ] contract.yaml `status: approved`；work-item.yaml 状态 `Contracted`、`contract_version` 已填
- [ ] 批准之后 contract.yaml 没有再被编辑过（改了就重新批准）
- [ ] 九个配置面都能在正文里指认出落点
