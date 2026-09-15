// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkpoint, eligible, initialState, transition } from "./engine";
import { artifacts, mechanisms, subissues } from "./selectors";
import { createDemoRepository } from "./repository";
import { agents, skills } from "./catalog";
import type { DemoCommand, DemoState } from "./types";

function driver(seed = initialState()) {
  let s = seed,
    seq = 0;
  return {
    get state() {
      return s;
    },
    run(c: DemoCommand) {
      s = transition(s, c, `test-${seq++}`);
      s = transition(s, { type: "reveal" }, `reveal-${seq++}`);
      return s;
    },
    say(text: string, issue: "build" | "trial" = "build") {
      return this.run({ type: "comment", text, issue });
    },
  };
}
describe("AnyHarness isolated scenario", () => {
  it("walks the full construction, repair, release and trial without executable dependencies", () => {
    const d = driver();
    d.run({
      type: "create",
      name: "Acme Runtime",
      goal: "企业 Python 编码",
      framework: "Deep Agents",
    });
    expect(artifacts(d.state)).toEqual([]);
    expect(subissues(d.state)).toEqual([]);
    d.run({ type: "team" });
    d.run({ type: "issue" });
    expect(subissues(d.state)).toHaveLength(8);
    d.say(
      "主要使用 Python。记忆只在项目内共享，验证后采纳。命令执行前需要确认。",
    );
    d.say("架构决策也必须保留，失败的尝试不能变成长期规则。");
    expect(mechanisms(d.state)).toHaveLength(20);
    expect(d.state.memory).toBe("verified");
    d.say("确认设计，开始构建");
    expect(d.state.stage).toBe("failed");
    const failure = artifacts(d.state).find((a) => a.id === "validation-1");
    expect(artifacts(d.state).find((a) => a.id === "release")).toBeUndefined();
    d.say("修复这个问题，再运行一次验证");
    expect(d.state.stage).toBe("ready");
    expect(artifacts(d.state).find((a) => a.id === "validation-1")).toEqual(
      failure,
    );
    d.say("确认发布 v1.0");
    expect(d.state.runtime?.version).toBe("v1.0");
    d.run({ type: "bind" });
    d.run({ type: "trial" });
    expect(d.state.trial).toBe("approval");
    d.say("批准运行测试", "trial");
    expect(d.state.trial).toBe("delivered");
    d.say("采纳这条项目记忆", "trial");
    expect(d.state.memoryAccepted).toBe(true);
    expect(
      artifacts(d.state).find((a) => a.id === "candidate")?.body,
    ).toContain("用户已采纳");
    expect(subissues(d.state).every((t) => t.status === "已完成")).toBe(true);
  });
  it.each([
    "不要发布",
    "如果通过了就确认发布 v1.0",
    "是否可以发布？",
    "也许确认发布",
    "确认发布？",
    "先别发布",
    "可以吗",
    "请解释发布流程",
  ])("does not approve ambiguous input: %s", (text) => {
    const d = driver(checkpoint("failed"));
    d.say("修复后重新验证");
    d.say(text);
    expect(d.state.stage).toBe("ready");
  });
  it("preserves staged playback, blocks duplicate sends and idempotent commands", () => {
    let s = transition(
      initialState(),
      { type: "create", name: "X", goal: "Y", framework: "Deep Agents" },
      "create",
    );
    expect(
      transition(
        s,
        { type: "create", name: "X", goal: "Y", framework: "Deep Agents" },
        "create",
      ),
    ).toBe(s);
    s = transition(s, { type: "team" }, "team");
    s = transition(s, { type: "issue" }, "issue");
    expect(s.visible).toBe(0);
    expect(
      transition(
        s,
        { type: "comment", issue: "build", text: "确认设计，开始构建" },
        "early",
      ),
    ).toBe(s);
  });
  it("rejects preview-only framework creation", () => {
    for (const framework of ["LangGraph", "Pi"] as const)
      expect(
        transition(
          initialState(),
          { type: "create", name: "x", goal: "y", framework },
          "x",
        ).runtime,
      ).toBeNull();
  });
  it("requires a revised design after rejection and respects both trial approvals", () => {
    const d = driver(checkpoint("design"));
    d.say("不同意当前设计，请修改方案");
    d.say("确认设计，开始构建");
    expect(d.state.stage).toBe("design");
    d.say("写入和命令都需要确认");
    expect(d.state.designRejected).toBe(false);
    expect(d.state.tools).toBe("writes");
    d.say("确认设计，开始构建");
    d.say("修复后重新验证");
    d.say("确认发布");
    d.run({ type: "bind" });
    d.run({ type: "trial" });
    expect(d.state.trial).toBe("write-approval");
    d.say("批准运行测试", "trial");
    expect(d.state.trial).toBe("write-approval");
    d.say("批准应用补丁", "trial");
    expect(d.state.trial).toBe("approval");
    d.say("如果没风险就批准运行测试", "trial");
    expect(d.state.trial).toBe("approval");
    d.say("批准运行测试", "trial");
    d.say("不采纳这条记忆", "trial");
    expect(d.state.memoryAccepted).toBe(false);
  });
  it("keeps edits consistent and exposes complete assets", () => {
    const d = driver(checkpoint("design"));
    d.run({
      type: "configure",
      name: "Finance Runtime",
      goal: "审查计算",
      language: "Go",
      protectedContext: ["架构决策", "审计依据"],
      memory: "verified",
      tools: "writes",
    });
    expect(mechanisms(d.state)[4]?.choice).toContain("审计依据");
    expect(artifacts(d.state).find((a) => a.id === "brief")?.body).toContain(
      "Go",
    );
    d.say("确认设计，开始构建");
    expect(artifacts(d.state).find((a) => a.id === "source")?.body).toContain(
      "model.go",
    );
    expect(skills).toHaveLength(17);
    expect(agents).toHaveLength(7);
    expect(
      agents.every((a) =>
        a.skills.every((id) => skills.some((k) => k.id === id)),
      ),
    ).toBe(true);
  });
  it("isolates identity, restoration, reset and checkpoint state", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) || null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
      removeItem: (k: string) => {
        data.delete(k);
      },
    };
    const a = createDemoRepository(storage, "user1", "workspace1");
    a.dispatch({ type: "checkpoint", checkpoint: "published" }, "seed");
    expect(
      createDemoRepository(storage, "user1", "workspace1").read().stage,
    ).toBe("published");
    expect(
      createDemoRepository(storage, "user2", "workspace1").read().stage,
    ).toBe("empty");
    const b = createDemoRepository(storage, "user1", "workspace2");
    expect(b.read().stage).toBe("empty");
    b.dispatch({ type: "checkpoint", checkpoint: "design" }, "b");
    a.dispatch({ type: "reset" }, "reset");
    expect(b.read().stage).toBe("design");
    expect(eligible("demo@deloittecn.com.cn", "anyharness")).toBe(true);
    expect(eligible("demo@deloittecn.com.cn", "other")).toBe(false);
    expect(eligible("other@example.com", "anyharness")).toBe(false);
    for (const stage of ["design", "failed", "published"] as const) {
      const s: DemoState = checkpoint(stage);
      expect(s.stage).toBe(stage);
      expect(s.visible).toBe(s.messages.length);
    }
  });
});
