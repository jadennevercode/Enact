# mmm-runtime

一个 Claude Code 插件，把营销组合建模（MMM）咨询项目跑成一组**交付物**：
每份交付物由一个 Skill 负责产出，计算交给独立的 Tool，方法与行业先例存在可检索的 Knowledge 里，
固定形态的产出（图表页、工作簿）由 App 生产。人在关键处拍板，而一步是否算完成，
由脚本对着磁盘判定——不是由模型觉得像做完了。

**项目就是一个目录。** 每份交付物是文件，每个人工确认都留痕，
一道确认关上的条件是检查脚本说证据通过。

**范围：** 从业务理解到模型输入锁定。建模与报告不在范围内——项目在主数据锁定时结束。

## 安装

```bash
git clone <this repo> ~/src/mmm-runtime
claude plugin marketplace add ~/src/mmm-runtime
claude plugin install mmm@mmm-runtime
```

然后在 Claude Code 里：

```
/mmm:status         项目到哪了
/mmm:daily          今天的日报 —— 变了什么、什么在等你、有什么风险
```

其余的直接说人话就行——"这是 SOW"、"建因子树"、"客户把数据发来了"、"这些指标能用吗"，
对应的 Skill 会自己接住。

## 十二个交付物

```
业务理解   项目档案 ─→ 因子树 ─→ 访谈 ─→ 数据需求与验收
                        ↑__________|          （访谈会回头改因子树，这是设计如此）

数据       发布数据集 ─→ 因子映射 ─→ 数据质量评分 ─→ 业务校验与签核
           ─→ 统计检验 ─→ OLS 预验证 ─→ 模型输入（建模范围的终点）

收尾       复盘与沉淀 —— 这个项目学到的进知识库，用户教的改进 Skill 本身
```

`shared/manifests/deliverables.yaml` 是这张图的机器可读版本：每个交付物由谁产出、
依赖什么、每一步只能读什么、检查什么、哪里需要人拍板、驳回之后退回哪一步。
**Skill 读它，不背它。**

交付物的状态是**推导**出来的，不是记下来的——`未开始 / 可开工 / 进行中 / 等你决定 / 待确认 / 已确认`
六态由步骤完成情况算出，所以记录不可能和磁盘分叉。

## 依赖，分两层

**业务理解阶段不需要任何第三方包。** `shared/lib/yamlio.py` 在没有 PyYAML 时用自带的解析器，
`shared/lib/xlsx.py` 不用 openpyxl 也能写工作簿——目标机器是顾问的笔记本，它两样都没有。

**数据阶段需要引擎**：`pip install ./tools/engine`（duckdb、pandas、numpy、pyarrow）。
`scripts/doctor.py` 会报这台机器分阶段能跑什么。引擎缺失是**一个明确的阻塞**，
永远不是悄悄降级——和入料确认遵守同一条规矩。

## 四条支撑它的性质

**上下文加载准确。** 编排层只拿流程定义和进度记录，从那里路由，所以产出型 Skill 不会同时挤在
上下文里。每份 SKILL.md 限长，细节放在 `references/`，每一步声明自己能读哪些路径。
读了什么要如实申报，裁剪要留痕，不能静默发生。

**执行标准。** 确认由对着磁盘求值的检查关闭（`scripts/gate_check.py`），
没有一行能以中间状态混过一道确认，人的裁决会钉住那一行不被后续重算覆盖，
每条裁决先落日志再动进度记录。

**数字有出处。** 交付物里的任何一个数字都不许由模型写。每个数字来自一次真实的工具运行，
每份文档都要说清它读的是哪份计算结果。见 `shared/numbers-provenance.md`——
这是整套机制里唯一没有上游对应物的一条，也是这次转化安全而不只是省事的原因。

**动手前先问清楚。** 每个 Skill 的第一步固定是澄清：先读完输入，只问"答案会改变产出"的问题，
形式是选择题 + 推荐 + 每项后果，一次问完，答案登记留档不重复问。
不澄清就动手只能靠猜，猜出来的东西必须用一堆限定词包装——那正是"说了一堆听不懂的话"的来源。

## 读的顺序

| 文件 | 定了什么 |
|---|---|
| `docs/specs/2026-08-08-architecture-and-methodology.md` | 架构与构建方法论，这是宪法 |
| `shared/conventions.md` | 活儿在哪干、开工前做什么、依赖与诚实截断、"空结果也是结论" |
| `shared/manifests/checks.yaml` | 每个检查项在断言什么、不过了怎么办 |
| `shared/manifests/deliverables.yaml` | 流程本身 |
| `shared/deliverable-states.md` | 六种状态与为什么是推导的 |
| `shared/gate-protocol.md` | 人工确认的五条规矩 |
| `shared/numbers-provenance.md` | 为什么模型不许写数字 |
| `tools/catalog/README.md` | 所有计算工具的目录 |

## 检查它

```bash
~/.local/bin/mmm script selftest      # 对确认机制的对抗性断言
~/.local/bin/mmm script check_suite   # 对这套东西自身的静态检查
~/.local/bin/mmm doctor        # 这台机器分阶段能跑什么
```

这三个只检查 runtime 自己，不需要外部任何东西——`selftest` 自建自毁一个临时工作区，
引擎的一致性测试跑在合成数据上。

**端到端的样例是项目，所以它们跟项目住在一起**，不在这里。
一个夹带某个客户材料的 runtime，就是一个对"谁在用它"有预设的 runtime。

## 出处

蒸馏自 AgenticMMM 平台的设计，更有用的部分蒸馏自它的失败记录。
这里的任何代码都不调用、不导入、不读取那个平台；`tools/engine/UPSTREAM.md` 记录了
什么时候抄了什么。逐个交付物的输入/构建过程/产出格式对照，在
`docs/specs/platform-contracts/`。
