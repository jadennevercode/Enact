# 套件写作规范

修改或新增本套件的 Skill 时遵守。**只有 sdlc-learn 在拿到 `lesson-approval.yml` 之后可以做这件事**（红线 4.2）。

这些规范来自对 Spec Kit、superpowers、anthropics/skills 官方实践、BMAD、Kiro、Agent OS 的调研与各自的实测教训，不是凭空定的风格偏好。

## 0. 九个配置面：每个 Skill 必须能被逐面指认

一个 SKILL.md 就是主规格 §09 意义上的 **AgentSpec**。AgentSpec 的定义是"覆盖九个配置面的声明"——
不逐面声明，它就只是一篇工作流散文，新增 Skill 时没有任何东西阻止它漏掉其中四个。

不必写成九个小标题，但**每一面都要能在正文里指出落点**：

| # | 配置面 | 至少要声明 | 常见落点 |
|---|---|---|---|
| 1 | Objective & charter | 职责、完成定义、不得越权的事项 | 开篇段 + `## Done When` |
| 2 | Domain schema | 本环节的受控词表与允许取值 | 状态/归因/类别的枚举表 |
| 3 | Context recipe | Seed（必读）、可发现范围、版本固定、扩展规则 | `## 输入：读什么` |
| 4 | Capability bundle | 用哪些模板与清单，版本怎么固定 | 引用模板处 + `capability_bundle_pinned` 事件 |
| 5 | Tools & services | 工具白名单、命令类别、环境与凭据 | `## 工具边界` |
| 6 | Action/change scope | 可读 / 可写 / 受保护 / 禁止动作 / 升级条件 **五要素** | `## 工具边界` |
| 7 | Gates & human handoff | 暂停、批准、驳回、重跑、超时 | `## Gate` / `## 出口` |
| 8 | Runtime policy | 在什么 Runtime 上跑、并发与降级 | 见下方说明 |
| 9 | Memory & learning | 短期状态、长期事实、**向 learn 交出什么** | `## 交接` |

**第 6 面是最容易缩水的一面**：很多环节只写了"读什么 / 写什么 / 不写代码"三要素，
漏掉 protected 与升级条件。三要素说的是"我干什么"，五要素说的是"我撞到边界时怎么办"——后者才是治理。

**第 8 面对本套件是统一答案**：当前编码 Agent 会话（Claude Code、Codex，或由 Enact 管理的 Runtime）即 Runtime，不做多 Runtime 主备。
但每个 Skill 仍要声明两件不依赖多 Runtime 的事：**用不用独立上下文、为什么用**（例如 QA 的 contract-only 角色隔离；非角色隔离部署才用运行时可用的 subagent），
以及**分层配置的来源解释**——当一条约束来自 `config.yaml` 项目级而非本次 change-scope 时，要能说出来源层级。

**第 9 面要双向声明**：不只是"我怎么记住上下文"，还包括"我产出的哪些东西是 Lesson 候选、交给谁"。
`boundary_stop`、反复失败的 Gate、反复出现的澄清都是 learn 的输入来源——
如果只有 learn 声明了"我要来取"，而产地不声明"我要交"，这条链就是断的。

---

## 1. description 只写触发条件

frontmatter 的 `description` 决定 Skill 会不会被用上，**不要在里面写工作流摘要**。实测教训：description 里出现流程描述后，模型会照着 description 干活而跳过正文——写了"环节之间做 code review"，它就只 review 一次，跳过了正文要求的两阶段。

- 以 "Use when..." 开头，第三人称
- 写具体触发词和场景，不写抽象能力
- 适度 pushy——模型倾向于欠触发 Skill
- 用否定句划边界，防止与相邻环节抢触发

✅ `Use when implementing an approved Execution Contract - writing the code, config or migration for a work item that has passed contract approval, declaring or expanding the change scope, or when someone asks to start building, implement the contract, or make the changes. Not for deciding what to build (that's sdlc-contract) or for verifying it afterwards (that's sdlc-qa).`

❌ `Build 环节的 Skill。先声明变更范围，然后实施，最后产出 build evidence。`（写了流程，且没写触发条件）

## 2. 正文结构与长度

- SKILL.md 控制在 **500 行以内**，只放工作流骨架和到 references 的导航
- 详细清单、维度表、格式规范放 `references/`，注明"什么时候读"
- **同一 Skill 内引用只允许一层深**：由 SKILL.md 指向本 Skill 的 `references/` 下某一份，
  不要从那一份再指向同级的另一份。两级跳会让读者在不知道自己还要读几份的情况下一直往下走。
- **跨 Skill 指向 sdlc-core 的共享定义是允许的**，因为那是唯一真相所在，
  把它复制一份到本地才是真正的问题。但**从 `references/` 出发必须退两级**（`../../` 开头）：
  只退一级会落在本 Skill 目录里，指出来的路径根本不存在——而它读起来像是有出处的，
  这比不写更糟。`check_suite.py` 会验这类路径存不存在。
- 长 reference（>300 行）顶部放目录
- 互斥场景拆成独立文件，让模型只读需要的那份

## 3. 强约束与讲道理的分工

这是本套件最容易写砸的地方。两种写法各有适用范围：

**用强约束（Iron Law 式）**：仅限脆弱的、极易被"这次情况特殊"消解掉的规则。本套件里只有三条铁律加三条支撑规则够格。写法是四件套：

1. Iron Law（代码块排版，短句，全大写）
2. 封口句：「违反字面就是违反精神」
3. 借口对照表 `| 借口 | 现实 |`——**每行必须是真实出现过的借口**，不要编造
4. 自检信号：把"念头本身"列为停止信号（"你正想着这次不一样，因为……"）

**用讲道理（解释为什么）**：其余全部。说明这条要求解决什么问题、不这样做会发生什么。模型有很好的推理能力，理解了原因就能在没预料到的情况下做对判断；死记规则做不到。

两条边界，来自实测：
- **禁令只对"知法犯法"型失败有效**。如果失败是"输出形状不对"（格式、结构、篇幅），给正面配方和示例，不要给禁令——实验显示禁令组产出的不良内容反而更多。
- **不加 nuance 条款**。"除非确实必要，否则不要 X"会重新打开谈判，让一条有效规则失效。要么规则成立，要么不写。

## 4. 格式约束的表达

- 易错格式给 ✅/❌ **成对示例**，比描述规则有效得多
- 数字配额防发散：一轮提问 ≤4 题（协议见 `interaction.md`）、澄清标记 ≤3、任务层级 ≤2 级
- 数量约束一律是**上限，不是下限**。强制凑满数量会逼出编造内容
- 每个 Skill 末尾放 `## Done When` 自检清单，其中一条固定为「九个配置面都能在正文里指认出落点」

## 5. Skill 之间的串联

用显式标记，不用自动加载：

```markdown
**REQUIRED**：读 `gates.md` 再写 Gate 记录。
```

不要用 `@` 强制预加载——会在还不需要的时候吃掉大量上下文。

交接时说明"下一步该用哪个 Skill、需要什么前置产物"，让链条能自己走下去。

## 6. 上下文纪律

- **定向读取**，不要全文加载。调研中有框架单步读了 82k token 的架构文档，根因就是"无边界的深度分析而非定向、有限的读取"
- 为下游准备摘要版产物，不让每个环节都重读上游全文
- 每段自问一次：这段是否值得它占的 token

## 7. 反幻觉引用制

任何技术细节都要带来源：`[Source: 文件路径#章节]`。查不到就明确写"未找到具体指引"，**不要编造**。这条在 build 的任务包里尤其关键——下游拿着错误的"事实"去实现，比拿着"不知道"更糟。

## 8. 脚本管确定性，LLM 管语义

编号分配、目录创建、格式校验、清单统计、diff 比对——全部脚本化。机械文本操作交给 LLM 已被反复证明易错。

脚本要求：
- 自己处理错误分支，不要把异常抛给调用方去猜
- 报错信息要具体到能自修：`字段 'approved_by' 为空。请填入具名责任人。` 而不是 `validation failed`
- 退出码约定：0 通过 / 1 检查未通过（有意义的结果）/ 2 脚本自身出错

## 9. 开发方法

新增或大改 Skill 时：

1. **先让 baseline 复现失败**。没有 Skill 的情况下跑一遍测试用例，确认失败真的存在——**baseline 没有这个失败，就没有东西要修**，不要写无用规则。
2. **eval 先行**，再写长文档。
3. with-skill vs without-skill 对照跑，读 transcript 而非只看产物。
4. 触发测试要造"难负例"：与本 Skill 共享关键词但应该走别的环节的请求。无关噪音测不出任何东西。
5. 防过拟合：只在测试用例上有效的 Skill 没有价值。
6. 观察信号：从不被读的 reference 文件说明多余或指引不清；被反复读的说明该上移进 SKILL.md。

## 10. 不采纳的做法

| 不做 | 理由 |
|---|---|
| 具名 persona 角色（Analyst Mary、Dev James） | 主规格明确角色应为可配置能力域而非硬编码。本套件按环节切分 |
| 状态存数据库 | 不可人读、不可 git diff、不可 PR 评审 |
| 自制执行引擎、伪 XML DSL | 与 Claude Code / Codex / Enact Runtime 的原生能力重复打架。同类框架作者已亲手砍掉过一次 |
| 强制凑满数量的模板 | 逼出幻觉内容 |
| 一次生成两千行文档 | 人审不动就等于没审 |
