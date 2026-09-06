# 规模检查：六项估算，超了不拦

## V1 上限

| 项 | 上限 | 它约束的是什么 |
|---|---|---|
| `collections` | ≤ 5 | 数据集合（表、数据集）数量 |
| `documents` | < 10 | 文档数量 |
| `sample_rows` | < 10000 | 抽样行数 |
| `process_steps` | < 100 | 流程步骤数 |
| `entity_types_estimate` | < 25 | 实体类型估算 |
| `relationship_types_estimate` | < 25 | 关系类型估算 |

上限的权威版本在 `tools/validators/define_checks.py` 的 `SCALE_LIMITS`，与这张表一致。
`charter_complete` 只要求六项**有值**且 `verdict` 是 `within` 或 `over`；
它不因为超限而判失败——超限不是错误，是一个需要人做选择的事实。

## 估不准是常态

不要空着，也不要编一个精确数字。给一个能核对的估法：

> `inputs/evidence/` 下 5 个文件（4 个 Markdown、1 个 CSV）→ documents = 5；
> CSV 样本 6 行，客户说月均 4 万条，按抽样取 4000 → sample_rows = 4000，标 estimated: true；
> 流程文档第 6 章列了 8 个主步骤 + 3 条异常路径，每条按 2–3 步展开 → process_steps ≈ 24。

把算法写进 `scale_check.basis`。数字要能说出出处；说不出出处的数字就不写。
标了 `estimated: true` 的数字，人可以直接改——这比一个假装精确的数字有用得多。

实体与关系类型的估算可以从初始问题清单反推：3–10 条 CQ 里出现的名词大致是实体，
动词大致是关系，再乘 2–3 倍留出没问到的部分。说清这个乘数是怎么来的。

## 超了怎么办：三选一

超限时 `verdict: over`，`over_limits` 列出超了哪几项，然后给人三个选项——
**不要自己缩范围，也不要装作没看见**。三个选项都写清后果：

| 选项 | 适合什么情况 | 后果 |
|---|---|---|
| `split_bounded_contexts` 拆成多个有界上下文 | 材料里有两三块彼此几乎不引用的业务 | 每块一个独立项目，各有章程与边界；跨块的关系要显式声明。见 `references/bounded-context-split.md` |
| `phase_delivery` 分阶段交付 | 是一块业务，但材料太多 | 本期只做核心的一段，其余进 backlog；边界写清"这一期不做但以后要做" |
| `upper_level_model` 先建上层概念模型 | 连有哪些东西都还没搞清 | 先出一版粗粒度的概念模型对齐认识，再决定往哪深挖；这一版不追求可执行 |

人选了以后写进 `scale_check.chosen_response`，并把选择的理由记进
`scope_and_boundary` 的裁决理由里。

**为什么不硬拦。** 一个超限的项目未必做不成，可能只是这次的领域确实大。
硬拦的结果是人把数字改小然后继续——那就既超了限，记录上又看不出来。
显式选择比隐式违规好。
