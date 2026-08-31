---
id: LP-000
status: observe        # observe | classify | validate | approve | publish | observed | rejected | deprecated
created: 2026-01-01
source_work_item: WI-000
---

# LP-000 — <一句话标题>

<!--
编辑权限：learn 环节拥有本文件。
六阶段闭环：Observe → Classify → Validate → Approve → Publish → Observe again
硬约束：未拿到 gates/lesson-approval.yml（PASS + 具名 approved_by）之前，
不得修改任何模板、清单或 Skill 文件。

一次成功不等于普遍规律。未经验证就固化的"经验"会污染之后所有工作，
而且极难回溯——因为它看起来和真正的规律一模一样。
-->

## 1. Observe — 观察到了什么

**来源证据**：

| 证据 | 引用 |
|---|---|
| | `WI-001/qa-report.md#失败归因` |

**发生了什么**：（具体事件，不是抽象总结）

**为什么值得沉淀**：（这件事会重复出现吗？依据是什么）

## 2. Classify — 该更新什么

**七类目标**（对应主规格 §16 Classify 的判断维度）：

| target_kind | 落点 | 影响半径 |
|---|---|---|
| `project-doc` | 项目内文档 / `.sdlc/` | 仅本项目 |
| `template` | `sdlc-core/templates/*` | 之后所有同类产物 |
| `checklist` | 某个 reference 里的检查清单 | 之后所有走该清单的环节 |
| `policy` | `config.yaml` 的 `protected_paths` / `data_policy` / `test_policy`，或 `redlines.md` | 之后所有工作的边界 |
| `eval` | `evals/` 下的用例与判据 | 之后所有 Skill 变更的验证基准 |
| `tool` | `sdlc-core/scripts/*` | 之后所有调用该脚本的环节 |
| `skill` | 某个 `SKILL.md` 或 `references/*` | 静默影响每一次执行，最难回溯 |

```yaml
target_kind: template
target_path: ""
new_asset: false      # true = 新建资产而非修改现有
target_version: ""    # 目标资产当前版本（git hash）；new_asset 时写"新建"
adoption_scope: all   # 这条经验对谁生效：all | 本项目 | 指定环节
```

**变更摘要**：（要改成什么）

三条选型提醒：

- 选 `skill` 前先过 baseline 检验——**没有这条规则时 baseline 会犯这个错吗？不会就没有东西要修。**
- 这条经验只对当前项目成立 → 选 `project-doc`，不要选 `skill`
- 拿不准就往低选（影响半径小的那个），观察一轮之后再开新 LP 提升

**`new_asset: true` 是「晋升为新资产」这条路。** 主规格明写「晋升为新资产**或**现有资产的新版本」——
此时预检不检查 `target_path` 是否已存在，改为检查是否说明了创建理由与归属目录。

**`adoption_scope` 决定爆炸半径。** 不填的话，一条 LP 一经发布就对所有项目、所有会话无差别生效。

## 3. Validate — 边界在哪里

**适用范围**：（什么条件下这条经验成立）

**反例**：（什么情况下不适用）

| 历史案例 | 应用这条经验会怎样 |
|---|---|

**说不清边界的不推进。** 一条"总是应该 X"的经验，如果举不出任何"除非 Y"的情况，
通常说明还没想清楚，而不是说明它真的普遍成立。

**Validation 六项**（主规格 §08）——逐项给结论，不适用的写"不适用 + 理由"：

| 检查 | 结论 |
|---|---|
| 结构校验：**改动后的资产**本身格式合法（YAML 可解析 / `check_suite.py` 通过） | |
| 依赖解析：引用这份资产的地方是否都还成立（`grep -rn` 引用点） | |
| 权限检查：谁有资格批准，以及改动后**谁被允许使用** | |
| 样例 / 反例：至少一个正例、一个反例 | |
| 场景运行：拿 2–3 个历史 WI 回放 | |
| 回归结果：改动前后跑同一组用例，结果对比 | |

注意第一项校的是**改完之后的资产**，不是这份 LP 自己的格式——后者是预检的事。

## 4. Approve — 批准

- Gate 文件：`gates/lesson-approval.yml`
- 批准人：
- **批准的目标版本**：（`target_version`——批准人签的必须是一个有版本的对象，不是一段描述）
- **生效范围**：（`adoption_scope`）
- 收益：
- 风险：
- 适用范围确认：

## 5. Publish — 发布

- 修改的文件：
- git commit：（这就是新版本号）
- 生效时间：
- **采用范围**：哪些环节 / 项目从现在起适用这条经验（与 `adoption_scope` 一致）

**只有在 §4 拿到有效批准之后才能填这一节。**

### 发布类型

| 类型 | 什么时候用 | 怎么做 |
|---|---|---|
| 新建（`new_asset: true`） | 现有资产里放不下这条经验 | 建文件 + 在上级导航里加入口，否则没人会读到它 |
| 修订（Amend） | 已发布的经验需要调整边界或措辞，**结论仍然成立** | 直接改 + commit 引用原 LP 编号，**不必重开一条 LP** |
| 废弃（Deprecate） | 结论不再成立 | 移除或标注失效，在原 LP 的 §6 记录废弃理由与时间 |

区分 Amend 与新 LP 的判据：**结论变了就是新 LP，只是说得更准确就是 Amend。**
不做这个区分的话，每次微调都要走一遍完整六阶段，成本高到没人愿意维护已发布的经验。

## 6. Observe again — 效果

| 观察时间 | 效果 | 结论 |
|---|---|---|

效果不好可以回滚（`git revert` + 在此记录）。**回滚不删 LP 文件**，status 保持 `observed`——
被推翻的经验和从未存在的经验是两回事，后来人需要知道这条路试过了。

沉淀不是终点，能被推翻才说明这个机制是活的。

同类改动**被撤销两次**，要质疑的就不是这条经验，而是判断这类经验的方式。
