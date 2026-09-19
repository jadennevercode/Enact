import { validationMatrix } from "./validation-cases";
import { domainRows, agents, skills } from "./catalog";

export const engineeringStages = [
  [
    "discovery",
    "企业约束与验收基线",
    "Lead Architect",
    "请说明开发语言、代码规模、部署环境、内部模型接口，以及禁止自动执行的操作。",
  ],
  [
    "architecture",
    "架构边界与框架适配",
    "Lead Architect",
    "建议保留 Deep Agents 的规划与工具循环，自研上下文组装、授权网关、记忆服务和执行日志。你希望进一步自主控制哪些机制？",
  ],
  [
    "context",
    "上下文工程与知识生命周期",
    "Context & Knowledge Designer",
    "需要确定：哪些内容永不压缩，代码和日志如何失效，记忆由谁验证。你可以要求保留架构决策，或修改上下文预算。",
  ],
  [
    "execution",
    "工具协议、权限与沙箱",
    "Runtime Systems Designer",
    "建议审批绑定命令、参数、工作目录、文件版本和有效期；读取允许，写入及命令分别授权。请确认授权粒度与网络策略。",
  ],
  [
    "orchestration",
    "协作协议与故障恢复",
    "Runtime Systems Designer",
    "Developer 与 Reviewer 独立；工具执行通过持久化动作账本去重。请确认失败后的重试、恢复与人工接管策略。",
  ],
  [
    "review",
    "跨机制设计审查",
    "Independent Verifier",
    "请审阅接口契约、ADR、威胁模型和验收矩阵。可以提出修改意见；明确“通过设计评审”后再拆解实施。",
  ],
  [
    "implementation",
    "实施计划与工程骨架",
    "Runtime Engineer",
    "已拆解模型适配、上下文、记忆、工具、沙箱、协作、状态、遥测八个实施包。请审阅依赖与验收，明确“开始构建”后组装。",
  ],
  [
    "verification",
    "独立验证与缺陷归因",
    "Independent Verifier",
    "阻断项：CTX-07 压缩遗失 ADR；AUTH-04 参数变更后旧批准仍有效；REC-03 恢复时重复执行副作用。可以逐项讨论和修复，也可以要求修复全部阻断项。",
  ],
  [
    "pilot",
    "修复复验与使用验收",
    "Independent Verifier",
    "三项缺陷的历史证据与修复差异已保留。请运行使用验收，检查多轮编码任务、审批中断、超时恢复和记忆污染防护。",
  ],
  [
    "release",
    "发布审查与运维交接",
    "Release Maintainer",
    "设计、接口、验证和使用验收已齐备。请审阅版本清单、部署拓扑、监控阈值和回滚步骤，再明确“确认发布 v1.0”。",
  ],
  [
    "published",
    "版本发布与持续演进",
    "Release Maintainer",
    "v1.0 已归档。可以在智能体团队中创建企业编码助手、绑定此 Runtime，并创建编码任务。",
  ],
] as const;

export const engineeringTasks = [
  "企业约束访谈与验收基线",
  "框架能力盘点与替换边界",
  "身份、模型网关与行为循环",
  "上下文分层、预算与压缩契约",
  "代码检索与证据失效",
  "项目记忆的验证、采纳与废弃",
  "Skill 加载与指令优先级",
  "工具 Schema、审批与动作账本",
  "沙箱、网络与工作目录隔离",
  "开发、探索、评审交接协议",
  "会话检查点与崩溃恢复",
  "追踪、成本与性能预算",
  "架构评审与威胁建模",
  "实施包与依赖排序",
  "工程组装与接口联调",
  "独立验收与缺陷修复",
  "使用验收与运维演练",
  "发布冻结与版本追溯",
];

export interface EngineeringConfig {
  name: string;
  framework: string;
  language: string;
  objective: string;
  protected: string[];
  memory: string;
  approval: string;
  contextBudget: number;
}

export function engineeringDocument(
  kind: string,
  c: EngineeringConfig,
  version: number,
  fixes: string[],
): string {
  const header = `# ${c.name} / ${kind}\n\n版本：0.${version} · 负责人：AnyHarness Runtime Builders\n\n`;
  const trace =
    "\n\n## 变更控制\n\n所有变更必须关联构建 Issue、决策记录、接口版本与验收用例。工程师不能签署自己的独立验收。发布只接受审批后的基线，未决阻断项不得豁免。";
  const contracts = `\n\n## 核心接口契约\n\n\`\`\`typescript\ninterface TaskEnvelope {\n  taskId: string; projectId: string; actorId: string;\n  objective: string; acceptance: string[];\n  constraints: { id: string; text: string; source: string }[];\n  budget: { inputTokens: number; outputTokens: number; toolCalls: number };\n}\ninterface ToolIntent {\n  actionId: string; taskId: string; tool: string;\n  args: Record<string, unknown>; cwd: string;\n  inputVersion: string; risk: 'read'|'write'|'execute';\n}\ninterface ApprovalGrant {\n  actionId: string; intentHash: string; approverId: string;\n  expiresAt: string; consumedAt?: string;\n}\ninterface Handoff {\n  task: TaskEnvelope; role: string; artifactRefs: string[];\n  protectedIds: string[]; openQuestions: string[]; checkpointId: string;\n}\n\`\`\`\n\n错误契约：MODEL_TIMEOUT 可退避重试；APPROVAL_REQUIRED 暂停；STALE_APPROVAL 必须重新批准；BUDGET_EXCEEDED 交给用户；CONTEXT_INVARIANT_FAILED 终止当前压缩并保留原文。`;
  const body: Record<string, string> = {
    需求与验收基线: `## 场景与边界\n\n${c.objective}\n\n主要语言：${c.language}。部署：企业内网，模型接入经内部网关，代码不出项目授权边界。单次任务以可审查补丁为交付单位，不允许自动合并或部署。\n\n## 需要确认的假设\n\n1. 模型网关支持流式响应、工具消息和稳定请求 ID。\n2. 项目知识具有来源版本；不能把向量检索命中直接当作已确认事实。\n3. Sandbox 可以阻止外网、限制工作目录及进程资源。\n4. 任务恢复必须查明副作用是否已经完成，再决定重试。\n\n## 验收条件\n\n|领域|条件|证据|\n|---|---|---|\n|上下文|压缩后目标、约束、ADR 完整|CTX-01…08|\n|记忆|跨项目不能读取，未验证不能复用|MEM-01…06|\n|权限|授权与具体动作及版本绑定|AUTH-01…06|\n|恢复|同一动作不重复产生副作用|REC-01…06|\n|协作|评审不能被开发角色替代|ORCH-01…05|\n|交付|补丁、用例、评审和引用可追溯|DEL-01…05|\n\n## 非目标\n\n本轮不提供通用自主运维、不自动迁移数据库、不承诺任意仓库的无人值守交付。`,
    框架适配与架构决策: `## 决策 ADR-001：基础与企业机制边界\n\n基础框架：${c.framework}。保留框架的单 Agent 调用循环与可扩展工具入口；企业层负责身份、上下文、授权、记忆、协作与生命周期。框架不是企业 Runtime 的完整替代品。\n\n|方案|收益|代价|处置|\n|---|---|---|---|\n|直接使用默认 Harness|起步快|企业授权与状态契约不受控|不作为完整方案|\n|在框架上加入明确边界|保留生态与企业控制|需实现适配与一致性测试|选用|\n|重写所有循环与工具栈|控制程度高|故障面与维护成本最大|保留后续评估|\n\n## 组件与调用方向\n\n\`\`\`mermaid\nflowchart TD\n U[Issue / 用户] --> O[任务协调器]\n O --> C[上下文组装]\n K[版本化知识] --> C\n M[项目记忆门禁] --> C\n C --> L[框架 Agent 循环]\n L --> G[企业模型网关]\n L --> P[工具策略与授权]\n P --> A[动作账本]\n A --> S[项目沙箱]\n S --> R[独立评审]\n R --> O\n O --> E[事件日志与检查点]\n\`\`\`\n\n## 适配器职责\n\nFrameworkAdapter 只翻译事件与工具契约，不拥有授权权力。ModelGatewayAdapter 统一超时、限额、取消与错误。ToolExecutor 不能自行创建 ApprovalGrant。MemoryStore 不能跳过验证状态。${contracts}`,
    上下文与知识设计: `## 上下文分层\n\n预算 ${c.contextBudget} tokens。保护区 4k；检索证据 8k；工作历史 ${Math.max(0, c.contextBudget - 16000)}；输出预留 4k。预算需使用所选模型 tokenizer 实测，不能把字符数当 token 数。\n\n保护内容：${c.protected.join("、")}。\n\n|层|来源|进入条件|失效条件|\n|---|---|---|---|\n|身份与规则|企业策略、项目规范|版本匹配且来源可信|策略版本更新|\n|任务保护区|目标、约束、架构决策|结构化 ID 完整|用户显式撤销|\n|知识证据|代码、检索引用|项目权限与文件版本有效|文件 hash 变化|\n|工作历史|观察、工具结果、失败尝试|当前任务相关|任务结束或被更新覆盖|\n|长期经验|已验证并采纳的记忆|同项目、适用条件满足|来源或规则版本失效|\n\n## 压缩算法\n\n1. 从事件日志重建 requiredProtectedIds，不依赖摘要自行回忆。\n2. 对历史观察去重；保留文件路径、行号、版本与原始日志引用。\n3. 仅压缩工作历史，保护区原样携带。\n4. 比较输出与输入的保护 ID 集合；任何丢失触发 CONTEXT_INVARIANT_FAILED。\n5. 组装失败退回上一个可用检查点，保留未压缩证据供人工核查。\n\n## CTX-07 回归夹具\n\n输入：ADR-001 禁止绕过企业网关；历史日志占预算 90%。期望：压缩后仍含 ADR-001 与其来源。需防止的失败模式：只保护标签而未保护 ID 内容，摘要丢失约束。${fixes.includes("CTX-07") ? "修复：required_ids 在压缩前冻结并作集合一致性断言；缺失时不提交摘要。" : "当前需在工程验证阶段确认保护机制，不以设计文字代替实现证据。"}${contracts}`,
    记忆生命周期与检索规范: `## 状态机\n\n候选 → 证据验证 → 用户采纳 → 活跃 → 过期 / 撤销。策略：${c.memory}。失败尝试属于任务记录，不能直接变成一般规则。\n\n## MemoryRecord\n\n\`\`\`json\n{"id":"MEM-PRICE-001","project_id":"pricing-service","kind":"verified_practice","statement":"输入校验先于价格计算","source_issue":"ANYH-102","source_revision":"patch-02","evidence":["DEL-03","MEM-04"],"status":"candidate","applies_when":"价格规则版本一致","invalidated_by":"pricing-policy version change"}\n\`\`\`\n\n## 写入与读取门禁\n\n写入先检查敏感信息、来源与可验证性；多个失败记录不能被投票聚合成事实。读取按项目权限、状态、适用条件和源版本过滤，再进行相关性排序。事实冲突保留各自来源，交给用户裁决。\n\n## 检索策略\n\n先符号和路径检索，再语义召回；限制候选数量；重复片段去重；引用包含 commit / file hash。无命中时说明证据不足，不制造来源。\n\n## 用例\n\nMEM-01 跨项目读取拒绝；MEM-02 未采纳候选不注入；MEM-03 敏感数据脱敏；MEM-04 来源变更后失效；MEM-05 冲突记录不覆盖；MEM-06 用户撤销后不可继续复用。`,
    工具授权与沙箱契约: `## 工具策略\n\n当前策略：${c.approval}。\n\n|工具|输入契约|权限|副作用与恢复|\n|---|---|---|---|\n|read_file|规范化路径、版本|项目内允许|无副作用；版本变化重新读取|\n|search_code|查询、项目范围|只读允许|引用必须绑定文件版本|\n|write_patch|base hash、diff、路径集合|审批|提交前比较 base hash|\n|run_tests|命令、参数、cwd、超时|审批|动作账本记录开始与结束|\n|network_request|域名、目的、数据分类|默认拒绝|仅企业白名单|\n|merge / deploy|目标与审批记录|拒绝自动执行|交由企业发布系统|\n\n## 审批不变量\n\nintentHash = hash(tool + args + cwd + projectId + inputVersion)。授权一次性消费；审批后任何参数变更都要求新凭证。工具输出永远不能授予自己权限。\n\n## 沙箱\n\n每任务独立工作目录；只读挂载源快照；写入层单独保存补丁。禁用宿主凭证继承、限制 CPU/内存/进程数、设置墙钟超时。路径校验需解析符号链接后的真实路径。\n\n## AUTH-04\n\n复现场景：用户批准 pytest tests/unit，随后参数变为 curl external.example。期望拒绝；${fixes.includes("AUTH-04") ? "修复后比较完整意图 hash，过期或不匹配凭证不能消费。" : "仅比较工具名称属于阻断安全缺陷，必须纳入工程验收。"}${contracts}`,
    "协作、会话与恢复协议": `## 角色边界\n\n构建 Family 负责研发 Runtime；运行时内部采用 Explorer（只读证据）、Developer（补丁）、Reviewer（独立验收）。两组角色不共用执行身份。\n\n## 协作状态\n\nassigned → exploring → implementing → awaiting_approval → validating → reviewing → delivered。评审失败返回 implementing；用户取消进入 cancelled，随后所有未消费授权失效。\n\n## 持久化顺序\n\n1. 写入 ToolIntent 与 actionId。\n2. 记录用户批准及 intentHash。\n3. 原子登记 executing，才允许执行副作用。\n4. 保存结果与产物引用，再提交 succeeded 与检查点。\n5. 恢复时查询账本：succeeded 复用结果；executing 先对账，不能盲目重试。\n\n## REC-03 故障注入\n\n在“补丁写入完成、检查点提交前”崩溃。需防止恢复后再次写入。${fixes.includes("REC-03") ? "修复：使用 actionId + base revision 做幂等键；对账已存在的目标 hash 后补记完成状态。" : "验收要求副作用至多发生一次，无法对账时转人工接管。"}\n\n## 重试与预算\n\n读取最多重试 2 次；模型超时指数退避；写入类工具不得自动重试。单任务最多 20 次工具调用，连续 3 次无进展交给用户。${contracts}`,
    实施分解与工程目录: `## 工程边界\n\n目标代码库语言：${c.language}；Runtime 核心采用 Python，项目语言支持由代码检索、补丁与测试适配器提供。框架适配与企业机制分包，依赖方向不能倒置。\n\n\`\`\`text\nenterprise-runtime/\n  contracts/task.schema.json\n  adapters/framework_adapter.py\n  adapters/model_gateway.py\n  context/budget.py\n  context/protected_set.py\n  context/compactor.py\n  knowledge/retriever.py\n  memory/repository.py\n  memory/adoption_policy.py\n  tools/intent.py\n  tools/approval.py\n  execution/sandbox.py\n  execution/action_ledger.py\n  orchestration/handoff.py\n  state/checkpoint.py\n  telemetry/events.py\n  tests/fixtures/context_loss.json\n  tests/faults/crash_after_effect.py\n  deployment/values.internal.yaml\n\`\`\`\n\n|包|依赖|完成定义|\n|---|---|---|\n|P1 契约与模型适配|需求基线|错误、取消与流式消息契约稳定|\n|P2 上下文与知识|P1|保护集合、预算、引用失效通过|\n|P3 记忆|P1/P2|作用域和生命周期门禁通过|\n|P4 工具与审批|P1|意图、版本、授权消费契约通过|\n|P5 沙箱与动作执行|P1/P4|路径、网络边界与资源限制通过|\n|P6 多角色协作|P2/P3/P4|角色权限与交接验收通过|\n|P7 状态与恢复|P5/P6|账本对账与故障注入通过|\n|P8 观测与验收|P1…P7|事件可关联，预算可核验|\n\n## 关键实现差异\n\n\`\`\`diff\n- compact(history)\n+ compact(history, immutable_protected_ids)\n+ assert required_ids <= assembled_context.ids\n- approve(tool_name)\n+ approve(hash(tool, args, cwd, project, input_revision))\n- retry(tool)\n+ reconcile(action_ledger[action_id], artifact_hash)\n\`\`\`\n\n## 集成风险\n\n框架升级可能改变工具消息格式；流式取消可能留下未闭合事件；tokenizer 差异会影响预算。三者都有适配层契约测试，不交给业务 Agent 自行处理。`,
    验证矩阵与故障证据: `## 验证分层\n\n共 36 项场景：CTX 8、MEM 6、AUTH 6、REC 6、ORCH 5、DEL 5。分别执行契约校验、状态迁移、故障注入和端到端使用验收。\n\n|缺陷|输入与触发|首次观察|期望|当前处置|\n|---|---|---|---|---|\n|CTX-07|长日志迫使压缩|ADR-001 消失|保护字段原样保留|${fixes.includes("CTX-07") ? "已修复并复验" : "阻断"}|\n|AUTH-04|批准后替换参数|旧批准仍可用|新意图必须重新批准|${fixes.includes("AUTH-04") ? "已修复并复验" : "阻断"}|\n|REC-03|副作用后崩溃|恢复重复写入|对账后复用结果|${fixes.includes("REC-03") ? "已修复并复验" : "阻断"}|\n\n首次结果：33/36。当前关闭 ${fixes.length}/3 阻断项。原始失败快照和每次修复保持独立，不覆盖旧报告。\n\n## 证据要求\n\n每项包含输入夹具、预期、实际输出、事件轨迹、构建版本、验证者和重现步骤。仅有“通过”标签不能作为发布依据。\n\n## 使用验收\n\n多文件编码任务中断后恢复；工具参数变化重新批准；独立评审退回一次补丁；未采纳记忆不能注入下一任务；内部模型不可用时有明确失败语义。`,
    发布清单与运维手册: `## 发布单元\n\n${c.name} v1.0，基础 ${c.framework}；冻结需求、ADR、接口 Schema、工程目录、验证夹具与策略版本。\n\n## 部署拓扑\n\n入口 / Issue 适配器 → 编排服务 → 企业模型网关；工具执行在独立沙箱池；检查点与动作账本在事务存储；知识索引与记忆访问经项目授权。凭证由企业密钥服务注入，不进入 Skill 正文。\n\n## 就绪检查\n\n内部模型契约、沙箱隔离、存储迁移、审批回调、审计脱敏均需通过。角色权限与项目范围由企业管理员确认。\n\n## 监控与告警\n\n保护字段丢失零容忍；旧授权复用零容忍；恢复重复副作用零容忍。观察模型超时、审批等待时长、无进展循环、token 预算、检索引用失效率。\n\n## 回滚\n\n停止新任务接入 → 等待或取消在途动作 → 撤销未消费授权 → 固定检查点快照 → 回切上一个框架/策略组合 → 重放只读验证 → 经负责人确认后恢复接入。不得跨不兼容 Schema 直接重放副作用。\n\n## 后续演进\n\n接入额外语言与仓库、预算基准、模型切换回归、记忆质量评测、策略例外流程。每项均需新的构建 Issue 与版本。`,
  };
  if (kind === "二十领域机制蓝图")
    return (
      header +
      domainRows
        .map(
          ([domain, choice, module, check], i) =>
            `## H${String(i + 1).padStart(2, "0")} ${domain}\n\n**方案**：${i === 4 ? c.protected.join("、") : i === 6 ? c.memory : i === 8 || i === 11 ? c.approval : choice}。\n\n**模块**：${module}；输入来自 TaskEnvelope 和项目策略，输出必须带来源与版本。\n\n**不变量**：${check}。\n\n**实现与验证**：契约校验 → 正常路径 → 失败/权限边界 → 中断恢复；证据关联当前构建版本。\n\n**设计取舍**：优先显式、可恢复的状态变化；能力增加必须评估对上下文预算、审批与恢复的影响。`,
        )
        .join("\n\n") +
      trace
    );
  return (
    header +
    (body[kind] || body["框架适配与架构决策"]) +
    (kind === "验证矩阵与故障证据"
      ? "\n\n## 逐项验收记录\n\n" + validationMatrix(fixes)
      : "") +
    trace
  );
}

export function fullSkillContent(index: number): string {
  const s = skills[index]!;
  const owners = agents.filter((a) => a.skills.includes(s.id));
  return `---\nname: ${s.name}\nversion: 1.0.0\n---\n\n# ${s.name}\n\n${s.purpose}\n\n## 触发条件\n\n${s.trigger}。入口必须携带构建 Issue、目标版本、项目范围及上游产物引用。\n\n## 输入契约\n\n${s.input}。检查来源版本、权限与完整性；缺少关键约束时先澄清，不推断用户批准。\n\n## 执行步骤\n\n1. 阅读需求基线和适用的 ADR，列出显式假设。\n2. 盘点关联领域 ${s.domains.map((n) => "H" + String(n).padStart(2, "0")).join("、")}，明确继承、自研、替换与暂缓项。\n3. 给出至少两个方案及其控制程度、维护成本、故障面与迁移代价。\n4. 为选定方案定义输入、输出、状态、不变量、错误与恢复语义。\n5. 更新接口契约、实现映射与验收矩阵；为失败路径编写重现夹具。\n6. 生成版本差异，指出对其他机制的影响，交给独立角色审查。\n\n## 输出与完成定义\n\n${s.output}。每项产物必须可由需求、决策、实现与测试双向追溯；不能用笼统的“已完成”替代证据。\n\n## 交接\n\n负责角色：${owners.map((a) => a.name).join("、")}。交接包含待决事项、风险、引用与下一角色的验收条件。\n\n## 禁止事项\n\n不得自行批准敏感动作；不得把未验证结论写成事实；不得覆盖失败证据；工程实施者不能给自己的变更签署独立验收。`;
}
