# 同步到 Intelligence Space

- [1. 三道门：同步之前必须过](#1-三道门同步之前必须过)
- [2. 什么过界、什么不过界](#2-什么过界什么不过界)
- [3. 落点映射](#3-落点映射)
- [4. 写入协议](#4-写入协议)
- [5. 什么时候停下](#5-什么时候停下)

Project Intelligence Space 是**同时给人和 Agent 读的事实来源**——它通过 MCP 把内容作为 grounding 提供给其他 Agent。这一点决定了这里的成本不对称：

**漏同步一次**，代价是空间里的信息旧了一阵子，下次补上即可。
**同步错一次**，代价是往一个被当作事实的空间里注入了错误，而它会被别的 Agent 当作依据取走，且没人知道这条是机器写的。

所以默认答案偏保守：**拿不准就不写，把判断留给评审的人。**

还有一条边界要先说清楚：**本套件永远不合并**。对方仓库的写入模型是「提 proposal → 人在 `/proposals` 评审 → 人合并」，那次人工合并就是这条链上的 Gate。本 Skill 只负责把 proposal 提到位，合并与否不归它管，也不允许它替谁决定。

---

## 1. 三道门：同步之前必须过

三道全过才动手。任何一道不过，如实报告并停下——不要绕。

### 门 1：配置开着且填全了

读 `.sdlc/config.yaml` 的 `intelligence_space`：

- `enabled: false` 或整段缺失 → 说明"未启用同步"，正常结束。这不是失败。
- `enabled: true` 但 `repo_path` 或 `space` 为空 → 停下，请人补配置。**不要猜路径、不要猜 space**。

`repo_path` 用引号原样取用。真实路径里出现过尾随空格，凭印象重敲一遍会敲丢。

### 门 2：目标 space 真的存在

读 `<repo_path>/machine/index.json`，确认配置里的 slug 在这份目录里。不在就停下。

**不要创建 space。** 新建一个 space 要动 `lib/projects.ts`、`lib/types.ts`、`meta.ts`、`structure.ts`——对方 `AGENTS.md` 明确把这类改动列为结构性变更，要求单独提出而不是夹在内容 proposal 里做掉。没有目标空间时正确的动作是**告诉人**："这个项目在 Intelligence Space 里还没有对应空间，需要先由人建立。"

### 门 3：体裁相容 —— 最容易被忽略的一道

**REQUIRED：读 `<repo_path>/projects/<space>/authoring/AUTHORING-BRIEF.md`。** 它是对方的绑定契约，比这份文件优先。

每个 space 都有自己的叙事契约，且各不相同：有的是虚构组织的方法论指南，有的是某个产品的交付记录，有的是一次分析交付的过程档案。**把一个项目的交付事实写进体裁不符的空间，不是"信息多了一点"，是污染。**

有些 space 还在 `validation.yaml` 里配了 `bannedFragments`（实测存在的包括 `/Users/`、`PycharmProjects/` 这类本地路径），命中即 **error**，pre-commit 拒绝提交。但**别指望它兜底**——覆盖范围见 §2 末尾。

判据一句话：**这个 space 讲的是不是本项目的事？** 不是就停下，别硬塞。

---

## 2. 什么过界、什么不过界

这是本文件最重要的一节。分界线不是"保密"，是**层次**：

> **业务层过界，治理层不过界。**

Intelligence Space 记录的是「这个产品是什么、变成了什么、进展如何」。`.sdlc/` 记录的是「我们如何受控地做到的」。后者对本项目的审计是必需的，对空间的读者是噪音，而且大部分会撞上体裁红线。

Contract 已经替你分好了——`contract.yaml` 的 `role_views.业务负责人` 那一组正是可同步的子集：

| | 内容 | 过界？ |
|---|---|---|
| `outcomes` | 这次要达成的业务结果 | ✅ |
| `requirements` | 需求陈述 | ✅ |
| `criteria` | 验收标准（**转述成业务语言，不带层级编号**） | ✅ |
| `scope.included` / `excluded` | 做了什么、明确不做什么 | ✅ |
| `design.approach` / `design.impact` | 方案取向与影响面（产品级描述） | ✅ 需转述 |
| `release.strategy` | 发布方式与节奏 | ✅ |
| `design.decisions` | 决策与被否方案 | ✅ 需转述 |
| `boundary` | 可改 / 不可改路径 | ❌ 治理层 |
| `change-scope.yaml` | 文件级白名单 | ❌ 治理层 |
| `ledger.md` / `evidence.jsonl` | 执行台账与事件流 | ❌ 治理层 |
| `gates/*.yml` | 批准记录与批准人真名 | ❌ 治理层 + 真实人名 |
| WI 编号 / 本地路径 / commit hash | 本套件的内部坐标 | ❌ 见下 |

### 四条硬规则

**不写本地文件路径。** 写进注册集合会被 `bannedFragments` 判 error；写进 `changelog.yaml` 这类未注册集合**不会有任何报错**（见下），而路径对空间读者本来就毫无意义。

**不写本套件的内部标识符当作空间里的事实。** `WI-007`、`LP-003`、`AMD-002`、commit hash 在对方空间里不是可解析的 ID——对方的 ID 必须来自该 space 的 `ID-INVENTORY.md`。溯源写成**有日期的陈述**，不是路径：

✅ `source: {type: delivery-record, reference: "V1.1 delivery increment, 2026-08-24", extracted_at: 2026-08-24, confidence: high, review_status: draft}`
❌ `source: {reference: "<本地绝对路径>/.sdlc/work-items/WI-007/contract.yaml"}`

**不写真实的人名。** Gate 的 `approved_by` 是本项目的问责记录，不是空间里的角色。`author:` 与 `owner:` 一律取该 space 自己的角色表（每个 space 的 AUTHORING-BRIEF 里有），或 `config.yaml` 的 `intelligence_space.author`。

**不写密钥、不写被 `data_policy.evidence_redaction` 命中的内容。** 屏蔽规则在这里同样生效，而且更要紧：`.sdlc/` 至少还在本仓库内，Intelligence Space 是给别的 Agent 取用的。

### 自动检查兜不住这里 —— 实测

校验器是按**注册的 artifact 类型**展开的，而 `changelog.yaml` 与 `delivery-status.yaml` 在各 space 里都**不是**注册类型。实测结果：

| 把 `/Users/...` 这样的本地路径写进 | 结果 |
|---|---|
| `changelog.yaml`（未注册集合） | **pre-commit 放行，提交成功** |
| `decisions.yaml`（注册的 artifact 集合） | 判 error，提交被拒 |

也就是说，**同步最常写的两个文件，恰好落在自动检查最薄的地方**。上面四条硬规则在这里没有安全网，全靠写的人自己守——落笔前把整段重读一遍，比事后指望 validator 现实得多。

反过来，往注册集合（`decisions.yaml`、`risks.yaml`、`releases.yaml` 等）里写时检查是硬的：未登记的 ID、缺失的必填字段、命中的禁用片段都会当场判 error 并拒绝提交。

### 翻译，不是搬运

同一件事在两边的说法不一样。左边是 `.sdlc/` 里的原话，右边是能进空间的说法：

✅ `退款总额列已上线，导出报表新增该口径；夜间批处理的重算窗口相应延长。`
❌ `WI-007 Completed，criterion 1.2 / 2.1 通过，change-scope 覆盖 4 个源文件。`

判断自己有没有翻译到位，问一句：**这句话对一个从没听说过这套 SDLC 流程的人，是不是完整可懂？**

---

## 3. 落点映射

**只动 `data/` 下的集合。`content/` 的 Markdown 页面不主动改**——那是有体裁约束的成稿，改错的代价高、发现得晚。人明确要求时才改，且改前重读 AUTHORING-BRIEF。

先读 `<repo_path>/machine/<space>/manifest.json` 拿到该 space **实际注册**的类型、前缀与数据文件，按它落点。**不要凭这张表硬编码文件名**——不同 space 的集合不一样。

| 要同步的东西 | 典型落点 | 怎么填 |
|---|---|---|
| 本次改了什么 | `changelog.yaml` | 追加一条 `{date, change, author, related}`，**新的在最前**。`change` 是业务语言的一段话，`related` 只填该 space 已存在的 ID |
| 整体进度 | `delivery-status.yaml` | 更新 `as_of`、`summary`，以及**这次真的动了**的那条 `workstreams` 的 `status`/`percent`/`note` |
| 发布 | `releases.yaml`（存在时） | 更新对应 release 的 `status` 与 `fields`；新 release 需要新 ID，见 §4 |
| 学到了什么 | 该 space 的经验类集合（如 `decisions.yaml` / `checklists.yaml` / `risks.yaml`） | 只同步 `status: observed` 的**已发布** LP。仍在 observe/classify/validate 的是假设，**不进事实空间** |

### 三条填写纪律

**`percent` 改动必须指得到具体交付。** 说不出这次完成了哪件事就让它推进了几个点，就不要动这个数字。进度数字是最容易被善意夸大的字段，而它会被当作事实读走。

**字段标签逐字照抄。** 对方的视图组件按 `field:<Name>` 精确匹配读取——**标签写错不会报错，只会渲染出一列空白**。可用标签在 AUTHORING-BRIEF §4，逐字复制，不要自己改写措辞。

**分组字段只能取封闭词表里的值。** 若干集合按某个字段分组显示，取值必须来自一个小的固定集合且拼写完全一致，否则表格会碎成一堆单行分组。同样在 AUTHORING-BRIEF 里。

---

## 4. 写入协议

固定六步。**不跳步、不改顺序。**

```bash
cd "<repo_path>"

# 1. 建 proposal 分支与 worktree（会一并链好 node_modules，pre-commit 才跑得起来）
npm run proposal:new -- <short-name>
cd ../intelligence-space-proposals/<short-name>

# 2. 需要新 artifact ID 时，先登记再使用。ID 永久且不复用
npm run id:next -- <space> <PREFIX> --claim "<标题>"

# 3. 改 data/ 下的文件

# 4. 自检（pre-commit 也会跑，这里先跑一遍好定位问题）
npm run validate -- <space>

# 5. 提交。pre-commit 会重生成 machine/ 并跑全量校验，失败即拒绝并回滚
git add -A && git commit -m "feat(<space>): <一句话>"

# 6. 停。告诉人去 /proposals 评审
```

### 关于这六步的几件事

**在 worktree 里改，绝不碰主 checkout。** 站点是从主 checkout 渲染的，切它的分支会当场改变读者看到的内容。

**永远不合并、不推 main、不删别人的分支。** `/proposals` 页面的合并接口是给人用的。

**不绕过 pre-commit。** 它重生成 `machine/` 并跑全量校验，失败就拒绝提交并把导出回滚干净——这是保证站点与机器契约不脱节的唯一强制点，对方文档写明「Do not work around it」。**用跳过钩子的提交参数在这里等同于越界写入**，红线 3 一样管得着。

**不手改 `machine/` 下的任何文件。** 那是生成物，pre-commit 会重写。

**提交失败就如实报告。** 常见原因：ID 没登记、必填字段标签写错、命中 banned fragment、Node 版本不够（需要 22.18+）。把 validator 的原文报出来，**不要为了让它通过而删检查、改 `validation.yaml` 的 severity，或改用跳过钩子的提交方式**——那是把对方的治理拆掉来让自己的任务通过。改 `validation.yaml` 属于对方的规则变更，不在一次内容同步的范围内。

**一次同步一件事。** 一个 WI 一个 proposal。攒成一个大 proposal 会让评审的人无法逐条判断，也让被拒时无法只退回其中一条。

### 收尾

proposal 提交成功后，向本 WI 的 `evidence.jsonl` 追加：

```json
{"ts":"...","actor":"sdlc-learn","action":"intelligence_synced","input_refs":["contract.yaml"],"output_refs":["<space>@proposal/<name>@<hash>"],"result":"ok","notes":"已提 proposal，待人工评审合并"}
```

然后明确告诉人：**分支名、提了什么、去哪评审**。同步没有"完成"状态——本套件这一侧到提出 proposal 为止。

---

## 5. 什么时候停下

以下任何一条出现，停下并报告，不要自行变通：

- 目标 space 不存在，或本项目在空间里没有归属
- 目标 space 的体裁与本项目的交付事实不符
- 要写的内容里去不掉本地路径、WI 编号或真实人名
- 需要的 artifact ID 无法通过 `id:next --claim` 登记
- pre-commit 校验失败，且修复方式需要改对方的校验规则或 severity
- 需要动 `meta.ts` / `structure.ts` / `lib/projects.ts`（结构性变更）
- 需要改 `content/` 下的成稿页面而人没有明确要求
- 进度数字要往前推，但说不出这次具体完成了什么

**这些不是失败，是这条链正常的停止点。** 停下来报告一条"需要人决定"，比提一个会被打回、或更糟——会被合并进去的错误 proposal 便宜得多。
