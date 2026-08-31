# 八个环节的验收清单

作为**接收方**核验某个环节的出口。产出缺口清单，不产出通过与否的判定——
那个判定属于下一个环节的人，他基于这份清单决定接不接。

- [怎么用这份清单](#怎么用这份清单)
- [intake](#intake)
- [explore](#explore)
- [contract](#contract)
- [build](#build)
- [qa](#qa)
- [release](#release)
- [operate](#operate)
- [learn](#learn)
- [三类留白的区别](#三类留白的区别)

## 怎么用这份清单

三步，顺序不能反：

1. **先跑脚本**。机械可查的部分不要人工看——人看会漏，而且看过之后会产生"已经检查过了"的错觉。
2. **再看产物齐全性**。重点不是文件在不在，是**该有内容的地方有没有留白**。
3. **最后列缺口**，每条写：缺什么 / 去哪补 / 不补的后果。

**脚本全绿不等于可以交。** 脚本查的是结构，查不了"这条 criterion 写得对不对"。
所以第 3 步的缺口清单里，允许出现脚本没报但你读出来的问题——注明那是判断不是机器结论。

---

## intake

**评审角色**：业务负责人 —— 判断的是「这是不是该做的事，框对了吗」。落点：`phase_reviewed（无 Gate）`。

**出口产物**：`work-item.yaml`

**脚本**：`wi_status.py --work-item WI-###`

**齐全性**：

- [ ] `objective` 写的是"要改变什么结果"，不是任务清单
- [ ] `owner` 是具名的人
- [ ] `lane` 与 `config.yaml` 的 `quick_lane_criteria` 对得上（quick 要四条判据全成立）
- [ ] `trigger` 能回答"为什么是现在"，不是"用户提的"
- [ ] 有前置依赖的话 `dependencies` 填了

**最常见的缺口**：`trigger` 留空或写成废话。它三个月后是判断这单还该不该做的唯一依据。

---

## explore

**评审角色**：业务负责人 —— 判断的是「这些结论和假设成立吗」。落点：`phase_reviewed（无 Gate）`。

**出口产物**：`exploration.md`

**脚本**：无（本环节没有确定性检查）

**齐全性**：

- [ ] §1 已确认事实**每条带来源**，查不到来源的没有混进这张表
- [ ] §3 假设每条写了"如果错了会怎样"
- [ ] §4 冲突显式记录，没有静默择一
- [ ] §6 Coverage Map **十个维度全部有结论**——`已确认` / `有假设` / `未决` / `不适用+理由`
- [ ] 判"不适用"的维度都写了可核对的依据
- [ ] 已生成 `review/exploration.html`（`render_review.py explore`），呈报时给出了路径

**最常见的缺口**：Coverage Map 有空格。**空着不算不适用**——它意味着没人想过这件事，
而 `不适用 + 理由` 是一次真实的判断。这两者在下游的后果完全不同。

---

## contract

**评审角色**：业务负责人 + 架构 + 运维 —— 判断的是「三块内容各有人认领」。落点：`gates/contract-approval.yml`。

**出口产物**：`contract.yaml`（approved）+ `gates/contract-approval.yml`

contract.yaml 是业务、技术设计、变更边界、发布运维四块合一的唯一真相，人类视图
`review/contract.html` 由 `render_review.py` 生成，**不手写、不验收**——验收只看源头这一份。
但要核对它**在**：呈报时没有 HTML，批准人读到的就还是 YAML。

**脚本**：`coverage_stats.py --phase contract` + `validate_gate.py --gate contract-approval`

**齐全性**：

- [ ] 每条 criterion 是 EARS 语法、有层级编号、可独立验证
- [ ] `verification: manual` 的都指定了 `verified_by`
- [ ] `scope.excluded` 非空——显式排除比隐含包含更能防止范围蔓延
- [ ] `open_decisions` 全部离开 `open`；`accepted` 的有 `revisit_at`
- [ ] `design.approach` 非空；`design.diagrams` 给了图或写了"不适用 + 理由"，且 `relates_to`
      指向真实存在的编号（不是凭空编的 `R9`）
- [ ] `design.decisions` 每条记了 `alternatives_rejected` 与 `impact`——只写"选了 X"不算决定
- [ ] `design` 块**没有 criteria 里没有的承诺**
- [ ] `boundary.may_change` / `must_not_change` 非空，且是**意图级**（模块、接口）而不是文件清单
- [ ] `release.rollback` 写清了怎么退，`rollback_data_state` 点名了不可逆写入
- [ ] Gate 的 `approved_by` 是真人，`merged_revision` 非空
- [ ] 已生成 `review/contract.html`（`render_review.py contract`），呈报时给出了路径 + 摘要而非全文

**最常见的缺口**：`release.rollback` 留空或写成"回滚到上一版本"。**怎么退是设计问题不是发布问题**——
某些方案根本回不去，那应该在这里就影响技术选型，而不是发布前夜组装 Evidence Case 时才发现。
其次是 `accepted` 的决策没有 `revisit_at`：带风险接受而没有复查时点，就会变成永久埋在系统里的临时默认。

---

## build

**评审角色**：开发 —— 判断的是「做法方向对不对」。落点：`gates/build-review.yml`。

**出口产物**：`change-scope.yaml` + `ledger.md` + `build-evidence.md` + `gates/build-review.yml`

**脚本**：`check_scope.py` + `coverage_stats.py --phase build` + `validate_gate.py --gate build-review`

**齐全性**：

- [ ] `build-evidence.md` 五节齐全，**第 3 节「未执行事项」为空时写了"无"**
- [ ] 每个实质变更在映射表里能说出服务于哪条 criterion
- [ ] `ledger.md` 的任务有 `_Criteria:` 标注和 commit range
- [ ] 自主裁决的 Ruling 写全三段，包括"如果错了代价是什么"
- [ ] 有越界的话，`boundary_stop` 事件 + 边界事件表 + scope-expansion Gate 三样齐全
- [ ] 发现的 contract 缺口走了 `amendments/`，没有一处是在代码里补的意图
- [ ] **`gates/build-review.yml` 存在、`approved_by` 具名、`validate_gate.py` 通过**；
      状态是在它通过**之后**才切到 `Verifying` 的
      （唯一免检情形：`lane: quick` 且 config 的 `gates.build_review.quick_lane: self-check`
      且 `self_check_decided_by` 有名字——三个条件缺一不可）

**最常见的缺口**：第 5 节「需要重点复核的风险」写"无"。
这一节的价值与诚实度成正比——写"无"通常不是没有风险，是不想让 review 变慢。

**第二常见**：build-review 被跳过。它是唯一一个**跳过了也不留痕迹**的 Gate——
不像范围扩大有 `change-scope.yaml` 的版本号可以对数。这里不查，就要等到 release 预检 G8 才查得出来。

---

## qa

**评审角色**：QA —— 判断的是「验得够不够」。落点：`phase_reviewed（无 Gate）`。

**出口产物**：`test-plan.yaml` + `qa-report.md`

**脚本**：`coverage_stats.py --phase qa` + `check_scope.py`（复查越界）

**齐全性**：

- [ ] 接手前确认过 `gates/build-review.yml` 存在且有效——没有它就是没人看过方向就送来了，该退回 build
- [ ] `intents_frozen_at` 非空，且早于任何实现文件的读取
- [ ] TestCase 的 `expected` 与对应 TI 的 `expected_behavior` 一致，没有"调整"过
- [ ] `risk_based_selection` 的 `covered` 非空，`skipped` 每条带理由
- [ ] `regression_set.selection_basis` 写清了本次触及什么、因此该重跑什么
- [ ] 所有失败已归因，归因五选一
- [ ] 工作线二七项检查全部有结论
- [ ] 没有修过业务代码
- [ ] 已生成 `review/qa.html`（`render_review.py qa`），交接时给出了路径

**最常见的缺口**：`regression_set` 为空。QA 报告只覆盖"新意图成立"，
不覆盖"既有功能没被弄坏"——而后者是发布之后最先出问题的那一类。

---

## release

**评审角色**：业务负责人 + 运维 —— 判断的是「面向用户的风险 + 运行时风险」。落点：`gates/release.yml`。

**出口产物**：`evidence-case.md` + `gates/release.yml`

**脚本**：`coverage_stats.py --phase release` + `check_scope.py` + `validate_gate.py`

**齐全性**：

- [ ] Evidence Case 九节齐全，**§2 覆盖表逐条列全 criteria**（缺行就是缺判断依据）
- [ ] §7 回退方案非空
- [ ] §6 已知例外每条有 owner；为空写"无"
- [ ] Gate 的 `approved_by` 是真人；PASS/CONCERNS 有 `merged_revision`
- [ ] FAIL 时区分清楚是 Hold（`reentry_conditions` 空）还是 Reject（必填）
- [ ] 预检 PASS/CONCERNS 后已生成 `review/release.html`（`render_review.py release`），呈报时给出了路径

**最常见的缺口**：拿一份预检未过的 Evidence Case 去请人签字。
预检不过就不该进入人工环节——不要把核对工作转嫁给最没时间做核对的人。

---

## operate

**评审角色**：运维 —— 判断的是「处置与根因判断对不对」。落点：`phase_reviewed（记在 INC 上）`。

**出口产物**：`incident.md` + 修复用的新 WI

**脚本**：无

**齐全性**：

- [ ] §2 关联表七行填全，尤其**出问题的产物修订**（具体 commit，不是范围）与**相关监控**
- [ ] §6 上游归位表有结论——**全空的事故等于没从中学到东西**
- [ ] 处置建议分了三类（立即缓解 / 根因修复 / 需人批准）
- [ ] 走了加速通道的话，补记录清单有截止时间
- [ ] 跨 WI 的 `incident_linked` 事件用了同一个 `correlation`

**最常见的缺口**：§6 只填了"改了某行代码"。那是下游补丁，不是上游归位。

---

## learn

**评审角色**：架构 —— 判断的是「该不该固化成标准」。落点：`gates/lesson-approval.yml`。

**出口产物**：`lesson.md` + `gates/lesson-approval.yml` + 被更新资产的新版本

**脚本**：`validate_gate.py --file .sdlc/lessons/LP-###-*/gates/lesson-approval.yml`

**齐全性**：

- [ ] §1 证据能打开
- [ ] §2 `target_kind` 在七类内；`new_asset: true` 的写了创建理由与归属目录
- [ ] §3 Validation 六项逐项有结论，反例非空
- [ ] §4 批准记了 `target_version` 与 `adoption_scope`
- [ ] §5 只在拿到有效批准之后才填
- [ ] 新建资产在上级导航里加了入口

**最常见的缺口**：`adoption_scope` 留空导致默认全局生效。
一条只在某个项目成立的经验，不该改变所有项目的行为。

---

## 三类留白的区别

验收时反复要判断的是同一件事：**这个空白是什么意思？**

| 看到的 | 可能的含义 | 怎么区分 |
|---|---|---|
| 字段留空 | 忘了填 / 确实没有 / 不适用 | **模板要求"为空也要写无"的地方，留空一律按"忘了填"处理** |
| 写了"无" | 判断过，确实没有 | 可以接受 |
| 写了"不适用 + 理由" | 判断过，且说得出为什么 | 最好的一种 |

这个区分不是形式主义。一份 `未执行事项：（空）` 的 build-evidence，
下游无法判断是"全做完了"还是"没检查"——而这两种情况在 Release 时的风险完全不同。
