---
name: package
description: 把已选定的候选发布渲染成一个可以注册使用的本体包——一个带 SKILL.md 的目录，里面是模型本身（实体、关系、事件、生命周期、约束）、术语对照表、能回答哪些问题、**不知道什么**、以及每条结论从哪条材料来。渲染是确定性的：同一版进去，同样的字节出来，所以装在别人机器上的那一份能被验证成还是这一版。用户说「打个包」「导出成 Skill」「让 Agent 能用这个本体」「注册进 Claude」「生成可安装的本体包」「这个模型怎么给别人用」「导出给下游」时就用它。凡是要把构建好的本体变成可消费形态的请求都归它；它不改模型，模型不对就回到 review 和 revise。
---

# package · 可注册的本体包

一份交付物：`exports/skill-package/<slug>/`。它是**渲染出来的**，不是写出来的——
所以这个 Skill 的活儿主要是确认渲染的对不对，以及把包里那些只有人能判断的部分讲清楚。

开工前读 `shared/conventions.md`、`shared/revision-model.md`。
`<ws>` 是工作区目录。

`<pkg>` 是包目录，判断标准是 `<pkg>/scripts/state.py` 存在。先试本 SKILL.md 所在目录（Enact Marketplace 安装后的布局），再试往上两级（Claude Code 插件布局）；都不是就在 skills 根目录下按 `*/scripts/state.py` 搜一遍，仍找不到停下报告，不要手写替代。`<pkg>/scripts/`、`<pkg>/shared/`、`<pkg>/tools/`、`<pkg>/knowledge/` 四个目录都在包里，下文相对路径以 `<pkg>` 为基准。

## 四步

| 步骤 | 类型 | 做什么 |
|---|---|---|
| `preflight` | C | 确认有 candidate release、已封存、评估跑过；见 `references/preflight.md` |
| `render` | S | `package.py` 渲染整个包 |
| `inspect` | H | 陪人看三样：description、boundaries、glossary；见 `references/inspect.md` |
| `install` | H | 交付方式：拷进 skills 目录，或按插件装；见 `references/installing.md` |

```bash
python3 <pkg>/scripts/package.py <ws>              # 渲染候选发布
python3 <pkg>/scripts/package.py <ws> --plugin     # 额外写插件与市场清单
python3 <pkg>/scripts/package.py <ws> --check      # 磁盘上那份还是这一版吗
python3 <pkg>/scripts/validate.py <ws> --gate package_ready
```

## 包里有什么

```
<slug>/
├── SKILL.md                        触发描述 + 怎么用这份本体
├── package.yaml                    来自哪一版、哪个发布、各类构件计数、未决数
├── ontology/
│   ├── glossary.md                 说法 → 对象。消费方第一个查的就是它
│   ├── entities.md                 定义、别名、反例、身份键、属性表
│   ├── relationships.md            方向、角色、基数、语义
│   ├── behaviour.md                事件；生命周期与允许的转换
│   ├── constraints.md              公理/约束/规则，以及政策与能力
│   ├── bundle.yaml                 机器可读的完整模型
│   └── graph.cypher                openCypher 投影
└── references/
    ├── competency-questions.md     验过的问题与结论
    ├── boundaries.md               **不知道什么**
    └── provenance.md               每个对象的来源编号与定位
```

## 三条硬规矩

**包必须来自被选定的那一版。** `package_from_candidate` 要求 source_revision 已封存
且标了 `candidate_release`。装它的人拿到的不该是一个没人选过的模型——
预览可以用 `--revision` 指定任意一版，但那种包不过门，也就不该发出去。

**包不带原文。** `skill_package_no_snippets` 会拿工作区里的 `exact_snippet`
去包里搜。出处只给来源编号和定位（流程 §12.4）。要看原句的人回工作区查。

**包必须说自己不知道什么。** `skill_package_bounded` 要求 `boundaries.md` 逐条列出
未决假设、未裁决的冲突、评估里 failed 和 unsupported 的问题。这一条不是形式：
一个不声明边界的模型，会让消费它的 Agent 把沉默当成否定，然后自信地答错。

## 不要手改包

`skill_package_current` 会重新渲染一遍逐字比对，包括「有渲染不出来的文件」这种情况。

手改一处，包就再也说不清它对应哪一版——而它存在的全部理由，就是别人能验证
手上这份还是那一版。要改内容，回到 `review` 和 `revise` 改模型，再重新渲染。

description 觉得不好、boundaries 想多说一句，也一样：改渲染器
（`tools/package/render.py`），不改产物。改渲染器影响的是以后所有项目，
所以那是一次值得留痕的改动。

## 能读什么

| 目录 | 读 | 写 |
|---|---|---|
| `revisions/**` | ✅ 候选发布那一版 | ❌ |
| `releases/**` | ✅ 选定记录、scope 声明 | ❌ |
| `evaluation/**` | ✅ 绑定该版本的结论 | ❌ |
| `define/**` | ✅ 章程的范围、FAGC 登记的未决项 | ❌ |
| `exports/skill-package/**` | ✅ | ✅ 只由 `package.py` 写 |

## 这个 Skill 不做什么

- **不改模型。** 包是模型的投影。投影不好看，先看是不是模型不好看。
- **不做提交。** `submit` 走的是平台治理那条路（PR）；这里走的是消费那条路。
  两条互不依赖：没提交也能打包，提交了也不会自动打包。
- **不装。** 拷贝和安装是人在他自己机器上的动作，命令给出来，人自己执行。
- **不替人判断 description 够不够准。** 触发描述决定别人的 Agent 会不会在
  该用的时候用它。渲染器给一版，人看一眼——这是 `inspect` 那一步存在的理由。

## 说话的规矩

1. 先说结论：包在哪、来自哪一版、几个未决。
2. 数字报出处：构件计数来自 `package.yaml`，不自己数。
3. 未决项要念出来，不要只说「有 4 处未决」。人装这个包是要用的，
   他得知道哪几处会答不了。
4. 不说 gate、validator、artifact；说机器门、检查项、交付物。
