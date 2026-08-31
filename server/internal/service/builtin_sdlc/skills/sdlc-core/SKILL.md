---
name: sdlc-core
description: Use when setting up or explaining the AI-SDLC governed workflow itself - initializing .sdlc/ in a project, looking up what a Work Item, Execution Contract, Change Scope, Evidence Case, Gate Decision or Lesson Proposal is and which fields it needs, asking what the Work Item state machine allows (which states exist, which transitions are legal), resolving which sdlc-* skill owns a step, or whenever another sdlc-* skill points here for shared definitions, templates or validation scripts. Also use when someone asks to set up a governed or evidence-based delivery process, mentions .sdlc/ files, or asks why a gate or scope boundary is being enforced. sdlc-core only reads and explains these definitions and templates - any request to change a template, checklist or skill file goes to sdlc-learn. And for "where does my work actually stand right now, who is blocking me", that is sdlc-intake, not this skill.
---

# SDLC Core — 共享对象模型与治理基座

这是 AI-SDLC Skill 套件的共享地基。八个环节 Skill（intake / explore / contract / build / qa / release / operate / learn）加一个横切的 `sdlc-orchestrator`，全部引用这里的对象定义、状态机、Gate 规则、产物模板与校验脚本，**任何一处定义都只在这里维护一份**。

套件解决的问题是：AI 执行很快，但边界模糊、依据不明、责任不清。治理骨架把"哪份事实可信、什么范围可改、谁批准了什么、留下了什么证据"变成可检查的文件，让人基于证据做决定，而不是通读输出后凭感觉签字。

## 三条铁律

这三条不是风格偏好。它们各自对应一类会造成真实损失的失败模式，而且每一条都极容易被"这次情况特殊"消解掉，所以写成不可协商的形式。

```
NO GATE PASSAGE WITHOUT A HUMAN APPROVAL RECORD
NO TEST EXPECTATIONS DERIVED FROM IMPLEMENTATION
NO WRITES OUTSIDE THE APPROVED CHANGE SCOPE
```

**违反字面就是违反精神。** 一条 Gate 记录里 `approved_by` 填了 "AI" 或留空，就是没有批准；测试"参考"了实现来确定预期值，就是从实现反推；"顺手改一下"不在白名单里的文件，就是越界。

完整的红线说明、借口对照表与自检信号在 `references/redlines.md`——**在你觉得某条红线这次可以变通的那一刻去读它**，那正是它写出来要拦的时刻。

## 目录与状态

一切状态是文件，可 `git diff`、可 PR 评审、可离线审计。不用数据库，不靠会话记忆。

```
.sdlc/
├── config.yaml                  项目配置：责任人、保护路径、风险默认值
├── current.yaml                 当前活跃 Work Item 指针（与 git 分支解耦）
├── family.yaml                  FamilySpec：阶段序列（可选，缺省用内置 AI-native delivery）
├── work-items/WI-001-slug/
│   ├── work-item.yaml           主记录：状态、owner、lane、objective、refs
│   ├── exploration.md           Exploration Record（含 coverage map、Assumptions）
│   ├── contract.yaml            Execution Contract：业务+技术+边界+发布的唯一真相（approved 后不可变）
│   ├── change-scope.yaml        Managed Change Area（越界升级后出新版本）
│   ├── ledger.md                执行台账（append-only）
│   ├── build-evidence.md        Build 交付物摘要与映射
│   ├── test-plan.yaml           TestIntent / TestCase / TestRunPlan / TestResult
│   ├── qa-report.md             QA 结果、失败归因、evidence assurance
│   ├── evidence-case.md         Release Evidence Case
│   ├── evidence.jsonl           Evidence Event 事件流（append-only）
│   ├── gates/*.yml              Gate Decision（一个 Gate 一个文件）
│   ├── review/*.html            呈报用的自包含 HTML（生成物：重跑即重建，不手改）
│   ├── amendments/AMD-*.md      Contract Amendment（上游缺口）
│   └── defects/DEF-*.md         Defect（实现缺陷，qa 开出、build 处置）
├── review/status.html            跨 WI 快照（生成物，同上）
├── incidents/INC-001-slug/incident.md
└── lessons/LP-001-slug/lesson.md
```

编号分配、目录创建、模板实例化一律走脚本。手工编号会重号，手工建目录会漏文件——这类机械操作交给确定性代码，语义判断才留给你。

### 脚本与模板怎么定位

全套件统一用 `$CORE` 指代 **sdlc-core 这个 Skill 的目录**。Bash 的工作目录是项目根，不是 Skill 目录，所以相对路径不能直接用——每个会话第一次要跑脚本时先解析一次。优先使用 Codex/Enact 物化的 `$CODEX_HOME/skills`，再兼容项目级与用户级的 Codex/Claude Skill 目录：

```bash
CORE=""
if [ -n "${CODEX_HOME:-}" ] && [ -d "$CODEX_HOME/skills/sdlc-core" ]; then
  CORE="$CODEX_HOME/skills/sdlc-core"
else
  for candidate in ./.agents/skills/sdlc-core ./.claude/skills/sdlc-core ~/.codex/skills/sdlc-core ~/.claude/skills/sdlc-core; do
    if [ -d "$candidate" ]; then CORE="$candidate"; break; fi
  done
fi
if [ -z "$CORE" ]; then
  echo "sdlc-core Skill 未找到；请先挂载或导入 sdlc-core，然后停止当前任务。" >&2
  exit 2
fi
```

Enact 会把同一 Agent 的 Skill 物化为 `$CODEX_HOME/skills` 下的同级目录；Claude Code 与项目级 Codex 安装则由后续候选路径兼容。任何候选都找不到时必须停止，不能凭记忆重建模板或脚本行为。

```bash
python3 "$CORE/scripts/sdlc_init.py" .                      # 初始化（幂等）
python3 "$CORE/scripts/new_work_item.py" . "<objective>" --owner <人> --lane full
```

模板同理：`$CORE/templates/contract.yaml`。用的时候整份复制再填，不要凭记忆重建结构——模板里的字段注释写了每个字段"为什么必须有"，那是后面 Gate 校验的依据。

## 环节与 Skill 的对应

| 阶段 | Skill | 出口产物 | 出口 Gate |
|---|---|---|---|
| Intake / Enact | `sdlc-intake` | work-item.yaml | 无（但 owner 必填才能往下走） |
| Explore | `sdlc-explore` | exploration.md | 自检清单（非正式 Gate） |
| Design & Contract | `sdlc-contract` | contract.yaml（+ 生成的 review/contract.html） | **contract-approval.yml（人工）** |
| Build | `sdlc-build` | change-scope.yaml + ledger.md + build-evidence.md | **scope-expansion-*.yml（越界时人工）** + **build-review.yml（进 QA 前人工）** |
| QA | `sdlc-qa` | test-plan.yaml + qa-report.md | 覆盖自检（确定性） |
| Release | `sdlc-release` | evidence-case.md | **release.yml（人工）** |
| Operate | `sdlc-operate` | incident.md | 事故关闭自检 |
| Learn | `sdlc-learn` | lesson.md；对外同步（见 `references/objects.md` §12） | **lesson-approval.yml（人工）** |
| 横切 | `sdlc-orchestrator` | 排程 / 核对 / 验收结论（**不产出交付物**） | 无 |

五个加粗的是必须有具名人类批准的节点。其余环节可以自主推进。

### 产物分三层，别混着交

上表的"出口产物"只列了主产物。完整清单和**每样东西给谁看**在 `references/artifacts.md`：

| 层 | 判据 | 例子 |
|---|---|---|
| **快速评审层** | 有人要读完它然后做判断或行动 | `exploration.md`、`build-evidence.md`、`qa-report.md`、`evidence-case.md`、`review/*.html` |
| **机读层** | 脚本要解析它，结构比可读性重要 | `contract.yaml`、`change-scope.yaml`、`test-plan.yaml`、`gates/*.yml` |
| **备查证据层** | 平时没人读，出问题时才翻 | `evidence.jsonl`、`ledger.md`、`amendments/` |

**三层都要有。** 只有快速评审层，下游脚本无从校验；只有机读层，就没有一份是能直接读的。
一个内容同时需要两层时**手写一份、生成另一份**——`contract.yaml` 手写，`review/contract.html` 由它渲染，
两份手写视图必然漂移成两份真相。

交接和呈报**给快速评审层的路径 + 摘要**，不要把机读层的内容在对话里复述一遍。

`build-review.yml` 是其中最年轻的一个，补的是一个具体缺口：在它之前，从 Contract 批准到 Release 决定之间**人一次都不看代码**。理由见 `references/gates.md`。

## 两条通道（lane）

小改动走完整八环节会把交付债换成流程债，这是所有同类框架共同踩过的坑。因此 `work-item.yaml` 有 `lane` 字段：

- **full**（默认）：完整八环节。
- **quick**：小改动、热修、单点缺陷。可以把 explore 压缩成几句事实确认、contract 的 design 块压到一句 `approach`、build 直接按 criteria 做。

**仪式随任务缩放，审批 Gate 从不缩放。** quick lane 仍然要有 contract（可以只有 2 条 criteria）、要有 change-scope、要有 release 决定与 Gate 记录。省掉的是篇幅，不是责任链。

lane 一旦选定写入 work-item.yaml；升级（quick→full）随时可以，降级需要说明理由并记入 work-item.yaml 的 notes。

## 需要展开时读哪一份

每份 reference 都是独立的，按需读一份，不要一次全读：

| 文件 | 什么时候读 |
|---|---|
| `references/redlines.md` | 觉得某条红线这次可以变通时；写任何 Gate 记录前 |
| `references/objects.md` | 需要某个对象的完整字段定义、它与主规格概念的对应关系、或判断一条内容属于哪个**记忆层级**时 |
| `references/state-machine.md` | 要变更 Work Item 状态、或判断能否回退时 |
| `references/gates.md` | 要开一个 Gate、写 Gate YAML、或判断某条件该由脚本判还是由人判时 |
| `references/evidence.md` | 要写 evidence.jsonl 事件、或组装 Evidence Case 时 |
| `references/artifacts.md` | 不确定某环节该落哪些文件时；交接或呈报之前；有人问"这次到底产出了什么"时。**三层分类（快速评审 / 机读 / 备查）在这里定义** |
| `references/interaction.md` | 要向人提问、收集判断、处置未决问题之前。**议程先行、成批提问、逐题回执的协议在这里** |
| `references/authoring-conventions.md` | 要新增或修改本套件的 Skill 时（只有 sdlc-learn 在批准后可以做这件事）。**§0 的九个配置面清单是每个 SKILL.md 的必填结构** |

模板在 `templates/`，用的时候整份复制再填，不要凭记忆重建结构——模板里的字段注释写了每个字段"为什么必须有"，那是后面 Gate 校验的依据。

## 脚本

全部 Python 3 标准库 + PyYAML，无网络访问。失败时打印可操作的错误信息而不是堆栈。

| 脚本 | 用途 | 谁调用 |
|---|---|---|
| `scripts/sdlc_init.py` | 初始化 `.sdlc/` 骨架与 config.yaml | core（首次） |
| `scripts/new_work_item.py` | 分配编号、建目录、实例化模板 | intake |
| `scripts/validate_gate.py` | 校验 Gate YAML：词表、必填字段、`approved_by` 非空非 AI | contract / build / release / learn |
| `scripts/check_scope.py` | 比对 `git diff` 文件清单与 change-scope 白名单 | build / qa / release |
| `scripts/coverage_stats.py` | 统计 criteria ↔ task ↔ TestIntent 的覆盖与缺口 | contract / build / qa / release |
| `scripts/wi_status.py` | 汇总所有 Work Item 的状态、阻塞点、待决事项；`--header` 输出一段供回复开头使用的状态行 | intake / orchestrator |
| `scripts/metrics.py` | 交付度量：lead time / 一次通过率 / 返工 / 缺陷逃逸 / Gate 等待 / 人工审批负担 / 上下文失败 / 资产复用 | intake |
| `scripts/render_review.py` | 从产物渲染自包含 HTML 评审页：contract / qa / release / explore / status | contract / qa / release / explore / orchestrator |
| `scripts/sdlc_audit.py` | 记录与磁盘的一致性核对：状态↔产物（**按状态累积反查**）、缺 build-review、evidence 为空、Gate↔状态、范围重叠、指针失效、已完成但未对外同步 | orchestrator |

调用约定：脚本以 JSON 输出到 stdout，退出码 0 表示检查通过、1 表示检查未通过、2 表示脚本自身出错（参数错、文件缺失）。**退出码 1 是有意义的结果，不是故障**——按 JSON 里的 `failures` 处理即可；退出码 2 才需要停下来修。

## 度量：不要只看 Token

`metrics.py` 从 `.sdlc/` 现有文件算出八项指标：Lead Time、一次通过率、返工、缺陷逃逸、
Gate 等待、人工审批负担、上下文失败、资产复用。原料本来就在，只是需要有人去算。

**运行成本不在其中。** token 与耗时不在 `.sdlc/` 里，算不出来就不列——
列一个算不出来的指标，读的人会以为是自己没找到。

**这些数字描述的是交付系统，不是某个人。** 返工多通常意味着 contract 没写清楚，那是上游问题；
Gate 等待长通常意味着批准人负载过高，那是排班问题。
不得用任何一项推导个人绩效，也不得用 token 消耗或 AI 使用率替代它们——
后者衡量的是"用了多少 AI"，与"交付得好不好"无关。

## Done When

- [ ] `.sdlc/` 存在；config.yaml 的 `roles` 里，各 Gate 要求的角色都有真实的人（一个人可担多个）
- [ ] 当前工作对应的 Work Item 目录已存在，`current.yaml` 指向它
- [ ] 你知道自己在哪个阶段、下一个 Gate 是什么、由谁批准
- [ ] `.sdlc/config.yaml` 的 `data_policy.never_read` 覆盖了本项目真实的密钥路径
