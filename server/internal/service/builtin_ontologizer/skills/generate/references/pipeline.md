# 十个阶段

顺序在 `shared/manifests/stages.yaml` 的 `pipeline_stages` 里，不能换。
每阶段独立会话、有时间线、可取消、可重试、可诊断（流程 §8.1）。

---

## 1 · `intake` (S)

**输入**：`define/**` 全部。
**输出**：`revisions/rNNNN/` 目录、`revision.yaml`（含冻结的输入 digest）、`runs/run-NNNN/`。

```bash
python3 <pkg>/scripts/revision.py new <ws> --reason "首次生成" --by <你>
```

它把证据快照、访谈状态、FAGC 登记、模型卡、章程各自的哈希写进 `revision.yaml`
的 `inputs`。这是 `reproducible` 检查项的依据：**一个说不出自己读了什么的
revision，没有资格声称可重现。**

**会出的错**：Define 还没齐（没有快照、readiness 没二值化、
`evidence_sufficiency` 未决）。此时不要硬开——回 `evidence` 或 `interview`。

---

## 2 · `process_ir` (C)

**输入**：证据里的流程性材料、访谈里的流程回答。
**输出**：`process_ir.yaml`。

**会出的错**：step 里挂了 `entities:` 列表（读着读着顺手把设计写下来了，
这是最常见的一种混入，`layer_separation` 会拦）；异常路径没有终点却顺手补了
一条材料里没有的线。注意 `events` 与 `lifecycles` 写在这一层是本分不是越界，
判据见 `process-ir.md`。

---

## 3 · `evidential_ir` (C)

**输入**：证据快照的 manifest 与 extractions、FAGC 登记。
**输出**：`evidential_ir.yaml`。

**会出的错**：把推断写成来源事实；锚点只有 `location` 没有 `exact_snippet`
（`schema_valid` 与 `trace_complete` 都会拦）；把冲突的两条合成一条。
写法见 `evidential-ir.md`。

---

## 4 · `alignment` (C)

**输入**：前两层。
**输出**：`alignment.yaml`。

**会出的错**：某条 mapping 缺 `source`、`target` 或 `confidence`——
`layer_separation` 判它是"无端点的自动对齐"，等于没有依据的断言；
`source` 指向一个 `evidential_ir` 与 `process_ir` 里都不存在的 id。
写法见 `alignment.md`。

---

## 5 · `candidate` (C)

**输入**：前三层 + 模型卡 + `knowledge/modeling-rules.md`。
**输出**：`candidate.yaml`。

**唯一允许联网的阶段**（`shared/conventions.md` §3），且网络引用必须同时记
URL 和访问日期。

**会出的错**：对象没有 support；定义只是名称的复述（"Journal Entry 是一条日记账分录"）；
关系缺 direction / cardinality / 两端 role / semantics；只建了名词没建事件与生命周期。
写法见 `candidate.md`。

---

## 6 · `gate` (S) —— Cypher 之前的强制门

```bash
python3 <pkg>/scripts/validate.py <ws> --gate candidate_ready --revision rNNNN
```

流程 §5.2 的管线是 `Candidate → mandatory gate → Cypher generation →
managed graph import/conformance`，所以这道门在 Cypher 之前，也就不查 Cypher：
七项——结构、层分离、身份、引用、追溯、定义、关系声明。

七项全过才渲染 Cypher。**过不了就不要往下走**：拿一个自己都不自洽的候选去生成
Cypher，只是把同一个问题换成一条更难读的报错。

结构不合法时 `schema_valid` 之后的检查会连锁误报，所以先修 `schema_valid`，
再看别的。

封存时跑的是 `ready_for_review`，它在这七项之外再加 `cypher_generated_and_parses`
和 `reproducible`。算数的是那一次。

---

## 7 · `cypher` (S)

从 candidate 渲染 `candidate.cypher`。生成的是 openCypher portable profile，
每个节点和关系都以稳定声明 id 作 MERGE 键，所以重复执行会收敛而不是复制。

```bash
python3 <pkg>/tools/cypher/run.py <ws> rNNNN      # 渲染 + 静态检查，写进 revision
python3 <pkg>/tools/cypher/run.py <ws> rNNNN --check    # 只检查已有的那份
python3 <pkg>/tools/cypher/run.py <ws> rNNNN --stdout   # 先看看再决定
```

它拒绝写进已封存的 revision，也在静态检查不过时不写——一份写进去又不合法的
脚本，会让下一个人以为这一步做过了。

**不要手写 Cypher。** 手写的版本和 candidate 会分叉，而分叉的方向是
Cypher 里多一个 candidate 里没有的对象——静态检查会拦，但拦下来之后
你不知道该改哪一边。

---

## 8 · `conformance` (S)

`cypher_generated_and_parses` 跑静态检查：括号是否平衡、引号是否成对、
每条语句是不是以受支持的子句开头、标签是不是合法标识符、
脚本里出现的每个 id 是不是都在 candidate 里声明过。

真实图库导入走可选适配器，本地没有图库时这一步就是静态检查。
**没有图库不是"跳过检查"，是这一层只做到静态**——如实说，别说"一致性检查通过"。

---

## 9 · `trace` (S)

建 `trace-index.yaml`，每个对象一条十二字段记录。`revision.py seal` 会自动做，
不用单独跑。要单独重建：

```bash
python3 -c "from tools.trace import index; index.write('<ws>','rNNNN')"
```

索引是**推导**出来的，不是手填的。它和产物分叉时是索引错了，重建即可。
一份可以手工编辑的追溯记录等于没有追溯记录。

---

## 10 · `seal` (S)

```bash
python3 <pkg>/scripts/revision.py seal <ws> rNNNN
```

它按顺序做四件事：建索引 → 跑 `ready_for_review` 门 → 把每项结果写进
`validation/*.json` 与 `revision.yaml` → 按门的结果写 `status`。

- 过了：`status: ready_for_review`，`sealed: true`，`HEAD` 移到它。
- 没过：`status: gate_failed`，`sealed: true`，**HEAD 不动**。产物留着可诊断。

封存之后目录只读。已封存的 revision 不能再 seal 一次。

**这一步是"Agent 完成 ≠ 成功"的落法。** 状态由脚本按检查结果写，
不由生成它的那一方宣布。所以报结果时说的是 seal 写下的那个词，
而不是"生成成功了"。

---

## 失败时的三选一

blocking failure 之后按流程 §8.4 给三个选择，不要自己替他选：

| 选项 | 什么时候合适 | 做什么 |
|---|---|---|
| `diagnose` | 不知道为什么失败 | 读 `validation/*.json` 的 findings，定位到具体对象和字段，报出来 |
| `retry` | 知道哪里错了，且改动局限在某一层 | 只重跑受影响的阶段，前面的产物不动 |
| keep / discard | 用户取消了 | 问已完成的阶段保留还是丢弃，默认保留 |

三种情况下 `revisions/runs/run-NNNN/` 都留着。详见 `failure-recovery.md`。

## 时间线怎么报

显示真实的阶段状态和已用时间：

```
intake          ✓  0.3s
process_ir      ✓  1m50s
evidential_ir   ✓  1m10s
alignment       ✓  40s
candidate       ✓  3m20s
gate（机器门）   ✗  2 项未过：trace_complete、relationship_declared
cypher          —
```

**不显示完成百分比**（流程 §8.1 AC-G01）。百分比要么是编的，要么是按阶段数
算出来的假精度——而阶段之间的耗时差着一个数量级。
