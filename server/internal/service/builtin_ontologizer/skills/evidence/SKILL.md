---
name: evidence
description: 把领域材料（CSV/TSV/Excel/ZIP、Markdown/TXT/PDF/DOCX/PPTX、图片、BPMN/Visio 导出、URL）登记成版本化的证据快照：记来源、哈希、密级、语言、格式、归属人；选抽取路径（native / structured / vision）；给每条抽取建可回到原处的锚点（页/区域、精确原文、表/行/单元格、图区），中英混排保留原始短语不翻译；对标识符、表格、代码、数字、断开的连接线、缺失的端点标高风险待审；把陈述分成事实/假设/指引/约束四类登记；互相矛盾的说法一律不合并，两条都留、都标 disputed、各自保留来源与适用范围与生效时间与权威方，并开一条有主的未决事项；最后由人决定证据够不够开始建模。用户说「这是我们的流程文档」「把这几份材料登记进来」「这几张表先入库」「这段是事实还是我们自己猜的」「两份文件说的对不上」「这个流程图看不懂」「证据够了吗」「可以开始生成了吗」时就用它。凡是要把原始材料变成可追溯输入的请求都归它。推断绝不允许被悄悄升格成事实——这是它存在的头号理由。
---

# evidence · Define 阶段的证据

**交付物：一个版本化证据快照（`define/evidence-snapshots/es-NNNN/` 下的 `manifest.yaml` 与 `extractions/`）加一份 `define/fagc-register.yaml`。** 别的都是过程。

开工前读 `shared/conventions.md`。

## 步骤

| # | 步骤 | 谁 | 做什么 |
|---|---|---|---|
| 1 | `register` | S+C | 给 `inputs/evidence/` 下每份材料算哈希、记来源/版本/密级/语言/格式/归属人，开一个 `es-NNNN` 目录 |
| 2 | `extract` | C/S | 选抽取路径，逐份抽取，每条带锚点，原始短语原样保留 |
| 3 | `classify` | C | 逐条陈述分成 fact / assumption / guidance / constraint 四类 |
| 4 | `conflicts` | C | 找出互相矛盾的说法，成组标 disputed，每组开一条有主的未决事项 |
| 5 | `confirm` | **H** | 人逐条过抽取结果，确认或纠正；纠正后的版本才是证据 |
| 6 | `sufficiency` | **H** | 决策点 `evidence_sufficiency`：证据够不够开始生成 |

`register` 之后可以只做增量：材料没换版本就不重抽。材料换了版本，
`source_digest` 会变，那条抽取的 `reuse_valid_for_current_source` 必须重新判定，
不能沿用——沿用等于拿旧材料的原文给新材料背书。

## 六条规矩

**1 · 推断不许当事实。** 一条标 `fact` 的陈述必须有至少一个同时带 `location` 与
`exact_snippet` 的锚点，还要有 `source_ids`。指不出原文出处的，降级成 `assumption`
并写清 `rationale`。检查项 `no_inference_as_fact` 逐条核这件事，不过就出不了这一阶段。

理由不是洁癖。后面每一个对象的追溯链，最终都落在这些锚点上；一条没出处的推断被标成
事实，整条链就都是装饰品，而这件事在审阅时看不出来——审阅的人看到的是 `fact` 这个词。

**2 · 冲突不合并。** 两份材料说法打架时，不要挑一条留下，也不要合成一句
"通常……但在某些情况下……"。两条都留，都标 `status: disputed`，共用一个
`conflict_group`，各自保留 `source_ids`、`scope`、`valid_time`、`authority_or_owner`
四项，并在 `unresolved_decisions` 里配一条有 `owner` 的记录。检查项
`conflicts_not_merged` 核这一整套。细节见 `references/conflict-handling.md`。

合并之后没人能再判断哪一条适用于自己这一笔业务——而这正是他打开这份材料要问的问题。

**3 · 锚点要能走回去。** 每种格式的稳定锚点长什么样，见 `references/anchors.md`。
判据只有一条：三个月后拿着这个锚点，能不能在原件里翻到那句话。

**4 · 换抽取路径要写下来。** native / structured / vision 各自适用什么、
为什么降级到 vision 必须记进 `extraction_path`，见 `references/extraction-paths.md`。
它改变了这条证据能被信任到什么程度，不是实现细节。

**5 · 高风险内容要标出来。** 标识符、表格、代码、数字、看不清的连接线、缺端点的
分支、结构不一致的段落，一律进 `high_risk_content` 等人看。清单与判据见
`references/high-risk-content.md`。

**6 · 够不够只有人能说。** 系统报薄弱、冲突、缺口和不确定度，不下"证据充分"的结论。
`proceed_with_warnings` 是一个正当选择，不是妥协。怎么把这个决定摆到人面前，见
`references/sufficiency-decision.md`。

分类的判据（哪些算 fact、哪些算 guidance、边界怎么划）见
`references/fagc-classification.md`，里面用的是同一批日记账冲销材料。

## 模板

- `templates/evidence-manifest.yaml` —— 快照清单，每个字段带注释说明谁在核它
- `templates/fagc-register.yaml` —— 四类陈述卡、冲突组、未决事项

字段名照抄，不要改。脚本按名字取值，改一个名字等于那一项没写。

## 命令

```bash
python3 <pkg>/scripts/validate.py <工作区> --stage evidence     # 四项检查
python3 <pkg>/scripts/state.py decide <工作区> \
  --point evidence_sufficiency --verdict proceed_with_warnings --role DE \
  --rationale "软关账冲突未裁决，接受带 warning 继续"
```

裁决先写日志再改状态。日志只追加，改主意是再记一行，不是改那一行。

## 能读什么

| 目录 | 读 | 写 |
|---|---|---|
| `inputs/evidence/**` | ✅ 原始材料 | ❌ 任何脚本都不许往 inputs 写 |
| `inputs/charter/`、`define/project-charter.yaml` | ✅ 边界与目标，用来判断哪些材料在范围内 | ❌ |
| `define/evidence-snapshots/**` | ✅ | ✅ |
| `define/fagc-register.yaml` | ✅ | ✅ |
| `revisions/`、`reviews/`、`releases/` | ❌ | ❌ |
| 网络 | ✅ 仅 `register` 一步，且 URL 与访问日期必须同时记下 | — |

`confirm` 与 `sufficiency` 两步不许中途去捞新材料。人批的必须是他刚看过的那一份，
中途换了内容，签核就落在他没见过的东西上。

## 这个 Skill 不做什么

- **不裁决冲突。** 它把冲突摆出来、留主、写清后果。裁决是 `orchestrator decide` 记的人的决定。
- **不判断证据是否充分。** 只报事实：几条薄弱、几组冲突、哪几项缺口。
- **不建模。** 实体、关系、属性是 `interview` 的模型卡和 `generate` 的 candidate 的事。
  在这里写下"这应该是个实体"，就是把设计决定混进了证据层。
- **不做访谈。** 材料里没有的东西去问人，那是 `interview`。
- **不改 `inputs/`。** 纠正的结果写进快照，原件一个字节都不动。
- **不新建项目目录。** 没有工作区就停下来说明，让 `orchestrator` 建。
