# QA Report — WI-000 <标题>

<!--
编辑权限：qa 环节拥有本文件，且只追加不重写既有结论。
两条工作线都必须有内容：只做常规验证会漏掉"证据链本身有没有断"这类问题。
-->

- 对应 contract 版本：1
- Test Intent 冻结时间：
- 报告时间：

## 工作线一：常规验证

### 覆盖情况

| Criterion | Test Intent | 策略 | 结果 |
|---|---|---|---|
| 1.1 | TI-001 | unit | ✅ |
| 2.1 | — | manual | 待王五确认 |

逐条列全 contract 的 criteria。**没有对应 Test Intent 的 criterion 必须显式标注理由**，
不能省略行——省略之后没有人能发现它被漏了。

### 执行结果

| 执行类别 | 用例数 | 通过 | 失败 | flaky | 跳过 |
|---|---|---|---|---|---|
| fast | | | | | |
| integration | | | | | |
| release | | | | | |

跳过的 release 类用例必须说明原因。因成本跳过关键 Gate 测试是不允许的。

### 回归

| 选择依据 | |
|---|---|
| 本次触及的共享路径 | |
| 因此必须重跑的既有用例 | |

| 用例 | 结果 |
|---|---|

**这一节为空要写明理由。** 「本次改动没有验证过既有功能」是一个需要有人接受的风险，
不是一个可以省略的段落。

### 失败归因

| 用例 | 现象 | 归因 | 后续 |
|---|---|---|---|
| TC-003 | | implementation | DEF-001 |

归因五选一：`requirement`（Contract 缺陷 → 提 AMD）/ `design` / `implementation`（→ defect）
/ `environment` / `test`（测试自身写错）。

归到 `requirement` 的失败比归到 `implementation` 的更有价值——它拦住的是
一整类将来还会重复发生的问题。

### Flaky

| 用例 | 重试次数 | 判断 |
|---|---|---|

重试后通过不等于稳定。这一节存在的意义就是不让"重试掩盖不稳定"。

## 工作线二：Evidence Assurance

核验 Build 提交的证据本身。对 build-evidence.md 的内容采取**"未验证声明"**的立场：
逐条核实，而不是采信。

| 检查项 | 结果 | 说明 |
|---|---|---|
| 每条 criterion 都有对应变更或明确的未执行说明 | | |
| 变更与 criterion 的映射真实成立（抽查 diff） | | |
| 无越界修改（`check_scope.py` 结果） | | |
| 无未声明的工具动作 | | |
| build-evidence 的"未执行事项"与实际一致 | | |
| Evidence Event 链条完整，无断点 | | |
| 抽验 `output_refs` 指向的原始 trace 存在且内容相符 | | 只核到 Event 层不够——Event 是自述，trace 是原件 |

## 结论

- 建议状态：（通过 / 有条件通过 / 不通过）
- 主要遗留问题：
- **本报告不做 Release 决定**。Release 由 sdlc-release 组装 Evidence Case，由具名责任人决定。
