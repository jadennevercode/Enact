# 失败归因

1. [为什么归因值得花时间](#1-为什么归因值得花时间)
2. [判别顺序](#2-判别顺序)
3. [五类归因：信号、处置、产出](#3-五类归因信号处置产出)
4. [flaky 的判定与处理](#4-flaky-的判定与处理)
5. [✅/❌ 归因对照](#5-归因对照)

---

## 1. 为什么归因值得花时间

一个失败的测试携带两条信息：**哪里坏了**，和**为什么会坏成这样**。第二条只有在归因正确时才拿得到。

把所有失败都记成 `implementation`，QA 就退化成一个报错转发器：build 收到一串 defect，修完，下一轮同类问题原样再来一遍。**归到 `requirement` 的失败拦住的是一整类将来还会重复发生的问题**——Contract 改了，之后所有基于它的实现、测试、发布证据都跟着对。这是 QA 能产生的最高价值，也是最容易被"先记个 defect 让 build 去看"绕过的价值。

`implementation` 是最省事的答案，所以它需要被主动怀疑：**当你准备写下 `implementation` 时，先确认你已经排除了另外四种。**

---

## 2. 判别顺序

先排除便宜且高频的，再做真正需要判断的区分：

```
1. environment ——  这次运行的条件对吗？（最便宜，且最常见）
        ↓ 排除
2. test       ——  测试自己写对了吗？（你能自己修，先看）
        ↓ 排除
3. requirement——  Contract 说的对吗？（最有价值，最容易被跳过）
        ↓ 排除
4. design     ——  方案能达到 Contract 吗？
        ↓ 排除
5. implementation —— 剩下的才是它
```

第 3 步是整个顺序的重点。到了这一步，你已经确认"测试写对了、环境正常了"，此时的默认反应是"那就是代码写错了"——但同样符合事实的另一种可能是：**代码正确实现了一条错误的 criterion**。区分这两者只有一个方法：回到 contract 读那条 EARS 的字面，问它是不是业务真正想要的。答不上来就去问 Contract 的责任人，**不要去读实现找答案**。

---

## 3. 五类归因：信号、处置、产出

### `environment`

**典型信号**

- 同一 commit 在另一台机器/CI 上通过
- 报错是连接超时、DNS、证书、端口占用、镜像拉取失败、磁盘满
- 报错提到缺少配置项、环境变量、密钥
- 一批不相关的用例同时失败（真正的实现缺陷通常聚集在相关用例）
- 种子数据缺失或被上一次运行污染（"第二次跑就挂"是经典信号）
- 时区、locale、系统时间导致的日期断言偏移

**处置**：修复环境或数据 → 重跑 → 记录。

**产出**：`results[].attribution: environment`，`evidence_ref` 指向报错日志，`notes` 写清是什么条件不对。**如果同一环境问题第二次出现，它就不再是环境问题了**——环境的不可复现性本身是个缺陷，升级成 defect 或写进 qa-report 的遗留问题。

**易错**：把"依赖服务返回 500"直接记成 environment。依赖服务挂了是 environment；依赖服务正常但拒绝了你的请求，那可能是 implementation 或 requirement。

---

### `test`

**典型信号**

- 断言写反了、比较用了错误的操作符、期望值有拼写错误
- 用了错误的 fixture、错误的用户角色、错误的测试数据
- 时序问题：没等异步完成就断言（注意：如果产品**要求**在某时限内完成，那是 performance 缺陷，不是测试问题）
- locator 因为样式重构失效，而功能本身正常（见 test-strategy.md §7——这类失败本身说明 locator 选错了）
- 测试之间有依赖，单跑通过、全量跑失败

**处置**：修测试。**这是唯一你可以自己动手改的失败类别**——测试目录在你的写白名单里。

**产出**：`attribution: test`，修正后重跑。

**红线交叉点**：修 `test` 只允许修**执行方式**（binding、fixture、等待、locator）。**不允许修 `expected`**——期望值来自冻结的 Test Intent，改它就是从实现反推预期。如果你确信期望值本身错了，那说明 Test Intent 派生错了或 criterion 有歧义：回到 contract 核对；若 criterion 确实有歧义，归因是 `requirement`，不是 `test`。

---

### `requirement`

**典型信号**

- criterion 的字面与业务实际期望不符（"超过 12 个月"其实业务想要"12 个月及以上"）
- 两条 criterion 互相矛盾，实现只能满足其中一条
- criterion 没覆盖测试中遇到的真实情况（并发、空数据、权限组合），实现只能靠猜
- criterion 抽象到无法派生可观察的预期（"性能良好""体验流畅"）
- 实现与 criterion 都"合理"，但对同一个词的理解不同（"工作日""当前用户""导出完成"）
- 团队讨论这个失败时，争论的是"应该是什么行为"而不是"代码哪写错了"——**这句是最强的信号**

**处置**：写 `amendments/AMD-###.md`（模板在 core），回 contract 环节评审。**不要在测试里替 Contract 做决定，也不要让 build 在代码里替它做决定。**

**产出**：AMD 文件 + `attribution: requirement` + `follow_up: AMD-###`。AMD 被接受后 contract 出新版本，受影响的 Test Intent 要重新派生并重新冻结。

**为什么最有价值**：一条修好的 criterion 会让之后每一轮实现、测试和发布证据都对齐；一个修好的 defect 只让这一次对齐。

---

### `design`

**典型信号**

- 实现忠实地照着 contract 的 `design` 块做了，结果达不到 criterion
- 失败是架构性的：选的数据结构撑不住数据量、选的同步模型解决不了并发、选的存储保证不了一致性
- 修这个失败需要改的是方案而不是几行代码
- 性能类失败中"算法/架构选择"导致的那一部分（区别于"某个查询忘了加索引"，后者是 implementation）
- 多个 criterion 因为同一个方案决策一起失败

**处置**：回 contract 环节重审 `design` 块（走 Amendment）。**不要在 build 里悄悄换方案**——方案变更会改变风险面，Release 需要知道自己批准的是什么。

**产出**：`attribution: design` + 指出是哪个设计决策撑不住，指向 contract `design.decisions` 的具体编号（`TD#`）或 `design.approach` 的具体一句。

---

### `implementation`

**典型信号**（**只有在前四类都被排除后才成立**）

- Contract 清楚、设计合理、测试正确、环境正常，代码就是没做到
- off-by-one、条件写反、分支漏了、错误没处理、边界没判
- 失败可稳定复现，且指向具体几行代码
- 修复只需要改实现，不需要改 Contract、design 或测试

**处置**：开 defect，交还 `sdlc-build`。**QA 不修业务代码**——既写实现又写测试的人无法验证自己的理解。

**产出**：defect 记录（criterion 编号、复现步骤、期望 vs 实际、evidence_ref）+ `attribution: implementation` + `follow_up: DEF-###`。

---

## 4. flaky 的判定与处理

**判定标准**：在**同一 commit、同一环境、同一数据**下，同一用例的结果不一致——就是 flaky。不管它是"跑 3 次挂 1 次"还是"跑 10 次挂 1 次"。

判定要点：

- **重试通过 ≠ 稳定。** 状态记 `flaky`，不记 `pass`。
- **flaky 不是一个归因类别，是一个状态。** 它仍然要归因：多数 flaky 属于 `test`（时序、共享状态、测试间依赖）或 `environment`（资源竞争、外部依赖抖动），但**有一部分是真实的并发/竞态缺陷**，归 `implementation`。一律记成 `test` 是最危险的处理方式——生产上的竞态就是这么被放过去的。
- **无法立即定性的 flaky，记为未归因的遗留问题**，进 qa-report 的 Flaky 小节，带 owner。不要因为"重试能过"就让它消失。

qa-report 的 Flaky 小节至少写：用例、重试次数与各次结果、初步归因或"待定"、owner。

**flaky 与 Gate 的关系**：release 类用例出现 flaky，等同于该 criterion 未被稳定验证。可以带风险发布，但那是一次显式的风险接受，要由具名责任人在 Gate 里承担，不是由"它重试就过了"承担。

---

## 5. 归因对照

**❌ 图省事**

> TC-011 失败：导出 CSV 缺少"退款金额"列。
> 归因：implementation。开 DEF-004，交给 build 加上这一列。

问题在于没做第 3 步。翻一下 contract 会发现：criterion 3.1 只说了"导出包含订单基础字段"，压根没提退款金额——测试里那条预期是从 exploration.md 的一句话里来的，本身就不该存在，或者 criterion 漏写了。记成 implementation 的结果是：build 加了一列没人批准的字段，Release 批准了一个自己不知道的变更，而下一个功能还会在同一处出同样的问题。

**✅ 做完判别**

> TC-011 失败：导出 CSV 缺少"退款金额"列。
> 排除 environment（其他导出用例正常）；排除 test（断言和 fixture 都对）。
> 核对 contract：criterion 3.1 是"导出包含订单基础字段"，未定义"基础字段"包含哪些；
> exploration.md 里业务方明确提过需要退款金额，但 Contract 固化时漏了。
> 归因：requirement。提 AMD-002，建议 3.1 显式列出字段清单。
> TI-009 在 contract v2 批准后重新派生并重新冻结。

---

**❌ 用重试掩盖**

> TC-018（release 类，并发下单）：第一次失败，重试后通过。记 pass。

**✅ 如实记录**

> TC-018（release 类，并发下单）：第 1 次失败（库存扣成负数），第 2 次通过。
> 同一 commit、同一环境、同一种子数据 → 判定 flaky。
> 初步归因：implementation（疑似库存扣减缺少并发控制，非测试时序问题——
> 失败时库存表实际值为 -1，这不是断言时机问题）。
> evidence_ref: runs/2026-08-21/tc-018-run1.log
> 开 DEF-007。release 类 flaky 视为该 criterion 未稳定验证，写入 qa-report 遗留问题。

---

**❌ 环境当挡箭牌**

> TC-022 失败：调用支付网关返回 502。归因 environment，重跑。第二天又挂，再重跑。

**✅ 反复出现就不再是环境**

> TC-022 第二次以同样方式失败。环境的不可复现性本身是缺陷。
> 查 network log：我方请求体缺少 `idempotency_key`，网关在重复请求时返回 502。
> 归因改为 implementation，开 DEF-009。
> （第一次记 environment 是合理的判断；第二次还记 environment 就是回避。）
