# 人的决策点

来自流程 §15.2（人机决策权）、§6、§10.3。机器可读版本在
`shared/manifests/decision-points.yaml`，`state.py decide` 按它校验。

## 两种门，不要混

**机器门**（`ready_for_review`、`submission_ready`）由 validators 判定，阻断流程，
不需要人批准。生成与修订**无人值守运行**——流程 §3 "Automate until a real
governance boundary"。

**人的决策点**记录一个人的判断。除了 `create_pull_request`，它们都不是审批门：
它们记录的是"这件事由人负责"，而不是"这件事要等人放行"。

不要把每一步都做成审批。一个到处要点确认的流程，人会用点"下一步"的方式通过它，
真正需要他判断的那两三个地方就淹没了。

## 八个决策点

| id | 谁 | 裁决 | 记录什么 |
|---|---|---|---|
| `scope_and_boundary` | DE/OO | approve · rework | 目标、边界、负责人定了 |
| `evidence_sufficiency` | DE | sufficient · proceed_with_warnings · insufficient | 证据够不够开始生成 |
| `semantic_review` | DE/OE/PO | accept_revision · request_changes | 这版语义对不对 |
| `competency_questions` | DE/PO | approve · rework | 这组问题是不是你要问的 |
| `candidate_selection` | OE/OO | select · defer | 哪个 revision 作为候选发布 |
| `access_scope_review` | OE/OO/GA | approve · rework | scope 覆盖、重叠、跨引用看过了 |
| `patch_or_version` | OE/OO | patch · version | 这次发布的兼容性性质 |
| `create_pull_request` | GA/OO | approve · reject | **唯一强制人工批准** |

不由本包记录的两件事：**阶段是否成功**（validators 判定，见 `checks.yaml`）；
**访问授权**（principal assignment 与运行时放行属于外部平台，本包只声明资源边界）。

## 怎么呈现一个决策点

按这个顺序，四段：

1. **在定什么** —— 决策点的问题原文。
2. **依据** —— 产物路径，加上一份人能据以判断的摘要：按状态计数、这次变了什么、
   自上次以来新增了什么。数字要报出处。
3. **还没定的** —— 每一条单独列出来。这是决策点的真正内容。
4. **选项与后果** —— 每个裁决词，以及选它之后会发生什么、什么会被冻结。

然后请他裁决。**有未决项时不要把 approve 作为默认推荐**，先把未决项解决掉。

## Patch/Version 是唯一不给推荐的决策点

其他决策点给"候选 + 推荐 + 后果"。这一个只给证据：semantic diff、
authorization-impacting 变更清单、migration 材料。

流程 §12.2 与 §19.2 明确写着 Ontologizer **不自动判断 semantic impact，
也不自动选择 Patch/Version**。给出推荐等于替人做了这个判断——人会点同意，
而这个判断的后果（下游消费者要不要改）只有他知道。

## 裁决怎么落

```bash
python3 <pkg>/scripts/state.py decide <ws> \
  --point evidence_sufficiency --verdict proceed_with_warnings --role DE \
  --rationale "软关账冲突未裁决，接受带 warning 继续"
```

- 只接受 `decision-points.yaml` 里的 id 与该 id 的合法裁决词。
- 裁决是"关门"类型时（`closing`），先跑它的 `requires_checks` 与 `requires_gates`，
  不过就拒绝，并列出没过的项。确实要在有未决项的情况下记录，用 `--skip-checks`，
  这样"明知有问题仍然决定继续"这件事本身留在日志里。
- 日志只追加。改主意不是改那一行，是再记一行。

## 签核之后冻结什么

`freezes` 列出的产物在这次裁决之后不应再改。改动不是禁止的，但要走一次显式重开：
再记一条裁决说明为什么重开，然后往前重跑。

没有任何脚本能从文件本身分辨"经批准的修改"和"偷偷的修改"。能检查的是**可见性**：
`state.py audit` 会重算全部检查，`revision_sealed_immutable` 会报出被改过的封存产物。
读那些报告——它们是一次未经批准的改动唯一会留下的信号。
