---
name: orchestrator
description: 管理一个 Ontology 构建项目的状态、历史与人的决策记录。用于「项目到哪了」「下一步做什么」「还差什么」「哪些版本可以审」「把 r0002 恢复成 HEAD」「这个项目还健康吗」「把这个决定记一下」「这件事该谁拍板」「新建一个本体项目」「我本机有哪些项目」「重算一遍所有检查」「审计一下」这类请求。它对着磁盘推导当前阶段、把人的裁决写进只追加的决策日志、重算全部检查项、管理版本历史与 restore，并且是唯一能新建项目的 Skill。凡是涉及本体项目的进度、历史、决策记录、审计、新建与列出项目的请求都用它；它不生成、不审阅、不修改任何本体交付物——那些交给对应阶段的 Skill。
---

# orchestrator · 状态、历史与决策记录

这个 Skill 只往 `history/` 下写东西：一行决策日志、一条运行记录。别的什么都不产。
它回答"现在在哪、下一步做什么、谁该拍板、哪里出问题了"，答案全部来自脚本对磁盘的重算。

开工前读 `shared/conventions.md`、`shared/decision-points.md`、`shared/revision-model.md`。
`<ws>` 是工作区目录。

`<pkg>` 是包目录，判断标准是 `<pkg>/scripts/state.py` 存在。先试本 SKILL.md 所在目录（Enact Marketplace 安装后的布局），再试往上两级（Claude Code 插件布局）；都不是就在 skills 根目录下按 `*/scripts/state.py` 搜一遍，仍找不到停下报告，不要手写替代。`<pkg>/scripts/`、`<pkg>/shared/`、`<pkg>/tools/`、`<pkg>/knowledge/` 四个目录都在包里，下文相对路径以 `<pkg>` 为基准。

## 八个模式

| 模式 | 什么时候用 | 怎么做 |
|---|---|---|
| `status` | "到哪了""还差什么" | 见 `references/status.md`。输出顺序固定，不许重排 |
| `next` | "下一步做什么" | 跑同一条 status，只把最后的「下一步」和「等你决定」讲清楚 |
| `history` | "这个项目都发生过什么" | 念决策日志 + 版本列表，见 `references/status.md` |
| `restore` | "把 r0002 恢复回来" | 见 `references/restore.md`。向前复制，旧版本一个字节都不动 |
| `decide` | "这个我定了""记一下" | 见 `references/decide.md`。四段呈现 → 人裁决 → 写日志 |
| `audit` | "这个项目还可信吗""提交前查一遍" | 见 `references/audit.md`。重算全部检查项 |
| `init` | "新建一个项目" | 只有这个 Skill 能建。见下 |
| `list` | "我本机有哪些项目" | 列注册过的项目；`--scan` 找没注册的 |

在 Enact 工作区里当编排 Agent 运行时（环境里有 `ENACT_TASK_ID` 或 `ENACT_AGENT_ID`），
派工、决策点、验收和父 issue 状态另有一套做法，见 `references/enact.md`。

```bash
python3 <pkg>/scripts/state.py status <ws>          # 阶段 · 版本 · 等谁决定 · 问题 · 下一步
python3 <pkg>/scripts/state.py problems <ws>        # 只要问题这一段
python3 <pkg>/scripts/state.py points               # 八个决策点、谁拍板、合法裁决词
python3 <pkg>/scripts/state.py list [--scan <目录>]
python3 <pkg>/scripts/state.py audit <ws>
python3 <pkg>/scripts/revision.py head <ws>         # 当前 HEAD 是哪一版
```

## init：只有这里能新建项目

```bash
python3 <pkg>/scripts/state.py init <目录> \
  --slug journal-reversal --domain "总账 · 日记账冲销" \
  --goal "支持财务助手回答一条分录能不能冲销" \
  --domain-owner "..." --ontology-owner "..." --process-owner "..."
```

它建目录树、写项目记录、开一个空的决策日志，并把项目登记到本机清单。
`ontologizer.yaml` 已经存在时它拒绝执行——重开一个已有项目不是重新 init，是接着往下做。

别的 Skill 需要一个工作区时，把请求转到这里，不要自己 `mkdir`。
一个自己造目录的 Skill 会造出没有决策日志、没有 pins 的半个项目，而这一点要等到几周后
有人问"这个决定谁拍的"时才会暴露。

init 之后立刻交棒给 `initiate` 写项目章程——目录建好不等于范围框好。

## status 的输出顺序是固定的

1. **推导出的阶段**，以及它为什么是这个阶段。
2. **HEAD 是哪一版、它的机器门过没过**；没过就点名是哪几项没过。
3. **等你决定**：逐条写清决策点名字和该谁拍板（`shared/manifests/decision-points.yaml` 里的 accountable）。
4. **问题**：每一行都照抄 problems 的输出，不改写、不合并、不凭印象补充。

这个顺序不是审美。先说阶段是因为人问的就是这个；把"等你决定"放在"问题"前面，
是因为人能立刻处理的事排在他只能知悉的事前面。而问题必须逐字照抄——
一旦你开始转述，"trace 断链"就会变成"看起来有点小问题"，然后没人去看它。

没有问题就说没有问题。`problems` 空着是结论，不是"暂时没发现"。

## 记决策：先写日志，再谈状态

呈现按 `shared/decision-points.md` 的四段来（在定什么 / 依据 / 还没定的 / 选项与后果），
然后落一行：

```bash
python3 <pkg>/scripts/state.py decide <ws> \
  --point evidence_sufficiency --verdict proceed_with_warnings --role DE \
  --rationale "软关账冲突未裁决，接受带 warning 继续"
```

- 决策点 id 与裁决词只能取 `shared/manifests/decision-points.yaml` 里有的。脚本会拒绝拼错的，
  因为日志不可回改，一个笔误会永久留在那里，日后表现为"这件事没人拍过板"。
- 裁决是关门类型时脚本先跑它要求的检查项，不过就拒绝并列出没过的项。
  确实要在有未决项的情况下记录，用 `--skip-checks`——这样"明知有问题仍然继续"本身留在日志里。
- 角色不在推荐名单里要 `--force-role`。用户说"就我一个人"也照记角色，写他当时的身份。
- 改主意不是改那一行，是再记一行。

`patch_or_version` 只给证据不给推荐，理由见 `references/decide.md`。

## 三件不许做

**不许替人拍板。** 八个决策点全是人的判断。你可以把选项和后果摆齐，不能替他选，
也不能因为"看起来显然"就默认 approve。

**机器门没过时不许绕。** `decide` 或 `seal` 报出某项检查未通过，那是交付物的问题，
不是记录的问题。把没过的检查项原样报给拥有那份交付物的 Skill（生成类的给 `generate`、
修订类的给 `revise`、证据类的给 `evidence`、章程类的给 `initiate`），由它去修。
用 `--skip-checks` 掩盖、手改文件里的记录值、或者"先记上回头再说"，都是在伪造审计线索。

**不许改封存的版本。** 封存之后目录只读。要改就开新版本。

## 这个 Skill 不做什么

- 不写任何本体交付物：章程、证据登记、四层文件、审阅记录、发布包，一个都不碰。
- 不判断语义对错，不判断证据够不够，不选 Patch 还是 Version——它只记录人的判断。
- 不宣布阶段成功。阶段是否成功由检查项判定，不由这里说了算。
- 不做对象级的追溯问答。"这个关系哪来的"归 `trace`。
