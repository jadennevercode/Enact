---
name: sdlc-learn
description: Use when something learned from delivery work should become a durable standard - registering a Lesson Proposal after a retrospective, incident, repeated clarifications or rework. Triggers include 复盘 / 沉淀经验 / 这个教训记下来 / 把这个做法固化 / 更新检查清单、模板或流程, asking to change a checklist, template, policy, eval, script or an sdlc-* skill itself, or amending, deprecating or rolling back a published lesson. Also use when finished delivery should be written outward into a Project Intelligence Space - what changed, what was learned, overall product progress - triggered by 同步到 IntelligenceSpace / 同步项目空间 / 把这次交付同步到项目空间 / 上线之后把变更记录下来 / 更新项目空间的进度. The only entry point that may modify capability assets, and only after a named approval gate. Not for 同步 in the sense of briefing a person (同步给测试 / 同步给老板), not for reading progress back out (sdlc-intake), diagnosing a live incident (sdlc-operate), changing product code (sdlc-build) or what a work item promises (sdlc-contract), or changing a Family's stage sequence (sdlc-orchestrator).
---

# SDLC Learn —— 把有效经验受控地变成能力资产的新版本

复盘完成不是终点。**只有经验被验证、批准并进入受治理资产，下一次执行才会真正变好。**一份写完就归档的复盘报告，除了让人感觉良好之外不改变任何事情。

但反向的失败更贵：一次个案被当成普遍规律写进模板或 Skill，之后每一次工作都会被它影响，而且极难回溯——因为它看起来和真正的规律一模一样。

所以这个环节的全部设计都围绕一件事：**让好经验能进来，让没验证过的经验进不来。**

职责边界：本环节改的是**能力资产**（模板 / 清单 / 策略 / eval / 脚本 / Skill / 项目文档），不改业务代码，不改已批准的 contract、gate 与 evidence。

## 铁律

```
NO ASSET CHANGES WITHOUT AN APPROVED LESSON
```

在 `gates/lesson-approval.yml` 存在、`gate: PASS`、`approved_by` 是具名真人之前，不得修改任何模板、检查清单、策略文件、eval、脚本、Skill 文件或项目标准文档。

**违反字面就是违反精神。** 「只加了一行注释」是修改；「只改了 references 没动 SKILL.md」是修改；「先建好新文件放着等批准」是修改。批准之前，你能写的只有 `.sdlc/lessons/`。

| 借口 | 现实 |
|---|---|
| "这个改动很明显是对的" | 明显对的经验花一轮交互就能拿到批准。真正的成本是：你判断的"明显"如果错了，它会静默地影响之后每一次工作，而没有任何人在看。 |
| "顺手把模板改了，反正 lesson 也要写" | 顺手改的那一下没有边界声明、没有反例、没有回滚锚点。它和一次越界写入是同一件事（红线 3）。 |
| "用户说'这个做法不错'，那就是批准了" | 那是对一件事的评价，不是对"把它固化到所有未来工作里"的授权。用固定话术重新问一次，10 秒的事。 |
| "先改，批准我等会儿补" | 补不上。事后没人记得当时是不是真的权衡过收益和风险，记录的价值全在时序。 |
| "这是新建一个文件，不是改现有资产" | 新建资产同样走完整六阶段（`new_asset: true`）。新增一份没人批准过的 reference，和悄悄改一份现有的一样会影响之后每一次执行。 |
| "只是把措辞改准一点，算 Amend 不用批" | Amend 省的是重开一条 LP，不是省批准。它照样要 Gate，只是挂在原 LP 下面。 |
| "这是修一个 bug，不是加一条规则" | 那就作为一次普通变更走 build 的受控通道。走到这个 Skill 里来，说明你想改的是能力资产本身。 |
| "反正是我自己维护的 Skill" | 谁维护和谁承担后果是两件事。承担后果的是之后所有用它的人。 |

**自检信号——出现以下任何一条就停下**：

- 你正要编辑 `.sdlc/lessons/` 之外的文件，而 `lesson-approval.yml` 还不存在
- 你心里在想"走一遍六阶段对这么小的改动是形式主义"
- 你说不出这条经验的任何一个反例
- 写 Gate 的 `approved_by` 时，你不知道该填谁

## 开工前

**REQUIRED**：读 `references/promotion-guide.md`——什么值得晋升、七类目标怎么选、Validate 六项怎么做、怎么安全地改或新建目标资产，全在那里。

**REQUIRED（Publish 之前）**：读 `../sdlc-core/references/authoring-conventions.md`。改本套件的资产要守同一套写作规范（含 §0 的九个配置面清单），否则你会一边修一个问题一边引入三个。

需要展开时才读：`../sdlc-core/references/gates.md`（写 Gate 记录、请求批准的固定话术）、`../sdlc-core/references/objects.md`（Lesson Proposal 字段与记忆层级）、`../sdlc-core/references/redlines.md`（觉得这次可以直接改的那一刻）。

输入：

| 来源 | 读它拿什么 |
|---|---|
| 触发它的证据 | `WI-###/qa-report.md`、`ledger.md`、`incidents/INC-###/incident.md`、evidence.jsonl 里的 `boundary_stop` |
| `.sdlc/lessons/` 现有 LP | 是否已有同一条经验的候选、已发布版本或被拒记录 |
| `.sdlc/config.yaml` | `gates.lesson-approval.require` 要哪些角色签、`roles` 里谁担这些角色；`protected_paths`、`data_policy`、`test_policy` 当前取值（改它们就是 `policy` 类经验） |
| 目标资产当前版本 | Classify 确定目标之后才读，且只读要改的那一份 |

**版本固定（Capability bundle）**：本 Skill 实例化 `../sdlc-core/templates/lesson.md` 与 `../sdlc-core/templates/gate.yml`。首次复制时向 evidence.jsonl 追加 `capability_bundle_pinned`，`input_refs` 填两个模板路径 + 当前 git hash。Publish 阶段若发现模板已经变了，用记下的那个版本核对，不要用"现在的模板"倒推当初填过什么。

`$CORE` 指 sdlc-core 的 Skill 目录。Bash 的工作目录是项目根，所以每个会话第一次跑脚本前按 Codex/Enact、项目级、用户级的顺序解析一次：

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

## 六阶段

| 阶段 | 动作 | 责任人 | 对应主规格能力生命周期 |
|---|---|---|---|
| Observe | 从澄清、失败、例外、返工、成功模式中登记候选 | 任意环节 | Draft（前半） |
| Classify | 判断目标资产类型、影响半径与采用范围 | Domain Expert / AI Engineer | Draft（后半） |
| Validate | 用历史案例、反例与回归集验证适用范围 | AI Engineer / QA | Validate |
| Approve | 确认收益、风险、适用范围与**目标版本** | Capability Steward（具名） | Review |
| Publish | 形成新版本；记录采用范围 | learn | Publish |
| Observe again | 监控效果，出 Amend 或 Deprecate | learn | Observe + Amend/Deprecate |

**没有漏阶段**：主规格的 Amend / Deprecate 不是第七个阶段，是 Observe again 的两个出口，定义在下面 §6。

`status` 跟着阶段走：`observe → classify → validate → approve → publish → observed`。被否掉的停在 `rejected`，被废弃的改成 `deprecated`。

### 1. Observe — 登记候选

建目录 `.sdlc/lessons/LP-###-slug/`，整份复制 `../sdlc-core/templates/lesson.md` 再填。编号顺着现有 LP 往下排，别重号。

只填 §1：来源证据（**引用到文件#章节，不复述内容**）、发生了什么（具体事件，不是抽象总结）、为什么值得沉淀。

**这一步不做判断，只做登记。** 候选多是好事——筛选是 Classify 和 Validate 的工作。登记完向 evidence.jsonl 追加 `action: lesson_proposed`。

值得登记的信号：同一个澄清问题第二次出现、Gate 因为同一类缺失第二次 FAIL、越界被拦下的地方其实是范围模板漏了声明、`config.yaml` 的某条 protected 路径反复挡住正常工作或反复漏掉一类文件、某次做法明显省了事而下次没人会想到。

### 2. Classify — 判断目标资产类型

**这一步的判断决定了影响半径，判错的代价最大。**

| target_kind | 落点 | 影响半径 | 选它的判据 |
|---|---|---|---|
| `project-doc` | 目标项目的 `docs/`、`CLAUDE.md`、`.sdlc/` 内的项目文档 | 只有本项目 | 经验依赖这个项目的技术栈、目录结构、组织约定、历史包袱 |
| `template` | `sdlc-core/templates/*` | 之后所有同类产物 | 产物里少了一个字段、一个必填项、一段说明 |
| `checklist` | 某个 reference 里的检查清单条目 | 之后所有走该清单的环节 | 是一条"别忘了检查 X"，不改变工作方式 |
| `policy` | `config.yaml` 的 `protected_paths` / `data_policy` / `test_policy` / `tool_actions`，或 `redlines.md` | 之后所有工作的边界 | 改的是"什么被允许、什么被禁止"，不是"怎么做得更好" |
| `eval` | `evals/scenarios.md` 的用例与通过判据 | 之后所有 Skill 变更的验证基准 | 现有 eval 放过了一类真实失败，或误伤了一类正常行为 |
| `tool` | `sdlc-core/scripts/*`、`tools/*` | 之后所有调用该脚本的环节 | 判断是确定性的，应该由脚本承担而不是每次靠人记住（写作规范 §8） |
| `skill` | 任一 `SKILL.md` 或 `references/*` | **之后所有工作、所有项目**，且整个会话常驻 | 工作方式本身错了，且换个项目也会错 |

`upstream-mapping.md` 产出的「`config.yaml` 的 protected 路径补充」这类归位结论，落点是 `policy`——不要把它硬塞进 `project-doc` 或 `template`。

判断的主分界线只有一条：**这条经验换一个项目还成立吗？**不成立就是 `project-doc`，到此为止。七类之间的完整选型问答见 `references/promotion-guide.md` §2。

选 `skill` / `policy` / `tool` 之前多问一道：**没有这条规则时，baseline 会犯这个错吗？**不会就没有东西要修。给一个不存在的失败写规则，只会挤占上下文并制造误伤。

填 §2 的三个字段，一个都不能空：

```yaml
target_kind: policy
target_path: ".sdlc/config.yaml"
new_asset: false        # true = 新建资产而非修改现有
target_version: "a3f21c" # 目标资产当前 git hash；new_asset 时写"新建"
adoption_scope: all      # all | 本项目 | 指定环节
```

**`new_asset: true` 是「晋升为新资产」这条路。** 主规格明写「晋升为新资产**或**现有资产的新版本」——需要新增一份 reference、一个新模板、一条新清单时走这条。此时 `target_path` 是**将要创建**的路径，另外要在 §2 的变更摘要里写明两件事：**为什么现有资产里放不下它**，以及**它归属哪个目录、由谁维护**。

**`adoption_scope` 决定爆炸半径。** 不填的话，一条 LP 一经发布就对所有项目、所有会话无差别生效——而 `skill` 类改动是静默影响每一次执行、最难回溯的那一类。只在本项目成立的写"本项目"，只对某个环节成立的写环节名。

目标是"某个模板"、"流程里"这种说不出路径的，说明还没想清楚。

### 3. Validate — 找边界

**REQUIRED**：`references/promotion-guide.md` 的「Validate 怎么做」一节有找历史案例的方法、构造反例的方法、适用范围问题清单和回归集的建法。

先过三道门，缺一不推进：跨场景复现（只发生过一次的留在 `observe`）、写得出反例、回放历史案例不出现误伤。

然后填模板 §3 的 **Validation 六项表**，逐项给结论，不适用的写"不适用 + 理由"：

| 检查 | 怎么填 |
|---|---|
| 结构校验 | 校的是**改动后的资产**，不是这份 LP 自己。改 Skill / reference / 模板：`python3 tools/check_suite.py`；改 YAML（config、gate、test-plan）：`python3 -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))" <文件>`。这一步在 Publish 改完之后立刻跑，结果回填这一行 |
| 依赖解析 | `grep -rn "<被改文件名>" .claude/skills/` 列出所有引用点，逐个确认措辞还对得上。删段落尤其危险 |
| 权限检查 | 两问：**谁有资格批准**（`gates.lesson-approval.require` 要的角色 + `roles` 里谁担它）**和改动后谁被允许使用**（`adoption_scope`）。第二问不是重复——git 权限管的是谁能改文件，管不了这条资产对哪些工作生效 |
| 样例 / 反例 | 至少一个正例（本来会失败、改后应该通过）和一个反例（本来正常、改后不能被误伤）。两个方向都不看，就不知道自己是修好了还是修坏了 |
| 场景运行 | 拿 2–3 个历史 WI 回放，问"如果当时就有这条规则会怎样"。出现"会拦下当时正确的做法"就是误伤，回去改措辞 |
| 回归结果 | 见下 |

**回归集在这里定义，套件其他地方不再另立一套。** 回归集 = 在 Validate 阶段**先固定下来**的一组用例，改动前跑一遍记录结果，改动后用**同一组**再跑一遍，两次结果并列写进这一行。

| 目标类型 | 回归集取自 | 比什么 |
|---|---|---|
| `skill` / `checklist` | `evals/scenarios.md` 的相关场景 + 2 个难负例 | 改前 vs 改后的 transcript 与通过判据 |
| `template` | 2–3 份历史 WI 的真实产物 | 用改后的模板重填，新字段填不填得出来 |
| `policy` | 历史上被这条策略挡住 / 放过的具体事件 | 同样的事件在新策略下的结论是否翻转 |
| `tool` | 该脚本已有的输入样例 | 退出码与报错文本逐条比对 |
| `eval` | 该 eval 判过的历史用例 | 判定结果有没有意外翻转 |
| `project-doc` | 不适用 | 写"不适用：只读文档，无可执行用例" |

**改动前那一次必须真的跑。** 只跑改动后的一次不叫回归，那只是自证。

写不出反例或六项里有硬伤的，把 status 退回 `classify`，或直接 `rejected` 并写明理由。

✅ `适用范围：涉及外部支付网关的 contract。反例：内部服务间调用不需要，加上会让 quick lane 变重。`
❌ `适用范围：所有需要的地方。`

### 4. Approve — 具名批准

**REQUIRED**：读 `../sdlc-core/references/gates.md` 的「请求批准的方式」与「呈报格式」。

先跑确定性预检，不通过就不要占用别人的判断力：

- §1 的每条证据都能打开
- §2 的 `target_path` **指向一个真实存在的文件**，**或** `new_asset: true` 且写明了创建理由与归属目录——两者满足其一即可
- §2 的 `target_version` 非空（现有资产填 git hash，新建填"新建"），`adoption_scope` 是受控值之一
- §3 有非空的适用范围**和**至少一条反例；Validation 六项每项都有结论（含"不适用 + 理由"）
- 没有别的 LP 已经改过同一个位置（会打架）

然后按固定话术请求批准，一次只呈一条 lesson：

```
## Lesson Approval — LP-###

**要决定什么**：是否把 <一句话的经验> 固化到 <目标文件>

**确定性预检**：<N> 项通过 / 0 项失败

**证据**：<来自哪次工作的什么事实，1-2 条>
**要改什么**：<具体到"在 X 文件的 Y 节增加/修改 Z">
**发布类型**：<新建 new_asset / 修改现有 / Amend LP-### / Deprecate LP-###>
**批准的目标版本**：<target_version：git hash，或"新建">
**生效范围**：<adoption_scope：all / 本项目 / 指定环节>
**适用范围**：<什么条件下成立>
**反例**：<什么情况下不适用>
**回归结果**：<改前 vs 改后，一行结论>
**收益**：<下次会少发生什么>
**风险**：<可能误伤什么>
**影响半径**：<只有本项目 / 所有用这份模板的工作 / 之后所有工作>

**如果通过**：改动落盘并 git commit，从下一次工作开始生效。
**如果不通过**：LP 记为 rejected 存档，不删。

确认把这条经验固化到 <目标文件> 吗？之后所有工作都会受影响。
```

**必须报出 `target_version`。** 批准人签的是一个有版本的对象，不是一段自然语言描述——`gates.md` 的「他批准的是他看过的那个版本」对能力资产同样成立。批准之后目标资产在别处被改动（hash 变了），这次批准作废，重新请求。

**只认显式肯定。**"看起来不错""你觉得呢""应该可以"都不是批准——继续澄清。影响半径是 `skill` / `policy` 时，明确说出"之后所有工作"这句话，让批准人知道自己在批什么。

拿到肯定后写 `.sdlc/lessons/LP-###-slug/gates/lesson-approval.yml`（复制 `../sdlc-core/templates/gate.yml`，`scope: lesson-approval`，`publish_scope` 与 `adoption_scope` 一致），然后校验记录本身有效：

```bash
python3 "$CORE/scripts/validate_gate.py" --file .sdlc/lessons/LP-###-slug/gates/lesson-approval.yml
```

被拒绝的：`status: rejected`，把拒绝理由写进 §4，**文件保留**。它是审计线索，也是下一次同类候选的参考。

### 5. Publish — 改目标资产

**REQUIRED（现在读，不要凭记忆）**：`../sdlc-core/references/authoring-conventions.md`。

顺序不能倒：**先有有效 Gate，后有改动**。改之前再确认一次 `gate: PASS`、`approved_by` 是真人、`target_version` 与目标资产当前 hash 一致。

**一次只改一处。** 一条 lesson 对应一个改动点，一次 commit。批准时批的是这一处，捎带的第二处没被批准过，而且会让 Observe again 无法归因。

三种发布类型：

| 类型 | 什么时候用 | 动作 |
|---|---|---|
| 新建（`new_asset: true`） | 现有资产里放不下这条经验 | 建文件 + **在上级导航里加入口**（新 reference 要在对应 SKILL.md 的「开工前」或需要时才读的清单里出现；新模板要在引用它的环节写明何时实例化）。**没有入口的新资产等于没发布**——没人会读到它 |
| 修改现有 | 目标资产已存在 | 直接改，commit 引用本 LP 编号 |
| Amend / Deprecate | 针对一条已发布的经验 | 见 §6 |

改动门槛按位置递增（详见 `references/promotion-guide.md` §4）：`project-doc` / `templates/` 正常 → `policy` / `eval` / `tool` 较高（改的是边界与判据，错了会静默放行或静默拦截）→ `references/` 较高（先 grep 引用点）→ `SKILL.md` 正文最高（整个会话常驻，每一行都在花所有人的上下文预算）。

改完立刻跑结构校验，把结果回填 §3 的第一行：

```bash
python3 tools/check_suite.py            # 改 Skill / reference / 模板之后（在套件仓库根目录跑）
```

commit message 带 LP 编号，`git commit` 即版本：

```
chore(learn): LP-007 契约模板增加外部依赖降级预案字段
```

填 §5：改了哪些文件、commit hash、生效时间、**采用范围**（哪些环节 / 项目从现在起适用，与 `adoption_scope` 一致；范围不是 `all` 的，在被改资产的正文里就近注明适用条件，否则读到的人无从判断它管不管自己）。向 evidence.jsonl 追加 `action: lesson_published`。

### 6. Observe again / Amend / Deprecate

`status: observed`。在 §6 留观察锚点：**下次什么时候、看什么现象能判断它有没有起作用。**

三个出口：

**保持。** 有效或暂时看不出影响，记一条观察结论，status 保持 `observed`。

**Amend——出修订版，不推翻结论。** 判据只有一条：**结论变了就是新 LP，只是说得更准确就是 Amend。**

- 属于 Amend：收窄或放宽适用范围、补一条反例、改措辞让规则更容易被读到、修一个笔误级的字段名
- 不属于 Amend：换了 `target_kind`、换了 `target_path`、结论反过来了、影响半径变大了——这些开新 LP，并在新 LP §1 引用原 LP

Amend 的走法：在**原 LP** 的 §5 追加一行修订记录（改了什么、新 commit hash、日期），照样要一次 Gate（`scope: lesson-approval`，话术里写明"Amend LP-###"），但**不重开六阶段**——§1 到 §3 沿用原文，只补充这次修订依据的新证据。不做这个区分的话，每次微调都要走一遍完整六阶段，成本高到没人愿意维护已发布的经验。

**Deprecate——结论不再成立。** 三个动作缺一不可：

1. 把改动**移除**（`git revert <commit>`）或在被改资产处**标注失效**（保留文字但注明"已废弃，见 LP-###"，适用于删掉会破坏上下文的段落）
2. 在**原 LP 的 §6** 记录废弃理由与时间——什么时候发现的、什么现象、为什么撤
3. 原 LP 的 `status` 改为 `deprecated`

**不删 LP 文件。** 被推翻的经验和从未存在的经验是两回事——后来人需要知道这条路试过了。Deprecate 同样要一次 Gate：废弃一条已生效的规则，和加一条一样会改变之后所有工作的行为。

**沉淀不是终点，能被推翻才说明这个机制是活的。** 同类改动被撤销两次，要质疑的就不是这条经验，而是判断这类经验的方式——那本身是一条新的 Observe。

## 修改能力资产时的自我约束

Publish 阶段最大的风险不是改错文件，是**根据一次个案给通用资产加特例**。四条防线：

1. **先问 baseline 会不会犯这个错。** 没有这条规则的情况下也不会犯，就没有东西要修。
2. **加规则前先想误伤。** 想象三个正常场景，这条规则会不会把它们也拦下来。一条拦住 1 次错误、同时给 20 次正确操作添堵的规则是负收益。
3. **优先改 references 和模板。** SKILL.md 正文常驻整个会话，进去的每一行都要值得它占的 token。
4. **一次只改一处**，让效果可归因。

还有一条来自写作规范、这里重复一遍：**不加 nuance 条款**。"除非确实必要，否则不要 X"会重新打开谈判，让一条原本有效的规则失效。要么规则成立，要么不写。

## 同步到 Intelligence Space

WI 上线完成后，把这次交付**向外发布**到 Project Intelligence Space：改了什么、学到了什么、产品整体走到哪了。

**这不是修改能力资产，上面那条铁律不适用。** 能力资产是本套件用来干活的东西（模板、清单、策略、Skill）；Intelligence Space 是给人和其他 Agent 读的事实空间，改它不会改变本套件之后怎么工作。反过来也成立——**不得拿"要同步"当理由去动本套件的任何资产**，那仍然要走完整六阶段。

它有自己的 Gate，而且不在本套件手里：对方仓库的写入模型是提 proposal、人在 `/proposals` 页面评审合并。**本 Skill 只提 proposal，永不合并、永不推 main、永不碰对方的主 checkout。**

**REQUIRED（同步前读，不要凭记忆）**：`references/intelligence-sync.md`——三道准入门、什么能过界什么不能、落点映射、六步写入协议、以及该停下的八种情形。

三件最容易做错、先在这里说明白：

1. **配置缺失就是"不同步"，不是"去猜"。** `.sdlc/config.yaml` 的 `intelligence_space.enabled` 为 false 或 `repo_path`/`space` 为空，说明一句正常结束，不要推断路径。
2. **业务层过界，治理层不过界。** 可同步的正是 `contract.yaml` 的 `role_views.业务负责人` 那一组；WI 编号、本地路径、commit hash、批准人真名一律不过界。**别指望对方的校验兜底**——实测同步最常写的 `changelog.yaml` 不在校验覆盖范围内，本地路径写进去照样提交成功。
3. **翻译，不是搬运。** 写出来的话要让一个没听说过这套流程的人完整看懂。

同步完成后向 evidence.jsonl 追加 `intelligence_synced`，并把**分支名与评审地址**告诉人。这一侧到提出 proposal 为止，没有"已同步完成"这个状态。

## 工具边界

| 要素 | 内容 |
|---|---|
| **可读** | `.sdlc/lessons/`、触发它的证据文件、`.sdlc/config.yaml`、本套件的 references / templates / scripts / evals；Classify 定下目标之后才读目标资产，且只读要改的那一份。同步时另加：目标 space 的 `AUTHORING-BRIEF.md`、`ID-INVENTORY.md`、`machine/` 导出与 `data/` 集合 |
| **可写** | Approve 之前只有 `.sdlc/lessons/LP-###-slug/`；Approve 之后再加上 §2 写死的那**一个** `target_path`。同步时另加：Intelligence Space 的 **proposal worktree**，且只到 `projects/<space>/data/` 与 `authoring/ID-INVENTORY.md` 为止 |
| **受保护** | `.sdlc/` 里已批准的 contract、gate、evidence（历史事实，不是可优化的资产）；业务代码；别的 LP 目录；命中 `config.yaml` 的 `data_policy.never_read` 的路径**读都不读**（优先级高于以上任何读范围）。Intelligence Space 一侧：主 checkout、`main`、`machine/`（生成物）、`meta.ts` / `structure.ts` / `lib/`（结构契约）、`validation.yaml`（对方的校验规则）、别人的 proposal 分支 |
| **禁止动作** | 继承 `config.yaml` 的 `tool_actions.always_forbidden`（deploy / push / publish / db-migrate）。不改业务代码——经验指向代码问题时开新 WI 走 build 的受控通道。同步时另禁：合并 proposal、跳过对方 pre-commit、改对方校验规则或 severity 来让提交通过 |
| **升级条件** | 改的过程中发现要动第二处 → 停下，开新 LP；目标资产落在 `protected_paths` 内 → 在呈报里显式说明并请批准人确认；批准后目标资产的 hash 与 `target_version` 对不上 → 作废重批；同一位置已有别的 LP 在改 → 停下先合并判断；同步时目标 space 不存在、体裁不符或需要动结构性文件 → 停下交人（八种情形见 `references/intelligence-sync.md` §5） |

**这是全套件唯一允许修改能力资产的入口。** 其余七个环节一律不改。

## Runtime 与配置来源

当前编码 Agent 会话（Claude Code、Codex，或由 Enact 管理的 Runtime）就是本环节 Runtime，不做多 Runtime 主备、不做并发编排。本 Skill **不使用 subagent**：批准上下文与改动动作必须在同一个上下文里，隔离出去之后 Publish 时无法当场核对 Gate 与 `target_version`。

**改动落在哪一层，影响半径完全不同**——`target_kind` 选完之后要能说出来源层级：

| 层 | 改的是 | 谁受影响 | 怎么撤 |
|---|---|---|---|
| 项目级 | `.sdlc/config.yaml`、项目 `docs/`、`CLAUDE.md` | 只有本项目的后续工作 | 改回去即可，不影响别的项目 |
| 套件级 | `sdlc-*/SKILL.md`、`references/`、`templates/`、`scripts/`、`evals/` | 装了这套 Skill 的**所有**项目 | `git revert` + 通知已采用方 |
| 会话级 | 本次对话里的临时判断 | 只有本次 | 不落盘就不存在——它**不是**能力资产，不要拿 LP 去固化它 |
| 对外发布层 | Intelligence Space 的 `projects/<space>/data/` | 读该空间的**人**，以及通过 MCP 取用它的**其他 Agent** | 合并前删 proposal 分支；合并后要对方仓库 `git revert`，且期间可能已被别的 Agent 读走 |

**对外发布层不是能力资产层**：它不改变本套件之后怎么工作，所以不走 LP 的六阶段；它的 Gate 是对方的人工合并。但它的撤销成本最高——错误一旦被别的 Agent 当作 grounding 读走，就追不回来了。

同一条经验落在项目级和套件级是两条不同的 LP。拿不准就先落项目级观察一轮（见 `references/promotion-guide.md` §2「拿不准的时候往低选」）。

## 交接

**收 Lesson 候选**：`boundary_stop`、反复 FAIL 的 Gate、反复出现的澄清、事故复盘的上游归位结论——由产地环节在自己的 `## 交接` 里声明"要交"，learn 在这里接。只有接收端声明"我要来取"、产地不声明"我要交"，这条链就是断的。

**收同步触发**：WI 走完 Release 决定进入 `Completed` 后，由 **sdlc-release** 在自己的 `## 交接` 里声明交出，learn 在这里接，按上面「同步到 Intelligence Space」一节处理。

**learn 自己也产 Lesson 候选**：同一类改动被撤销两次、同一个 `target_path` 反复被改、Validation 六项里同一项反复填"不适用"——这些指向的是判断方式本身，回到 §1 登记成新的 LP。

**交**：

- Lesson 指向的修复需要动代码 → 交给 **sdlc-intake** 开新 Work Item，在 lesson.md §2 记下 WI 编号
- 事故复盘移交过来的候选 → 来源写 `incidents/INC-###/incident.md`，并回填一行到 incident.md 说明已登记为 LP-###，否则事故关闭自检查不到闭环
- 同步被挡住时（space 不存在 / 体裁不符 / 需要结构性变更）→ 交给**人**，不要自行变通；这类阻塞反复出现本身就是 Lesson 候选
- 已发布的 LP（`status: observed`）属于记忆层级的 `released` 档，可以被后续工作当作事实引用；处于 observe/classify/validate 的属于 `experimentation` 档，**被引用时必须标注为假设**（见 `../sdlc-core/references/objects.md` §9）

## Done When

- [ ] `.sdlc/lessons/LP-###-slug/lesson.md` 存在，§1 的每条证据都能打开
- [ ] §2 的 `target_kind` 是七类之一；`target_path` 指向真实文件，**或** `new_asset: true` 且写明了创建理由与归属目录
- [ ] §2 的 `target_version` 与 `adoption_scope` 都非空
- [ ] 选 `skill` / `policy` / `tool` 的，回答过"换个项目还成立吗"和"baseline 会犯这个错吗"
- [ ] §3 有具体的适用范围**和**至少一条反例；跨场景复现过
- [ ] §3 的 Validation 六项每项都有结论；回归集在改动**之前**跑过一次，两次结果都记了
- [ ] 用固定话术请求过批准，呈报里报出了 `target_version` 与 `adoption_scope`，拿到**显式肯定**
- [ ] `gates/lesson-approval.yml` 的 `approved_by` 是刚才那个人的真名，`validate_gate.py --file` 通过
- [ ] 目标资产的任何改动都发生在 Gate 有效**之后**，且改前核对过 hash 与 `target_version` 一致
- [ ] 本次只改了一处，commit message 带 LP 编号
- [ ] `new_asset: true` 的，新文件在上级导航里有入口
- [ ] 改完跑过结构校验（`check_suite.py` 或 YAML 解析），结果回填 §3
- [ ] §5 填了改动文件、commit hash、生效时间与采用范围；§6 留了下次复查的观察锚点
- [ ] Amend 挂在原 LP 下并单独取得批准；Deprecate 做齐三件事且 `status: deprecated`
- [ ] 被拒绝的 LP 保留为 `status: rejected`，写了理由，没有删除
- [ ] 九个配置面都能在正文里指认出落点（清单见 `../sdlc-core/references/authoring-conventions.md` §0）

同步到 Intelligence Space 时另加：

- [ ] 读过目标 space 的 `AUTHORING-BRIEF.md`，确认体裁与本项目交付事实相容
- [ ] 目标 space 在对方的 `machine/index.json` 里确实存在，没有新建 space
- [ ] 写进去的内容里没有本地路径、WI/LP 编号、commit hash、批准人真名或密钥
- [ ] 字段标签逐字取自 AUTHORING-BRIEF，分组字段取值来自封闭词表
- [ ] 新 artifact ID 都经 `id:next --claim` 登记过
- [ ] 改动只在 proposal worktree 里，主 checkout 与 `main` 未被触碰
- [ ] pre-commit 正常跑过并通过，没有跳过钩子、没有改对方的校验规则
- [ ] 动了 `percent` 的，说得出这次具体完成了什么
- [ ] evidence.jsonl 有 `intelligence_synced`，且已把分支名与评审地址告诉人
- [ ] **没有合并 proposal**——合并是对方那一侧的人做的
