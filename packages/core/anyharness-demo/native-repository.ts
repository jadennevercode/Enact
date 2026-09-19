import type {
  Agent,
  AgentRuntime,
  Attachment,
  Comment,
  Issue,
  RuntimeProfile,
  Skill,
  Squad,
  User,
} from "../types";
import type { StorageAdapter } from "../types/storage";
import { agents as roles, skills as skillSpecs, domainRows } from "./catalog";
import {
  engineeringDocument,
  engineeringStages,
  engineeringTasks,
  fullSkillContent,
  type EngineeringConfig,
} from "./native-content";

export const localId = (n: number) =>
  `a11a0000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
export const builderRuntimeId = localId(1);
export const enterpriseRuntimeId = localId(2);
export const builderFamilyId = localId(3);
const defects = ["CTX-07", "AUTH-04", "REC-03"];
export const defaultEngineeringConfig: EngineeringConfig = {
  name: "Enterprise Code Runtime",
  framework: "Deep Agents",
  language: "Python",
  objective:
    "使用企业内部模型，理解项目、修改代码、补充测试；支持项目记忆、受控工具执行及独立评审。",
  protected: ["任务目标", "执行约束", "未决问题", "架构决策"],
  memory: "项目内共享；候选经过证据验证和用户采纳后才可复用",
  approval: "读取允许；写入和命令执行逐次确认；外网默认拒绝",
  contextBudget: 32000,
};
export interface NativeState {
  schema: 2;
  userId: string;
  workspaceId: string;
  sequence: number;
  revision: number;
  config: EngineeringConfig;
  draft: boolean;
  stage: number;
  buildId: string | null;
  fixes: string[];
  issues: Issue[];
  comments: Comment[];
  files: Array<{ attachment: Attachment; content: string }>;
  agents: Agent[];
  trial: Record<string, "approval" | "memory" | "done">;
  decisions: Array<{ at: string; stage: number; text: string }>;
}
const now = () => new Date().toISOString();
const stageDocs: Record<number, string[]> = {
  0: ["需求与验收基线"],
  1: ["框架适配与架构决策"],
  2: ["上下文与知识设计", "记忆生命周期与检索规范"],
  3: ["工具授权与沙箱契约"],
  4: ["协作、会话与恢复协议"],
  5: ["二十领域机制蓝图"],
  6: ["实施分解与工程目录"],
  7: ["验证矩阵与故障证据"],
  8: ["验证矩阵与故障证据"],
  9: ["发布清单与运维手册"],
};
const stageTaskLimits = [1, 3, 6, 9, 12, 13, 14, 16, 17, 18, 18];
const replies = [
  "已建立需求基线，仍需验证模型网关是否支持工具消息、取消和稳定请求 ID。验收不是“能聊天”，而是补丁、授权、证据、恢复四条链路闭合。下一步盘点基础框架与自主机制边界。",
  "ADR-001 选择适配层方案：基础循环由框架提供；上下文、项目记忆、授权和动作账本由企业掌握。接口分为 TaskEnvelope、ToolIntent、ApprovalGrant 和 Handoff。替换框架时只调整事件翻译，不改变授权语义。",
  "上下文采用保护区、版本化知识、工作历史和已采纳记忆四层。压缩必须验证保护 ID 完整；代码 hash 变化使旧引用失效。记忆候选、证据验证、用户采纳是独立状态，失败尝试只保留在任务记录中。",
  "工具协议已区分读取、写入、命令和外网。批准绑定完整意图 hash、输入版本和工作目录，只消费一次。沙箱拒绝宿主凭证继承。工程实现必须验证符号链接逃逸、参数替换、超时与取消。",
  "Explorer 只收集证据，Developer 交付补丁，Reviewer 独立验收。交接携带保护字段、证据引用和检查点。恢复先对账，再决定是否重试；已发生的副作用不能直接重放。",
  "跨机制审查已建立二十领域追踪。重点检查上下文与权限的交界、记忆来源版本、审批后的输入变更、崩溃后的动作重复。请审阅文档后明确“通过设计评审”，也可以直接提出修改。",
  "实施分为八个包：模型网关、上下文、记忆、工具契约、沙箱、编排、状态恢复、遥测。先冻结接口和夹具，再并行实现；组装后由独立验证角色签署。请审阅工程目录和验收矩阵后回复“开始构建”。",
  "构建快照 build-001 已完成接口联调。独立验证共 36 项，33 项通过，3 项阻断：CTX-07 压缩丢失架构决策、AUTH-04 参数变更复用旧授权、REC-03 恢复时重复写入。已分别建立缺陷 Issue，保留复现步骤、预期、实际和根因。现在不能发布。",
  "复验 36/36 通过。首次失败证据不会被覆盖。还需使用验收：长对话编码、审批中断、取消后的权限撤销，以及任务恢复。请回复“运行使用验收”，或继续追问具体证据。",
  "使用验收已完成：长对话约束保真、暂停后重新校验授权、恢复不重复副作用、未采纳记忆不注入。Release Maintainer 已冻结版本清单、部署契约、监控阈值和回滚步骤。请审阅后明确“确认发布 v1.0”，或暂缓发布。",
  "v1.0 已发布。构建 Family 仍保留在研发控制面；企业编码助手应绑定新的 Enterprise Runtime。可以在智能体团队中新建助手，再创建“修复价格计算中的边界错误”任务。",
];

export function createNativeRepository(
  storage: StorageAdapter,
  user: Pick<User, "id" | "email" | "name">,
  workspaceId: string,
) {
  const key = `enact:anyharness:native:2:${user.id}:${workspaceId}`;
  const listeners = new Set<() => void>();
  let state: NativeState = {
    schema: 2,
    userId: user.id,
    workspaceId,
    sequence: 1000,
    revision: 0,
    config: {
      ...defaultEngineeringConfig,
      protected: [...defaultEngineeringConfig.protected],
    },
    draft: false,
    stage: 0,
    buildId: null,
    fixes: [],
    issues: [],
    comments: [],
    files: [],
    agents: [],
    trial: {},
    decisions: [],
  };
  try {
    const saved = JSON.parse(
      storage.getItem(key) || "null",
    ) as NativeState | null;
    if (
      saved?.schema === 2 &&
      saved.userId === user.id &&
      saved.workspaceId === workspaceId &&
      Array.isArray(saved.issues) &&
      Array.isArray(saved.comments) &&
      Array.isArray(saved.files)
    )
      state = saved;
  } catch {
    /* Invalid or older snapshots start a fresh local space. */
  }
  function save() {
    state = { ...state, revision: state.revision + 1 };
    storage.setItem(key, JSON.stringify(state));
    listeners.forEach((fn) => fn());
  }
  function id() {
    return localId(++state.sequence);
  }
  function getSkills(): Skill[] {
    return skillSpecs.map((s, i) => ({
      id: localId(100 + i),
      workspace_id: workspaceId,
      name: s.name,
      description: s.purpose,
      config: {},
      created_by: user.id,
      created_at: "2026-09-01T09:00:00Z",
      updated_at: "2026-09-01T09:00:00Z",
      enabled: true,
      content: fullSkillContent(i),
      files: [
        {
          id: localId(200 + i),
          skill_id: localId(100 + i),
          path: "references/design-contract.md",
          content: `# ${s.name} / 领域契约\n\n${s.domains
            .map((n) => {
              const [name, choice, module, invariant] = domainRows[n - 1]!;
              return `## H${String(n).padStart(2, "0")} ${name}\n\n选定方案：${choice}\n\n实现映射：${module}\n\n验收不变量：${invariant}`;
            })
            .join(
              "\n\n",
            )}\n\n## 评审示例\n\n收到“${s.input}”后，先记录适用假设，再交付“${s.output}”；每个领域至少包含一条正常路径和一条故障路径。\n\n评审记录应包含输入版本、失败证据、影响范围和负责角色，修复后保留原始失败报告。`,
          created_at: "2026-09-01T09:00:00Z",
          updated_at: "2026-09-01T09:00:00Z",
        },
      ],
    }));
  }
  function makeAgent(name: string, i: number): Agent {
    return {
      id: localId(10 + i),
      workspace_id: workspaceId,
      runtime_id: builderRuntimeId,
      runtime_bound: true,
      name,
      description: roles[i]?.responsibility || "企业项目编码与独立评审",
      instructions: roles[i]
        ? `## 职责\n${roles[i]!.responsibility}\n\n## 输入\n${roles[i]!.input}\n\n## 交付\n${roles[i]!.output}\n\n## 边界\n${roles[i]!.boundary}\n\n工作由构建 Issue 驱动；所有交接带需求、接口版本和验收证据。`
        : "遵循项目约束；读代码、提交补丁、获得授权后验证；独立评审通过才能交付。",
      avatar_url: null,
      runtime_mode: "local",
      runtime_config: {},
      custom_args: [],
      visibility: "workspace",
      permission_mode: "public_to",
      invocation_targets: [
        { target_type: "workspace", target_id: workspaceId },
      ],
      status: "idle",
      max_concurrent_tasks: 1,
      model: "enterprise/code-model",
      owner_id: user.id,
      skills: getSkills()
        .filter((_, j) => roles[i]?.skills.includes(skillSpecs[j]!.id))
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          enabled: true,
        })),
      created_at: "2026-09-01T09:00:00Z",
      updated_at: now(),
      archived_at: null,
      archived_by: null,
    };
  }
  if (!state.agents.length)
    state.agents = roles.map((r, i) => makeAgent(r.name, i));
  function family(): Squad {
    return {
      id: builderFamilyId,
      workspace_id: workspaceId,
      name: "AnyHarness Runtime Builders",
      description: "企业 Runtime 研发团队 · 7 个专业角色 · 17 项工程能力",
      instructions:
        "Orchestrator 管理需求和派工；Architect 冻结接口；Context / Systems Designer 完成机制设计；Engineer 实施；Verifier 独立验收；Release Maintainer 发布。每次交接附带输入基线、交付物、未决问题与验收条件。未经用户批准不越过设计、执行和发布门禁。",
      avatar_url: null,
      leader_id: localId(10),
      creator_id: user.id,
      created_at: "2026-09-01T09:00:00Z",
      updated_at: now(),
      archived_at: null,
      archived_by: null,
      member_count: 7,
      member_preview: roles.map((_, i) => ({
        member_type: "agent",
        member_id: localId(10 + i),
        role: i === 0 ? "leader" : "member",
      })),
    };
  }
  function runtimes(): AgentRuntime[] {
    const base: AgentRuntime = {
      id: builderRuntimeId,
      workspace_id: workspaceId,
      daemon_id: localId(4),
      machine_id: localId(5),
      name: "AnyHarness Build Control",
      custom_name: "AnyHarness Build Control",
      runtime_mode: "local",
      provider: "pi",
      launch_header: "AnyHarness Engineering Control Plane",
      status: "online",
      device_info: "Enterprise Engineering / Linux",
      metadata: {
        hostname: "engineering-control",
        machine_name: "研发控制面",
        platform: "linux",
        cli_version: "0.4.32",
        version: "1.0.0",
      },
      owner_id: user.id,
      visibility: "public",
      profile_id: null,
      last_seen_at: now(),
      created_at: "2026-09-01T09:00:00Z",
      updated_at: now(),
    };
    return state.draft
      ? [
          base,
          {
            ...base,
            id: enterpriseRuntimeId,
            daemon_id: localId(6),
            machine_id: localId(7),
            name: state.config.name,
            custom_name: state.config.name,
            profile_id: null,
            provider: "deepagents",
            status: state.stage === 10 ? "online" : "offline",
            device_info: state.config.framework,
            metadata: {
              hostname: "enterprise-code",
              cli_version: "0.4.32",
              machine_name: state.config.name,
              framework: state.config.framework,
              lifecycle: engineeringStages[state.stage]![1],
              version: state.stage === 10 ? "1.0.0" : `0.${state.revision}`,
              build_issue_id: state.buildId || "",
            },
          },
        ]
      : [base];
  }
  function profiles(): RuntimeProfile[] {
    // Both runtimes are preconfigured; no workspace-wide launch profile is pending.
    return [];
  }
  function newIssue(data: Partial<Issue>): Issue {
    const n = state.issues.length + 101;
    const issue: Issue = {
      id: id(),
      workspace_id: workspaceId,
      number: n,
      identifier: `ANYH-${n}`,
      title: "",
      description: null,
      status: "todo",
      priority: "medium",
      assignee_type: null,
      assignee_id: null,
      creator_type: "member",
      creator_id: user.id,
      parent_issue_id: null,
      position: n,
      stage: null,
      start_date: null,
      due_date: null,
      metadata: {},
      properties: {},
      created_at: now(),
      updated_at: now(),
      ...Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      ),
    };
    state.issues.push(issue);
    return issue;
  }
  function comment(
    issueId: string,
    text: string,
    role: number | null = 0,
  ): Comment {
    const c: Comment = {
      id: id(),
      issue_id: issueId,
      author_type: role === null ? "member" : "agent",
      author_id: role === null ? user.id : localId(10 + role),
      content: text,
      type: "comment",
      parent_id: null,
      reactions: [],
      attachments: [],
      created_at: new Date(Date.now() + state.sequence).toISOString(),
      updated_at: now(),
      resolved_at: null,
      resolved_by_type: null,
      resolved_by_id: null,
    };
    state.comments.push(c);
    return c;
  }
  function artifact(kind: string, issueId = state.buildId!, content?: string) {
    const text = (
      content ||
      engineeringDocument(kind, state.config, state.revision + 1, state.fixes)
    ).replace(
      /版本：0\.\d+/,
      state.stage === 10 ? "版本：1.0" : `版本：0.${state.revision + 1}`,
    );
    const aid = id();
    const attachment: Attachment = {
      id: aid,
      workspace_id: workspaceId,
      issue_id: issueId,
      comment_id: null,
      chat_session_id: null,
      chat_message_id: null,
      uploader_type: "agent",
      uploader_id: localId(11),
      filename: `${kind}-v${state.stage === 10 ? "1.0" : `0.${state.revision + 1}`}.md`,
      url: `/api/attachments/${aid}/download`,
      download_url: `/api/attachments/${aid}/download`,
      markdown_url: `/api/attachments/${aid}/download`,
      content_type: "text/markdown",
      size_bytes: new TextEncoder().encode(text).length,
      created_at: now(),
    };
    state.files.push({ attachment, content: text });
    return attachment;
  }
  function emitStage() {
    if (!state.buildId) return;
    const s = engineeringStages[state.stage]!;
    const role = Math.max(
      0,
      roles.findIndex((r) => r.name === s[2]),
    );
    const c = comment(
      state.buildId,
      `## ${s[1]}\n\n${replies[state.stage]}\n\n**待决事项**\n\n${s[3]}\n\n${engineeringSuggestions(state.stage)}`,
      role,
    );
    c.attachments = (stageDocs[state.stage] || []).map((k) => artifact(k));
    c.attachments.forEach((a) => {
      a.comment_id = c.id;
    });
    syncTasks();
  }
  function syncTasks() {
    const children = state.issues.filter(
      (i) =>
        i.parent_issue_id === state.buildId &&
        typeof i.metadata.work_index === "number",
    );
    const limit = stageTaskLimits[state.stage]!;
    children.forEach((i) => {
      const index = Number(i.metadata.work_index);
      const previous = i.status;
      i.status =
        state.stage === 10 || index < limit - 1
          ? "done"
          : index === limit - 1
            ? "in_progress"
            : "backlog";
      i.updated_at = now();
      if (previous !== i.status && i.status === "done") {
        const docKinds = [
          "需求与验收基线",
          "框架适配与架构决策",
          "框架适配与架构决策",
          "上下文与知识设计",
          "上下文与知识设计",
          "记忆生命周期与检索规范",
          "工具授权与沙箱契约",
          "工具授权与沙箱契约",
          "工具授权与沙箱契约",
          "协作、会话与恢复协议",
          "协作、会话与恢复协议",
          "二十领域机制蓝图",
          "二十领域机制蓝图",
          "实施分解与工程目录",
          "实施分解与工程目录",
          "验证矩阵与故障证据",
          "验证矩阵与故障证据",
          "发布清单与运维手册",
        ];
        const kind = docKinds[index]!;
        const file = [...state.files]
          .reverse()
          .find((f) => f.attachment.filename.startsWith(kind));
        const role = Math.max(
          0,
          state.agents.findIndex((a) => a.id === i.assignee_id),
        );
        const entry = comment(
          i.id,
          `## 交接记录\n\n工作项：${i.title}。当前基线已由主构建 Issue 确认。\n\n交付：${kind}；所有输入、接口、不变量和验收条件见附带文档。\n\n下一阶段：${engineeringStages[state.stage]![1]}。后续基线变更会使当前签署失效，需重新评审。`,
          role,
        );
        if (file) entry.attachments = [file.attachment];
      }
    });
    const root = state.issues.find((i) => i.id === state.buildId);
    if (root) {
      root.status =
        state.stage === 10
          ? "done"
          : state.stage === 7
            ? "blocked"
            : state.stage >= 5
              ? "in_review"
              : "in_progress";
      root.metadata = {
        ...root.metadata,
        phase: engineeringStages[state.stage]![1],
        runtime: state.config.name,
      };
      root.updated_at = now();
    }
  }
  function createBuild(data: Partial<Issue>) {
    if (state.buildId) return state.issues.find((i) => i.id === state.buildId)!;
    state.draft = true;
    const issue = newIssue({
      ...data,
      title: data.title || `构建 ${state.config.name}`,
      description:
        data.description ||
        `${state.config.objective}\n\n基础：${state.config.framework}。企业模型、受控执行、上下文与知识生命周期、独立评审及可恢复协作。\n\n交付标准：二十领域蓝图、接口契约、实施包、验证证据、发布与运维手册。`,
      assignee_type: "squad",
      assignee_id: builderFamilyId,
      status: "in_progress",
    });
    state.buildId = issue.id;
    engineeringTasks.forEach((title, i) => {
      const role = [1, 1, 1, 2, 2, 2, 0, 3, 3, 3, 3, 5, 1, 4, 4, 5, 5, 6][i]!;
      const child = newIssue({
        title,
        description: `## 交付要求\n\n${title}。\n\n输入：父任务的企业约束与当前设计基线。\n输出：选定方案、备选及取舍、接口或实现映射、失败模式与验收证据。\n\n负责人：${roles[role]!.name}。所有结论回写主 Issue；不自行越过审批门禁。`,
        parent_issue_id: issue.id,
        assignee_type: "agent",
        assignee_id: localId(10 + role),
        status: "backlog",
        metadata: { work_index: i },
      });
      comment(
        child.id,
        `已接收工作项：${title}。等待前置基线；可以在此讨论细节，决定将同步到主构建记录。`,
        role,
      );
    });
    comment(
      issue.id,
      "已接收构建委托。18 个工程工作项已分配给 7 个角色。先做约束访谈，再冻结架构与契约，完成实施、独立验证、故障修复及发布交接。构建团队运行于独立研发控制面，最终企业 Runtime 尚未建立。",
      0,
    );
    emitStage();
    return issue;
  }
  function addDefects() {
    defects.forEach((code, i) => {
      if (state.issues.some((x) => x.metadata.defect === code)) return;
      const descriptions = [
        "压缩后 protected_ids 缺少 ADR-001；根因是仅保留标签，未对保护内容做集合断言。修复应冻结 ID 及内容，并在提交摘要前校验。",
        "批准 pytest 后替换命令参数，旧凭证仍可消费；根因是仅校验工具名称。修复应绑定完整 intentHash、输入版本、cwd 和有效期。",
        "在补丁完成而检查点未提交时崩溃，恢复后补丁被重复应用。修复应使用 actionId 和 base revision 幂等键，先对账再重试。",
      ][i]!;
      const bug = newIssue({
        title: `${code} · ${["上下文压缩丢失架构约束", "工具参数变更后授权未失效", "崩溃恢复重复执行副作用"][i]}`,
        description: `## 复现与根因\n\n${descriptions}\n\n严重性：阻断发布。\n验收：原始夹具失败、修复后通过、相邻用例无回退。`,
        parent_issue_id: state.buildId,
        assignee_type: "agent",
        assignee_id: localId(14),
        status: "blocked",
        priority: "urgent",
        metadata: { defect: code },
      });
      comment(bug.id, descriptions, 5);
    });
  }
  function revise(text: string) {
    const c = state.config;
    const before = JSON.stringify(c);
    const name = text.match(
      /(?:名称改为|重命名为|名字改成|Runtime 名称[:：])\s*[“"']?([^\n。！？”"']+)/i,
    );
    if (name) {
      c.name = name[1]!.trim();
      const root = state.issues.find((i) => i.id === state.buildId);
      if (root) root.title = `构建 ${c.name}`;
    }
    const language = text.match(
      /(?:主要语言|语言改为|使用语言|主要使用)[：:\s]*(Python|TypeScript|JavaScript|Java|Go|Rust|C\+\+)/i,
    );
    if (language) c.language = language[1]!;
    const objective = text.match(/(?:目标改为|目标调整为)[:：\s]*(.+)/);
    if (objective) c.objective = objective[1]!;
    if (
      /(?:保留|保护|不能丢|不可压缩)/.test(text) &&
      /(?:架构|ADR)/i.test(text) &&
      !c.protected.includes("架构决策")
    )
      c.protected.push("架构决策");
    const extra = text.match(
      /(?:保护内容增加|保护字段增加|固定保留)[:：\s]*([^。\n]+)/,
    );
    if (extra)
      c.protected = [
        ...new Set([
          ...c.protected,
          ...extra[1]!.split(/[、，,]/).map((s) => s.trim()),
        ]),
      ];
    const budget = text.match(/(?:预算|上下文窗口)[：:\s]*(\d+)\s*(k)?/i);
    if (budget) {
      const n = Number(budget[1]) * (budget[2] ? 1000 : 1);
      if (n >= 16000 && n <= 256000) c.contextBudget = n;
    }
    if (/记忆/.test(text) && /(验证|采纳|不能直接|不要直接)/.test(text))
      c.memory = "项目内共享；候选经过证据验证和用户采纳后才可复用";
    if (
      /(?:命令|工具|写入|测试)/.test(text) &&
      /(执行|写入|逐次|需要|必须|读取)/.test(text) &&
      /(确认|审批|批准)/.test(text) &&
      !/(?:不用|无需|不需要|不必).{0,5}(?:确认|审批|批准)/.test(text)
    )
      c.approval = text;
    if (JSON.stringify(c) !== before) {
      state.decisions.push({ at: now(), stage: state.stage, text });
      return true;
    }
    return false;
  }
  function reply(issue: Issue, text: string) {
    const root = state.buildId!;
    if (state.trial[issue.id]) {
      trialReply(issue, text);
      return;
    }
    const lower = text.trim().replace(/[。！!\s]+$/, "");
    if (/(?:怎么构建|如何构建|追溯|构建过程)/.test(text)) {
      const c = comment(
        issue.id,
        `## 版本追溯\n\n${state.config.name} / ${state.stage === 10 ? "v1.0" : engineeringStages[state.stage]![1]}\n\n构建任务：${state.issues.find((i) => i.id === root)?.identifier}\n\n${state.decisions.map((d, i) => `${i + 1}. ${engineeringStages[d.stage]![1]}：${d.text}`).join("\n")}\n\n设计、首次失败、修复差异与复验报告均保存在本任务附件中；原始记录不覆盖。`,
        6,
      );
      c.attachments = state.files
        .filter((f) => f.attachment.issue_id === root)
        .slice(-3)
        .map((f) => f.attachment);
      return;
    }
    if (/解释|为什么|依据|原因|如何|怎么|\?|？/.test(text)) {
      const kind = /授权|权限|工具|AUTH/.test(text)
        ? "工具授权与沙箱契约"
        : /恢复|编排|REC/.test(text)
          ? "协作、会话与恢复协议"
          : /记忆/.test(text)
            ? "记忆生命周期与检索规范"
            : "上下文与知识设计";
      const c = comment(
        issue.id,
        `针对“${text}”，请看以下设计依据与验收约束。当前阶段保持不变。\n\n${engineeringDocument(kind, state.config, state.revision + 1, state.fixes)}`,
        /记忆|上下文/.test(kind) ? 2 : 3,
      );
      c.attachments = [artifact(kind)];
      return;
    }
    if (
      /^(?:暂不|不要|不批准|不同意|拒绝|先别|暂缓|不通过)/.test(lower) ||
      /(?:如果|假如|是否|等.+再)/.test(text)
    ) {
      comment(
        issue.id,
        "已保留当前基线，本轮不推进审批。请具体指出需要修改的机制、约束或验收条件；修改后重新评审。",
        0,
      );
      return;
    }
    if (state.stage === 10 && /(修改|调整|增加|改为|改成)/.test(text)) {
      comment(
        issue.id,
        "v1.0 已冻结。本条意见作为下一版本提案记录，不修改已发布基线。请创建后续演进 Issue 并重新评审。",
        6,
      );
      return;
    }
    const changed = revise(text);
    if (changed || /(修改|调整|增加|必须|应当|需要保留)/.test(text)) {
      state.decisions.push({ at: now(), stage: state.stage, text });
      const c = comment(
        issue.id,
        `已记录变更请求：${text}\n\n当前配置：${state.config.language}；${state.config.contextBudget} tokens；保护 ${state.config.protected.join("、")}；${state.config.memory}。\n\n影响分析：上下文、工具、协作与验收文档应按此基线联动更新。${changed ? "已更新结构化配置与相关文档。" : "此项已列入待评审约束，尚未视为完成实现。"}\n\n${engineeringSuggestions(state.stage)}`,
        state.stage <= 2 ? 2 : 3,
      );
      c.attachments = [
        "二十领域机制蓝图",
        ...(stageDocs[Math.min(state.stage, 6)] || []),
      ].map((k) => artifact(k));
      if (state.stage >= 6 && state.stage < 10) {
        state.stage = 5;
        state.fixes = [];
        comment(
          root,
          "设计基线发生变化，原验收签署失效。返回跨机制评审，确认后重新构建和验证。",
          5,
        );
        syncTasks();
      }
      return;
    }
    if (state.stage === 7 && /^(?:请)?(?:修复|解决)/.test(lower)) {
      const requested = defects.filter((code) => text.includes(code));
      const selected = requested.length
        ? requested
        : /全部|所有|这些|阻断|问题/.test(text)
          ? defects
          : [];
      if (!selected.length) {
        comment(
          issue.id,
          "请指定 CTX-07、AUTH-04、REC-03，或回复“修复全部阻断项并重新验证”。",
          4,
        );
        return;
      }
      selected.forEach((code) => {
        if (state.fixes.includes(code)) return;
        state.fixes.push(code);
        const bug = state.issues.find((i) => i.metadata.defect === code)!;
        bug.status = "done";
        comment(
          bug.id,
          `修复 ${code}：增加契约校验与回归夹具；原始失败输入保留，故障注入复测通过。关联主任务的验证矩阵可查看前后差异。`,
          4,
        );
      });
      const c = comment(
        root,
        `已修复：${state.fixes.join("、")}。\n\n${36 - defects.length + state.fixes.length}/36 项通过；未解决：${defects.filter((d) => !state.fixes.includes(d)).join("、") || "无"}。\n\n修复未修改历史报告，新增本次复验版本。`,
        5,
      );
      c.attachments = [
        artifact("验证矩阵与故障证据"),
        artifact("实施分解与工程目录"),
      ];
      if (state.fixes.length === 3) {
        state.stage = 8;
        emitStage();
      }
      return;
    }
    const accepted =
      state.stage === 5
        ? /^(通过设计评审|确认设计方案)$/.test(lower)
        : state.stage === 6
          ? /^(开始构建|按方案开始构建)$/.test(lower)
          : state.stage === 8
            ? /^(运行使用验收|开始使用验收)$/.test(lower)
            : state.stage === 9
              ? /^确认发布(?:\s*v?1\.0)?$/i.test(lower)
              : state.stage < 5
                ? /^(确认并继续|继续(?:设计|下一阶段)?|进入下一阶段|采用此方案|确认基线|确认架构|确认上下文方案|确认工具方案|确认协作方案)$/.test(
                    lower,
                  )
                : false;
    if (accepted) {
      state.decisions.push({ at: now(), stage: state.stage, text });
      state.stage++;
      if (state.stage === 7) addDefects();
      emitStage();
      if (state.stage === 10) {
        const c = state.comments
          .filter((entry) => entry.issue_id === root)
          .at(-1)!;
        c.attachments = [
          artifact("发布清单与运维手册"),
          artifact("二十领域机制蓝图"),
        ];
        const manifest = artifact(
          "runtime-manifest",
          root,
          JSON.stringify(
            {
              name: state.config.name,
              version: "1.0.0",
              framework: state.config.framework,
              configuration: state.config,
              build_issue: root,
              accepted_decisions: state.decisions,
              resolved_defects: state.fixes,
              execution: "frontend-local",
              production_ready: false,
            },
            null,
            2,
          ),
        );
        manifest.filename = "runtime-manifest-v1.0.json";
        manifest.content_type = "application/json";
        c.attachments.push(manifest);
      }
      return;
    }
    if (
      state.stage === 0 &&
      /(Python|TypeScript|Java|内网|内部模型|项目内|命令)/i.test(text)
    ) {
      state.decisions.push({ at: now(), stage: 0, text });
      const c = comment(
        root,
        `已将你的回答纳入需求基线：\n\n> ${text}\n\n请核对需求文档中的假设与验收项。确认后回复“确认基线”。`,
        1,
      );
      c.attachments = [artifact("需求与验收基线")];
      return;
    }
    comment(
      issue.id,
      `已记录你的意见。当前停留在「${engineeringStages[state.stage]![1]}」。请明确需要讨论的机制或决定。\n\n${engineeringSuggestions(state.stage)}`,
      0,
    );
  }
  function trialComment(issue: Issue, text: string, role: number) {
    const c = comment(
      issue.id,
      `**企业 Runtime / ${role === 5 ? "独立 Reviewer" : role === 4 ? "Developer" : "Coordinator"}**\n\n${text}`,
      role,
    );
    c.author_id =
      issue.assignee_id ||
      state.agents.find((a) => a.runtime_id === enterpriseRuntimeId)?.id ||
      localId(14);
    return c;
  }
  function createTrial(data: Partial<Issue>) {
    const coder = state.agents.find(
      (a) => a.runtime_id === enterpriseRuntimeId,
    );
    if (!coder) throw new Error("请先创建并绑定企业编码助手。");
    const issue = newIssue({
      ...data,
      title: data.title || "修复价格计算中的边界错误",
      assignee_type: "agent",
      assignee_id:
        data.assignee_type === "agent"
          ? data.assignee_id || coder.id
          : coder.id,
      status: "in_progress",
    });
    state.trial[issue.id] = "approval";
    trialComment(
      issue,
      `## 调查与修改计划\n\n上下文：项目规则、价格模块快照、任务验收及已采纳记忆。Explorer 读取 pricing.py 后发现：负数数量进入折扣分支，Decimal 转换前发生 float 运算。Developer 提出补丁；Reviewer 等待验证证据。\n\n\`\`\`diff\n- return float(price) * quantity * (1-discount)\n+ if quantity < 0: raise ValueError("quantity must be non-negative")\n+ if not 0 <= discount <= 1: raise ValueError("discount out of range")\n+ return (Decimal(str(price)) * quantity * (1-Decimal(str(discount)))).quantize(Decimal("0.01"))\n\`\`\`\n\n**申请执行测试**\n\n工具：run_tests；命令：pytest tests/test_pricing.py；工作目录：/workspace/pricing-service；输入：patch-02；超时：30 秒。批准仅对此意图有效。\n\n请回复“批准运行测试”，或提出修改。`,
      4,
    );
    return issue;
  }
  function trialReply(issue: Issue, text: string) {
    const plain = text.trim().replace(/[。！!]+$/, "");
    if (state.trial[issue.id] === "approval" && plain === "批准运行测试") {
      state.trial[issue.id] = "memory";
      const c = trialComment(
        issue,
        "测试结果：9/9 通过。边界覆盖：0 数量、负数、折扣 0/1/越界、小数精度、空输入和大数。授权已消费，参数变化必须重新批准。\n\nIndependent Reviewer：输入校验在计算前执行；Decimal 全链路避免浮点误差；补丁与用例对应，评审通过。\n\n项目记忆候选：价格输入先校验，再做 Decimal 运算；仅适用于 pricing-policy 当前版本。来源：本 Issue、patch-02、9 项测试。尚未注入长期记忆。请回复“采纳这条记忆”或“拒绝这条记忆”。",
        5,
      );
      c.attachments = [
        artifact(
          "价格模块补丁与评审",
          issue.id,
          "# 价格模块补丁与评审\n\n" +
            state.comments.find((c) => c.issue_id === issue.id)?.content +
            "\n\n## 测试记录\n\n9/9 通过；Reviewer 已签署。\n\n## 追溯\n\nRuntime v1.0；CTX-07 / AUTH-04 / REC-03 修复基线；审批限定 pytest tests/test_pricing.py 和 patch-02。",
        ),
      ];
      issue.status = "in_review";
    } else if (
      state.trial[issue.id] === "memory" &&
      /^(采纳这条记忆|拒绝这条记忆)$/.test(plain)
    ) {
      state.trial[issue.id] = "done";
      issue.status = "done";
      trialComment(
        issue,
        plain.startsWith("采纳")
          ? "已采纳 MEM-PRICE-001。仅同项目、同规则版本、来源仍有效时可检索；规则变更自动失效。补丁、测试、评审与记忆来源已归档。"
          : "候选已拒绝，不进入长期记忆。补丁、测试与独立评审记录仍保留，任务已完成。",
        6,
      );
    } else {
      trialComment(
        issue,
        `当前等待${state.trial[issue.id] === "approval" ? "对指定测试命令的明确批准；回复“批准运行测试”" : "记忆采纳决定；回复“采纳这条记忆”或“拒绝这条记忆”"}。其他评论已记录。`,
        0,
      );
    }
  }
  const repository = {
    key,
    user,
    workspaceId,
    get: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    save,
    getSkills,
    family,
    runtimes,
    profiles,
    configure(config: EngineeringConfig) {
      if (state.buildId)
        throw new Error("已有构建任务，请在原 Issue 中修改设计。");
      state.config = structuredClone(config);
      state.draft = true;
      save();
    },
    createIssue(data: Partial<Issue>) {
      const issue = data.parent_issue_id
        ? newIssue(data)
        : data.assignee_id === builderFamilyId || !state.buildId
          ? createBuild(data)
          : state.stage === 10
            ? createTrial(data)
            : newIssue(data);
      save();
      return structuredClone(issue);
    },
    createComment(issueId: string, text: string) {
      const issue = state.issues.find(
        (i) => i.id === issueId || i.identifier === issueId,
      );
      if (!issue) throw new Error("任务不存在");
      const last = state.comments
        .filter((c) => c.author_type === "member" && c.issue_id === issue.id)
        .at(-1);
      if (
        last?.content === text &&
        Date.now() - Date.parse(last.updated_at) < 1500
      )
        return structuredClone(last);
      const c = comment(issue.id, text, null);
      reply(issue, text);
      save();
      return structuredClone(c);
    },
    createAgent(data: Partial<Agent>) {
      if (data.runtime_id === enterpriseRuntimeId && state.stage !== 10)
        throw new Error("Runtime 尚未发布。");
      const a = {
        ...makeAgent(data.name || "企业编码助手", state.agents.length),
        ...Object.fromEntries(
          Object.entries(data).filter(([, value]) => value !== undefined),
        ),
        id: id(),
      };
      if (!a.instructions.trim())
        a.instructions = makeAgent(a.name, 7).instructions;
      if (!a.description.trim())
        a.description = "企业项目编码、受控工具执行与独立评审";
      if (a.runtime_id === enterpriseRuntimeId && !a.skills.length)
        a.skills = getSkills()
          .filter((x) =>
            [
              "harness-design-context",
              "harness-design-execution",
              "harness-verify",
            ].includes(x.name),
          )
          .map((x) => ({
            id: x.id,
            name: x.name,
            description: x.description,
            enabled: true,
          }));
      state.agents.push(a);
      save();
      return a;
    },
    updateIssue(issueId: string, data: Partial<Issue>) {
      const i = state.issues.find((i) => i.id === issueId);
      if (!i) throw new Error("任务不存在");
      Object.assign(i, data, { updated_at: now() });
      save();
      return i;
    },
    completeExample(): void {
      const issue = state.buildId
        ? state.issues.find((item) => item.id === state.buildId)!
        : repository.createIssue({
            title: `构建 ${state.config.name}`,
            assignee_id: builderFamilyId,
          });
      const send = (text: string) => repository.createComment(issue.id, text);
      const steps = [
        "确认基线", "确认架构", "确认上下文方案", "确认工具方案",
        "确认协作方案", "通过设计评审", "开始构建",
        "修复全部阻断项并重新验证", "运行使用验收", "确认发布 v1.0",
      ];
      while (state.stage < 10) {
        const previous = state.stage;
        if (previous === 0)
          send("主要使用 Python，企业内网部署，记忆项目内共享，命令执行前逐次确认。");
        if (previous === 2) {
          send("上下文预算48000，保护字段增加：审批状态、接口契约、当前代码版本");
          send("记忆必须验证后采纳，不能直接复用；失败尝试保留在任务记录。");
        }
        if (previous === 5) {
          send("不通过当前设计，保护内容还应包括回滚决策和未消费的授权。");
          send("保护字段增加：回滚决策、未消费授权");
        }
        if (previous === 7) {
          send("解释 AUTH-04 的失败原因和修复验收依据");
          for (const code of defects) {
            if (!state.fixes.includes(code)) send(`修复 ${code}`);
          }
        } else {
          if (previous === 9) send("暂缓发布，先核对回滚步骤、监控指标和发布清单。");
          send(steps[previous]!);
        }
        if (state.stage === previous)
          throw new Error(`完整场景未能推进阶段 ${previous}`);
      }
      for (const child of state.issues.filter((item) => item.parent_issue_id === issue.id)) {
        if (child.metadata.complete_example === true) continue;
        const index = Number(child.metadata.work_index);
        const kinds = [
          "需求与验收基线", "框架适配与架构决策", "框架适配与架构决策",
          "上下文与知识设计", "上下文与知识设计", "记忆生命周期与检索规范",
          "工具授权与沙箱契约", "工具授权与沙箱契约", "工具授权与沙箱契约",
          "协作、会话与恢复协议", "协作、会话与恢复协议", "二十领域机制蓝图",
          "二十领域机制蓝图", "实施分解与工程目录", "实施分解与工程目录",
          "验证矩阵与故障证据", "验证矩阵与故障证据", "发布清单与运维手册",
        ];
        const kind = kinds[index] || "验证矩阵与故障证据";
        const owner = Math.max(0, state.agents.findIndex((agent) => agent.id === child.assignee_id));
        const delivery = comment(child.id,
          `## 交付与验收归档\n\n工作项：${child.title}\n\n输入：${state.config.name} 的需求基线、已确认架构与本工作项前置契约。\n\n设计与实现：详见本任务附件「${kind}」，包含选定机制、接口、执行规则与验收条件。\n\n验证：独立验收矩阵 36/36 通过；CTX-07、AUTH-04、REC-03 的首次失败和修复证据保留在主 Issue。\n\n交接：交付物随 v1.0 冻结；后续修改必须重新评审和验证。`, owner);
        const file = artifact(kind, child.id);
        file.comment_id = delivery.id;
        delivery.attachments = [file];
        comment(child.id, `## 独立评审\n\n已核对「${child.title}」的输入基线、实现映射与验收证据，确认与发布版本一致。无未关闭的阻断项。\n\n结论：接受交付，归档至 ${issue.identifier} 的 v1.0 发布记录。`, 5);
        child.metadata.complete_example = true;
      }
      let coder = state.agents.find((agent) => agent.runtime_id === enterpriseRuntimeId);
      if (!coder)
        coder = repository.createAgent({ name: "企业编码助手", runtime_id: enterpriseRuntimeId });
      if (!Object.keys(state.trial).length)
        repository.createIssue({ title: "修复价格计算中的边界错误", assignee_type: "agent", assignee_id: coder.id });
      for (const [issueId, phase] of Object.entries(state.trial)) {
        if (phase === "approval") repository.createComment(issueId, "批准运行测试");
        if (state.trial[issueId] === "memory") repository.createComment(issueId, "采纳这条记忆");
      }
      save();
    },
    reset() {
      storage.removeItem(key);
    },
  };
  return repository;
}
export type NativeRepository = ReturnType<typeof createNativeRepository>;
export function engineeringSuggestions(stage: number) {
  return (
    [
      "可以回复：主要使用 Python，企业内网部署，记忆项目内共享，命令执行逐次确认。核对后回复“确认基线”。",
      "可以讨论保留与替换边界、内部模型协议，或回复“确认架构”。",
      "可以调整保护字段、预算、检索和记忆规则，或回复“确认上下文方案”。",
      "可以讨论审批粒度、网络白名单和沙箱，或回复“确认工具方案”。",
      "可以讨论角色交接、并发、重试和人工接管，或回复“确认协作方案”。",
      "可以要求修改任意机制，或回复“通过设计评审”。",
      "可以查看实施包、依赖和接口，或回复“开始构建”。",
      "可以回复“解释 AUTH-04 的原因”、“修复 CTX-07”或“修复全部阻断项并重新验证”。",
      "可以查看复验差异，或回复“运行使用验收”。",
      "可以回复“暂缓发布”，或“确认发布 v1.0”。",
      "可以询问“这个 Runtime 是怎么构建出来的”，或创建企业编码助手。",
    ][stage] || ""
  );
}
