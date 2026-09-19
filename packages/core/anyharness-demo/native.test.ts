import { beforeEach, describe, expect, it } from "vitest";
import {
  configureNativeStorage,
  getNativeRepository,
  resolveNativeOperation,
  type NativeIdentity,
} from "./native-api";
import {
  builderFamilyId,
  defaultEngineeringConfig,
  enterpriseRuntimeId,
} from "./native-repository";
import {
  IssueSchema,
  CommentsListSchema,
  TimelineEntriesSchema,
  ListArtifactsResponseSchema,
  RuntimeUsageListSchema,
} from "../api/schemas";

const identity: NativeIdentity = {
  user: { id: "user-a", name: "Alex", email: "demo@deloittecn.com.cn" },
  slug: "anyharness",
  workspaceId: "workspace-a",
};
let records: Map<string, string>;
const storage = {
  getItem: (k: string) => records.get(k) || null,
  setItem: (k: string, v: string) => {
    records.set(k, v);
  },
  removeItem: (k: string) => {
    records.delete(k);
  },
};
beforeEach(() => {
  records = new Map();
  configureNativeStorage(storage, false);
});
async function call(method: string, ...args: unknown[]) {
  const op = resolveNativeOperation(identity, method, args);
  expect(op).toBeDefined();
  return op!();
}
function start() {
  const r = getNativeRepository(identity)!;
  r.configure(defaultEngineeringConfig);
  const issue = r.createIssue({
    title: "构建 Enterprise Code Runtime",
    assignee_id: builderFamilyId,
  });
  return { r, issue, send: (text: string) => r.createComment(issue.id, text) };
}
function design(send: (t: string) => unknown) {
  for (const text of [
    "主要使用 Python，企业内网部署，命令执行前逐次确认",
    "确认基线",
    "确认架构",
    "确认上下文方案",
    "确认工具方案",
    "确认协作方案",
    "通过设计评审",
    "开始构建",
  ])
    send(text);
}

describe("native AnyHarness data scope", () => {
  it("leaves every operation on other users and workspaces untouched", () => {
    for (const scope of [
      { ...identity, slug: "other", workspaceId: "b" },
      {
        ...identity,
        user: { ...identity.user!, email: "another@example.com" },
      },
      { ...identity, workspaceId: null },
    ])
      for (const method of [
        "listIssues",
        "createIssue",
        "createComment",
        "listRuntimes",
        "createAgent",
      ])
        expect(resolveNativeOperation(scope, method, [{}])).toBeUndefined();
    expect(
      resolveNativeOperation(identity, "listAgents", [
        { workspace_id: "other" },
      ]),
    ).toBeUndefined();
    expect(
      resolveNativeOperation(identity, "listRuntimeProfiles", ["other"]),
    ).toBeUndefined();
    expect(resolveNativeOperation(identity, "getBaseUrl", [])).toBeUndefined();
    expect(
      resolveNativeOperation(identity, "listWorkspaces", []),
    ).toBeUndefined();
  });
  it("fails closed for unimplemented actions and stale local object references", async () => {
    await expect(call("createChatSession", {})).rejects.toThrow("尚未配置");
    const { issue } = start();
    await expect(
      resolveNativeOperation({ ...identity, slug: "other" }, "getIssue", [
        issue.id,
      ])!(),
    ).rejects.toThrow("当前工作区");
    for (const scope of [identity, { ...identity, slug: "other" }]) {
      await expect(
        resolveNativeOperation(scope, "createIssue", [
          {
            workspace_id: "other",
            assignee_id: builderFamilyId,
            metadata: { parent: issue.id },
          },
        ])!(),
      ).rejects.toThrow("当前工作区");
    }
    expect(records.size).toBe(1);
  });
  it("returns native issue/comment/timeline/artifact contracts", async () => {
    const { issue } = start();
    expect(
      IssueSchema.safeParse(await call("getIssue", issue.id)).success,
    ).toBe(true);
    expect(
      CommentsListSchema.safeParse(await call("listComments", issue.id))
        .success,
    ).toBe(true);
    expect(
      TimelineEntriesSchema.safeParse(await call("listTimeline", issue.id))
        .success,
    ).toBe(true);
    expect(
      ListArtifactsResponseSchema.safeParse(
        await call("listIssueArtifacts", issue.id),
      ).success,
    ).toBe(true);
    const files = getNativeRepository(identity)!.get().files;
    const result = await call(
      "getAttachmentTextContent",
      files[0]!.attachment.id,
    );
    expect(result).toMatchObject({
      originalContentType: "text/markdown",
      text: expect.stringContaining("验收条件"),
    });
    expect(
      RuntimeUsageListSchema.safeParse(
        await call("getRuntimeUsage", enterpriseRuntimeId),
      ).success,
    ).toBe(true);
  });
  it("persists independently for each identity and resolved workspace", () => {
    const { r, send } = start();
    send("确认基线");
    const count = r.get().comments.length;
    configureNativeStorage(storage, false);
    const restored = getNativeRepository(identity)!;
    expect(restored.get().stage).toBe(1);
    expect(restored.get().comments).toHaveLength(count);
    expect(
      getNativeRepository({ ...identity, workspaceId: "workspace-b" })!.get()
        .issues,
    ).toHaveLength(0);
  });
  it("serves native board branch keys and status facets from the same issues", async () => {
    start();
    const query = {
      scope: { kind: "workspace" },
      filters: { include_sub_issues: false },
      sort: { field: "created_at", direction: "desc" },
    };
    const result = (await call("listIssueTableGroups", {
      query,
      group: { kind: "status_category" },
    })) as { groups: { key: string; count: number }[] };
    expect(result.groups).toHaveLength(1);
    const branch = (await call("listIssueTableRows", {
      query,
      group: { kind: "status_category" },
      group_key: result.groups[0]!.key,
      hierarchy: { enabled: false },
    })) as { rows: unknown[] };
    expect(branch.rows).toHaveLength(result.groups[0]!.count);
    const facets = (await call("listIssueTableFacets", { query })) as {
      total: number;
      facets: { kind: string; values: { count: number }[] }[];
    };
    expect(facets.total).toBe(1);
    expect(
      facets.facets
        .find((f) => f.kind === "status")!
        .values.reduce((n, v) => n + v.count, 0),
    ).toBe(1);
  });
  it("accepts optional undefined fields from the native agent form", async () => {
    const agent = (await call("createAgent", {
      name: "新角色",
      instructions: undefined,
      description: undefined,
    })) as { instructions: string; description: string };
    expect(agent.instructions.trim().length).toBeGreaterThan(0);
    expect(agent.description.trim().length).toBeGreaterThan(0);
  });
});

describe("engineering lifecycle through native comments", () => {
  it("loads a complete example in a fresh browser and enriches every child without repeating it", () => {
    configureNativeStorage(storage);
    const repo = getNativeRepository(identity)!;
    const snapshot = repo.get();
    expect(snapshot.stage).toBe(10);
    expect(snapshot.issues.find((issue) => issue.identifier === "ANYH-101")?.status).toBe("done");
    const children = snapshot.issues.filter((issue) => issue.parent_issue_id === snapshot.buildId);
    expect(children).toHaveLength(21);
    for (const child of children) {
      expect(child.status).toBe("done");
      expect(snapshot.files.some((file) => file.attachment.issue_id === child.id)).toBe(true);
      expect(snapshot.comments.filter((comment) => comment.issue_id === child.id).length).toBeGreaterThanOrEqual(3);
    }
    expect(Object.values(snapshot.trial)).toEqual(["done"]);
    expect(snapshot.comments.some((comment) => comment.content.includes("33 项通过"))).toBe(true);
    configureNativeStorage(storage);
    expect(getNativeRepository(identity)!.get()).toEqual(snapshot);
  });
  it("completes an older partial browser snapshot while preserving its comments and configuration", () => {
    const { r, send } = start();
    send("确认基线");
    const original = structuredClone(r.get().comments);
    configureNativeStorage(storage);
    const completed = getNativeRepository(identity)!.get();
    expect(completed.stage).toBe(10);
    for (const comment of original) expect(completed.comments).toContainEqual(comment);
    expect(completed.issues.filter((issue) => !issue.parent_issue_id)).toHaveLength(2);
  });
  it("runs design, three independent defects, repair, release, agent binding and approved coding", () => {
    const { r, issue, send } = start();
    expect(r.get().issues).toHaveLength(19);
    expect(r.getSkills()).toHaveLength(17);
    expect(r.get().agents).toHaveLength(7);
    design(send);
    expect(r.get().stage).toBe(7);
    expect(r.get().issues.filter((i) => i.metadata.defect)).toHaveLength(3);
    const failed = r
      .get()
      .files.find((f) => f.attachment.filename.startsWith("验证矩阵"))!.content;
    send("修复 CTX-07");
    expect(r.get().stage).toBe(7);
    expect(r.get().fixes).toEqual(["CTX-07"]);
    send("确认发布 v1.0");
    expect(r.get().stage).toBe(7);
    send("修复全部阻断项并重新验证");
    expect(r.get().stage).toBe(8);
    expect(r.get().files.some((f) => f.content === failed)).toBe(true);
    send("运行使用验收");
    send("暂缓发布");
    expect(r.get().stage).toBe(9);
    send("确认发布 v1.0");
    expect(r.runtimes().find((r) => r.id === enterpriseRuntimeId)?.status).toBe(
      "online",
    );
    expect(r.get().issues.find((i) => i.id === issue.id)?.status).toBe("done");
    const agent = r.createAgent({
      name: "企业编码助手",
      runtime_id: enterpriseRuntimeId,
    });
    const trial = r.createIssue({
      title: "修复价格计算中的边界错误",
      assignee_type: "agent",
      assignee_id: agent.id,
    });
    r.createComment(trial.id, "不要批准运行测试");
    expect(r.get().trial[trial.id]).toBe("approval");
    r.createComment(trial.id, "批准运行测试");
    expect(r.get().trial[trial.id]).toBe("memory");
    r.createComment(trial.id, "拒绝这条记忆");
    expect(r.get().trial[trial.id]).toBe("done");
  });
  it("does not treat denial, conditions, questions or ambiguous text as decisions or edits", () => {
    const { r, send } = start();
    for (const text of [
      "如果上下文预算64000就确认基线",
      "不要修改名称改为 Wrong",
      "是否确认基线？",
      "确认基线但先不要继续",
      "可以吧",
    ])
      send(text);
    expect(r.get().stage).toBe(0);
    expect(r.get().config.contextBudget).toBe(32000);
    expect(r.get().config.name).toBe("Enterprise Code Runtime");
  });
  it("propagates changes and invalidates later validation when baseline changes", () => {
    const { r, send } = start();
    send("名称改为 Finance Runtime");
    send("主要语言：TypeScript");
    send("上下文预算64000，保护字段增加：审批状态、接口契约");
    expect(r.get().config).toMatchObject({
      name: "Finance Runtime",
      language: "TypeScript",
      contextBudget: 64000,
    });
    expect(r.get().config.protected).toContain("审批状态");
    expect(r.get().issues[0]?.title).toBe("构建 Finance Runtime");
    design(send);
    send("上下文预算48000");
    expect(r.get().stage).toBe(5);
    expect(r.get().fixes).toEqual([]);
  });
  it("deduplicates repeated comment submissions and preserves immutable release configuration", () => {
    const { r, send } = start();
    send("确认基线");
    const count = r.get().comments.length;
    send("确认基线");
    expect(r.get().comments).toHaveLength(count);
    for (const t of [
      "确认架构",
      "确认上下文方案",
      "确认工具方案",
      "确认协作方案",
      "通过设计评审",
      "开始构建",
      "修复全部阻断项并重新验证",
      "运行使用验收",
      "确认发布 v1.0",
    ])
      send(t);
    send("名称改为 Should not change");
    expect(r.get().config.name).toBe("Enterprise Code Runtime");
  });
});
