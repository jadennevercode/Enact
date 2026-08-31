# 验证策略选择与调度

1. [先按风险决定做哪几类](#1-先按风险决定做哪几类)
2. [从 criterion 特征选策略](#2-从-criterion-特征选策略)
3. [策略选择的三个常见错判](#3-策略选择的三个常见错判)
4. [Execution Class 调度规则](#4-execution-class-调度规则)
5. [九项调度输入怎么填](#5-九项调度输入怎么填)
6. [AI 调度建议：必须带理由与置信度](#6-ai-调度建议必须带理由与置信度)
7. [browser/DOM 测试规范](#7-browserdom-测试规范)
8. [完整例子：从 EARS criterion 到 TestCase](#8-完整例子从-ears-criterion-到-testcase)

选择分两层，**顺序不能倒过来**：

1. **先按风险决定本轮做哪几类验证**（§1）。主规格的原话是「按风险选择，不要求每次平均覆盖」——挨着 criterion 配齐八类，得到的是危险的那条和无关紧要的那条享受同等待遇。
2. **再对选中的每条 criterion 挑具体策略**（§2）。这一层的标准只有一条：**这个策略能不能证伪这条 criterion**。跑得快、写得省事、覆盖率好看，都不是标准。一条集成语义的 criterion 用单元测试加 mock 覆盖，得到的是绿灯和零信息量——mock 里写的是你对依赖的假设，测的还是你自己。

先做第二层会把第一层挤掉：一旦开始逐条 criterion 想测试，"这次到底该不该做恢复类"这个问题就再也不会被问出来了。

---

- [1. 先按风险决定做哪几类](#1-先按风险决定做哪几类)
- [2. 从 criterion 特征选策略](#2-从-criterion-特征选策略)
- [3. 策略选择的三个常见错判](#3-策略选择的三个常见错判)
- [4. Execution Class 调度规则](#4-execution-class-调度规则)
- [5. 九项调度输入怎么填](#5-九项调度输入怎么填)
- [6. AI 调度建议：必须带理由与置信度](#6-ai-调度建议必须带理由与置信度)
- [7. browser/DOM 测试规范](#7-browserdom-测试规范)
- [8. 完整例子：从 EARS criterion 到 TestCase](#8-完整例子从-ears-criterion-到-testcase)

## 1. 先按风险决定做哪几类

### 风险分级：五个面，各自独立取值

| 风险面 | 问什么 | 判高的信号 | 判低的信号 |
|---|---|---|---|
| **数据破坏** | 出错会不会写坏或删掉存量数据 | 迁移、批量更新、删除、schema 变更、去重合并 | 只读、只新增 |
| **资金** | 出错会不会产生错误的钱 | 计费、退款、结算、额度、对账 | 纯展示 |
| **权限** | 出错会不会让人看到或做到不该的事 | 认证、授权、租户隔离、越权、导出 | 已登录用户操作自有数据 |
| **可逆性** | 出错能不能退回去 | 不可逆写入、外发通知/邮件、第三方调用、缓存失效 | 可回滚、可重放、幂等 |
| **影响面** | 出错波及多少人、多少功能 | 公共模块、共享接口、全量用户、默认开启 | 单一入口、灰度中、开关默认关 |

**任何一面为高，本次就不是低风险变更——不管改了几行。** 行数是成本的度量，不是风险的度量：一行 `if` 改成 `elif` 可以让全量用户越权。

### 八类验证：什么时候必须做，什么时候可以不做

| 类别 | 必须做 | 可以不做 |
|---|---|---|
| **正常** | 永远 | 无 |
| **异常** | 有失败分支要处理：外部调用、输入校验、超时、重试 | 纯查询，且失败只表现为空结果 |
| **边界** | criterion 里出现阈值、范围、上限、时间窗、数量词 | criterion 里没有任何量词 |
| **兼容** | 改了公共接口、数据结构、依赖版本、序列化格式 | 改动完全在私有实现内部 |
| **性能** | 触及热路径、新增查询或循环、数据量随用户增长 | 无新增 IO 且调用频次不变 |
| **安全** | 权限面判高，或触及认证、输入边界、密钥、审计留痕 | 无权限语义且不接受外部输入 |
| **恢复** | 可逆性判高，或流程中断后需要接着跑 | 单步幂等操作 |
| **运维准备** | 影响面判高，或本次新增了要看的指标 / 要退的路径 | 无新增可观测面，且回退路径未变 |

判"可以不做"是一个判断，要写进 `test-plan.yaml` 的 `risk_based_selection.skipped` **并带上理由**。不写就是静默省略——Release 责任人看到一份没有性能测试的报告，分不清是判断过不需要，还是根本没想到这一类。这两种情况他该做的决定完全不同。

反过来，`covered` 里列了一个类别，就要有对应的 Test Intent 或回归用例真的属于它。**声明覆盖但拿不出用例，比不声明更糟**——它把一个已知的空白变成了一个看不见的空白。

---

## 2. 从 criterion 特征选策略

| criterion 特征（怎么认出来） | 推荐策略 | 为什么 |
|---|---|---|
| **数据校验类**：格式、范围、必填、枚举、单位换算 | `unit` + `schema` | 纯函数语义，输入输出可穷举边界。schema 校验能一次锁住整个结构 |
| **状态转换类**：WHEN 事件 THEN 状态从 A 到 B；不允许的转换要被拒 | `unit`（状态机纯逻辑）+ `integration`（持久化后状态真的变了） | 只测内存状态机会漏掉"事务回滚了状态没落库"这类问题 |
| **接口契约类**：请求/响应结构、状态码、错误体、版本兼容 | `api-contract` | 断言在结构与契约层面，不依赖被调方的业务实现 |
| **集成类**：跨模块、跨服务、涉及数据库/队列/外部 API 的真实交互 | `integration`；跨服务用 `e2e` | 这类 criterion 的失败模式几乎全在"连接处"，mock 恰好把连接处抹掉了 |
| **端到端旅程类**：用户从入口走到结果的完整路径、发布验证、回退验证 | `e2e` | 唯一能证明各部分拼起来还成立的方式 |
| **UI 行为类**：可见性、可用性、禁用态、提示文案、可访问性 | `browser` | 见 §7 |
| **性能类**：响应时间、吞吐、并发、数据量上限 | `performance` | 必须在接近目标环境的条件下测；单机 happy path 的数字没有意义 |
| **安全类**：认证、授权、越权、注入、密钥暴露、审计留痕 | `security` + `unit`（授权判定逻辑） | 授权规则的每条否定分支都要有用例——"该被拒绝的确实被拒绝"比"该通过的通过了"重要 |
| **恢复类**：故障后能否恢复、断点续跑、数据修复、降级切换 | `integration` + `manual`（演练） | 这类 criterion 的失败只在"第二次"才暴露——第一次跑通不能证明中断后接得上。要真的杀掉进程、断开连接、灌入半写入的脏数据，再看它怎么起来 |
| **运维准备类**：监控指标可采集、告警可触发、回退脚本可执行 | `integration`（指标与告警端到端）+ `release`（回退演练） | 运维准备最容易退化成填空题：Release 页面上写着"已配置监控"，而没有人验证过那条指标真的有数、那条告警真的会响。**验证过的准备度和声明过的准备度是两回事**，出事那天才会发现区别 |
| **静态约束类**：依赖不得引入、配置项必须存在、命名/结构规范 | `static` | 用 lint/脚本一次锁定，比运行时测试可靠且便宜 |
| **主观/业务合理性类**：文案得体、体验可接受、风险可接受 | `manual` | 指派责任人和期限。**不要伪装成自动测试**——一个断言 `assert True` 的"自动化"用例比诚实的待办更糟 |

一条 criterion 可以有多条 Test Intent，**上限 3 条**：正常路径、边界、异常路径各一条通常就够。数量是上限不是下限，凑数会逼出编造的用例。

一条 criterion 也可以配两种策略（例如状态转换类的 unit + integration）。这时两条 Intent 分别记 `strategy`，不要合成一条含糊的。

---

## 3. 策略选择的三个常见错判

**错判一：把集成语义降级成单元测试。**
criterion 说"订单支付成功后库存扣减"，你写了个单元测试 mock 掉库存服务，断言"调用了 decrease()"。这条测试在库存服务改了签名、扣减失败不回滚、或者根本没部署时全部通过。判别方法：**问自己这条测试在哪种真实故障下会变红**。答不上来就是假覆盖。

**错判二：把静态约束写成运行时测试。**
"配置文件必须包含 X"用集成测试跑一遍服务启动来验证，慢且脆。能在不运行系统的情况下判定的，一律用 `static`。

**错判三：把 manual 包装成 automated。**
"导出的报表排版可读"没法自动断言。写成 `manual` + `verified_by: <人名>`，比写一个只检查文件非空的假自动化诚实得多——后者会在覆盖统计里显示为绿色。

---

## 4. Execution Class 调度规则

五个自动化执行类别加一类人工指派。类别决定**什么时候跑、能不能延后、失败怎么处理**，不决定测试写法。

| 类别 | 装什么 | 何时跑 | 能否延后 | 重试策略 | 失败处置 |
|---|---|---|---|---|---|
| `fast` | lint、schema、static、unit、关键 API contract | 每次变更后立即 | 不可 | **不重试** | fail-stop：立刻停下修，不要在红灯上继续堆变更 |
| `integration` | 容器化服务、数据库组合、模块间兼容性 | 按受影响组件选择性触发 | 可以合批，但不得跨越 QA 出口 | 至多 1 次，且必须记录重试 | 归因后处理；连接类失败先查 `environment` |
| `browser` | 多浏览器、可访问性、视觉与交互行为 | 关键路径立即；广泛浏览器矩阵可分片 | 关键路径不可；矩阵可以 | 至多 1 次，保留两次的 trace | 见 §7 的证据保留要求 |
| `release` | 端到端旅程、回退演练、发布后验证 | **Release Gate 前强制** | **不可延后、不可因成本静默跳过** | 至多 1 次；两次都挂即 fail | 未跑完就不进入 Release 人工环节 |
| `heavy` | 负载、安全扫描、大数据量回归 | 排队执行 | 可以，但要写明下次跑的时间点 | 不重试（重试成本高于价值） | 命中关键风险时提级到 release，由人决定是否等它 |
| `human` | UX、业务合理性、风险接受 | 指派后按期限 | 可以，但期限要落在 qa-report 里 | 不适用 | 到期未确认 = 未覆盖，不是通过 |

**哪些类别不可延后由项目决定，不由这张表决定。** 权威来源是 `config.yaml` 的 `test_policy.non_deferrable_classes`（默认 `fast` + `release`）。上表的"能否延后"列是这个默认值的解释，项目改了配置就以配置为准——不同项目对"必须当场跑完"的定义本来就不同，写死在 Skill 里只会逼着项目要么假装遵守，要么整段忽略。

**关于跳过。** 唯一合法的跳过是：具名责任人明确接受风险 + 在 `gates/` 留下记录 + qa-report 的执行结果表里写明。缺任何一项都是静默跳过。"这次改动跟它无关"是一个判断，不是一次批准——判断错了没有人拦得住，这正是要求批准的原因。

**关于重试。** 重试必须显式声明并计数。同一用例重试后通过，状态记 `flaky` 而非 `pass`，并进 qa-report 的 Flaky 小节。判定标准见 `attribution.md`。

---

## 5. 九项调度输入怎么填

调度不该靠临场判断。这九项让排期决定可复现、可审计——缺了它们，"为什么这批用例是这么跑的"事后没有人答得上来，而下一次还会照样出错。

### TestCase 上的五项

| 字段 | 取值 | 怎么判断 | 填错会怎样 |
|---|---|---|---|
| `criticality` | low / medium / high | 命中关键路径、或属于 Gate 必测，填 high | 填低了：高风险用例被排进可延后的批次，Gate 前才发现它压根没跑 |
| `data_sensitivity` | synthetic / masked / real | 用到真实生产数据即 `real` | 填低了：真实数据被带进共享测试环境、被写进 evidence 或 trace。`data_policy` 拦不住已经发生的事 |
| `env_exclusive` | true / false | 要不要求"跑的时候别人别动"（独占端口、全量数据集、改共享状态） | 见下方 |
| `parallel_safe` | true / false | 与别的用例同时跑，会不会互相看到对方的写入 | 见下方 |
| `human_dependency` | 文本，无则留空 | 依赖的人工前置：审批、开权限、造账号、线下造数 | 留空但实际有依赖：用例长期"待跑"，看起来像排期慢，实际是阻塞，没有人去解 |

**`parallel_safe` 与 `env_exclusive` 是九项里代价最不对称的两项。**

没有它们，integration 和 browser 用例会被并行编排到同一套共享状态上：A 的清库跑在 B 的断言中间，B 挂了。这个失败的现场——连接被重置、数据莫名其妙不见了、只在 CI 上复现——看起来**完全就是环境问题**。于是它被归因为 `environment`、重跑一次、绿了、结案。

**一个真实存在的并发缺陷，就这样被自己的调度参数制造出来，又被自己的重试策略掩盖掉。** 这条链上没有任何一步单独看是错的，错在两个布尔值没人填。

判别方法：

- 这个用例**写**共享资源吗（库表、文件、缓存、外部账号、消息队列）？写就是 `parallel_safe: false`
- 它要求环境安静吗？要就是 `env_exclusive: true`

两者不等价：性能基准用例只读、不写任何共享资源，但必须独占——`parallel_safe: true` + `env_exclusive: true`。

### run_plan 上的三项

| 字段 | 怎么填 | 填错会怎样 |
|---|---|---|
| `resource_profile` | light / standard / heavy，按 CPU、内存、外部依赖的消耗量 | heavy 标成 light：它被塞进"每次变更都跑"的批次，把几十秒的快反馈拖成十几分钟，然后所有人开始跳过它 |
| `run_window` | `when` 触发时机、`not_before` 最早可跑、`deadline` 最晚必须出结果 | 见下方 off-peak |
| `max_workers` / `shards` | 受 `config.yaml` 的 `test_policy.budget.max_parallel_workers` 约束 | 超上限：要么排队饿死，要么挤掉别人的 CI 额度，而这件事在本次运行里看不出来 |

**off-peak 排期用 `run_window.not_before`。** heavy 类（负载、安全扫描、大数据量回归）和 model evaluation 这类**既贵又不阻塞当前变更**的批次，把 `not_before` 设在低峰时段、`deadline` 设在 Release Gate 之前。这两个值必须一起给才有意义：只有 `not_before` 会让它无限期推迟，只有 `deadline` 会让它跟快反馈抢资源。

> **model evaluation 是 heavy 的一种典型**：一次跑几十分钟，结果是一个分布而不是一个布尔值，而且几乎从不因为这一次代码变更而改变。它的正确位置是 off-peak 批次 + Release Gate 前必须有结果，不是每次提交都跑。把它塞进 `fast` 的人通常几周之内就会把它整个关掉。

### results 上的一项

`duration_sec` 每次都要记，包括通过的用例。单看一次没有用，**攒起来才是「基于历史建议分片数与 worker 数」的唯一原料**。不记录耗时，任何调度建议都只能是猜测——而猜测不该被写成建议（红线 4.3）。

---

## 6. AI 调度建议：必须带理由与置信度

主规格允许基于历史给出建议：impacted tests、分片数、worker 数、off-peak 窗口、重试策略。同一句话要求**显示理由与置信度**。原因很直接：**不带理由的建议无法被反驳，不带置信度的建议会被当成结论**——而调度建议恰恰是最经常基于三五个样本做出的那一类判断。

固定三段，缺一段就不算一条建议：

```
建议: 分 4 片并行
理由: 历史 P95 单片 6min，当前单片 22min，deadline 前只剩 15min
置信度: 中（仅 3 次历史样本，且都在同一台 runner 上）
```

✅ `建议: browser 矩阵本轮只跑 Chromium + Firefox / 理由: 近 20 次运行中 Safari 分支零独有失败 / 置信度: 中（样本集中在最近两周，未覆盖上次样式重构前）`

❌ `建议: 可以适当减少浏览器覆盖以节省时间`（没有理由、没有置信度，"适当"也无法执行）

✅ `建议: TC-018 重试上限从 1 提到 2 / 理由: 连续 5 次运行有 2 次首跑失败、重跑通过，失败点都在登录跳转 / 置信度: 低（现象未定位，重试是绕过不是修复）`

❌ `建议: TC-018 一直不稳，标成 flaky 忽略掉`（这不是调度建议，是取消验证）

**置信度低的建议照样要给出来**——它的价值就在于把"我们其实不知道"摆到台面上。但低置信度的建议不能作为跳过验证的依据：不知道，所以更要跑。

### 哪些建议必须走人工确认

| 建议类型 | 为什么要人确认 |
|---|---|
| 提高并发、申请更多预算 | `config.yaml` 的 `test_policy.budget_change_requires_approval` 为 true 时，`max_workers` 超过 `budget.max_parallel_workers` 必须有具名批准。成本落在别人的额度上 |
| 缩小执行范围（跳过用例、砍浏览器矩阵、降低重试后仍判通过） | 这是在替别人接受风险 |
| 把某个类别整体延后 | 哪些类别不可延后由 `config.yaml` 的 `test_policy.non_deferrable_classes` 决定，不由建议决定 |

其余建议（分片数、执行顺序、off-peak 窗口）可以直接采用，但**理由与置信度要落进 qa-report**，让人事后能判断这次排期是不是合理。一次排期决定如果只留下结果不留下依据，下次遇到同样的情况还是从零猜起。

---

## 7. browser/DOM 测试规范

### 语义 locator

**CSS 路径不是业务契约。** `.btn-primary > span:nth-child(2)` 会在任何一次样式重构后失效，而它失效时你得到的信息是"选择器变了"，不是"功能坏了"。用用户能感知的语义定位：

| ✅ 用这个 | ❌ 不要用 |
|---|---|
| `role=button, name=确认导出` | `.btn-primary > span:nth-child(2)` |
| `role=alert` + 可见文案断言 | `#toast-container div.msg` |
| `label=开始日期` 定位输入框 | `input[name="dt_start"]`（除非该 name 本身写在 Contract 里） |
| `role=table` → `row` → `columnheader=退款金额` | `//table/tbody/tr[3]/td[5]` |
| `data-testid=export-dialog`（团队已约定的稳定钩子） | `.MuiDialog-paper` （第三方库内部类名） |

判别原则：**这个定位方式描述的是用户看到/用到的东西，还是当前 DOM 恰好长成的样子？** `data-testid` 处在中间——它稳定，但它不表达用户语义。可以用它锁定容器，然后在容器内用 role/name 定位具体元素。

### 要检查什么

只断言"元素存在"通常不够。一条 UI 行为类 criterion 至少覆盖：

- **可见性与可用性**：元素可见、可点击；禁用态用 `disabled` / `aria-disabled` 断言，不要靠灰色截图
- **ARIA 与 DOM 状态**：`aria-expanded`、`aria-invalid`、`aria-live` 区域的内容、焦点落在哪里
- **文案**：错误提示的实际文字（criterion 说"可读的错误说明"，就要断言它确实说清了什么错）
- **网络请求是否发生**：criterion 说"点击后不应发起请求"或"应带上时间范围参数"，就监听网络。**UI 没报错不等于后端没被调用**——这是纯 DOM 断言最大的盲区
- **状态持久性**：刷新后仍成立的要求，要真刷新一次

### 失败时保留什么

browser 用例失败，**证据必须在失败现场留下**，事后无法复现：

| 证据 | 为什么 |
|---|---|
| trace（Playwright trace 或等价物） | 唯一能回放"当时到底点到了哪"的东西 |
| 失败时刻的 DOM snapshot | 区分"元素不存在"和"元素存在但 locator 写错了" |
| network log | 区分前端没发请求、后端返回了错误、还是请求成功但渲染没跟上 |
| console 日志 | 前端异常常常只在这里出现 |
| 截图 | 给人看的补充证据，不作为唯一证据（截图无法证明 ARIA 状态） |

保留路径写进 `test-plan.yaml` 的 `results[].evidence_ref`。**没有 evidence_ref 的 browser 失败无法归因**——你分不清它是 implementation 还是 environment，只能猜。

---

## 8. 完整例子：从 EARS criterion 到 TestCase

### 输入（approved contract.yaml 片段）

```yaml
criteria:
  - id: "1.2"
    ears: "WHEN 用户请求导出的时间范围超过 12 个月 THEN 系统 SHALL 拒绝导出并返回可读的错误说明"
    verification: automated
```

### 步骤 1：冻结 Test Intent（只看 contract，不看代码）

这条 criterion 有三个可观察面：拒绝这个动作、错误说明的可读性、以及"超过 12 个月"这个边界本身。所以拆三条：

```yaml
test_intents:
  - id: TI-004
    criterion: "1.2"
    expected_behavior: "请求 13 个月的时间范围时，导出不发生，用户收到一条说明了原因和上限的错误信息"
    strategy: api-contract
    execution_class: fast
    rationale: "拒绝行为体现在响应结构与状态码上，不需要真实导出链路"

  - id: TI-005
    criterion: "1.2"
    expected_behavior: "恰好 12 个月的时间范围被接受，导出正常开始"
    strategy: api-contract
    execution_class: fast
    rationale: "边界的另一侧。criterion 说的是'超过'，12 个月本身不该被拒"

  - id: TI-006
    criterion: "1.2"
    expected_behavior: "在导出界面选择跨度超过 12 个月后提交，页面显示可读的错误提示，且不发起导出请求"
    strategy: browser
    execution_class: browser
    rationale: "criterion 要求错误对用户'可读'，只有在用户界面上才能验证这一点"
```

注意 TI-005：**边界的另一侧来自 criterion 的字面**（"超过"），不是来自实现里读到的 `if months > 12`。如果实现写的是 `>= 12`，TI-005 会失败——这正是它存在的意义。

也注意三条 Intent 都没有出现 endpoint、函数名、字段名或选择器。这一步不知道这些东西是正常的。

### 步骤 2：绑定实现（现在才读代码）

读代码得到：`POST /api/reports/export`，请求体 `{from, to, format}`，错误响应 `{code, message}`；前端页面 `/reports`，提交按钮文案"开始导出"。

```yaml
test_cases:
  - id: TC-004
    intent: TI-004
    preconditions: "已登录的普通报表用户；无进行中的导出任务"
    environment: "test，种子数据集 seed-reports-v3"
    steps:
      - "POST /api/reports/export，body: {from: 2025-01-01, to: 2026-02-01, format: csv}"
    expected: "导出不发生，响应中包含说明原因与上限的可读错误信息"
    binding: "endpoint=POST /api/reports/export; 断言 4xx + body.message 非空且包含时间上限的说明; 断言未产生导出任务记录"

  - id: TC-005
    intent: TI-005
    preconditions: "同上"
    environment: "同上"
    steps:
      - "POST /api/reports/export，body: {from: 2025-02-01, to: 2026-02-01, format: csv}"
    expected: "恰好 12 个月被接受，导出正常开始"
    binding: "endpoint 同上；断言 2xx 且产生一条导出任务记录"

  - id: TC-006
    intent: TI-006
    preconditions: "已登录，停留在 /reports"
    environment: "test，Chromium + Firefox"
    steps:
      - "填写开始日期 2025-01-01、结束日期 2026-02-01"
      - "点击 role=button, name=开始导出"
    expected: "页面显示可读的错误提示，且不发起导出请求"
    binding: >
      locator: label=开始日期 / label=结束日期 / role=button,name=开始导出 / role=alert;
      断言 role=alert 文案包含时间上限说明；
      监听网络：不应出现 POST /api/reports/export；
      失败时保留 trace + DOM snapshot + network log
```

**`expected` 逐字来自对应的 TI**，只有 `binding` 是新增的。如果你发现自己在改 `expected` 让它更贴合实现，那就是铁律二正在被违反的那一刻。

### 步骤 3：进 run_plan

```yaml
run_plan:
  - execution_class: fast
    cases: [TC-004, TC-005]
    runner: "pytest tests/api/test_export_range.py --junitxml=.artifacts/fast.xml"
    resource_profile: light
    run_window:
      when: 每次变更
      not_before: null
      deadline: null
    max_workers: 4
    shards: 1
    retry_policy: 不重试
    skippable: false
  - execution_class: browser
    cases: [TC-006]
    runner: "npx playwright test export-range --trace=on --output=.artifacts/browser"
    resource_profile: standard
    run_window:
      when: 关键路径，每次变更后
      not_before: null
      deadline: null
    max_workers: 2
    shards: 1
    retry_policy: 至多 1 次，两次的 trace 都保留
    skippable: false
```

`runner` 写出来才谈得上"执行与解释分离"：按它跑、收产物、记 `duration_sec`，**判 pass/fail 是下一步的事**。TC-006 是 browser 用例且要登录，`parallel_safe` 取 false——不填这一项，它和别的登录用例并行时会互相踢掉会话，而失败现场看起来像超时。

### 假如 TC-005 失败了

实现是 `>= 12` 拒绝，criterion 写的是"超过 12 个月"。这时**不要改 TC-005 的预期**。两个可能：实现有 off-by-one（归因 `implementation`，开 defect），或者业务本意就是 12 个月也拒绝而 Contract 写错了（归因 `requirement`，提 AMD）。这两者你无法从代码判断——去问 Contract 的责任人。判别方法见 `attribution.md`。
