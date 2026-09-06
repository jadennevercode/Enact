# 反模式

白皮书 §11 的八个常见误区，加上流程 §19.3 语义 lint 点名的四类
（重复概念、关系名词化、粒度混杂、属性滥用）。

每条给三样东西：**在 candidate.yaml 里长什么样**、**为什么会写成这样**、
**谁能发现它**。最后一样最重要——十二条里只有五条有检查项管，
剩下七条全靠人。知道哪些没人管，比知道全部规则更有用。

## 目录

- [速查](#速查)
- [白皮书 §11 的八条](#白皮书-11-的八条)
- [流程 §19.3 的语义 lint 四类](#流程-193-的语义-lint-四类)
- [写给审阅的人](#写给审阅的人)

## 速查

| # | 反模式 | 谁发现 |
|---|---|---|
| 1 | 把数据库反向生成结果直接称为 Ontology | 人（`definition_present` 只挡最粗糙的那种） |
| 2 | 只建名词，不建行为与约束 | `behaviour_present`（warning） |
| 3 | 把所有业务逻辑都塞进 Ontology | 人 |
| 4 | 认为有向量检索就不需要结构语义 | 人（属于选型阶段，不落在产物上） |
| 5 | 认为图数据库天然具有 Ontology | `definition_present` + `relationship_declared` 部分 |
| 6 | 将 Ontology 整体放入 Prompt | 不在本包范围（运行时问题） |
| 7 | 忽略事实来源、时间和冲突 | `trace_complete`、`no_inference_as_fact`、`conflicts_not_merged` |
| 8 | 让 Agent 直接修改正式本体 | `revision_sealed_immutable`、`patch_version_human`、`create_pull_request` 决策点 |
| 9 | 重复概念 | 人 |
| 10 | 关系名词化 | 人 |
| 11 | 粒度混杂 | 人 |
| 12 | 属性滥用 | 人 |

## 白皮书 §11 的八条

### 1 · 把数据库反向生成结果直接称为 Ontology

**长什么样**：实体名等于表名，属性等于列名，关系等于外键，定义栏是列注释。

```yaml
entities:
  - id: ent.gl_je_header
    view_label: GL_JE_HEADER
    canonical_name: GlJeHeader
    definition: "总账日记账头表"       # 这是表注释，不是业务定义
    support: [{ type: evidence, alignment_id: aln.0031 }]
```

**为什么会写成这样**：从 ERP 导出的 DDL 是现成的、结构化的、看起来很完整。
从表结构起步，一小时能产出六十个"实体"。

**谁发现**：`definition_present` 只能挡住"GlJeHeader 是 GL_JE_HEADER 表"这种
名称复述。上面那条能过检查。真正的判据是白皮书 §11.1 说的：
数据库通常缺少业务定义、别名、状态、政策、动作和跨系统身份——
**自动生成只能作为草稿，必须经过语义策展**。
审阅第四轮问一句"这个名字客户会怎么念"，基本能筛干净。

### 2 · 只建名词，不建行为与约束

**长什么样**：`entities`、`relationships`、`attributes` 三段写满，
`events`、`lifecycles`、`constraints` 是空列表。

**为什么会写成这样**：名词最容易从材料里抽出来。手册 §6.2 那五步流程里
藏着三个事件、一个生命周期和四条约束，但它们要读进去才看得见。

**谁发现**：`behaviour_present`（warning 级）——candidate 至少含一个 event 和
一个 lifecycle，否则报"世界如何变化没有被建模 / 允许怎样变化没有被建模"。
它是 warning 不是 blocking，因为确实存在没有状态变化的领域；
真是那样，就在 generation report 里写明理由。

在冲销这个域里，它必定是错的：客户的原始问题就是"这条分录**能不能**冲销、
该谁批"——答案全在 lifecycle 的 guard 和 constraint 里。

### 3 · 把所有业务逻辑都塞进 Ontology

**长什么样**：constraint 的 `statement` 里出现 SQL、`capabilities` 里出现
接口路径和重试次数、`policies` 里写着"超时 30 秒后调用补偿接口"。

```yaml
constraints:
  - id: con.approval_query
    kind: rule
    statement: "SELECT ... FROM gl_je_header h JOIN approval a ON ... WHERE h.amount >= 50000"
    support: [...]
```

**为什么会写成这样**：写下实现比写下语义容易验证。而且"反正最后要跑起来"。

**谁发现**：没有检查项。白皮书 §11.3 划的线是：本体声明**稳定业务语义和规则**，
不吞并 UI、运行时调度、连接池、模型 prompt、详细 SQL、会话状态和基础设施实现。
上面那条应该写成 `statement: "金额（本位币）≥ 50000 时需财务控制审批"`，
SQL 挂到 `bindings` 里 `binding_kind: metric` 或 `action` 的那条。
边界的完整清单在 `knowledge/boundaries.md`。

### 4 · 认为有向量检索就不需要结构语义

**长什么样**：在本包里通常表现为不作为——CQ 只覆盖 retrieve，
不写 filter / aggregate / lifecycle 那几类，因为"检索能找到相关段落"。

**为什么会写成这样**：向量召回在演示里效果很好。

**谁发现**：没有检查项能发现，但 `evaluate` 阶段会暴露它。
白皮书 §11.4 说得具体：向量相似度**不能可靠表达基数、职责分离、有效时间、
状态转换和动作效果**。`cq.002`（这条分录的冲销该由谁审批）就是一个
向量检索答不对的问题——它需要金额门槛、职责分离和角色三样东西同时成立。

### 5 · 认为图数据库天然具有 Ontology

**长什么样**：关系只有两个端点和一个名字，没有方向、基数、角色和语义类别；
id 是自增数字；定义栏空着。

**谁发现**：这一条本包管得住一半。`relationship_declared` 要求每条关系有
`direction`、`cardinality`（两端）、`source_role`、`target_role`、`semantics`；
`definition_present` 要求非空定义；`ids_stable_unique` 要求 id 稳定。
白皮书 §11.5 列的四条症状里，前三条各有对应检查。
第四条"版本无人负责"落在 `bundle.domain.owners` 上，那是可选字段，没人查。

### 6 · 将 Ontology 整体放入 Prompt

**长什么样**：不在本包的产物里。本包产出的是 candidate bundle，
不是 context package。

**谁发现**：不在本包范围。记在这里是因为它决定了**建模时该不该在乎切片**——
如果本体注定要被整体塞进 prompt，那 `cq_links`、`scope` 和最小模型原则
都没有意义。白皮书 §8.2 的立场是：**Ontology 不是上下文本身，是上下文生成器**。

### 7 · 忽略事实来源、时间和冲突

**长什么样**：三种，一种比一种隐蔽。

```yaml
# (a) 没有依据
entities:
  - id: ent.approval_matrix
    definition: "审批矩阵"
    support: []                       # trace_complete 直接报

# (b) 推断写成事实（在 evidential_ir 一侧）
facts:
  - id: fact.0044
    statement: "所有工厂对软关账起止时点的定义一致"
    source_id: glossary-fragment      # 术语表恰恰说"各工厂理解不一"
    anchor: { location: ..., exact_snippet: ... }

# (c) 冲突被挑掉一个
constraints:
  - id: con.soft_close_reversal
    kind: rule
    statement: "软关账期间经财务控制批准可以冲销"    # 只留了手册那一条
```

**为什么会写成这样**：(a) 是赶工；(b) 是模型把"应该是这样"写成"材料说这样"；
(c) 最诱人——留两条互相矛盾的规则，模型看起来很不专业。

**谁发现**：(a) `trace_complete`；(b) `no_inference_as_fact`（fact 必须有
带 `exact_snippet` 的 anchor）；(c) `conflicts_not_merged`
（互相冲突的陈述各留一条、状态 disputed、每组有一条未决 decision）。

这一条是三份文档里被强调最多的一条。冲销域的整个价值就在这里：
两份权威文件对"软关账能不能冲销"给出相反答案，政策部说自己优先、
共享中心按手册执行、分歧尚未裁决。**把这个分歧完整保留下来，
本身就是交付物的一部分**——月结平均延误 1.5 天就是它造成的。

### 8 · 让 Agent 直接修改正式本体

**长什么样**：直接编辑一个已封存的 `revisions/rNNNN/candidate.yaml`；
或者自动判定这次发布是 patch 还是 version；或者跳过 PR 直接推。

**谁发现**：三道。`revision_sealed_immutable` 重算封存目录的 digest，
对不上就报"有人改了历史"。`patch_version_human` 要求
`decided_by: human` 且有 rationale 和 target_version。
`create_pull_request` 是八个决策点里**唯一强制人工批准**的那个。

白皮书 §11.8 的说法和流程 §15.2 一致：Agent 可以生成候选概念、别名、
关系和规则，正式变更必须走草稿、评审、测试和发布。运行时反馈不绕过治理。

## 流程 §19.3 的语义 lint 四类

这四类流程列为 P2 增强（"Semantic linting 和 anti-pattern detection"），
**本包尚未实现**。写在这里是为了让审阅的人知道要盯什么。

### 9 · 重复概念

**长什么样**：

```yaml
entities:
  - { id: ent.reversal,     view_label: 冲销, canonical_name: Reversal,
      definition: "把一条错误分录反向记账的动作。", support: [...] }
  - { id: ent.red_reversal, view_label: 红冲, canonical_name: RedReversal,
      definition: "对已过账分录做反向记账。",     support: [...] }
```

**为什么会写成这样**：材料里两个词都出现了，各自有出处，各自能挂上 support。
两条 support 都合法，`trace_complete` 全绿。

**谁发现**：只有人。术语表白纸黑字写着"'红冲'是习惯说法，系统里没有这个动作"，
正确的做法是一个对象加 `aliases: [红冲, 反过账]`。
`ids_stable_unique` 只查 id 重复，不查语义重复——两个不同的 id 配两个
不同的 `canonical_name`，在它眼里是两个正常对象。

反向的错也一样只有人能发现：术语表说"调整分录"和"冲销分录"**不是一回事**，
合并它们同样没有检查会报。

### 10 · 关系名词化

**长什么样**：本该是关系的东西被建成了实体，然后用两条无意义的关系接回去。

```yaml
entities:
  - id: ent.reversal_link              # 名词化的产物
    view_label: 冲销关联
    canonical_name: ReversalLink
    definition: "记录哪条冲销分录对应哪条原分录。"
    support: [...]
relationships:
  - { id: rel.link_has_source, source: ent.reversal_link, target: ent.journal_entry, ... }
  - { id: rel.link_has_target, source: ent.reversal_link, target: ent.journal_entry, ... }
```

**为什么会写成这样**：从数据库的关联表直译过来就长这样；
或者不确定关系要不要带属性，先建个实体"以后再说"。

**谁发现**：只有人。所有检查都过——两条关系语义字段齐全、端点解析、
实体有定义有 support。判据是：**这个"实体"有没有独立身份和自己的生命周期**。
如果没有，它就是 `rel.reverses`，写成关系；如果有（比如冲销申请单，
有单号、有审批、有状态），那它本来就该是实体，不叫名词化。
真的需要给关系挂属性时，用 `reified: true` 并另建实体，见
`knowledge/design-patterns/n-ary-relationship.md`。

### 11 · 粒度混杂

**长什么样**：

```yaml
entities:
  - id: ent.journal_entry      # 一条分录
  - id: ent.journal_line       # 分录的一行（章程说"journal line 不展开"）
  - id: ent.general_ledger     # 整个总账
  - id: ent.fsc_finance        # 整个财务共享中心
```

**为什么会写成这样**：这四个词在材料里都出现了，抽取的时候一视同仁。

**谁发现**：只有人。而且这一条最容易被放过——四个对象各自都合理，
问题只在放在一起。两个自查动作：
按数量级排一遍（"这个域里有多少个？"），
以及对照章程的数据粒度声明（这里是"到单条分录，journal line 不展开"）。

### 12 · 属性滥用

**长什么样**：两个方向。

```yaml
attributes:
  - id: attr.journal_entry.period      # (a) 该提升为实体的留在属性上
    owner: ent.journal_entry
    datatype: string       # 但 period 有 open/soft_close/hard_close 三种状态
    nullable: false
    support: [...]
  - id: attr.journal_entry.remarks     # (b) 用自由文本承载稳定关系
    owner: ent.journal_entry
    datatype: string       # 里面写着 "冲销了 JE-2026-0091"
    nullable: true
    support: [...]
```

**为什么会写成这样**：(a) 因为源数据里它就是一列字符串；
(b) 因为 remarks 列真的存在，而且抽取的时候它确实是个属性。

**谁发现**：只有人。检查问题在流程 §7.3 里写着：
**如果该值要独立引用、治理或连接，是否应提升为实体？**
`period` 被 `lc.journal_entry` 的 guard 引用、被政策 §3.1 赋予三种状态，
答案是"要"。`remarks` 里的那句话是 `rel.reverses`，
流程 §8.3-5 直接点名：**避免用自由文本承载稳定业务关系**。

## 写给审阅的人

十二条里有七条只有人能发现，它们集中在同一个位置：**四轮审阅的第四轮**
（评价设计本身）。前三轮确认我们知道什么、业务怎么运转、映射是否成立，
顺序不能换——反过来审，人会先爱上一个漂亮的模型，然后为它找依据。

第四轮拿这七条当清单，逐个对象问四句：

1. 这个名字是业务的说法还是系统的说法？（1、9）
2. 它和另外哪个对象说的是同一件事吗？（9）
3. 它有自己的身份和生命周期吗？（10、12）
4. 它和它旁边那几个对象是一个数量级吗？（11）

答不上来的给 `comment` 或 `reject`，不要给 `accept`。
`review_binary` 要求每个被审对象都有结论，`reject_has_reason` 要求
reject 带类别（`unsupported` / `duplicate` / `out_of_scope` / `semantically_wrong`）——
上面这七条基本落在 `duplicate` 和 `semantically_wrong` 两类里。
