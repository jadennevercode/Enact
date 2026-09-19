import type { StorageAdapter } from "../types/storage";
import type { Agent, Issue, IssueTableQuerySpec, User } from "../types";
import {
  createNativeRepository,
  localId,
  type NativeRepository,
} from "./native-repository";

export interface NativeIdentity {
  user: Pick<User, "id" | "email" | "name"> | null;
  slug: string | null;
  workspaceId: string | null;
}
export function isNativeWorkspace(identity: NativeIdentity) {
  return (
    identity.user?.email?.toLowerCase() === "demo@deloittecn.com.cn" &&
    identity.slug === "anyharness" &&
    !!identity.workspaceId
  );
}
let storageAdapter: StorageAdapter | undefined;
let loadCompleteExample = true;
const repositories = new Map<string, NativeRepository>();
export function configureNativeStorage(storage: StorageAdapter, completeExample = true) {
  storageAdapter = storage;
  loadCompleteExample = completeExample;
  repositories.clear();
}
export function getNativeRepository(identity: NativeIdentity) {
  if (
    !isNativeWorkspace(identity) ||
    !storageAdapter ||
    !identity.user ||
    !identity.workspaceId
  )
    return null;
  const key = `${identity.user.id}:${identity.workspaceId}`;
  let repo = repositories.get(key);
  if (!repo) {
    repo = createNativeRepository(
      storageAdapter,
      identity.user,
      identity.workspaceId,
    );
    const exampleKey = `${repo.key}:complete-example-v1`;
    if (loadCompleteExample && storageAdapter.getItem(exampleKey) !== "loaded") {
      repo.completeExample();
      storageAdapter.setItem(exampleKey, "loaded");
    }
    repositories.set(key, repo);
  }
  return repo;
}

// Only identity/account reads are passed through while this workspace is active.
// Native feature methods resolve locally; an unimplemented action fails closed.
const identityMethods = new Set([
  "getBaseUrl",
  "listWorkspaces",
  "getWorkspace",
  "getMe",
  "getConfig",
  "getInboxUnreadSummary",
  "getNotificationPreferences",
  "getWorkspaceProfile",
  "getWorkspaceSetup",
  "listMyInvitations",
  "getWorkspaceSubscriptionEntitlements",
  "getWorkspaceSubscriptionSummary",
  "getWorkspaceSubscriptionPrices",
]);
const workspaceFirstArgument = new Set([
  "listRuntimeProfiles",
  "getRuntimeProfile",
  "createRuntimeProfile",
  "updateRuntimeProfile",
  "listMembers",
  "listWorkspaceMcpServers",
  "listPluginInstallations",
  "listPluginPackages",
  "listVCSConnections",
  "listGitHubInstallations",
  "listLarkInstallations",
  "listSlackInstallations",
  "listDingTalkInstallations",
  "listWecomInstallations",
  "listTelegramInstallations",
]);
function containsLocalReference(
  value: unknown,
  seen = new Set<object>(),
): boolean {
  if (typeof value === "string") return value.startsWith("a11a0000-");
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((child) =>
    containsLocalReference(child, seen),
  );
}
const rejectLocalReference = async () => {
  throw new Error("此对象不属于当前工作区。");
};
export function resolveNativeOperation(
  identity: NativeIdentity,
  method: string,
  args: unknown[],
): (() => Promise<unknown>) | undefined {
  if (!isNativeWorkspace(identity)) {
    // Local entity references must never be sent to a real workspace.
    if (containsLocalReference(args)) return rejectLocalReference;
    return undefined;
  }
  if (
    identityMethods.has(method) ||
    (method.startsWith("set") &&
      ["setToken", "setWorkspaceSlug"].includes(method))
  )
    return undefined;
  const first = args[0];
  const explicit =
    typeof first === "object" && first !== null
      ? "workspace_id" in first
        ? String(first.workspace_id)
        : "workspaceId" in first
          ? String(first.workspaceId)
          : null
      : workspaceFirstArgument.has(method) && typeof first === "string"
        ? first
        : null;
  if (explicit && explicit !== identity.workspaceId)
    return containsLocalReference(args) ? rejectLocalReference : undefined;
  const repo = getNativeRepository(identity);
  if (!repo) return undefined;
  return async () => nativeOperation(repo, method, args);
}
function required<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("找不到当前工作区中的对象");
  return structuredClone(v);
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function nativeOperation(
  repo: NativeRepository,
  method: string,
  args: unknown[],
): unknown {
  const s = repo.get(),
    a = String(args[0] ?? ""),
    data = asRecord(args[0]),
    second = asRecord(args[1]);
  const issues = s.issues;
  const findIssue = (id: string) =>
    issues.find((i) => i.id === id || i.identifier === id);
  const list = (q?: Partial<IssueTableQuerySpec>) =>
    issues.filter((i) => {
      const f = q?.filters;
      if (f?.include_sub_issues === false && i.parent_issue_id) return false;
      if (
        q?.scope?.kind === "workspace" &&
        q.scope.assignee_types?.length &&
        (!i.assignee_type || !q.scope.assignee_types.includes(i.assignee_type))
      )
        return false;

      if (
        q?.search &&
        !`${i.title} ${i.identifier}`
          .toLowerCase()
          .includes(q.search.toLowerCase())
      )
        return false;
      if (f?.statuses?.length && !f.statuses.includes(i.status)) return false;
      if (f?.priorities?.length && !f.priorities.includes(i.priority))
        return false;
      if (
        f?.assignees?.length &&
        !f.assignees.some(
          (x) => x.id === i.assignee_id && x.type === i.assignee_type,
        )
      )
        return false;
      if (q?.scope?.kind === "assignee" && i.assignee_id !== q.scope.actor.id)
        return false;
      if (q?.scope?.kind === "creator" && i.creator_id !== q.scope.actor.id)
        return false;
      return true;
    });
  switch (method) {
    case "semanticRequest":
      if (second.method && second.method !== "GET")
        throw new Error("此工作区未启用语义写入操作。");
      if (a.startsWith("/constructions/for-issue/"))
        throw Object.assign(new Error("无关联本体构建"), { status: 404 });
      if (/^\/agents\/[^/]+\/ontologies$/.test(a)) return { assignments: [] };
      return [];

    case "listAgents":
      return structuredClone(
        s.agents.filter((x) => data.include_archived || !x.archived_at),
      );
    case "getAgent":
      return required(s.agents.find((x) => x.id === a));
    case "createAgent":
      return repo.createAgent(data as Partial<Agent>);
    case "updateAgent": {
      const agent = s.agents.find((x) => x.id === a);
      if (!agent) throw new Error("智能体不存在");
      Object.assign(agent, second);
      repo.save();
      return structuredClone(agent);
    }
    case "archiveAgent":
    case "deleteAgent": {
      const agent = s.agents.find((x) => x.id === a);
      if (agent) {
        agent.archived_at = new Date().toISOString();
        repo.save();
      }
      return;
    }
    case "listRuntimes":
      return repo.runtimes();
    case "listRuntimeProfiles":
    case "listMyRuntimeProfiles":
      return repo.profiles();
    case "getRuntimeProfile":
      return required(
        repo.profiles().find((x) => x.id === String(args[1] || args[0])),
      );
    case "listMachines":
      return repo.runtimes().map((r) => ({
        id: r.machine_id,
        workspace_id: repo.workspaceId,
        name: r.metadata.machine_name,
        custom_name: r.metadata.machine_name,
        owner_id: repo.user.id,
        daemon_id: r.daemon_id,
        status: r.status,
        hostname: r.metadata.hostname,
        platform: "linux",
        arch: "x64",
        created_at: r.created_at,
        updated_at: r.updated_at,
        last_seen_at: r.last_seen_at,
      }));
    case "listSkills":
      return repo.getSkills();
    case "getSkill":
      return required(repo.getSkills().find((x) => x.id === a));
    case "listSkillVersions":
      return {
        versions: [
          {
            id: localId(400),
            skill_id: a,
            version: 1,
            change_summary: "企业 Runtime 工程能力基线",
            created_at: "2026-09-01T09:00:00Z",
            created_by: repo.user.id,
          },
        ],
        total: 1,
      };
    case "getSkillVersion":
      return { ...repo.getSkills().find((x) => x.id === a), version: 1 };
    case "setAgentSkillEnabled": {
      const agent = s.agents.find((x) => x.id === a);
      const skill = agent?.skills.find((x) => x.id === String(args[1]));
      if (skill) {
        skill.enabled = Boolean(args[2]);
        repo.save();
      }
      return;
    }
    case "listAgentSkills":
      return repo
        .getSkills()
        .filter((x) =>
          s.agents.find((v) => v.id === a)?.skills.some((v) => v.id === x.id),
        );
    case "setAgentSkills":
    case "addAgentSkills": {
      const agent = s.agents.find((x) => x.id === a);
      if (agent) {
        const ids = (
          Array.isArray(args[1]) ? args[1] : second.skill_ids || []
        ) as string[];
        agent.skills = repo
          .getSkills()
          .filter((x) => ids.includes(x.id))
          .map((x) => ({
            id: x.id,
            name: x.name,
            description: x.description,
            enabled: true,
          }));
        repo.save();
        return agent.skills;
      }
      return [];
    }
    case "listSquads":
      return [repo.family()];
    case "getSquad":
      return required(a === repo.family().id ? repo.family() : undefined);
    case "listSquadMembers":
      return s.agents.slice(0, 7).map((v, i) => ({
        id: localId(300 + i),
        squad_id: a,
        member_type: "agent",
        member_id: v.id,
        role: i === 0 ? "leader" : "member",
        created_at: v.created_at,
      }));
    case "getSquadMemberStatus":
      return {
        members: s.agents.slice(0, 7).map((v) => ({
          member_type: "agent",
          member_id: v.id,
          status: "idle",
          active_issues: issues.filter(
            (i) => i.assignee_id === v.id && i.status === "in_progress",
          ),
          last_active_at: null,
        })),
      };
    case "listMembers":
      return [
        {
          id: repo.user.id,
          workspace_id: repo.workspaceId,
          user_id: repo.user.id,
          role: "owner",
          name: repo.user.name || "项目负责人",
          email: repo.user.email,
          avatar_url: null,
          created_at: "2026-09-01T09:00:00Z",
        },
      ];
    case "getIssue":
      return required(findIssue(a));
    case "quickCreateIssue": {
      const issue = repo.createIssue({
        title: String(data.prompt || "构建企业 Runtime").split("\n")[0]!,
        description: String(data.prompt || ""),
        priority: (data.priority || "medium") as Issue["priority"],
        parent_issue_id: (data.parent_issue_id || null) as string | null,
      });
      return { task_id: issue.id };
    }
    case "createIssue":
      return repo.createIssue(data as Partial<Issue>);
    case "updateIssue":
      return repo.updateIssue(a, second as Partial<Issue>);
    case "deleteIssue": {
      s.issues = s.issues.filter((i) => i.id !== a);
      repo.save();
      return;
    }
    case "listIssues":
    case "searchIssues": {
      const filtered = issues.filter(
        (i) =>
          (!data.assignee_id || i.assignee_id === data.assignee_id) &&
          (!data.q || i.title.includes(String(data.q))) &&
          (!data.parent_issue_id || i.parent_issue_id === data.parent_issue_id),
      );
      return { issues: structuredClone(filtered), total: filtered.length };
    }
    case "listChildIssues":
      return {
        issues: structuredClone(issues.filter((i) => i.parent_issue_id === a)),
      };
    case "listChildrenByParents":
      return {
        issues: structuredClone(
          issues.filter((i) =>
            (args[0] as string[]).includes(i.parent_issue_id || ""),
          ),
        ),
      };
    case "getChildIssueProgress":
      return {
        progress: issues.map((i) => {
          const children = issues.filter((x) => x.parent_issue_id === i.id);
          return {
            parent_issue_id: i.id,
            total: children.length,
            done: children.filter((x) => x.status === "done").length,
            hidden_total: 0,
          };
        }),
      };
    case "listIssueTableGroups": {
      const rows = list(data.query as IssueTableQuerySpec);
      const group = asRecord(data.group);
      const grouped = new Map<string, Issue[]>();
      rows.forEach((i) => {
        const key =
          group.kind === "assignee"
            ? i.assignee_id || "unassigned"
            : group.kind === "parent"
              ? i.parent_issue_id || "root"
              : i.status;
        grouped.set(key, [...(grouped.get(key) || []), i]);
      });
      return {
        query_fingerprint: `native-${s.revision}`,
        total: rows.length,
        groups: [...grouped].map(([key, r]) => ({
          key:
            group.kind === "status" || group.kind === "status_category"
              ? `${group.kind}:${key}`
              : key,
          value:
            group.kind === "assignee"
              ? {
                  kind: "assignee",
                  actor: r[0]?.assignee_id
                    ? { type: r[0].assignee_type, id: r[0].assignee_id }
                    : null,
                }
              : group.kind === "parent"
                ? {
                    kind: "parent",
                    parent_id: r[0]?.parent_issue_id,
                    parent: findIssue(r[0]?.parent_issue_id || "") || null,
                    value_state: key === "root" ? "unset" : "value",
                  }
                : { kind: "status", status: key },
          count: r.length,
        })),
        next_cursor: null,
      };
    }
    case "listIssueTableRows": {
      let rows = list(data.query as IssueTableQuerySpec);
      const group = asRecord(data.group);
      if (data.parent_id)
        rows = rows.filter((i) => i.parent_issue_id === data.parent_id);
      else if (asRecord(data.hierarchy).enabled)
        rows = rows.filter((i) => !i.parent_issue_id);
      if (data.group_key)
        rows = rows.filter((i) =>
          group.kind === "assignee"
            ? (i.assignee_id || "unassigned") === data.group_key
            : group.kind === "parent"
              ? (i.parent_issue_id || "root") === data.group_key
              : i.status ===
                String(data.group_key).replace(/^status(_category)?:/, ""),
        );
      return {
        query_fingerprint: `native-${s.revision}`,
        group_key: data.group_key || null,
        parent_id: data.parent_id || null,
        total: rows.length,
        branch_total: rows.length,
        rows: rows.map((i) => ({
          issue: structuredClone(i),
          direct_child_count: issues.filter((x) => x.parent_issue_id === i.id)
            .length,
        })),
        next_cursor: null,
      };
    }
    case "listIssueTableFacets": {
      const query = data.query as IssueTableQuerySpec;
      const rows = list(query);
      const statuses = list({
        ...query,
        filters: { ...query.filters, statuses: undefined },
      });
      const counts = (items: Issue[], key: (i: Issue) => string) =>
        [...new Set(items.map(key))].map((k) => ({
          key: k,
          count: items.filter((i) => key(i) === k).length,
        }));
      return {
        query_fingerprint: `native-${s.revision}`,
        total: rows.length,
        facets: [
          { kind: "status", values: counts(statuses, (i) => i.status) },
          { kind: "priority", values: counts(rows, (i) => i.priority) },
          {
            kind: "assignee",
            values: counts(rows, (i) =>
              i.assignee_id
                ? `${i.assignee_type}:${i.assignee_id}`
                : "unassigned",
            ),
          },
          { kind: "working_agents", values: [] },
        ],
      };
    }
    case "listGroupedIssues":
      return {
        groups: s.agents.map((agent) => ({
          assignee_type: "agent",
          assignee_id: agent.id,
          issues: issues.filter((i) => i.assignee_id === agent.id),
          total: issues.filter((i) => i.assignee_id === agent.id).length,
        })),
      };
    case "listComments":
      return structuredClone(
        s.comments.filter((c) => c.issue_id === (findIssue(a)?.id || a)),
      );
    case "listTimeline":
      return s.comments
        .filter((c) => c.issue_id === (findIssue(a)?.id || a))
        .map((c) => ({
          ...structuredClone(c),
          type: "comment",
          actor_type: c.author_type,
          actor_id: c.author_id,
          comment_type: c.type,
        }));
    case "createComment":
      return repo.createComment(a, String(args[1]));
    case "updateComment": {
      const c = s.comments.find((c) => c.id === a);
      if (!c) throw new Error("评论不存在");
      c.content = String(args[1]);
      repo.save();
      return structuredClone(c);
    }
    case "previewCommentTriggers":
      return { agents: [] };
    case "previewIssueTrigger":
      return { triggers: [], total_count: 0 };
    case "listAttachments":
      return s.files
        .filter((f) => f.attachment.issue_id === a)
        .map((f) => ({ ...f.attachment }));
    case "getAttachment":
      return required(s.files.find((f) => f.attachment.id === a)?.attachment);
    case "getAttachmentTextContent":
      return {
        text: required(s.files.find((f) => f.attachment.id === a)?.content),
        originalContentType: s.files.find((f) => f.attachment.id === a)!
          .attachment.content_type,
      };
    case "getAttachmentBlob":
      return new Blob(
        [required(s.files.find((f) => f.attachment.id === a)?.content)],
        {
          type: s.files.find((f) => f.attachment.id === a)!.attachment
            .content_type,
        },
      );
    case "listIssueArtifacts": {
      const files = s.files.filter(
        (f) =>
          f.attachment.issue_id === a ||
          issues.some(
            (i) => i.id === f.attachment.issue_id && i.parent_issue_id === a,
          ),
      );
      return {
        artifacts: files.map((f) => ({
          ...f.attachment,
          owner_issue_id: f.attachment.issue_id,
          owner_issue_identifier: findIssue(f.attachment.issue_id || "")
            ?.identifier,
          owner_issue_number: findIssue(f.attachment.issue_id || "")?.number,
          owner_issue_title: findIssue(f.attachment.issue_id || "")?.title,
        })),
        total: files.length,
        truncated: false,
        scope_issue_id: a,
      };
    }
    case "listIssueStatuses": {
      const categories = [
        "backlog",
        "todo",
        "in_progress",
        "in_review",
        "done",
        "blocked",
        "cancelled",
      ];
      return {
        categories,
        total: 7,
        statuses: categories.map((key, i) => ({
          id: localId(500 + i),
          workspace_id: repo.workspaceId,
          key,
          name: [
            "待规划",
            "待处理",
            "进行中",
            "待评审",
            "已完成",
            "阻塞",
            "已取消",
          ][i],
          description: "",
          category: key,
          color: [
            "#71717a",
            "#71717a",
            "#3b82f6",
            "#a855f7",
            "#22c55e",
            "#ef4444",
            "#71717a",
          ][i],
          is_system: true,
          position: i,
          archived_at: null,
          created_at: "2026-09-01T09:00:00Z",
          updated_at: "2026-09-01T09:00:00Z",
        })),
      };
    }
    case "listLabels":
    case "listLabelsForIssue":
    case "listLabelsForResource":
      return { labels: [], total: 0 };
    case "listProperties":
      return { properties: [], total: 0 };
    case "listQuickActions":
      return { quick_actions: [], total: 0 };
    case "listIssueViews":
      return [];
    case "getIssueViewPreference":
      return null;
    case "listWorkspaceResources":
      return { resources: [], total: 0 };
    case "listAgentKnowledge":
      return { knowledge_sources: [], total: 0 };
    case "listIssuePullRequests":
      return { pull_requests: [] };
    case "listPendingChatTasks":
      return { tasks: [] };
    case "getActiveTasksForIssue":
      return { tasks: [] };
    case "getWorkspaceWorkingAgents":
      return [];
    case "getUnreadInboxCount":
      return { count: 0 };
    case "getIssueUsage":
      return {
        issue_id: a,
        total_cost_usd: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_tokens: 0,
        by_agent: [],
        agents: [],
      };
    case "getRuntimeUsage":
      return [];
    case "getAgentEnv":
      return { custom_env: {}, env: {} };
    case "listAutopilots":
      return { autopilots: [], total: 0 };
    case "listPluginInstallations":
      return { installations: [], total: 0 };
    case "listPluginPackages":
      return { packages: [], total: 0 };
    case "listVCSConnections":
      return { connections: [] };
    case "listGitHubInstallations":
    case "listLarkInstallations":
    case "listSlackInstallations":
    case "listDingTalkInstallations":
    case "listWecomInstallations":
    case "listTelegramInstallations":
      return { installations: [] };
    case "listCloudRuntimeNodes":
      return { nodes: [], total: 0 };
    case "listChatSessions":
    case "listChatPinnedAgents":
    case "listPins":
    case "listInbox":
    case "listArchivedInbox":
    case "getAgentTaskSnapshot":
    case "listAgentTasks":
    case "listTasksByIssue":
    case "listTaskMessages":
    case "listIssueSubscribers":
    case "getAssigneeFrequency":
    case "listWorkspaceMcpServers":
    case "listAgentMcpServers":
    case "listComposioConnections":
    case "listComposioToolkits":
    case "getWorkspaceAgentActivity30d":
    case "getWorkspaceAgentRunCounts":
    case "getRuntimeTaskActivity":
    case "getRuntimeUsageByAgent":
    case "getRuntimeUsageByHour":
    case "listOntologies":
    case "listContextCheckpoints":
    case "listContextSessions":
      return [];
    default:
      throw new Error(`当前工作区尚未配置此能力（${method}）。`);
  }
}
