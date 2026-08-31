# 发布确定性预检规则

按顺序机械执行。**这里是执行规则，不是自由心证。**

写成规则序列的理由：Release 前的"看着差不多"是整条治理链最容易断的一环。规则可以被审计、可以被复跑、结论可以被别人复现；判断不能。规则判不了的部分（值不值得冒这个险）才留给人，那正是第二段存在的意义。

## 目录

- [怎么用](#怎么用)
- [A 组：契约覆盖类（C1–C7）](#a-组契约覆盖类)
- [B 组：证据完整性类（E1–E9）](#b-组证据完整性类)
- [C 组：边界合规类（B1–B4）](#c-组边界合规类)
- [D 组：发布准备类（R1–R7）](#d-组发布准备类)
- [E 组：Gate 记录有效性类（G1–G8）](#e-组gate-记录有效性类)
- [裁决表：规则 → 结论](#裁决表规则--结论)
- [预检结论怎么用](#预检结论怎么用)

---

## 怎么用

先把三个脚本跑掉，它们的 JSON 是 A/C/E 三组大部分规则的原料：

```bash
python3 "$CORE/scripts/coverage_stats.py" --root . --work-item WI-00X --phase release
python3 "$CORE/scripts/check_scope.py"   --root . --work-item WI-00X
python3 "$CORE/scripts/validate_gate.py" --root . --work-item WI-00X
```

退出码：0 通过 / 1 检查未通过（**有意义的结果，按 JSON 处理**）/ 2 脚本自身出错（先修调用）。

然后 A → B → C → D → E 逐条走。每条记下 `PASS` / `CONCERNS` / `FAIL` 与依据。**不要因为前面已经出现 FAIL 就中断后面的规则**——一次给全清单，比让人补一条再跑一次便宜得多。

每条规则的"不通过"栏只有两种值：

- **FAIL**：缺的是判断依据本身。人在这个状态下无法负责任地决定，所以不进入人工环节。
- **CONCERNS**：判断依据齐了，但有已知问题。可以进入人工环节，前提是问题连同 owner 一起摆到最前面。

---

## A 组：契约覆盖类

判的是"批准过的意图，每一条是否都有了结论"。

### C1 — contract.yaml 存在且是已批准版本

- **检查什么**：`.sdlc/work-items/WI-###-*/contract.yaml` 存在；`work-item.yaml` 的 `contract_version` 非空且指向它。
- **怎么检查**：`coverage_stats.py` 的 `error` 字段；读 `work-item.yaml`。
- **不通过**：FAIL
- **修复**：没有 Contract 就没有任何锚点——QA 测的是什么、Release 批的是什么都说不清。回 `sdlc-contract`。

### C2 — 每条 criterion 在 Evidence Case 第 2 节有一行

- **检查什么**：`coverage_stats.py` 输出的 `criteria` 数组，逐个在 `evidence-case.md` §2 覆盖表里找到对应行。
- **怎么检查**：比对 `criteria` 与表格首列。数量相等且逐个匹配才算过。
- **不通过**：FAIL
- **修复**：补齐缺的行。**没验证的也要有行**，写"未覆盖 + 理由 + owner"——省略一行之后，没有人能发现它被漏了。

### C3 — 每条 criterion 有验证方式与结果

- **检查什么**：§2 每行的"验证方式"是 `automated` 或 `manual`；"结果"栏非空。
- **怎么检查**：逐行读表；`coverage_stats.py` 的 `failures` 里带 `verification=` 的条目直接对应。
- **不通过**：验证方式为空或非法 → FAIL；结果栏写"未覆盖"且给了理由与 owner → CONCERNS；结果栏为空 → FAIL。
- **修复**：`manual` 的必须有 `verified_by` 具名责任人，且第 2 节的"证据"栏要写清谁在什么时候确认的。

### C4 — 无引用不存在的 criterion 编号

- **检查什么**：ledger、build-evidence、test-plan 里引用的编号都在 contract 里存在。
- **怎么检查**：`coverage_stats.py` 的 `failures` 中 `problem` 为"引用了 contract 中不存在的 criterion 编号"的条目。
- **不通过**：FAIL
- **修复**：要么编号写错了，要么这条 criterion 被删掉却还有下游引用。后一种更危险——说明有工作正对着一条已经不存在的要求做。

### C5 — 每条 requirement 挂了至少一条 criteria

- **检查什么**：contract 的 `requirements[].criteria` 非空。
- **怎么检查**：`coverage_stats.py` 的 `failures` 中"没有关联任何 criteria"的条目。
- **不通过**：FAIL
- **修复**：没有验收标准的需求无法验证，等于没写。回 `sdlc-contract` 补，或明确移入 scope 的排除项。

### C6 — 无仍处于 open 的未决问题

- **检查什么**：contract 的 `open_decisions[].status` 全部是 `closed` 或 `accepted`。
- **怎么检查**：`coverage_stats.py` 输出的 `open_decisions` 计数为 0。
- **不通过**：FAIL
- **修复**：`accepted` 是合法出口——明确接受风险并记录即可。但**不能停在 `open` 就发布**：那意味着 Release Authority 在批准一个还没人想清楚的问题。

### C7 — 带风险接受的决策有未过期的复查时点

- **检查什么**：contract 的 `open_decisions` 中 `status: accepted` 的每一条，`revisit_at` 非空且不早于今天。
- **怎么检查**：`coverage_stats.py --phase release` 的 `failures` 中"带风险接受但没有 revisit_at"的条目；有 `revisit_at` 的逐条比对当前日期。
- **不通过**：缺 `revisit_at` → FAIL；已过期且本次没有重新处置 → FAIL；已过期但本次当场重新处置（更新时点或转 `closed`）并写进 Evidence Case §6 → CONCERNS。
- **修复**：`accepted` 的意思是"我们现在接受这个风险"，不是"这个问题不存在了"。**没有复查时点的接受会变成永久埋在系统里的临时默认**——埋它的那次讨论三个月后没人记得，而那条默认还在生效。给一个日期，或者现在就把它 `closed`。

---

## B 组：证据完整性类

判的是"QA 交出来的东西，本身有没有洞"。

### E1 — qa-report.md 存在且对应当前 contract 版本

- **检查什么**：文件存在；头部"对应 contract 版本"等于 `work-item.yaml` 的 `contract_version`。
- **怎么检查**：读文件头。
- **不通过**：不存在 → FAIL；版本不一致 → FAIL。
- **修复**：版本不一致意味着 QA 验的是旧意图。contract 改过就要重新验，不能拿旧报告发新版本。

### E2 — 无未归因失败

- **检查什么**：`test-plan.yaml` 中 `status: fail` 的每条都有 `attribution`；qa-report 的失败归因表每行"归因"栏非空。
- **怎么检查**：`coverage_stats.py` 的 `failures` 中"失败但没有归因"的条目；再人工扫一遍 qa-report 的归因表。
- **不通过**：FAIL
- **修复**：归因五选一——`requirement` / `design` / `implementation` / `environment` / `test`。**未归因的失败是发布证据里最贵的一种空白**：没人知道它是"环境抖了一下"还是"这个功能根本不成立"。回 `sdlc-qa`。

### E3 — release 类测试无静默跳过

- **检查什么**：`run_plan` 中 `execution_class: release` 的用例，在 `results` 里都有记录且 `status` 不是 `skipped`；若为 `skipped`，qa-report 里有明写的原因。
- **怎么检查**：比对 `run_plan[].cases` 与 `results[].case`；读 qa-report 执行结果表的"跳过"列。
- **不通过**：跳过且无原因 → FAIL；跳过且原因是成本/时间 → FAIL；跳过且原因是"该场景本次不适用"并有 owner → CONCERNS。
- **修复**：release 类是端到端旅程、回退验证、发布验证。**因为跑得慢就跳过它，等于把发布前唯一一次真实演练省掉了。**

### E4 — flaky 项已列明

- **检查什么**：`status: flaky` 的用例在 qa-report 的 Flaky 一节有行，且写了重试次数与判断。
- **怎么检查**：比对 `test-plan.yaml` 的 results 与 qa-report Flaky 表。
- **不通过**：有 flaky 但未列 → FAIL；已列明 → CONCERNS（flaky 本身就是要摆到人面前的已知问题）。
- **修复**：重试后通过不等于稳定。把它作为已知例外写进 Evidence Case §6 并给 owner。

### E5 — Test Intent 冻结时间非空

- **检查什么**：`test-plan.yaml` 的 `intents_frozen_at` 非空。
- **怎么检查**：`coverage_stats.py` 的 `failures` 中"intents_frozen_at 为空"的条目。
- **不通过**：FAIL
- **修复**：这是铁律二（测试期望不得从实现推导）唯一的可检查痕迹。为空意味着无法证明预期是先于实现冻结的，那么整份 QA 结论的独立性就是未经证实的。回 `sdlc-qa`。

### E6 — build-evidence 存在且 Evidence Assurance 有结论

- **检查什么**：`build-evidence.md` 存在；qa-report 的"工作线二：Evidence Assurance"七个检查项每项都有结果（第 7 项是抽验 `output_refs` 指向的原始 trace——Event 是自述，trace 是原件）。
- **怎么检查**：读 qa-report 该节表格，任一"结果"栏为空即不通过。
- **不通过**：FAIL
- **修复**：只做了常规验证等于只验了"代码做了什么"，没验"证据链本身有没有断"。回 `sdlc-qa` 补第二条工作线。

### E7 — evidence.jsonl 有关键节点事件

- **检查什么**：事件流里至少有 `contract_approved`、`scope_declared`、`test_intent_frozen`、`test_executed` 各一条。
- **怎么检查**：`grep` 事件流的 `action` 字段。
- **不通过**：缺 `contract_approved` → FAIL（与 G2 同源）；缺其余任一 → CONCERNS。
- **修复**：事件流断点不阻止发布，但要在 Evidence Case §6 记一条"证据链有断点，事后回溯能力受限"，owner 是对应环节。

### E8 — 回归集有选择依据，依据成立时有执行结果

- **检查什么**：`test-plan.yaml` 的 `regression_set.selection_basis` 非空；`regression_set.cases` 非空时 `regression_set.results` 有对应结果且无未执行项。
- **怎么检查**：`coverage_stats.py --phase release` 的 `failures` 中"regression_set.selection_basis 为空"的条目。**脚本只判空与不空，"有没有触及共享路径"这一层由这里判**：读 `change-scope.yaml` 的 write 白名单与本次 git 变更（`git diff --name-only`），看有没有落在共享接口、数据模型、公共工具、基础设施或安全配置上。
- **不通过**：
  - `selection_basis` 为空**且本次触及共享路径** → **FAIL**
  - `selection_basis` 为空但本次只动了本功能私有代码 → CONCERNS（在 Evidence Case §6 记一条"本次未做回归"并给具名 owner）
  - `selection_basis` 写了但 `cases` 为空且触及共享路径 → FAIL
  - `cases` 非空而 `results` 为空或有未执行项 → FAIL。选了不跑比没选更糟：它书面记录了一个已知该做而没做的动作
- **修复**：回归回答的是"这次改动有没有弄坏别的东西"，整条链上只有这一条规则在问它。**没有它，一次通过全部其他预检的发布，可以完全没有验证过既有功能。** 选择依据按这个顺序写：触及共享路径 → 该路径的既有用例全跑；改了公共接口 → 所有消费方的契约用例；只动私有代码 → 同模块用例即可。补齐要回 `sdlc-qa`，Release 环节不能自己补测试。

### E9 — 风险选择记录了做了哪几类、有意不做哪几类

- **检查什么**：`test-plan.yaml` 的 `risk_based_selection.covered` 非空；`skipped` 的每条带理由。
- **怎么检查**：`coverage_stats.py --phase release` 的 `failures` 中"risk_based_selection.covered 为空"的条目；`skipped` 逐条读。
- **不通过**：`covered` 为空 → FAIL；`covered` 非空但 `skipped` 有条目没写理由 → CONCERNS；`skipped` 为空且写明"本次无有意省略" → PASS。
- **修复**：主规格要求按风险选，**不要求每次平均覆盖**——所以"本次不做性能测试"完全可能是正确判断。但不写下来，省略就是静默省略：Release Authority 拿到的是一份从头到尾没提过性能的报告，他无法区分"想过并决定不做"和"根本没想到"。这两者的风险不一样，他要签的字也不一样。

---

## C 组：边界合规类

判的是"这次变更有没有超出被批准的范围，而且超出的部分是否已被处置"。

### B1 — git 变更全部落在 write 白名单内

- **检查什么**：`check_scope.py` 的 `violations` 为空。
- **怎么检查**：跑脚本，读 `violations` 数组。
- **不通过**：FAIL
- **修复**：对每个越界文件二选一——撤销改动，或补 `change-scope` 新版本 + `gates/scope-expansion-###.yml` 具名确认。**Release 环节不能自己认定"这个改动没问题"**：范围的意义是让复核者知道该看哪里，在最后一步放行越界，等于让整条边界机制在最重要的地方失效。

### B2 — protected 路径未被修改

- **检查什么**：`check_scope.py` 的 `violations` 中 `kind: protected` 的条目为空。
- **怎么检查**：同上，看 `kind` 字段。
- **不通过**：FAIL（这条比 B1 更硬：白名单外是"没批过"，protected 是"明确说过不许"）
- **修复**：撤销，或走一次显式的范围扩大批准。共享接口、数据模型、基础设施与安全配置默认属于 protected，即使 `change-scope.yaml` 里没逐条列出。

### B3 — 每次 boundary_stop 都有处置结论

- **检查什么**：`evidence.jsonl` 中每条 `action: boundary_stop`，都能对应到一个 `scope_expanded` 事件、一个 `gates/scope-expansion-*.yml`，或 ledger 里明写的"已撤销/未做"。
- **怎么检查**：`grep boundary_stop` 数出条数，逐条找下文。
- **不通过**：有 boundary_stop 找不到下文 → FAIL。
- **修复**：越界被拦下是好事（它证明边界在起作用），**没有下文才是问题**——说明有一个动作停在半空，没人知道最后做了还是没做。

### B4 — 无未处置的 Contract Amendment

- **检查什么**：`amendments/AMD-*.md` 每份的"处置"节中 `决定` 非空（`accepted` / `rejected` / `deferred`）、有决定人、有决定时间；`deferred` 的要写清推迟到哪里。
- **怎么检查**：逐份读文件的处置节。
- **不通过**：决定为空 → FAIL；`accepted` 但没有产生 contract 新版本 → FAIL；`deferred` 且写明去向与 owner → CONCERNS。
- **修复**：Amendment 是"发现 Contract 有洞"的正式记录。带着未处置的 Amendment 发布，意味着 Release Authority 批准的那份 Contract，已经被人书面质疑过而无人回应。

---

## D 组：发布准备类

判的是"这次发布出了事，能不能收场"。这组规则里 R1 最硬。

### R1 — 回退方案非空

- **检查什么**：`evidence-case.md` §7 的"回退方式"有实质内容。
- **怎么检查**：读 §7。空、"待定"、"N/A"、"暂无"、"应该可以回滚"——全部算空。
- **不通过**：FAIL
- **修复**：**没有回退路径的发布是单向门。** 它需要的是一个不同量级的决策——谁能承担"发出去就收不回来"，通常不是常规 Release Authority 一个人能定的。要么把回退方案做出来，要么把它作为一次单向门决策单独提出来，而不是混在常规发布评审里过掉。

### R2 — 回退后数据状态已说明

- **检查什么**：§7 的"回退后数据状态"非空。
- **怎么检查**：读 §7 第三项。
- **不通过**：为空 → FAIL；写了但只说"无影响"而本次变更含数据库迁移 → FAIL；其余 → PASS。
- **修复**：代码可以回滚，写进库里的数据不会自己回来。"回滚版本"回答的是代码，这一栏回答的是数据——两者不是同一个问题。

### R3 — 接口兼容有明确结论

- **检查什么**：§3 的"破坏性变更"栏是"有"或"无"（不是空、不是"可能"）；若为"有"，受影响消费方与迁移要求非空。
- **怎么检查**：读 §3 三项。
- **不通过**：结论为空或含糊 → FAIL；有破坏性变更且消费方/迁移已写明 → CONCERNS。
- **修复**："应该没有破坏性变更"不是结论。看 diff 里有没有改动公开接口、响应结构、字段语义、枚举取值。

### R4 — 安全与隐私有明确结论

- **检查什么**：§4 的"是否触及认证 / 权限 / 个人数据 / 密钥"四项各有明确回答；任一为"是"时"相关检查结果"非空。
- **怎么检查**：读 §4。
- **不通过**：任一项为空 → FAIL；触及但无检查结果 → FAIL；触及且有检查结果 → CONCERNS。
- **修复**：这四项是 Release Authority 最没有能力自己判断、也最不能事后补救的一类风险。含糊的回答在这里等同于没有回答。

### R5 — 监控与支持准备有响应人

- **检查什么**：§8 的"异常时谁响应"是具名的人或具名的值班角色；"观察什么指标、看多久"非空。
- **怎么检查**：读 §8 两项。
- **不通过**：响应人为空或写"团队" → FAIL；指标为空 → CONCERNS。
- **修复**：发布后没有指定响应人，等于把发现问题的时间交给运气。"团队"不是响应人——出事时每个人都以为别人在看。

### R6 — 已知例外每条有 owner

- **检查什么**：§6 表格每行的 `owner` 是具名的人；`严重度` 是 `low` / `medium` / `high` 之一。
- **怎么检查**：读 §6 表格；本节为空时必须显式写"无"。
- **不通过**：有例外但缺 owner → FAIL；本节空白（既不是表格也不是"无"）→ FAIL；有 `high` 级例外且 owner 齐全 → CONCERNS。
- **修复**：写不出 owner 的问题不算已知例外，那是缺口。这条对应 gates.md 里 CONCERNS 的准确含义：**这些问题我看见了、我接受、并且我知道由谁负责。**

### R7 — Evidence Case 九章节齐全且无原始 trace

- **检查什么**：九个一级标题按顺序齐全；正文里没有粘贴完整 diff、命令原始输出、contract 全文。
- **怎么检查**：数标题；扫一眼有没有超过 20 行的代码块或日志块。
- **不通过**：缺章节 → FAIL；有原始 trace → CONCERNS（改掉即可，不必回上游）。
- **修复**：章节固定是为了让人每次在同样的位置找到同样的东西。粘原始 trace 的后果是 Release Authority 读不完，读不完就只能凭印象签字——那正是这套流程要消除的东西。

---

## E 组：Gate 记录有效性类

判的是"这条链上此前每一次批准，是不是真的批准"。

### G1 — 所有既有 Gate 记录通过校验

- **检查什么**：`validate_gate.py --work-item WI-00X` 的 `invalid` 为 0。
- **怎么检查**：跑脚本，读 `results[].failures`。
- **不通过**：FAIL
- **修复**：脚本的每条 `failures` 都带 `fix` 字段，按它改。**注意：`approved_by` 一栏出问题时，唯一的修法是去拿一次真实的人工确认，不是换个写法。**

### G2 — contract-approval.yml 有效且 approved_by 是真人

- **检查什么**：`gates/contract-approval.yml` 存在；`gate` 是 `PASS` 或 `CONCERNS`；`approved_by` 是具名的人。
- **怎么检查**：`validate_gate.py --gate contract-approval`。
- **不通过**：不存在 → FAIL；`gate: FAIL` → FAIL；`approved_by` 是 AI / Claude / system / 空 → FAIL。
- **修复**：整条链的第一次授权无效，后面所有工作就都建立在一次自证之上。回 `sdlc-contract` 补一次真实批准。

### G8 — build-review.yml 存在且有效

- **检查什么**：`gates/build-review.yml` 存在；`gate` 是 `PASS` 或 `CONCERNS`；`approved_by` 是具名的人。
- **怎么检查**：`validate_gate.py --gate build-review`。**唯一的免检情形**是
  `lane: quick` 且 `config.yaml` 的 `gates.build_review.quick_lane` 为 `self-check`
  且 `self_check_decided_by` 有名字——三个条件缺一不可，缺任一条按不存在处理。
- **不通过**：不存在 → FAIL；`gate: FAIL` → FAIL；`approved_by` 是 AI / Claude / system / 空 → FAIL。
- **修复**：没有它意味着这次实现**没有任何人看过方向**就一路走到了发布前。
  Release 决定人此刻要一次性承担"做法对不对"和"能不能上"两个判断，而前者本该在
  进 QA 之前就有人回答过。回 `sdlc-build` 补一次 build-review。

**为什么这条必须在 release 检**：build-review 是唯一一个"跳过了也不留痕迹"的 Gate——
不像范围扩大有 `change-scope.yaml` 的版本号可以对数，也不像 contract 批准有下游全部产物依赖它。
跳过它，`Executing → Verifying → Decision` 一路全绿。这里不问，就没有地方会问。

### G3 — 每次范围扩大有对应 Gate

- **检查什么**：`change-scope.yaml` 的 `version` 为 N 时，`gates/` 下有 N-1 个有效的 `scope-expansion-*.yml`。
- **怎么检查**：读 `change-scope.yaml` 的版本号，数 `gates/scope-expansion-*.yml`。
- **不通过**：数量不足 → FAIL。
- **修复**：范围扩大是一次不可逆的信任扩大，每一次都要有具名确认。少一个就意味着有一次扩大是自己给自己批的。

### G4 — 无"预检失败但判 PASS"的既有 Gate

- **检查什么**：任一 Gate 文件中 `gate: PASS` 且 `deterministic_checks.failed > 0`。
- **怎么检查**：`validate_gate.py` 会直接报这一条。
- **不通过**：FAIL
- **修复**：预检不通过就不该进入人工环节。要么补齐后重跑，要么如实记为 `CONCERNS` / `FAIL`。

### G5 — WAIVED 的补齐动作未逾期

- **检查什么**：任一 Gate 为 `WAIVED` 时，`waiver.compensating_record` 描述的补齐动作已完成，或 `waiver.deadline` 未到。
- **怎么检查**：读 waiver 段，比对当前日期与实际产物。
- **不通过**：逾期未补 → FAIL；未逾期但未补 → CONCERNS。
- **修复**：豁免的书面代价必须付。带着一笔逾期未还的豁免发布，等于这套流程默认豁免可以不还——那么下一次豁免就更容易开。

### G6 — PASS/CONCERNS 的 Gate 记录写明了产生哪个版本

- **检查什么**：`gates/` 下每份 `gate` 为 `PASS` 或 `CONCERNS` 的记录，`merged_revision` 非空——contract 版本号、git commit / tag，或明确写"无"。
- **怎么检查**：`validate_gate.py` 直接报这一条（`field: merged_revision`）。
- **不通过**：FAIL
- **修复**：一次答不出"当时批准的到底是什么"的批准，在审计里只是一个人名加一个时间戳。写"无"也是合法答案——它的意思是"这次批准没有产生新版本"，与留空不是一回事：留空的含义是"没人填"。

### G7 — publish_scope 在受控词表内且与证据范围一致

- **检查什么**：每份 Gate 记录的 `publish_scope` 是 `task` / `project` / `domain` / `organization` 之一。
- **怎么检查**：`validate_gate.py` 直接报词表违规（`field: publish_scope`）；一致性由这里判——比对 `release.yml` 的取值与 Evidence Case §1 描述的范围。
- **不通过**：不在词表内 → FAIL；填了 `task` 之外的值而 §1 的范围只描述了本 WI → CONCERNS。
- **修复**：这一栏回答的是"这次批准对多大范围生效"。默认 `task`——只对这个 Work Item 生效。往上填一档意味着别的工作可以引用这次决定，那么证据也要覆盖到那一档，否则就是拿一个 WI 的验证给一个领域背书。

---

## 裁决表：规则 → 结论

逐条判完之后，按下表得出**预检结论**：

| 规则组合 | 预检结论 | 动作 |
|---|---|---|
| 无 FAIL、无 CONCERNS | **PASS** | 组装 Evidence Case → 进入人工决定 |
| 无 FAIL、有 ≥1 CONCERNS | **CONCERNS** | 组装 Evidence Case → 进入人工决定，**每条 CONCERNS 连同 owner 出现在呈报最前面** |
| 有 ≥1 FAIL | **FAIL** | 停。输出三要素 Hold 清单，WI 退回 `Verifying`，**不写 `gates/release.yml`** |

无条件 FAIL 的八条（不管其他规则如何，命中即 FAIL，不允许用"其余都很好"抵消）：

| 规则 | 缺的是什么 |
|---|---|
| **C2** criterion 未逐条列全 | 判断依据本身残缺 |
| **E2** 存在未归因失败 | 不知道失败意味着什么 |
| **E8** 触及共享路径而回归集选择依据为空 | 既有功能有没有被弄坏，无人回答过 |
| **B1/B2** 越界或改了 protected 且未处置 | 变更超出了被批准的范围 |
| **R1** 回退方案为空 | 出事无法收场 |
| **B4** 有未处置的 Amendment | Contract 被书面质疑而无人回应 |
| **G1/G2** 存在无效 Gate 记录 | 上游某次批准是自证的 |
| **G8** 缺 build-review 且未具名降级 | 没有任何人看过这次实现的方向 |

**E8 进这张表、E9 不进**，因为两者缺的东西不是同一个量级。E8 缺的是**验证行为本身**——
触及共享路径却没有回归，等于"既有功能有没有被弄坏"这个问题从头到尾没被问过，与 R1 回退方案为空同类，
是不能拿"其余都很好"去抵消的：其余规则再绿也不构成对这个问题的回答。
E9 缺的是**关于验证的说明**——测试做了，只是没写下哪几类做了、哪几类有意不做。
这仍然是问题（它让人分不清判断与遗漏），但判断依据是存在的，补一段话就能修，
所以留在普通规则里按分支判 FAIL 或 CONCERNS，允许被整体裁决表按正常方式汇总。

CONCERNS 的正确用法：它**不是"差不多能过"的委婉说法**。写成 CONCERNS 的每条问题都必须能填满三样东西——是什么问题、多严重、由谁负责。三样填不满的，就是 FAIL。

---

## 预检结论怎么用

**预检结论 ≠ Gate 结论。** 预检说的是"规则允不允许进入决定"；Gate 说的是"人接不接受这个风险"。

- 预检 `PASS` 之后，人依然可以给 Hold 或 Reject。规则通过不构成发布的理由。
- 预检 `CONCERNS` 之后，人可以给 Release（此时 `gates/release.yml` 的 `gate` 写 `CONCERNS`，`top_issues` 逐条列明）。
- 预检 `FAIL` 之后，**不产生 Gate 记录**。没有人做过决定，就不该有决定的记录——空着的 `approved_by` 或填了 AI 的 Gate 文件，比没有文件更糟：它看起来像一次决定。

预检结果写入 `gates/release.yml` 的 `deterministic_checks`：

```yaml
deterministic_checks:
  passed: 12
  failed: 0
  details: "preflight-rules A/B/C/D/E 全组通过；E4 flaky 2 项已转入已知例外"
```

`details` 写成能复现的形式——三个月后有人问"当时到底检查了什么"，这一行就是答案。
