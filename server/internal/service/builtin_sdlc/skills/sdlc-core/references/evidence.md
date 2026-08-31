# 证据

三层结构，各有各的受众。混用会导致要么无法排障，要么没人愿意读。

| 层 | 文件 | 内容 | 给谁看 |
|---|---|---|---|
| Runtime trace | 会话记录、命令输出、测试日志 | 工具调用、命令、报错原文 | 排障与审计，按需回溯 |
| Evidence Event | `evidence.jsonl` | 输入版本、动作、输出、结果、责任主体 | 机器关联与确定性检查 |
| Evidence Case | `evidence-case.md` | 目标覆盖、例外、批准、回退准备 | QA、Release 责任人、业务负责人 |

**不要求任何人通读事件流来做决定。** Evidence Case 存在的全部意义就是把决策需要的东西组织好；完整链路留在 jsonl 里可回溯即可。

---

## Evidence Event

每行一个 JSON 对象，追加写入，**不修改、不删除、不重排**。

```json
{"ts":"2026-08-21T10:22:31Z","actor":"sdlc-build","action":"file_modified","input_refs":["contract.yaml#1.1"],"output_refs":["src/reports/exporter.py@a3f21c"],"result":"ok","notes":"新增 refund_amount 列"}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `ts` | 是 | ISO 8601 UTC |
| `actor` | 是 | 环节 Skill 名（`sdlc-build`）或人名（人工动作） |
| `action` | 是 | 见下方动作词表 |
| `input_refs` | 是 | 这次动作依据了什么。尽量带版本：`contract.yaml#1.1`、`src/x.py@<hash>` |
| `output_refs` | 是 | 产生或改变了什么。无产出写 `[]` |
| `result` | 是 | `ok` / `failed` / `blocked` |
| `correlation` | 否 | 跨对象串联锚点。默认是本 WI 编号；跨 WI 的因果链（事故 → 原 WI → 修复 WI → LP）填共同锚点如 `INC-001` |
| `notes` | 否 | 一句话补充。不要粘贴长输出 |

### 动作词表

| action | 何时写 |
|---|---|
| `work_item_created` | intake 创建 WI |
| `status_changed` | 状态机变更，notes 写 `from → to` |
| `fact_confirmed` | explore 确认一条事实，input_refs 指向来源文件 |
| `question_answered` | 用户回答了一个澄清问题 |
| `contract_approved` | contract Gate 通过，input_refs 指向 gate 文件 |
| `amendment_raised` / `amendment_decided` | Contract 缺口的提出与处置 |
| `context_resolved` | **本次执行实际依据了哪些文件与版本**。scope 声明时落一条，每次范围扩大后再落一条——范围变了意味着可依据的事实集合变了 |
| `capability_bundle_pinned` | 首次实例化模板/清单时记录用了哪个版本，`input_refs` 填模板路径 + git hash |
| `scope_declared` / `scope_expanded` | change-scope 的建立与扩大 |
| `file_modified` / `file_created` | build 的实质变更 |
| `command_run` | 跑了 lint/test/build，result 记结果 |
| `test_intent_frozen` | qa 冻结预期行为（在读实现之前） |
| `test_executed` | 一次测试执行，notes 记 pass/fail 数 |
| `defect_found` | 发现缺陷，notes 记归因类别 |
| `boundary_stop` | **越界被拦下**，notes 记想做什么、为什么停 |
| `gate_decided` | Gate 决定，input_refs 指向 gate 文件 |
| `phase_reviewed` | **没有 Gate 的阶段（intake / explore / qa / operate）出口评审已完成**。`actor` 填评审人真名，`notes` **必须以阶段名开头**：「`explore` · 业务负责人 · ok」或「`qa` · QA · gaps：并发场景无覆盖」——不点名阶段，一条记录会被当成把好几个阶段都评审过了。它不是 Gate——不接受风险、不阻塞、没有四值词表；它只回答"有没有人真的看过" |
| `incident_linked` | operate 把事故关联到 WI |
| `lesson_proposed` / `lesson_published` | learn 的关键节点 |
| `regression_selected` | qa 选定本轮回归集，notes 记选择依据 |
| `intelligence_synced` | 交付结论已同步到 Intelligence Space，`output_refs` 填 `<space>@<proposal 分支名>@<commit hash>`。**记的是提出了 proposal，不是已合并**——合并由对方仓库的人做，本套件无从得知 |

`boundary_stop` 特别重要——它证明边界真的在起作用。主规格把"越界动作被阻止或升级"列为 Pilot 完成定义之一。

### 写入方式

追加一行，不要读全文再重写：

```bash
python3 -c "
import json,sys,datetime
e={'ts':datetime.datetime.now(datetime.UTC).strftime('%Y-%m-%dT%H:%M:%SZ'),
   'actor':'sdlc-build','action':'file_modified',
   'input_refs':['contract.yaml#1.1'],'output_refs':['src/reports/exporter.py'],
   'result':'ok','notes':'新增 refund_amount 列'}
open('.sdlc/work-items/WI-001-x/evidence.jsonl','a').write(json.dumps(e,ensure_ascii=False)+'\n')"
```

**写什么、不写什么**：记录会改变判断的事实——依据了哪个版本、改了什么、检查结果、被拦下的越界、谁批准了什么。不要记录思考过程、中间尝试、逐次文件读取的流水。事件流要能被读完。

（"依据了哪些文件与版本"由 `context_resolved` 在几个关键节点成批记录，这与"记录每一次 Read 调用"是两回事——前者是快照，后者是流水。）

### 硬规则：证据里不得出现密钥

`evidence.jsonl` 与 `ledger.md` 是**永久保留、进 git、可 PR 评审**的，而本套件所有规则都在鼓励"不删除"。
一旦某次 `command_run` 的 notes 带进了连接串或 token，它就永久留在 git 历史里——**治理机制会把一次疏忽变成永久泄露**。

因此：

- 写入前对 `notes` 与 `refs` 做屏蔽检查，模式取自 `config.yaml` 的 `data_policy.evidence_redaction`
- 命中就写 `[redacted]`，并把 `result` 记为 `blocked`，notes 说明"命中 data_policy，内容未记录"
- 命中 `data_policy.never_read` 的文件，内容不得读入上下文，更不得进入任何 refs
- 不要粘贴命令的原始输出。输出里有什么你事先并不知道

---

## Evidence Case

面向一次 Release 决策组装。章节固定（主规格 §15 的 Release 页面清单），因为责任人需要每次在同样的位置找到同样的东西。

```markdown
# Evidence Case — WI-001 <标题>

## 1. 业务目标与范围
（outcomes 原文 + scope.included/excluded 摘要。让人想起来这是要干什么）

## 2. Contract 覆盖
| Criterion | 验证方式 | 结果 | 证据 |
|---|---|---|---|
| 1.1 | automated | ✅ | test-plan.yaml#TC-003, run 2026-08-21 |
| 1.2 | automated | ✅ | test-plan.yaml#TC-004 |
| 2.1 | manual | ✅ | 王五确认 2026-08-21 |
（必须逐条列全。有 criterion 没出现在这张表里，预检就该 FAIL）

## 3. 接口兼容
（有无破坏性变更；消费方影响；迁移需要）

## 4. 安全与隐私
（是否触及认证、权限、个人数据、密钥；相关检查结果）

## 5. QA 结果
（通过/失败统计、flaky 项、未覆盖项及理由。指向 qa-report.md，不复制全文）

## 6. 已知例外
（CONCERNS 级问题、临时方案、技术债。每条要有 owner）

## 7. 部署与回退
（怎么发、怎么退、退回后数据状态如何。**回退方案为空时预检直接 FAIL**）

## 8. 监控与支持准备
（发布后看什么指标、异常时谁响应）

## 9. 批准
（由 gates/release.yml 承载，此处只引用）
```

### 组装原则

- **每条结论都指向证据引用**，不是复述。责任人想深挖时能顺着引用打开原件。
- **例外要显式**。把已知问题藏在"总体通过"里，是最容易导致事后追责的做法。
- **不要粘贴原始 trace**。Release 不应该要求业务负责人读工具调用日志。
- **覆盖表必须完整**。缺一条 criterion 就是缺一块判断依据，宁可标"未覆盖 + 理由"也不要省略行。
