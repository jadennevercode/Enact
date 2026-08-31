# Work Item 状态机

```
Proposed → Exploring → Contracted → Planned → Executing → Verifying → Decision → Completed
                                                                              ↘ Held
                                                                              ↘ Cancelled
```

## 状态定义与转入条件

| 状态 | 含义 | 转入条件 | 谁触发 |
|---|---|---|---|
| `Proposed` | 已登记，尚未开始 | 创建时的初始状态 | intake |
| `Exploring` | 正在澄清需求与边界 | **owner 已填** | explore |
| `Contracted` | Execution Contract 已批准 | `gates/contract-approval.yml` 有效（PASS + 具名 approved_by） | contract |
| `Planned` | 变更范围已确认，任务已拆 | `change-scope.yaml` v1 就位 | build |
| `Executing` | 正在实施 | 首个任务开始 | build |
| `Verifying` | 独立验证中 | build-evidence.md 就位**且** `gates/build-review.yml` 有效（PASS/CONCERNS + 具名 approved_by） | qa |
| `Decision` | 等待发布决定 | evidence-case.md 组装完成 | release |
| `Completed` | 已发布 / 已交付 | `gates/release.yml` 为 PASS | release |
| `Held` | 暂停，等外部条件 | 见下 | 任意环节 |
| `Cancelled` | 不做了 | 人工决定，需记理由 | 任意环节 |

**状态只由对应环节 Skill 在完成出口动作后变更**。不要因为"感觉差不多了"就推进状态——状态是别人判断能否接手的依据。

## Held：什么时候用，怎么用

`Held` 不是失败，是诚实。以下情况应当进入 Held 而不是硬推：

- 需要人工批准但批准人不可达
- 依赖外部条件（第三方接口未就绪、数据未到位）
- 同一问题尝试 3 种方法仍未解决（熔断，见下）
- 发现 Contract 缺口且 Amendment 尚未处置

进入 Held 必须同时写清三件事，写在 `work-item.yaml` 的 `blocked_by`：

```yaml
blocked_by:
  what: 需要 DBA 确认历史数据回填窗口
  who: 李四
  since: 2026-08-21
  unblocks_to: Executing     # 解除后回到哪个状态
```

缺任何一项的 Held 都是"卡住了但没人知道该干什么"，等价于工作丢失。

## 回退规则

任何回退必须说明：**回到哪个阶段、缺什么、由谁处理**，并保留旧版本。

| 回退 | 典型原因 | 必须保留 |
|---|---|---|
| Executing → Contracted | Contract 缺口，Amendment 被接受 | 原 contract 版本 + AMD 记录 |
| Verifying → Executing | QA 发现实现缺陷 | 原 build-evidence + `defects/DEF-###.md` |
| Verifying → Contracted | QA 发现需求缺陷（不是实现问题） | AMD 记录 |
| Decision → Verifying | Release 预检不通过，证据待补 | Hold 清单 |
| Decision → Exploring | Reject：目标或风险不可接受，但改了还能回来 | Gate 的 `reentry_conditions` 写明回来的条件 |
| Decision → Cancelled | Reject 且这件事不该做 | `reentry_conditions` 写「不重新进入」+ 理由。**没有这条出口，一个"不该做"的判断只能被写成永远回不来的 Exploring** |

回退写入 `work-item.yaml` 的 `notes`，格式：`YYYY-MM-DD 从 <状态> 退回 <状态>：<缺什么> / 处理人 <谁>`。

**旧版本一律保留**。contract v1 被 v2 取代时，v1 标记 `status: superseded` 但文件不删——审计时需要知道当时批准的是什么。

## 熔断

同一个问题尝试 **3 种不同方法**仍未解决时，停止尝试第 4 种：

- 在 `ledger.md` 记录三次尝试各自是什么、为什么失败
- 进入 `Held`，`blocked_by.what` 写清卡在哪里
- 如果三次失败指向同一个方向（例如都撞在同一个架构约束上），把这个观察写出来——它通常比继续试更有价值

合法终态只有两个：**完成**，或**已记录的阻塞**。不存在"大概好了"、"基本能跑"、"应该没问题"。

## quick lane 的状态压缩

`lane: quick` 时允许合并状态跳转，但不允许跳过 Gate：

| full lane | quick lane |
|---|---|
| Proposed → Exploring → Contracted | Proposed → Contracted（explore 压缩为几句事实确认写进 exploration.md） |
| Planned → Executing | 合并 |
| Executing → Verifying | Gate 保留，呈报压到三行；项目在 config 里具名声明后可降为自检（`gates.md` §build-review） |
| Verifying → Decision → Completed | 保持不变（Release Gate 不可省） |

跳转压缩要在 `work-item.yaml` 的 notes 里留一行说明，让后来的人知道这里不是漏了步骤。
