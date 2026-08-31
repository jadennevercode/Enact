# 产物注册表：三层，各给谁看

**什么时候读**：不确定某个环节该落哪些文件时；交接或呈报之前；有人问"这次到底产出了什么"时。

这份表回答两个问题：**一次交付走完，磁盘上应该有什么**；以及**每样东西是给谁在什么时候看的**。

第二个问题被忽略的代价很具体：一份 200 行的 YAML 和一份 20 行的评审页混在一起交出去，
拿到的人不知道该先看哪个，通常的结果是两个都不看。**分层不是分类癖，是为了让"读哪一份"
这件事不需要每次重新判断。**

## 目录

- [§1 三层怎么分](#1-三层怎么分)
- [§2 完整注册表](#2-完整注册表)
- [§3 一次交付走完应该看到什么](#3-一次交付走完应该看到什么)
- [§4 落盘先于呈报](#4-落盘先于呈报)
- [§5 分层不是重要性排序](#5-分层不是重要性排序)
- [§6 谁在检查这件事](#6-谁在检查这件事)

---

## 1. 三层怎么分

分层的判据是**你拿它干什么**，不是它是什么格式：

| 层 | 判据 | 典型动作 | 读者 |
|---|---|---|---|
| **快速评审层** | 有人要读完它然后做判断或行动 | 评审、批准、照着修 | 人，几分钟内 |
| **机读层** | 脚本要解析它；结构比可读性重要 | 校验、统计、渲染 | 脚本；人只在追细节时打开 |
| **备查证据层** | 平时没有人读它 | 出问题时回溯、审计、复盘 | 将来的某个人 |

三层都要有。**只有快速评审层，下游脚本无从校验，一切退回靠人盯**；
只有机读层，就是这次改版之前的样子——东西都在，但没有一份是能直接读的。

一个内容同时需要两层时，**手写一份、生成另一份**，不要手写两份。
`contract.yaml` 是手写的机读层，`review/contract.html` 是从它生成的快速评审层——
两份手写视图必然各自漂移成两份真相，这是本套件明确不做的事。

## 2. 完整注册表

路径均相对于 `.sdlc/`。`WI-*` 指 `work-items/WI-###-slug/`。

### 快速评审层

| 产物 | 环节 | 手写/生成 | 谁读它 |
|---|---|---|---|
| `WI-*/exploration.md` | explore | 手写 | contract 环节；需求方复核结论 |
| `WI-*/review/exploration.html` | explore | 生成 | 呈报时给的就是它——十个维度画成树，缺口一眼可见 |
| `WI-*/review/contract.html` | contract | 生成 | **Contract 批准人看的是这一份**，不是 YAML |
| `WI-*/build-evidence.md` | build | 手写 | build-review 批准人；QA 逐条核实 |
| `WI-*/qa-report.md` | qa | 手写 | release 环节；给的是建议状态不是决定 |
| `WI-*/review/qa.html` | qa | 生成 | 交接时给它的路径 |
| `WI-*/evidence-case.md` | release | 手写 | **Release 决定人**——这是他做判断的全部材料 |
| `WI-*/review/release.html` | release | 生成 | 同上，呈报形态 |
| `WI-*/defects/DEF-###.md` | qa | 手写 | build 照着修；QA 的那几节是交接单也是证据，修的人不许改 |
| `incidents/INC-###-slug/incident.md` | operate | 手写 | 处置人；复盘时的输入 |
| `lessons/LP-###-slug/lesson.md` | learn | 手写 | 之后所有工作都受它影响，所以它必须是能读的 |
| `review/status.html` | orchestrator | 生成 | 跨 WI 的依赖图与状态表 |

### 机读层

| 产物 | 环节 | 手写/生成 | 谁解析它 |
|---|---|---|---|
| `config.yaml` | intake（人维护） | 手写 | 几乎所有脚本；分层配置的项目级来源 |
| `current.yaml` | intake | 脚本写 | 不带 `--work-item` 的脚本靠它定位 |
| `WI-*/work-item.yaml` | intake | 脚本建骨架 + 手写字段 | `wi_status.py`、`sdlc_audit.py` |
| `WI-*/contract.yaml` | contract | 手写 | `coverage_stats.py`、`check_scope.py`、渲染器、QA 的期望来源 |
| `WI-*/change-scope.yaml` | build | 手写 | `check_scope.py` 的基线；QA 的越界复查依据 |
| `WI-*/test-plan.yaml` | qa | 手写 | `coverage_stats.py --phase qa` |
| `WI-*/gates/*.yml` | 各环节 | 手写 | `validate_gate.py`；release 预检 |
| `family.yaml` | orchestrator | 手写 | 跨 WI 排程与一致性核对 |

`contract.yaml` 是这一层里唯一**主要靠人写**的：它是意图的唯一真相，
所以只能人写。它的可读形态是渲染出来的 HTML，见上一张表。

### 备查证据层

| 产物 | 环节 | 写法 | 什么时候会被翻出来 |
|---|---|---|---|
| `WI-*/evidence.jsonl` | 所有环节 | **追加，不改不删** | 审计、归因、复盘。它是唯一能重建"当时发生了什么"的东西 |
| `WI-*/ledger.md` | build | 追加 | 上下文压缩后恢复现场；主要读者是下一轮的你自己 |
| `WI-*/amendments/AMD-###.md` | contract/build | 手写 | 三个月后有人问"为什么当初没做 X" |

`ledger.md` 值得单独说一句：它是**工作日志**，不是交付物。
不要为了让它好看而精简——它的价值在于三天后你还能从里面认出当时的判断。

### 模板对照

`sdlc-core/templates/` 下每个模板对应上表一项：
`work-item.yaml` / `contract.yaml` / `change-scope.yaml` / `gate.yml` / `exploration.md` /
`ledger.md` / `build-evidence.md` / `test-plan.yaml` / `qa-report.md` / `defect.md` /
`evidence-case.md` / `amendment.md` / `incident.md` / `lesson.md` / `family.yaml` / `config.yaml`。

**没有对应模板的产物只有三类**：`current.yaml`（由 `sdlc_init.py` 写）、
`evidence.jsonl`（格式见 `evidence.md`）、`review/*.html`（生成物，不该有模板）。

## 3. 一次交付走完应该看到什么

full lane 走到 `Completed`，`WI-###-slug/` 下至少有这些：

```
WI-007-coupon-expiry/
├── work-item.yaml            机读
├── exploration.md            快速评审
├── contract.yaml             机读（唯一真相）
├── change-scope.yaml         机读
├── ledger.md                 备查
├── build-evidence.md         快速评审
├── test-plan.yaml            机读
├── qa-report.md              快速评审
├── evidence-case.md          快速评审
├── evidence.jsonl            备查（非空）
├── gates/
│   ├── contract-approval.yml
│   ├── build-review.yml
│   └── release.yml
├── amendments/               有就有，没有就空
├── defects/                  同上
└── review/
    ├── exploration.html      生成
    ├── contract.html         生成
    ├── qa.html               生成
    └── release.html          生成
```

**数一下：13 个文件加 4 个 HTML。** 如果你走完一次交付只落了三四个文件，
不是这套流程轻量，是有环节把该写的东西留在对话里了。

`lane: quick` 可以少：`exploration.md` 可以只有几句事实确认、`amendments/` 和 `defects/`
通常是空的。**但每一层至少各有一份，Gate 一个都不少。**

**中途停下来时该看到什么，别拿这份终态清单去减。** 每个状态各自欠什么是累积的，
定义在 `sdlc_audit.py` 的 `STATUS_ADDS`，直接跑它比自己推可靠：

```bash
python3 "$CORE/scripts/sdlc_audit.py" --root . --work-item WI-###
```

`defects/` 由 qa 首次开出缺陷时创建，`new_work_item.py` 不预建它——目录不存在不等于漏了产物。

## 4. 落盘先于呈报

**先写文件，再在对话里说。** 顺序不能倒，这条适用于每个环节。

这条规则针对的是一个具体的失败：环节把结论凝练成一段话讲给用户听，讲得很清楚，
用户也认可了——然后这段话没有落到任何文件里。下一个环节读文件时，那个结论不存在。
**上下文压缩之后，"讲过了"和"没讲过"没有区别。**

呈报的正确形状是**路径 + 摘要**：

```
Contract 已就绪：.sdlc/work-items/WI-007-coupon-expiry/review/contract.html
9 条验收标准（7 条自动、2 条人工，人工的验证人都已指定），1 个未决问题待你定。
```

不要把 contract 全文、完整 diff、原始日志倒进对话。批准人需要的是组织过的判断材料，
不是原材料——**把长材料在对话里再倒一遍，"读不过来"这个问题原样还在**。

## 5. 分层不是重要性排序

备查层排在最后，不代表它可以省。恰恰相反：

- `evidence.jsonl` 是**唯一**能在事后重建过程的东西。它空着，这次交付在审计意义上等于没发生过。
- `amendments/` 里被 rejected 的那些，价值和被接受的一样大——它们记录了"考虑过并且否掉了"，
  否则同一个提议会在下一个类似需求出现时被重新发现一遍。

"平时没人读"说的是它的**读取频率**，不是它的**价值**。这一层的特点是：
需要它的时候，通常是出事的时候，而那时候补不了。

## 6. 谁在检查这件事

`sdlc_audit.py` 按 WI 的 `status` 反查该有的产物存不存在。**要求是累积的**——
`Completed` 欠的是前面每个状态欠过的全部，加上它自己的。不是这样的话，
一个被直接置成 `Completed` 的 WI 会绕过前面所有检查，而这正是这条检查要防的事。

上面 §3 那份 13 + 4 的清单，由**三个机制**共同覆盖，不是一条：

| 机制 | 管什么 | 判什么 |
|---|---|---|
| `status-artifact-mismatch` | §3 清单里的 14 项（含三个 Gate 中的两个） | `.md` / `.yaml` 判 high；`review/*.html` 判 medium |
| `missing-build-review` | `gates/build-review.yml` | high（quick lane 已具名降级的除外） |
| `empty-evidence` | `evidence.jsonl` 不存在或为空 | high |

第 17 项是 `work-item.yaml` ——它缺失时整个目录不成其为 Work Item，判 `missing-record`。

`review/*.html` 判 medium 而不是 high，是因为它是生成的、补一条命令就有；
但它同时是**最容易在赶工时被跳过**的，而跳过之后从任何别的地方都看不出来，
所以宁可报得轻一点，也不能不报。

**备查层同样在反查范围内**：`ledger.md` 缺失在 `Verifying` 及之后判 high。
"平时没人读"不等于可以不写——见 §5。

审计只报告，不修复。**一处不一致是关于这次工作实际怎么走的证据，悄悄修好它等于毁掉证据。**
