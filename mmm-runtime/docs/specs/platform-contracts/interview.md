# 契约卡：访谈

**阶段：** 业务理解
**平台出处：** 1.3（起草提纲）· 1.3b（AI 预答）· 1.4a（收纪要/录音）· 1.4b（ASR 转写）· 1.4（消化纪要 → 答案 + 因子提案）
· 设计文档编号 1.3 Interview + **1.32 访谈框架及纪要** + **1.33 纪要总结框架**——1.32/1.33 在代码里不是任务，见「备注 1」
· **平台 B-16 已把"提纲"与"纪要"合并为单一 `Interview` 交付物**（`08-product-architecture-v2.md` §10.1.15）
· `backend/app/agents/business.py` `_build_targets` / `_data_questions` / `_make_target` / `_interview_sheets` / `draft_interview` / `pre_answer` / `_digest_transcript` / `_merge_minutes_digests` / `writeback_minutes` / `transcribe_audio`
· `backend/app/domain/models.py` `InterviewQuestion` / `InterviewCategory` / `Proposal` / `DiffLine` / `Insight`
· `docs/agent-design/01-business-agent.md` §3 Step 4 · `07-assumptions-log.md` A4（纪要框架是平台方假设）· `09-business-understanding-flow.md` §4 步骤 3
· 实盘 `Assets/Interview Plan & Question.xlsx`（14 sheet / 94 题）· `reference/01.商业智能体/…访谈框架及纪要_1.32/`（提纲 + 11 份纪要 .docx）· `reference/Gatorade …MMM-Interview-Outline-20260630-1501.xlsx`（平台真实导出）
**产出 Skill：** interview

---

## 输入

| 来源 | 内容 | 类型 |
|---|---|---|
| 上游交付物 | **因子树（已确认）** —— 数据类问题**逐条从 accepted/baseline 的叶子生成**；每题挂它探的那一行 | 交付物（必须先过 `d-1.21`） |
| 上游交付物 | **项目档案** —— 品牌/品类/时间窗，供 AI 预答与提问用词 | 交付物 |
| 上游（internal） | **行业知识包** —— 分层访谈的问题框架 | internal 输入 |
| 上游（internal） | **材料索引** + `inputs/industry-reference/**` —— AI 预答的依据来源 | internal 输入 |
| 知识库 | 行业**访谈提纲模板**（按层级分组的问题库）；饮料包内置 94 题 | Knowledge（平台 `KnowledgeTemplate(kind="interview")`） |
| 人提供 | **访谈纪要或录音** → `inputs/interview-minutes/`（平台类目 `interview_minutes`） | **internal 输入**（intake 关卡 `1.4a`） |

**平台的知识库模板种子（`template_seed.py`）：** 从 `Assets/Interview Plan & Question.xlsx`
解析出 `InterviewQuestion{category, role, question}`。`_category_for(sheet_title)` 按 sheet 名归类：
含 `leadership` → `Leadership`；以 `management` 开头 → `Management`；以 `operation` 开头 → `Operation`；
其余（`Interview Plan` / `Interview Invitaion`）忽略。`role` 直接取 sheet 名。

---

## 构建过程

| # | 步骤 | Class | 执行者 | 说明 |
|---|---|---|---|---|
| 0 | 澄清 | C | Skill | 见下节 |
| 1 | 从模板取业务类问题，按层级 × 团队分组 | **M** | Tool | `_clean_team()` 把 sheet 名洗成团队名：剥掉前缀 `^(Operation Team-\|Management Team-\|Leadership Team-)`，`Mkt` → `Marketing`。每组一个 target，`id = "tgt_" + sha1(f"{layer}\|{team}")[:10]` |
| 2 | **从因子树派生数据类问题** | **M** | 确定性 | 对每个 `status ∈ {baseline, accepted}` 的叶子，按路径去重，生成**固定四问**（见产出格式 C）。这一步没有 LLM |
| 3 | 补齐 target 元数据 | M | 确定性 | `durationMin` 查表：leadership/management = 60，operations/data = 90 |
| 4 | 渲染提纲 | M | App | Overview 表 + 每个 target 一张表 |
| 5 | **AI 逐题预答** | **C** | Skill | 每个业务 target 一次并发调用；数据类 target **不调 LLM，用固定模板句**。产出：初步回答 + 置信度 + 来源标签 |
| 6 | 收纪要或录音 | **H** | 人 | intake 关卡。`requiresUpload: True` |
| 7 | 录音转写 | **M** | Tool | 平台 `1.4b` ASR，逐个文件转成 `{stem}.transcript.txt` 写回同类目；`asr_status ∈ {transcribing, done, error}`，音频 ≤25 MB |
| 8 | 逐份纪要消化 | **C** | Skill | **一份纪要一次调用**（不是一次吃全部），三件事一起做：答案 + 因子改动 + 洞察。超时 300 秒 |
| 9 | 合并多份纪要的结果 | **M** | 确定性 | 答案按题号**先到先得**；因子改动按 `(op,l1,l2,l3,l4,indicator)` 去重；洞察上限 3 条 |
| 10 | 把最终答案写回提纲的列 | M | 确定性 | 平台是往同一张表加两列 `访谈回答` / `回答来源`，**不另开一张表** |
| 11 | 产出因子改动提案 | **C** | Skill | 每条必须带**逐字原话**。提案是文件，不写树 |
| 12 | 交由 factor-tree 应用 | **H** | Orchestration | 关卡 `d-1.4`，由 **factor-tree** skill 的 `apply-proposals` 承接，不由 interview 做 |

**Class 分布（平台 08 §2.2）：** `1.32 访谈提纲 | 分层提纲生成 | A`；
`1.33 纪要总结 | 框架化总结（假设 A4）｜ 结构化抽取（因子 diff/口径/KBQ 候选）| A ｜ C`。
代码打标：1.3 = A，1.3b = C，1.4a = H，1.4b = M，1.4 = C，1.4d = H。

---

## 澄清点

### 澄清 1 · 访谈对象名单与档期

- **读到：** 因子树里的 `team` / `owner` 字段（如果 1.21d 时填了）、材料索引里的组织信息。
- **为什么必须问：** target 数量决定问题总量和提纲的形状。而且**客户组织与模板的层级映射经常对不上**——有的客户没有 SIA，有的把 Trade Marketing 并在 Sales 里。
- **候选：**
  - **A. 按模板的层级结构全量出（推荐）** —— 三层 × 各团队，客户自己删不需要的。
  - **B. 只对客户点名的团队出** —— 提纲短，但漏掉的层级会在收数时变成"没人知道这个指标在哪"。
- **必须单独确认：** 有没有**独立的数据团队 / IT 团队**。平台把数据类问题全部堆在一个 `Data Team` target 上（实盘 168 题），如果客户的数据分散在各业务团队，这个 target 要拆。
- **后果：** 写进 Overview 表的 `Team` / `Participants` / `Duration`。

### 澄清 2 · 数据类问题问到多细

- **读到：** 因子树 accepted 行数。
- **为什么必须问：** 平台对**每个叶子**问四题。46 个 L4 × 4 = 184 题，实盘 Gatorade 是 168 题。**一场 90 分钟的会不可能问完 168 题。**
- **候选：**
  - **A. 每个 L4 四题，全量出（平台做法）** —— 提纲完整，但要按团队拆成多场，且必须标出重点题。
  - **B. 只对"AI 预答置信度低"的因子出全四题，高置信的合并成一题确认**（推荐）—— 这正是 1.3b 预答步骤存在的理由：**把访谈时间花在缺口和分歧上**。
  - **C. 按 L3 而不是 L4 出题** —— 题量降到 17×4，但会丢掉 L4 级的口径差异。
- **后果：** 决定 `Question Count` 和访谈场次。

### 澄清 3 · 纪要以什么形式回来

- **读到：** `inputs/interview-minutes/` 里有什么。
- **候选：** A. 文字纪要（推荐——直接可读）· B. 逐字转录稿（信息全但噪声大，要先归纳）· C. 录音——**runtime 不做转写**（见备注 4），必须先由人转成文字。
- **后果：** C 选项下这一步会卡住，必须在开工前说清楚。

### 澄清 4 · 一场访谈没覆盖到的问题怎么算

- **为什么必须问：** 这是"空是一个发现"的具体落点。
- **候选：** A. 明确列出未覆盖题 + 为什么 + 下一步（推荐）· B. 不提——**这会让因子树看起来被访谈验证过，其实没有**。
- **后果：** 强制 `## Not covered` / `## Unanswered` 段落。平台的 prompt 也是这个语义：*"Skip questions it does not cover."*

---

## 产出格式

### A. 平台交付物的表结构（`_interview_sheets`，单一 artifact `a-interview`）

**Sheet 1 · `Overview`** —— 列（逐字）：

```python
_OVERVIEW_COLUMNS = ["Target ID", "Layer", "Layer (中文)", "Team", "Participants",
                     "Proposed Schedule", "Duration (min)", "Status", "Question Count"]
```

实盘（`reference/Gatorade …MMM-Interview-Outline-20260630-1501.xlsx`）：

| Target ID | Layer | Layer (中文) | Team | Participants | Proposed Schedule | Duration (min) | Status | Question Count |
|---|---|---|---|---|---|---|---|---|
| tgt_3f3f85127a | leadership | 高层 | Brand Leadership | | | 60 | pending | 8 |
| tgt_87c0bb1912 | management | 管理层 | Sales | | | 60 | pending | 8 |
| tgt_084d0e5a11 | management | 管理层 | Finance | | | 60 | pending | 6 |
| tgt_017152dbb4 | management | 管理层 | Marketing | | | 60 | pending | 5 |
| tgt_21b20c27a2 | operations | 执行层 | Marketing-Media | | | 90 | pending | 4 |
| tgt_4bd21b3873 | operations | 执行层 | Marketing-Activation | | | 90 | pending | 4 |
| tgt_9daaa271c6 | operations | 执行层 | Sales-KA | | | 90 | pending | 4 |
| tgt_48f2a016a0 | operations | 执行层 | Sales-Trade Marketing | | | 90 | pending | 3 |
| tgt_b9ce085a6f | operations | 执行层 | SIA | | | 90 | pending | 4 |
| **tgt_3617b93cc5** | **data** | **数据团队** | **Data Team** | | | 90 | pending | **168** |

**Sheet 2..N · 每个 target 一张**，tab 名 `f"{layerZh}·{team}"`（紧凑点号，Excel 友好），
表上方有两行横幅（`preRows`）：

```
高层 · Brand Leadership
Layer: leadership  |  Duration: 60 min  |  Status: pending  |  Participants: —
（空行）
```

列（逐字）：

```python
_IV_COLUMNS = ["#", "Q Type", "Question", "Related Factor Path", "AI Pre-Answer",
               "访谈回答", "回答来源", "Confidence", "Sources"]
```

> 一张表同时承载**提纲、AI 预答、访谈答案**三个阶段——这就是 B-16 把"提纲"与"纪要"
> 合并成单一交付物的物理形态：**同一批行，逐阶段往右长列。**

数据类 target 的一行实例：

| # | Q Type | Question | Related Factor Path | AI Pre-Answer | 访谈回答 | 回答来源 | Confidence | Sources |
|---|---|---|---|---|---|---|---|---|
| 1 | data | `[消费者需求驱动 › 品牌广告/内容种草 › 品牌媒体 › Digital Display] 针对该 L4 因子，您所在团队是否能提供以下指标？…` | `消费者需求驱动 / 品牌广告/内容种草 / 品牌媒体 / Digital Display` | 【暂无足够信息】当前材料只明确提到抖音 Ads 可提供周度花费、曝光、互动… | | | low | `ai_recommendation:SOW summary; ai_recommendation:a-scope` |

### B. 层级枚举（`business.py`，逐字）

```python
_LAYER_BY_CATEGORY = {"Leadership": "leadership", "Management": "management", "Operation": "operations"}
_LAYER_ZH   = {"leadership": "高层", "management": "管理层", "operations": "执行层", "data": "数据团队"}
_LAYER_DURATION = {"leadership": 60, "management": 60, "operations": 90, "data": 90}
```

与实盘 `Interview Plan` sheet 的 `Duration` 列完全一致（Layer 1/2 = `60mins`，Layer 3 = `90mins`）。
`data` 层是**平台合成出来的**——实盘没有这一层，它是从因子树派生的。

设计文档（`01 §3 Step 4`）的层级职责表：

| 层级 | 对象 | 问什么 | 时长 |
|---|---|---|---|
| Layer 1 | Leadership（GM） | 痛点与业务战略、投资策略 3 年转变、KBQ 期望、分析范围 | 60min |
| Layer 2 | Management（Mkt/Sales/Finance） | 业务细节、KBQ 下钻、数据可行性 high-level | 60min |
| Layer 3 | Operation（Brand/Media/Activation/EC/KA/TradeMkt/Execution/SIA/O2O/RTM） | 数据明细：覆盖、颗粒度、指标定义、连续性、获取方式 | 90min |

实盘 `KBQs` sheet 的一句话总结（逐字）：
> 给 C level 和高层问痛点及业务，中层问业务细节，底层问数据

### C. 数据类问题的固定四问（`_DATA_SUBQUESTIONS`，逐字，M 类生成）

```python
_DATA_SUBQUESTIONS = [
    "该指标当前是否可获得？主要来源系统 / 供应商是什么？",
    "可提供的最小时间颗粒度与可回溯的历史区间是什么（周度 / 月度，起止时间）？",
    "可按哪些业务维度拆分（品牌 / 区域 / 渠道 / 平台），各维度的颗粒度如何？",
    "数据口径是否已与业务现实对齐？是否存在已知缺口、口径调整或可比性问题？",
]
```

生成规则（`_data_questions`）：

```python
for r in ft.rows:
    if r.status not in ("baseline", "accepted"):
        continue
    parts = [p for p in (r.l1, r.l2, r.l3, r.l4) if p]
    if r.indicator:
        parts.append(r.indicator)
    path_slash = " / ".join(parts)          # → Related Factor Path 列
    if not path_slash or path_slash in seen:
        continue
    path_arrow = " › ".join(parts)          # → 题干前缀 [a › b › c]
    for subq in _DATA_SUBQUESTIONS:
        out.append({"qType": "data", "question": f"[{path_arrow}] {subq}",
                    "relatedFactorPath": path_slash, "preAnswer": "",
                    "confidence": "low", "sources": []})
```

**这四问就是五项数据准入标准的提问形态**（完整性 / 颗粒度 / 一致性 / 准确性），
与因子树宽表最后五列一一对应。

### D. 实盘提纲的问题分类标签（`Assets/Interview Plan & Question.xlsx`，中英成对）

```
[业务现状理解]        ↔ [Business Download]
[关键业务问题与期望]  ↔ [KBQs & Expectations]
[分析颗粒度与范围]    ↔ [Granularity & Scope]     ← Layer 1 用词
[数据颗粒度与范围]    ↔ [Granularity & Scope]     ← Layer 2/3 用词
```

**平台代码把这套三段式标签压成了两个值：`qType ∈ {"business", "data"}`。**
实盘 Layer 1（`Brand Leadership`）8 题的分布：Q1–Q4 `[业务现状理解]`，Q5–Q7
`[关键业务问题与期望]`，Q8 `[分析颗粒度与范围]`。

实盘每张问题表的固定骨架（`preRows` 的原型）：

```
R2  Danone MMM POC Project Interview - Layer 1 [To Leadership]              [Back]
R3  Expected Participants：Miranda GAO
R4  Date：
R6  访谈目的/Objective
R7+  编号目标，中文一行、英文一行
R12 在访谈开始前，我们希望先就以下两方面作简要说明：
R13-16  两段前置说明（费用类别梳理 / 热力图分析法），中英各一行
R18 问题列表/Questions
R19+ 编号问题，中文一行、英文一行
```

（`Participants：` / `Date：` 用**全角冒号**；`Back` 是回目录的超链接。）

### E. AI 预答的字段契约（`pre_answer`）

**业务类**（每个 target 一次并发 LLM 调用），prompt 关键约束逐字：

```
Before the interviews, draft a PRELIMINARY answer to each question below — explicitly a
hypothesis to validate, not fact. If the provided context lacks the information needed,
you MUST begin that answer with the exact prefix 【暂无足够信息】 and state what is missing.
Keep each answer to 1-3 sentences. For each question return: n (1-based), answer,
confidence (low|medium|high), and sources — a list chosen from these candidate labels: [...]
Return JSON: {"answers":[{"n":int,"answer":str,"confidence":str,"sources":[str]}]}
```

- **`【暂无足够信息】` 是强制前缀**，不是措辞建议。材料不支撑就必须这样开头并说明缺什么。
  这是平台版的"拿不准就说不知道，别用模糊措辞蒙混"。
- 置信度归一：`_norm_confidence` —— 不在 `{low, medium, high}` 里的一律落 `low`。
- 来源标签格式：`f"ai_recommendation:{label}"`，候选标签来自
  `_source_labels(st)` = `["SOW summary"] + 已存在的 a-scope / a-factor-tree`。
- 缺失兜底：`"【暂无足够信息】现有材料不足以预判该问题，待访谈确认。"`

**数据类（不调 LLM，固定模板句）：**

```python
q["preAnswer"] = ("【暂无足够信息】该数据点的可获得性、来源、颗粒度与口径需由数据团队在访谈中确认；"
                  "现有材料尚未覆盖该因子的完整数据规格。")
q["confidence"] = "low"
```

### F. 纪要消化的字段契约（`_digest_transcript`，一份纪要一次调用）

```
Return JSON: {
  "answers":[{"n":int,"answer":str,"source":str}],
  "factor_changes":[{"op":"add|modify","l1":str,"l2":str,"l3":str,"l4":str,
                     "indicator":str,"granularity":str,"rationale":str,"quote":str}],
  "insights":[{"kind":"connection|gap|conflict|reference","title":str,
               "finding":str,"confidence":0-1}]
}
```

三条硬约束（prompt 逐字）：
- *"Using ONLY this transcript"* —— 一次只看一份，避免串味；
- *"Skip questions it does not cover."* —— **不覆盖就跳过，不许编**；
- *"each traced to a verbatim quote"* —— 每条因子改动必须带逐字原话。

合并规则（`_merge_minutes_digests`）：

| 对象 | 规则 |
|---|---|
| 答案 | 按题号 `n` **先到先得**（`if n in answers: continue`）——先处理的纪要赢 |
| 因子改动 | 按 `(op, l1, l2, l3, l4, indicator)` 六元组去重 |
| 洞察 | 上限 `_MAX_INSIGHTS = 3` |

其他上限：业务题送进 prompt 的上限 `biz[:28]`；LLM 超时 `_MINUTES_LLM_TIMEOUT = 300.0`
（注释说明：推理模型跑因子改动那一路常要 ~180 秒，默认 120 秒会**静默把回写清零**）。
单份纪要失败返回 `{}` 并跳过，**只损失它自己**。

**改动落成的因子行：**

```python
FactorRow(
    id=f"ft-iv-{st.tick}-{i}",
    l1=…, l2=…, l3=…, l4=…, indicator=…,
    dimension=_default_dimension(st),
    source="interview", status="proposed",
    rationale=f"{op} · {rationale} · granularity: {granularity or '—'}",
    evidence=str(quote)[:200])
```
落之前先按五元组与现有行去重，再过一遍 `atomic_factor_rows`。

### G. runtime 载体（五个文件，`artifacts/s1/interview/`）

> runtime 把平台的"一张表逐阶段长列"拆成了**五个文件**。这不是偏离——文本形态下，
> 一份随阶段增列的表在对话里没法读。信息结构一致：题号是跨文件的连接键。

**`outline.md`** —— 提纲。frontmatter `counts: {questions, layers}`；
每题一行 `- Q<n> <题干> [factor: f-xxxx]`，题号**全文唯一**（`answers` / `pre-answers` 都按它对齐）。

**`pre-answers.md`** —— 每题一块，`### Q<n> · <题干>` 是校验器认的锚点：

```markdown
### Q14 · 跨 TV 和数字的活动，花费是怎么记账的？

- **Pre-answer:** 【暂无足够信息】…（或一个可验证的假设）
- **Confidence:** low
- **Basis:** brand-review.pptx p.19 只有一条合并的 campaign 预算线，没说怎么拆
- **If confirmed:** TV 与数字在月度上不可分，f-0041 与 f-0042 合并为一行
- **Listen for:** 财务那边是否留了按实际投放拆分的数据
```

置信度四档（runtime 比平台多一档 `none`）：

| 级别 | 含义 |
|---|---|
| `high` | 有文档明说 |
| `medium` | 从文档说的能推出来 |
| `low` | 行业惯例或推断，由访谈定夺 |
| `none` | 完全没依据——**说这个，而不是编一句像样的** |

**`minutes-<slug>.md`** —— 一份纪要一个文件。frontmatter 多两个字段
`layer` 与 `interviewedAt`，`counts: {sections, questionsCovered, questionsMissed}`。三个结构装置：

- **段标签 `[Q14, Q15]`** —— 让消化纪要时不用重读原稿就能定位材料；
- **`**对因子树的影响：**`** —— 因子改动建议的候选来源。一段没有影响就没有这行；
- **`## 没覆盖到`** —— **必填**。"一场什么都覆盖到了的访谈很罕见；声称覆盖到了的纪要通常是纪要的问题"；
- **`[unplanned]`** —— 提纲没问但受访者主动提的、且重要的。

> **2026-08-17：`answers.md` 已删除。** 它当初承担的是"提纲每一题都有下落"，
> 现在这个保证落在纪要上——每个题号要么出现在某个段标签里，要么出现在 `## 没覆盖到` 里，
> 由 `minutes_cover_outline` 逐题核。少一个文件，保证不变。
> 「预答错在哪」这一段的价值转由 `insights.yaml` 的 `conflict` 类承载。

**`insights.yaml` / `assumptions.yaml`**（2026-08-17 新增）—— 洞察只出 `gap` 与 `conflict`
两类，每条 ≥2 个证据锚点 + 一条可执行建议；关键假设一问一答，每条挂一个建模决策，
读者在 S2。见「有意放弃登记表」§7 第 2 位。

**`proposals-<slug>.yaml`** —— 因子提案，交给 factor-tree 应用：

```yaml
meta:
  task: "1.4"
  skill: interview
  mode: writeback
  generated: "2026-08-08T16:45:00+08:00"
  grounding:
    - { path: "artifacts/s1/interview/minutes-layer3-media.md", chars: 8800, truncated: false }
    - { path: "artifacts/s1/factor-tree.yaml", chars: 11200, truncated: false }
  knowledgeRecall: none
  counts: { proposals: 4, add: 2, amend: 1, reject: 1 }
proposals:
  - id: p-001
    kind: add                       # add | amend | reject
    targetRow: ""                   # amend / reject 必填
    l1: 消费者需求驱动
    l2: 品牌广告/内容种草
    l3: 品牌传播
    l4: 直播
    indicator: "直播投放花费"
    dimension: "Month, Brand, Channel, Geo"
    granularity: "By month, by channel"        # 平台 factor_changes 有此字段
    rationale: "数字预算里最大的单项，树里完全没有。"
    evidence: "\"去年数字预算差不多 40% 投在直播上\" — minutes-layer3-media §5"
    applied: pending                # pending → accepted | rejected，由 factor-tree 写
```

映射表（访谈说了什么 → 什么 kind）：

| 访谈说 | 提案 |
|---|---|
| 有个没人列过的因子很重要 | `add` |
| 某个指标的度量方式和假设的不一样 | 对那行 `amend` |
| 某个列出的因子在这里不存在 / 测不了 | 对那行 `reject` |
| 某个指标某个日期前拿不到 | `amend`，把约束写进 `rationale` |

**空的情况：** 写 `proposals: []`、`counts: {proposals: 0}`，
并在 `meta.note` 里说明这场访谈覆盖了什么、为什么没有一条改动。**空是一个发现，不是空文件。**

---

## Gate

| 触发条件 | 判定者 | 候选处置 | 路由 |
|---|---|---|---|
| 提纲起草完成 | —— | 无关卡 | 平台 1.3 `produces: ["a-interview"]`，无 decision。runtime 1.3 也无 gate |
| AI 预答完成 | —— | 无关卡 | 平台 1.3b `produces: []`。**预答是给访谈用的，不是给人批的** |
| `inputs/interview-minutes/` 为空 | 人 | ① 上传纪要/转录稿（推荐）② 客户确实不给访谈 → 放 `NONE.md` 写明谁确认的、为什么 | intake 关卡 `g-1.4a`。平台 `in-1.4a`，`requiresUpload: True`。**不许拿报告顶替纪要** |
| 纪要消化完成，提出了因子改动 | BA | ① `approve` 接受改动写回树（推荐）② `rework` 重新消化纪要 | 平台 `d-1.4`，kind `approval`，`reworkTaskId: 1.4`。**这个关卡由 factor-tree skill 的 `apply-proposals` 承接**——interview 只产提案，不写树 |
| 改动落在**因子树的 10–20% 增删阈值**之外 | Solution Team 联审 | 见因子树卡 | 平台 05 §4.1 `G1.2`。访谈是三个补充来源之一（AI 推荐 / 报告 / 访谈），三者共用同一个阈值 |
| 提案要新增一个 **L2** | BA | 接受并在关卡上明说"骨架长了一层" | **只有 `d-1.4` 允许**（runtime 规则）。要新增 L1 → 是 finding 不是行 |
| 设计文档的 `G1.3 纪要改动确认（每份纪要消化后）` | BA | —— | **平台代码没有按份关卡**，只有一个总的 `d-1.4`。以代码为准 |

**interview skill 自身开 0 个关卡。** 它拥有 4 个任务（1.3 / 1.3b / 1.4a / 1.4），
其中 `1.4a` 的 intake 关卡由文件存在性自动判定，`d-1.4` 属于 factor-tree。
runtime 现状与此**一致**——`interview` 的任何模式都不调 `state.py decide`。

---

## 2026-08-17 · runtime 改成了能力式

本卡以下各节描述的是**平台**的流程形态，仍然有效，可以照读。但 runtime 这一侧在
2026-08-17 做了一次结构性重构，读差异表之前先知道这几件事：

**1. 五个能力，不是四步流水线。** `outline` / `pre-answer` / `minutes` / `digest` /
`insights`，各自独立，按手上有什么材料用哪个。`pre-answer` 与 `insights` 在流程定义里
标了 `optional: true`，不做也不拦着交付物走完；`minutes` **不再依赖 `pre-answer`**
（那从来就不是数据依赖，一份逐字稿不需要先有预答才能整理）。唯一的交付物级前提仍是
因子树已确认。

**2. `answers.md` 删掉了。** 「提纲每一题都要有下落」这个保证移到了纪要：每个题号
要么出现在某个段标签里，要么出现在 `## 没覆盖到` 里，由 `minutes_cover_outline` 逐题核。
少一个文件，保证不变。平台那边把回答写回同一张表的做法，runtime 不再有对应物。

**3. 四份产出物有了 Word。** `outline` / `pre-answers` / `minutes-*` / `insights` 各渲染
一份 `.docx`，由 `apps/report/interview_*.py` 生成，指纹记在文档属性里，`doc_current` 比对。
**Markdown 与 YAML 是真相，Word 是视图。**

**4. 预答可以联网。** `interview/pre-answer` 是这套流程第二处 `web:*` 许可
（第一处是 `factor-tree/derive`）。边界由 `web_grounding_scoped` 管：只能挂业务题、
必须带访问日期、置信度 ≤ `low`。**数据题一律不许联网**——那四问是关于客户内部系统的
事实，网上搜到的一定是编的。

**5. 洞察与关键假设做出来了。** 见「有意放弃登记表」§7 第 2 位（已标为补上）。
`insights.yaml` 只出 `gap` / `conflict` 两类，三条约束（≥2 锚点 / 有可执行建议 /
忽略要写理由）是会失败的断言；`assumptions.yaml` 一问一答，每条挂一个建模决策，
读者在 S2（`stat-screening/score` 与 `ols-test/fit` 的取材范围里都加了它）。

**6. 因子树的 Excel 有了访谈校正版。** `factor-tree/amend` 之后往 `exports/` 归档
`factor-tree-<日期>-访谈校正.xlsx`，由 `amended_workbook_archived` 检查。
`artifacts/s1/factor-tree.xlsx` 仍然是单向渲染的当前版，任何时候都不手改。

---

## 与 runtime 现状的差异

| 平台定义 | runtime 现状 | 判定 | 建议 |
|---|---|---|---|
| 提纲 = **层级 × 团队** 两级结构，每个 target 一张表；饮料包内置 94 题模板 | 提纲按 `## L1 · Leadership` / `## L3 · Operations · Media` 分段，**没有 target 概念**，没有 `Target ID` / `Participants` / `Duration` / `Status` / `Question Count` | **偏离 + 缺失** | 补 target 层：Overview 段（表：层级 \| 团队 \| 时长 \| 题数 \| 状态 \| 参与人 \| 档期）+ 每个 target 一节。**没有 target，客户没法排会**——而排会是这个交付物的第一用途 |
| 知识库内置 94 题访谈模板（`KnowledgeTemplate(kind="interview")`） | **`knowledge/` 里没有任何访谈模板**；`recall()` 无条件返回 `None` | **缺失** | 把 `Assets/Interview Plan & Question.xlsx` 的 94 题按 `{category, role, question}` 落进 `knowledge/industry/food-bev/beverage/interview-outline.yaml`。同因子树卡的第一条 |
| 数据类问题 = 每个 accepted 叶子 × 固定四问，M 类确定性生成，题干带 `[a › b › c]` 路径前缀 | 同左，规则写进 `references/outline.md`，并由 `data_questions_complete` 对着树重算核对 | **已补上（2026-08-17）** | —— 判定式会把漏掉的因子路径原样报出来。只取 `accepted`（不含 `baseline`）是有意的：提纲依赖 `factor-tree/confirm`，过关后树上没有 baseline |
| 时长表 leadership/management=60、operations/data=90 | 无 | **缺失** | 补。客户要拿它排会 |
| `qType ∈ {business, data}` | 无字段；靠分段隐含 | **缺失** | 补。`answers` 的处理逻辑对两类不同（平台 `writeback` 明确跳过 data 层：数据类问题由数据团队确认，不在业务纪要里） |
| `Related Factor Path` 列（每个数据题挂它探的因子路径） | `[factor: f-xxxx]` 标记（挂**行 id**） | **一致（更好）** | 保留 runtime 做法。挂 id 比挂路径字符串稳——路径会因为 `amend` 改名而失配 |
| **`【暂无足够信息】` 强制前缀** | 有 `Confidence: none` 一档，无强制前缀 | 偏离（等价） | 已按建议把"没依据就说没依据、不许编一句像样的"写进 `pre-answer.md` 与 SKILL.md 的硬规矩。**保留 runtime 的四档置信度** |
| 来源标签 `ai_recommendation:<label>` | `Basis:` 自由文本 | 偏离 | runtime 的 `Basis` 更可读（它说了页码）。保留，但建议要求指到**文件 + 位置**，不要只写文件名 |
| 一份纪要一次 LLM 调用，失败只损失自己；合并按题号先到先得 | 一文件一产出，语义一致；冲突处置写进 `references/proposals.md` 与 `insights.yaml` 的 `conflict` 类 | **已补上（2026-08-17）** | `answers.md` 已删除，合并规则落在改动建议的六元组去重上；同一口径两种说法本身是一条 `conflict` 洞察 |
| 因子改动带 `granularity` 字段 | `templates/proposals.yaml` 与 `apply-proposals.md` 的 schema 逐字一致，两边都有 `dimension` 与 `granularity` | **已补上（2026-08-17）** | 两处 schema 统一，并在 `apply-proposals.md` 里写明 `granularity` 不是注释：客户说"只能到月"意味着周度项目里这一行进不了模型 |
| 洞察上限 3 条（`Insight{kind: connection\|gap\|conflict\|reference}`） | `interview/insights` 出 `insights.yaml`，只开放 `gap` 与 `conflict` 两类，无条数上限 | **已补上（2026-08-17）** | `connection` / `recall` 仍不做（要跨项目语料与向量检索）。不设条数上限：约束是"每条都要能执行"，能执行的洞察多几条不是问题 |
| `1.4b` ASR 转写（class M），音频 ≤25 MB | `interview` SKILL.md 明写 "There is no transcription in this suite" | **有意缺失** | 保持不做，但**在澄清 3 里前置告知**——不然人会传一堆 mp3 然后卡住。runtime manifest 里也没有 1.4b 任务，一致 |
| 单一 `a-interview` artifact 承载全部五个阶段 | 五个文件 | 偏离（形态） | 保留 runtime 做法。见「备注 2」 |
| `g-1.4a` 是 1.4a 的 intake 关卡 | 关卡 id 就是步骤全称 `interview/minutes`（`g-`/`d-` 两套编号已废），并写进了 `references/minutes.md` | **已补上（2026-08-17）** | 一步最多一道门，所以门的 id 就是步骤 id，不再需要独立编号 |
| —— | `templates/pre-answers.md` 有完整 frontmatter，含联网引用的写法（`url` + `accessed`） | **已补上** | `frontmatter_valid` 也一并放宽：带 `url` 的取材条目不再要求 `path`，否则它与 `grounding_within_allowlist` 互相矛盾 |
| KBQ（1.34 / a-kbq / d-1.6） | 无 | **一致（都不做）** | 用户已裁决 D7 不做 KBQ。**平台现役代码里 KBQ 也已经不在 S1**（`blueprint.py` 与 `registry.py` 都没有 1.6/1.6d/a-kbq，只有 `09` 这份文档还写着）。runtime 与平台现状一致 |

---

## 备注

**1. 编号 1.32 / 1.33 是文档编号，不是任务。**
`00-overview.md` §3 把 1.31（品牌报告）、1.32（访谈框架及纪要）、1.33（访谈纪要总结框架）
列为独立编号，`01-business-agent.md` 也照此分段。**代码里没有它们**：
`registry.py` 只注册 `1.3 → draft_interview`、`1.3b → pre_answer`、
`1.4b → transcribe_audio`、`1.4 → writeback_minutes`。1.31 是输入材料（并进
`industry_reference` 类目），1.32 是模板（并进知识库），1.33 是 1.4 的一部分。
以代码为准：**访谈是一个交付物，不是三个。**

**2. B-16 的合并裁决，和 runtime 的再拆分。**
`08 §10.1.15`（Phase B-16，2026-06-13）逐字：
> **Interview Outline + Interview Minutes 合并为单一 `Interview`**（S1 由 6→5 交付物）。
> `a-interview`（sheet，5 sheet：提纲 / AI 预答 / 纪要消化 / AI 回写建议 / 数据&口径反馈）

这条裁决的**内容**是"这是一个交付物"，它的**形态**是"一个工作簿多张表"。
代码后来把形态收得更紧——不是五张表，而是**同一批行逐阶段往右加列**
（`访谈回答` / `回答来源` 就是纪要阶段加的两列）。

runtime 把它拆成五个文件，**这不违反 A5**：五个文件是同一个交付物的组成部分，
由同一个 skill 拥有，一起过同一个关卡。理由是文本形态下逐阶段增列的表读不了。
但要保证的是：**题号 `Q<n>` 是跨文件的主键**，`outline` / `pre-answers` / `answers`
必须按它对齐，否则五个文件就真的变成了五个东西。

**3. 数据类问题是本交付物真正的体量所在。**
实盘 Gatorade：业务题 42 道，数据题 **168 道**（42 个叶子 × 4 问）。
`Question Count` 那一列上，`Data Team` 一个 target 顶其余九个的四倍。
这说明两件事：① 访谈的主要产出是**数据可得性**，不是业务洞见；
② 数据题必须能被确定性生成、能被机械核对完整覆盖——所以它是 **M 类**，不是 C 类。
runtime 现在缺这条规则，是本卡最需要补的一处。

**4. 平台前端交互 → runtime 文本形态的降级。**

| 平台前端 | 承载的信息结构 | runtime 文本形态 |
|---|---|---|
| 单一工作簿逐阶段增列（提纲 → 预答 → 访谈回答） | 同一题的三个阶段答案并排可比 | 纪要的段标签把题号挂回原文；`insights.yaml` 的 `conflict` 承载"预答与实答对不上"这件事。**2026-08-17 起不再有 `answers.md`** —— 逐题并排对照的价值不足以养一个必须与提纲逐题对账的文件 |
| AI 回写建议的 diff 卡片 + 逐条采纳 | 变更 + 理由 + 原话 + 采纳/驳回 | `proposals-*.yaml` 的提案列表 + factor-tree `apply-proposals` 的变更表。裁决结果写回 `applied:` 字段 |
| Disclaimer sheet（"AI preliminary answers … for reference"） | 预答不是事实的免责声明 | `pre-answers.md` 的 `Confidence` 字段 + `【暂无足够信息】`/`none` 档。**用逐题的置信度代替一句统一免责**——更有信息量 |
| `Insight` 卡片 + `open_asset` 动作 | 跨来源的发现 | `insights.yaml`（`gap` / `conflict` 两类，带锚点与建议）+ `minutes-*.md` 的 `**对因子树的影响：**` 行 |
| ASR 自动转写 | 音频 → 文字 | **不做**，澄清 3 前置告知 |

**5. 纪要文件的实际结构（11 份 Danone 纪要，`07-assumptions-log.md` A4 从中反推的模板）。**

```
[Normal]   Danone China MMM POC Project
[Normal]   Stakeholder Interview Notes | Note | Transcript
[TABLE]    3 行 2 列：
             Date & Time | 2025/11/19 08:00-09:00 AM
             Theme       | Danone China MMM Project Interview – Layer1 - GM
             Attendee    | Danone Team: <names>  Deloitte Team: <names>
[Heading2] Meeting Objective        ← 逐字抄自对应的提纲 sheet
[Heading2] Key Discussion points
             1. / 2.  主题
               a）/ b）/ 1）/ 2）  细节
```

两种文档类型：**Notes**（中文归纳，10 份）与 **Transcript**（英文逐字，1 份）。
只用 `Heading2` 一级标题，没有 Heading1。`Attendee` 单元格里
Danone 与 Deloitte 两份名单之间**没有分隔符**（是两个段落），
按纯文本拼起来会变成 `…Hilda CHENDeloitte Team:…` —— 解析要按段落边界或按 `Deloitte Team:` 切。
`Theme` 行用的是**短破折号 `–`** 不是连字符。

runtime 的 `minutes-<slug>.md` frontmatter 有 `layer` 与 `interviewedAt`，
对应实盘的 `Theme` 与 `Date & Time`；**缺 `Attendee`**——建议补一个 `attendees` 字段，
因为"谁说的"在 `evidence` 引用里要用到（实盘的引用格式是 `"…" — Media Manager`）。

**6. 实盘文件里的脏东西。**
sheet 名 `Interview Invitaion`（拼写）、Layer 3 各表标题里的 `Opeation Team`（拼写）、
`Sales-Tradke Mkt`（拼写）、`Operation Team-SIA` 的标题写的是 `- Sales`（分类错）、
`Layer 3 [To Operation Team] ` 有的行带尾随空格有的不带。
`_category_for()` 靠 `title.lower()` 的 `startswith` 判断，
所以 `Operation Team-SIA` 仍能正确归到 `Operation` —— 但如果照抄模板到知识库，
**这些字符串会原样带进来**，落库前应清洗，并把清洗动作记一笔。
