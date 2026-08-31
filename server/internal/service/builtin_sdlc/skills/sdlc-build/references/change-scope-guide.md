# Change Scope 推导指南

从 approved contract 推导出一份粒度合适的 Managed Change Area。

- [1. 从 Contract 推导写入范围](#1-从-contract-推导写入范围)
- [2. 白名单粒度：✅/❌](#2-白名单粒度)
- [3. 风险分级：哪些可以默认接受](#3-风险分级)
- [4. protected：两个来源与五类默认区域](#4-protected两个来源与五类默认区域)
- [5. tool_actions 怎么定](#5-tool_actions-怎么定)
- [6. 范围扩大的完整流程与话术](#6-范围扩大的完整流程与话术)
- [7. 怎么读 check_scope.py 的输出](#7-怎么读-check_scopepy-的输出)

---

## 1. 从 Contract 推导写入范围

范围不是凭对代码库的印象拍出来的，是从 criterion 一条条推出来的。五步：

**第一步：逐条 criterion 列出受影响的行为。**

criterion 是 EARS 句式，主语基本都指向一个具体的系统行为。把它翻译成"哪段代码负责这件事"。

```
1.1 WHEN 导出请求的时间范围超过 12 个月 THEN 系统 SHALL 拒绝并返回可读的错误说明
    → 受影响行为：导出请求的参数校验
```

**第二步：Grep 定位到文件。**

用行为里的领域词、现有错误码、接口路径去搜，不要用猜的文件名去 Glob。

```bash
grep -rn "export" src/ --include=*.py -l
grep -rn "ApiError\|raise .*Error" src/reports/
```

搜到的是候选，逐个 Read 确认哪个真的承担这个行为。承担这个行为的文件进 `write`。

**第三步：反查调用方，判断是否需要连带修改。**

```bash
grep -rn "from .reports.exporter import\|reports\.exporter" src/ tests/
```

调用方分三种处理：

| 情况 | 处理 |
|---|---|
| 调用方需要跟着改（签名变了、新增必填参数） | 进 `write` |
| 调用方只是读，不需要改 | 只进 `read` |
| 调用方是别的团队/别的模块的共享入口 | 进 `protected_local`，并考虑改成向后兼容的实现方式 |

第三种情况值得多想一步：如果只有把共享接口改了才能满足 criterion，那这件事在 contract 阶段就该被识别为破坏性变更。它没被识别出来，可能是一个 Amendment。

**第四步：把测试落点写进去。**

最常被漏掉的一项。Build 要跑自测，自测通常意味着新增或修改测试文件——那些文件必须在白名单内。

```
src/reports/exporter.py    →  tests/reports/test_exporter.py
```

**第五步：把配置、迁移、生成物的落点写进去。**

新增配置项、数据库迁移文件、lockfile、生成的类型定义——只要 git diff 会看到它，它就得在白名单内。工具自动产生的写入不是例外。

---

## 2. 白名单粒度

判据只有一条：**复核者看着这份白名单，能不能知道该看哪里。**

### ✅ 粒度合适

```yaml
write:
  - "src/reports/exporter.py"
  - "src/reports/validators.py"
  - "tests/reports/test_exporter.py"
  - "tests/reports/test_validators.py"
```

具体到文件，且测试落点齐全。复核者一眼知道这次动的是报表导出这一块。

```yaml
write:
  - "src/reports/**"          # 本次是报表模块的整体重构，contract 里有 6 条 criteria 覆盖
  - "tests/reports/**"
```

目录级也可以合适——前提是这次变更**确实**覆盖整个目录，而且目录本身足够窄。理由写进 change-scope 的注释。

### ❌ 过宽

```yaml
write:
  - "src/**"
```

等于没有边界。这份白名单不给复核者提供任何信息，`check_scope.py` 也永远不会报越界——于是第三条铁律的机械检查完全失效。

```yaml
write:
  - "**/*.py"
```

同上，换了个写法而已。按文件类型划范围永远是错的：范围的语义是"这次要动的功能区域"，不是"这次会用到的语言"。

### ❌ 过窄

```yaml
write:
  - "src/reports/exporter.py"
```

漏了测试目录。开工二十分钟后就会撞上一次本可避免的范围扩大，而且很容易演变成"先把测试写了，扩大的事回头一起提"——那就是越界。

```yaml
write:
  - "src/reports/exporter.py"
  - "tests/reports/test_exporter.py"
# 但 criterion 2.1 要求新增一个配置开关，配置文件没列
```

推导时漏了一条 criterion。第 1 节的第五步就是防这个的。

### 一个提醒

**过窄比过宽好。** 过窄的代价是一次范围扩大交互（一轮对话）；过宽的代价是整条边界失效，而且没有任何检查能发现。拿不准时列窄一点。

---

## 3. 风险分级

### 可以建议 owner 默认接受（低风险）

四条同时成立才算：

- `write` 全部落在本次功能自己的实现文件与对应测试文件上
- 不新增、不修改任何被其他模块导入的公共接口签名
- 不触碰数据模型、迁移、认证授权、密钥、CI 配置，也没有读 `read_excluded` 里的任何路径
- `tool_actions.allowed` 不超出 config.yaml 的 `allowed_by_default`

这时在 change-scope 里写明「低风险，owner 默认接受」，直接开工。理由：为一份显然合理的窄范围打断责任人，是在消耗他之后真正需要判断时的注意力。

### 必须拿具名确认（高风险）

出现任何一条就要确认，`approved_by` 填真实人名：

| 触发条件 | 为什么 |
|---|---|
| 修改被其他模块导入的接口、公共 API、事件格式 | 影响面超出本次 WI，别人的代码会因此坏掉 |
| 修改数据模型、schema、写数据库迁移 | 数据变更通常不可逆，回退方案要单独想 |
| 触碰认证、授权、密钥、个人数据处理 | 出问题的代价不是 bug 级别的 |
| 修改基础设施或 CI 配置 | 改坏了会拦住所有人，不只是你 |
| 需要 config.yaml 默认之外的命令类别 | 命令类别是另一条边界，扩大它和扩大路径同等 |
| write 白名单跨了 3 个以上顶层模块 | 说明本次变更的影响面本身需要有人看一眼 |
| 从 `protected_from_project` 里拿掉任何一条 | 那是项目策略，撤销要经过平台负责人，不是 WI owner |

### 灰色地带怎么办

拿不准算低风险还是高风险时，按高风险处理，把判断依据摆出来让人一秒钟做决定：

> 本次要改 `src/reports/exporter.py` 和 `src/api/schemas.py`。第二个文件被 3 个模块导入，但本次只新增一个可选字段，理论上向后兼容。按规则这属于共享接口修改，需要你确认——确认扩大范围吗？

这比自己判定"应该算兼容"然后开工要好：判断可能对，但没人复核过。

---

## 4. protected：两个来源与五类默认区域

### 4.0 两个来源要分开记

`change-scope.yaml` 里 protected 拆成两个字段，不是格式洁癖：

| 字段 | 内容 | 要改它找谁 |
|---|---|---|
| `protected_from_project` | 原样继承 `config.yaml` 的 `protected_paths` | **平台 / 项目负责人**。这是项目策略，一个 WI 无权撤销 |
| `protected_local` | 本次自己额外收紧的部分 | **WI owner**。走一次范围扩大即可，一轮交互 |

分开的理由是**申诉对象不同**。合成一张表之后，用户被拦下时不知道该找谁：
去问 WI owner，他改不了项目策略；去找平台负责人，本次收紧的那条其实一句话就能放开。
两次都是白跑，而且第二次之后人就开始绕过这个机制了。

两条纪律：

- **不要在 `protected_from_project` 里删条目。** 要放开项目级保护，走的是改 `config.yaml` 的路径，
  而不是在本次范围里悄悄少抄一行——后者从 diff 上看不出来，机械检查也发现不了。
- **`protected_local` 只加不减**，并在注释里写清是谁加的、为什么加。它比项目策略更容易被
  "这次情况特殊"消解掉，因为它本来就是自己给自己设的。

### 五类默认保护区域

以下五类**即使没人明说、即使 config.yaml 里没列**，也默认按 protected 处理（写进 `protected_local`）。
每一类的原因不同，不要当成同一条规则记。

### 4.1 共享接口

公共 API、模块导出、事件/消息格式、SDK 签名。

**原因**：影响面不在你的可视范围内。你能看到本仓库里的调用方，看不到别的仓库、别的团队、还没部署的分支、以及正在依赖当前行为的线上流量。改一个共享接口的真实成本，只有维护它的人算得出来。

### 4.2 数据模型

ORM 模型、schema 定义、迁移文件、序列化格式。

**原因**：数据变更常常不可逆。代码改错了可以 revert，数据被迁移脚本改过之后，revert 代码不会把数据变回去。这类改动需要单独设计回退方案，而回退方案是 Release Evidence Case 的必填项。

### 4.3 基础设施配置

`infra/**`、Dockerfile、k8s manifest、terraform、部署脚本。

**原因**：作用域是环境而不是代码。一次改动影响的是所有在这个环境上工作的人和所有在跑的服务，而不只是本次 WI 的功能。而且它的失败模式通常是"部署之后才发现"，反馈链最长。

### 4.4 安全与密钥配置

认证/授权逻辑、权限表、密钥与凭据文件、CORS/CSP/加密相关配置。

**原因**：这类改动的错误不表现为功能异常。改错了功能照常工作，只是多了一个洞——所以自测、code review、甚至 QA 都可能全绿通过。它必须由懂威胁模型的人看，而不是由"改完能跑"来验证。

### 4.5 CI 配置

`.github/workflows/**`、流水线定义、质量门禁配置。

**原因**：CI 是所有其他检查赖以成立的地基。在受检查的同一次变更里修改检查本身，是一个结构性的利益冲突——哪怕动机完全正当。而且改坏了会拦住整个团队，不只是你。

### 在保护区里发现问题怎么办

**记下来，作为独立发现交出去**，写进 build-evidence 第 5 节「需要重点复核的风险」，或者开一个新的 Work Item。

不要顺手修。你不知道那段代码是不是有意为之，也不知道它是不是属于另一个正在进行中的变更。而且在保护区里改动意味着没有人在复核你——那正是保护区存在的原因。

---

## 5. tool_actions 怎么定

`allowed` 从 config.yaml 的 `allowed_by_default` 起步，只加本次确实需要的。

| 类别 | 通常允许 | 说明 |
|---|---|---|
| `lint` / `format` | ✅ | 仅对白名单内文件生效 |
| `unit-test` / `build` | ✅ | Build 自证需要 |
| `vcs-commit` | ✅ | **提交不是推送**：本地、可 reset，而 ledger 每个任务要写 commit range。不允许它，那一栏就只能填"未提交" |
| `integration-test` | 视项目 | 会碰外部依赖或测试数据库时按需声明 |
| `db-migrate` | ❌ 默认禁止 | 对数据生效，属于 workspace 外副作用 |
| `deploy` / `push` / `publish` | ❌ 永远禁止 | 四类必停之一，只能由人执行 |
| `network-write` | ❌ 默认禁止 | 对外部系统写入不可回退 |

`forbidden` 不是提醒清单，是停止条件。撞上 `forbidden` 里的动作，走第 6 节的升级流程，不要找一条绕开它的等价命令——`git push` 被禁而改用别的方式推送，违反的是同一条边界。

### 5.1 environment 与 credentials

这两项不是环境细节，是边界的一部分：**"这次跑在哪、能用哪套凭据"决定了同一条命令的后果范围。**

| 字段 | 取值 | 怎么填 |
|---|---|---|
| `environment` | `local` / `ci` / `staging` | 默认 `local`。填 `ci` 或 `staging` 意味着命令的副作用会离开你这台机器，此时即使 `allowed` 没变也要拿具名确认 |
| `credentials` | `none` / 具名凭据集 | 默认 `none`。填任何非 none 的值都要写清是哪一套、从哪里取 |

为什么必须显式声明：同一条 `unit-test` 在 local 上只动本机文件，在 staging 上可能连到共享数据库；
同一条 `integration-test` 带不带凭据，决定它是打 mock 还是打真实外部服务。
`allowed` 只回答"允许哪一类命令"，这两项回答"这一类命令这次能造成多大范围的后果"——
少了它们，`allowed: [integration-test]` 这一行既可能是完全无害的，也可能是能写到生产库的。

**这里写的永远是凭据的名字，不是凭据本身。** change-scope.yaml 也是进 git 的文件；
凭据内容本身连读都不该读进上下文（见 `read_excluded` 与 `config.yaml` 的 `data_policy.never_read`）。

---

## 6. 范围扩大的完整流程与话术

### 七步

1. **停。** 不要"先改了再说，等下一起提"。已经改了就照实记录（见 6.4）。
2. **写 evidence**：`boundary_stop`，notes 写清楚想做什么、为什么停。
   ```json
   {"ts":"...","actor":"sdlc-build","action":"boundary_stop","input_refs":["contract.yaml#2.1"],"output_refs":[],"result":"blocked","notes":"需要修改 src/api/schemas.py（共享接口，不在 write 内）才能满足 2.1；已停止，请求扩大范围"}
   ```
3. **ledger.md 的「边界事件」表追加一行**：时间 / 想做什么 / 为什么停 / 处置。
4. **请求扩大**，用第 6.2 节的话术。命中 `protected` 时先按第 7 节看 `source` 决定该找谁。
5. **拿到具名确认后**：生成 `change-scope.yaml` 的 version+1（旧内容进 `history`，原文件不是就地改掉），
   写 `gates/scope-expansion-###.yml`，跑 `python3 "$CORE/scripts/validate_gate.py" --gate scope-expansion` 确认有效。
6. **写 `scope_expanded` 与 `gate_decided` evidence。**
7. **再落一条 `context_resolved`**，`input_refs` 记扩大后本轮实际依据的文件与版本。
   范围变了意味着可依据的事实集合也变了；不重新固化，之后就无法区分某条结论是扩大前还是扩大后得出的。
   这一步顺便把期间读过的 `read` 列表外路径并进新版本的 `read`。

### 6.2 请求话术

固定结构，四行，让人在十秒内能决定：

```
需要把 <路径> 加入可写范围。

原因：<为什么绕不开——哪条 criterion 要求的、为什么不能在现有白名单内解决>
影响：<这个路径还有谁在用、改动是否向后兼容>
不扩大的后果：<criterion x.y 无法满足 / 只能用某个更差的实现方式>

确认扩大范围吗？
```

真实例子：

> 需要把 `src/api/schemas.py` 加入可写范围。
>
> 原因：criterion 2.1 要求导出响应带 `refund_amount`，响应结构定义在这个文件里，导出模块只是引用它。
> 影响：该文件被 reports / billing / admin 三个模块导入。本次只新增一个可选字段，现有消费方不受影响。
> 不扩大的后果：只能在 exporter 里手工拼一个绕过 schema 的返回结构，会让响应格式出现两个事实来源。
>
> 确认扩大范围吗？

### 6.3 三个反模式

**❌ 攒着一起提。** "先把能做的做完，最后一次性提三处扩大"——中间那段时间里你已经在越界写入了，而且事后提的范围是对既成事实的追认，不是边界。

**❌ 理由写成方便性。** "改这个文件会比较简洁"不是理由。理由必须能回答"不扩大会怎样"。答不上来，说明这次扩大是可以不做的。

**❌ 把 write 一次开大以免再来一次。** "干脆把 `src/**` 加进去省得再问"——这是用一次交互的成本换掉整条边界。要扩就精确扩到需要的那几个路径。

### 6.4 已经越界了怎么办

在 ledger.md 的边界事件里如实记录：改了什么、为什么当时没停下、当前状态是保留还是已回退。然后立即补一次范围确认。

**掩盖比越界本身严重得多。** 越界是一次可以补救的流程偏差；隐瞒会让 build-evidence 与实际 diff 不一致，而 QA 的 evidence assurance 正是靠这个一致性工作的——一旦它不可信，后面所有检查都建立在错误前提上。

---

## 7. 怎么读 check_scope.py 的输出

```bash
python3 "$CORE/scripts/check_scope.py" --root <项目根> --work-item WI-###
```

退出码：0 通过 / 1 检查未通过（有意义的结果）/ 2 脚本自身出错。**动手前也跑一次**——它会告诉你工作区里有没有上一轮遗留的越界改动。

### violations：先看 kind，再看 source

| `kind` | 含义 | 处置 |
|---|---|---|
| `outside-whitelist` | 改了 `write` 白名单外的文件 | 撤销，或走第 6 节七步扩大 `write` |
| `protected` | 命中保护区 | 先看 `source` 决定申诉对象 |

`protected` 类违规带 `source` 与 `appeal_to` 两个字段，对应第 4.0 节的两个来源：

| `source` | 来自 | `appeal_to` 与该做什么 |
|---|---|---|
| `project` | `protected_from_project`（config.yaml 的项目策略） | 平台 / 项目负责人。**本次 WI 不能自己放开**。绝大多数情况下正确的动作是撤销改动，把它作为独立发现交出去，而不是去申请例外 |
| `local` | `protected_local`（本次自己收紧的） | WI owner。走一次范围扩大即可 |
| `unspecified` | 旧版 change-scope 只有合并的 `protected` 字段 | 先把 change-scope 升到分层格式，再判断该找谁 |

按 `source` 决定去问谁，不要一律找同一个人。找错人的代价不只是白跑一趟——
被拒绝两次之后，人就开始绕过这个机制了。

### secret_files_touched：按事故处理，不按越界处理

命中 `read_excluded` 的路径出现在改动清单里时会报这一项，并把 `ok` 置为 `false`。
这与普通越界不是一个量级：

1. 确认内容有没有被读进上下文；
2. 确认有没有写进 `evidence.jsonl` 或 `ledger.md`——**这两个文件进 git 且不删除，写进去就是永久的**；
3. 若已写入，按 `config.yaml` 的 `data_policy` 处理，并**轮换相关凭据**。

改写历史记录不是选项。证据链的价值建立在"不修改、不删除"上，为一次泄露破例，
之后每一条证据都要被质疑是不是也被改过。轮换凭据才是那条能同时保住安全和证据链的路。

### 其余字段

- `declared_but_unused`：声明了但一个文件都没碰的 `write` 条目。不算错，但值得看一眼——
  通常说明推导时多列了，或者有条 criterion 忘了做。
- `generated_artifacts`：`__pycache__`、`*.pyc` 之类。由已授权的命令产生，不计越界。
  但仓库把它们纳入版本控制是个卫生问题，作为独立发现交出去，**不要顺手加 `.gitignore`**——那本身是范围外的改动。
- `read_excluded_patterns`：脚本回显本次的读排除清单。git 看不到"读"，
  所以这条边界的执行是行为性的，脚本只能在事后从改动清单里发现它被碰过。

---

## Context Budget

`config.yaml` 的 `context_budget` 给了两个阈值。超限不是硬停，是必须换个读法：

| 阈值 | 超过时 |
|---|---|
| `max_source_files_per_task` | 单个任务 brief 引用的来源文件超过它，先产出一份定向摘要（接口签名、约束、现有模式），brief 引摘要而不是引原文 |
| `max_doc_age_days` | 引用更旧的文档时，在 `[Source: ...]` 后加注"（文档 <日期>，可能已过期）"，并说明有没有核对过代码现状 |

`on_exceed` 决定动作：`summarize` 先摘要 / `replace` 换更小的来源 / `ask` 问责任人。

这不是省 token 的技巧。**没有预算，渐进加载就不稳定**——一个任务把二十个文件塞进 brief，
下一次上下文压缩会把它们一起丢掉，而压缩后重复执行已完成的任务是本环节观测到的最昂贵的失败。

---

## read_excluded 命中之后

这是套件里最反直觉的一处，值得单独想清楚。

`protected_*` 管的是**不可写**。按"可读范围宽、可写范围窄"的建模原则，写保护**恰恰不约束读取**——
一个 `.pem` 即使躺在 protected 里，按字面规则它仍然可读，把它读进上下文完全合规。

而风险正在读这一侧：`evidence.jsonl` 与 `ledger.md` 永久保留、进 git、可 PR 评审，
套件所有规则都在鼓励"不删除"。一次疏忽写进去的连接串或 token 就是永久泄露——
**治理机制会把一次疏忽放大成不可撤销的后果。** 所以密钥必须靠一条独立的读边界拦住。

`change-scope.yaml` 的 `read_excluded` 就是这条边界，默认继承 `config.yaml` 的 `data_policy.never_read`。
命中时四步：

1. **停止读取**。不要"先看一眼再说"——看过就已经在上下文里了，没有撤回动作。
2. 写 `boundary_stop`，notes 只写路径与用途，**不写文件内容**。
3. 说明**缺什么、用什么替代**：用 `.env.example` 的键名而非 `.env` 的值、用 `config.yaml` 的 `commands`
   而非 CI secrets、用接口文档而非真实凭据。说清楚缺的是哪一项权限，让人能一步补上。
4. **不把内容带入上下文**，也不进任何 `input_refs`。

**REQUIRED**：写第一条 evidence 之前读 `../../sdlc-core/references/evidence.md` 的「硬规则：证据里不得出现密钥」。
屏蔽模式取自 `data_policy.evidence_redaction`，命中就写 `[redacted]` 并把 `result` 记为 `blocked`。
不要粘贴命令原始输出——输出里有什么，你事先并不知道。

---

## 读 read 列表之外的路径

`read` 是宽范围而不是白名单。读它之外的路径**不需要人工确认**（读得宽是有意为之，
为一次 Read 打断责任人，是在消耗他之后真正需要判断时的注意力），但要留痕：

- `ledger.md` 的「边界事件」表追加一行，处置写"已读，下次 change-scope 更新时并入 read"
- 下次生成 change-scope 新版本时，把这些路径并进 `read`

**唯一例外**：命中 `read_excluded` 的路径不适用这条宽松规则，走上面的四步。

