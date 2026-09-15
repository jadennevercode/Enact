import type { DemoCommand, DemoState, DemoMessage, Stage } from "./types";

export const eligible = (email?: string | null, slug?: string | null) =>
  email?.toLowerCase() === "demo@deloittecn.com.cn" && slug === "anyharness";
export const stageLabels: Record<Stage, string> = {
  empty: "尚未创建",
  draft: "待设计",
  team: "待创建构建任务",
  clarify: "需求澄清",
  design: "设计中",
  failed: "待修复",
  ready: "待发布",
  published: "可用 · 演示",
};
export function runtimeStatus(s: DemoState): string {
  if (
    s.visible < s.messages.length &&
    (s.stage === "failed" || s.stage === "ready")
  ) {
    const next = s.messages[s.visible];
    return next?.role === "Independent Verifier"
      ? "验证中"
      : s.stage === "failed"
        ? "构建中"
        : "修复中";
  }
  return s.designRejected ? "设计待修改" : stageLabels[s.stage];
}
export function initialState(): DemoState {
  return {
    schema: 1,
    stage: "empty",
    runtime: null,
    familyAdded: false,
    designRejected: false,
    protectedContext: ["任务目标", "执行约束", "未决问题"],
    memory: "direct",
    tools: "confirm",
    messages: [],
    revisions: [],
    events: [],
    visible: 0,
    trial: "none",
    coderBound: false,
    memoryAccepted: null,
    validation: [],
  };
}
export function suggestions(s: DemoState, issue: "build" | "trial"): string[] {
  if (issue === "trial")
    return s.trial === "write-approval"
      ? ["批准应用补丁", "先解释补丁内容", "暂不批准补丁"]
      : s.trial === "approval"
        ? ["批准运行测试", "先解释本次测试会做什么", "暂不批准测试"]
        : s.trial === "delivered"
          ? ["采纳这条项目记忆", "不采纳这条记忆"]
          : ["查看本次任务的交付依据"];
  switch (s.stage) {
    case "clarify":
      return [
        "主要使用 Python。记忆只在项目内共享，验证后采纳。命令执行前需要确认。",
        "主要使用 TypeScript。记忆只在项目内共享，验证后采纳。命令执行前需要确认。",
      ];
    case "design":
      return [
        "架构决策也必须保留，失败的尝试不能变成长期规则。",
        "解释上下文压缩的依据",
        "不同意当前设计，请修改方案",
        "确认设计，开始构建",
      ];
    case "failed":
      return ["查看验证失败原因", "修复这个问题，再运行一次验证"];
    case "ready":
      return ["暂不发布，保留待发布状态", "确认发布 v1.0"];
    case "published":
      return ["这个 Runtime 是怎么构建出来的？"];
    default:
      return [];
  }
}
function revise(s: DemoState, reason: string) {
  s.designRejected = false;
  s.revisions.push({
    version: `v0.${s.revisions.length + 1}`,
    reason,
    protectedContext: [...s.protectedContext],
    memory: s.memory,
    tools: s.tools,
  });
}
// Only explicit, unconditional whole-sentence approvals advance consequential stages.
function exact(text: string, choices: string[]) {
  return choices.includes(text.replace(/[。！!\s]+$/g, ""));
}
const conditional =
  /如果|假如|除非|是否|能否|可以吗|要不要|也许|可能|等.*再|if\b/i;
export function transition(
  previous: DemoState,
  command: DemoCommand,
  id: string,
  time = new Date().toISOString(),
): DemoState {
  if (previous.events.some((e) => e.id === id)) return previous;
  if (command.type === "reset") return initialState();
  if (command.type === "checkpoint") return checkpoint(command.checkpoint);
  const s: DemoState = structuredClone(previous);
  const say = (
    role: string,
    text: string,
    kind: DemoMessage["kind"] = "comment",
    artifactIds: string[] = [],
    issue: "build" | "trial" = "build",
  ) =>
    s.messages.push({
      id: `${id}-m${s.messages.length}`,
      issue,
      role,
      text,
      kind,
      artifactIds,
      time,
    });
  const runtime = s.runtime;
  switch (command.type) {
    case "create":
      if (s.stage !== "empty" || command.framework !== "Deep Agents")
        return previous;
      s.runtime = {
        id: "demo-runtime-enterprise",
        name: command.name.trim() || "Enterprise Code Runtime",
        goal: command.goal.trim() || "使用内部模型理解项目、修改代码、补充测试",
        framework: command.framework,
        language: "Python",
        version: "草稿",
      };
      s.stage = "draft";
      break;
    case "team":
      if (s.stage !== "draft") return previous;
      s.familyAdded = true;
      s.stage = "team";
      break;
    case "issue":
      if (s.stage !== "team") return previous;
      s.stage = "clarify";
      say(
        "你",
        `帮我们构建 ${runtime?.name}，基于 Deep Agents，使用内部模型。${runtime?.goal}`,
      );
      say(
        "Orchestrator",
        "已建立八个阶段任务。构建 Family 在独立的模拟环境中工作，最终企业 Runtime 由本次任务产出。先由架构师澄清边界，再分别设计机制。",
        "handoff",
      );
      say(
        "Lead Architect",
        "请确认：主要开发语言、记忆的共享范围，以及命令执行是否逐次确认。可编辑下方回复建议后发送。",
      );
      break;
    case "configure":
      if (
        !runtime ||
        s.stage === "published" ||
        s.stage === "ready" ||
        s.stage === "failed"
      )
        return previous;
      runtime.name = command.name.trim() || runtime.name;
      runtime.goal = command.goal;
      runtime.language = command.language;
      s.protectedContext = [
        ...new Set(["任务目标", "执行约束", ...command.protectedContext]),
      ];
      s.memory = command.memory;
      s.tools = command.tools;
      if (s.revisions.length) {
        revise(s, "用户更新机制与企业要求");
        say(
          "Lead Architect",
          `已更新 ${runtime.name} 的目标、语言及机制配置。所有设计卡和工程映射同步使用当前版本。`,
          "artifact",
          ["blueprint", "context", "memory", "tools"],
        );
      }
      break;
    case "bind":
      if (s.stage !== "published" || s.coderBound) return previous;
      s.coderBound = true;
      break;
    case "trial":
      if (!s.coderBound || s.trial !== "none") return previous;
      s.trial = s.tools === "writes" ? "write-approval" : "approval";
      say(
        "你",
        "修复价格计算中的边界错误：折扣为 0 时不应收取负费用。",
        "comment",
        [],
        "trial",
      );
      say(
        "企业编码助手 · Explorer",
        "开始只读探索。上下文包含任务目标、项目规范、价格模块和保护约束；调用 read_file(pricing.py)。发现 quantity = 0 时仍减去优惠金额。",
        "handoff",
        ["trial-context"],
        "trial",
      );
      say(
        "企业编码助手 · Developer",
        `已生成 ${runtime?.language} 示例补丁：先验证输入边界，再计算价格，结果不低于 0。${s.tools === "confirm" ? "请求批准模拟测试：仅检查零数量、负输入、折扣边界与正常价格。" : "写入和执行都需要确认。请先批准应用补丁，再批准测试。"} 无网络和真实命令执行。`,
        "artifact",
        ["patch", "trial-context"],
        "trial",
      );
      break;
    case "tick":
      s.visible = Math.min(s.visible + 1, s.messages.length);
      return s;
    case "reveal":
      s.visible = s.messages.length;
      return s;
    case "comment": {
      const text = command.text.trim();
      if (!text || !runtime) return previous;
      if (s.visible < s.messages.length) return previous;
      say("你", text, "comment", [], command.issue);
      if (command.issue === "trial") {
        if (
          s.trial === "write-approval" &&
          exact(text, ["批准应用补丁"]) &&
          !conditional.test(text)
        ) {
          s.trial = "approval";
          say(
            "企业编码助手 · Developer",
            "补丁写入授权已记录，模拟应用完成。现在请求批准四项价格边界测试。",
            "artifact",
            ["patch"],
            "trial",
          );
        } else if (
          s.trial === "approval" &&
          exact(text, ["批准运行测试", "确认运行测试", "同意运行测试"]) &&
          !conditional.test(text)
        ) {
          s.trial = "delivered";
          say(
            "企业编码助手 · Developer",
            "测试授权已记录。模拟测试 4/4 通过：零数量、负数输入、折扣下限、正常计算。",
            "validation",
            ["trial-report"],
            "trial",
          );
          say(
            "企业编码助手 · Reviewer",
            "独立评审完成：边界保护明确，补丁仅涉及价格函数；未更改权限策略。交付补丁和测试记录。",
            "handoff",
            ["patch", "trial-report"],
            "trial",
          );
          say(
            "企业编码助手",
            "项目记忆候选：价格函数需要先验证输入边界，并确保结果非负。来源：本任务补丁与 4 项模拟测试。作用域：当前项目。请决定是否采纳。",
            "artifact",
            ["candidate"],
            "trial",
          );
        } else if (
          s.trial === "delivered" &&
          exact(text, ["采纳这条项目记忆", "不采纳这条记忆"])
        ) {
          s.memoryAccepted = text === "采纳这条项目记忆";
          s.trial = "complete";
          say(
            "企业编码助手",
            s.memoryAccepted
              ? "已记录用户采纳决定，候选转为项目内已验证记忆。后续使用仍需核对来源版本。"
              : "已拒绝采纳。候选保留在任务记录中，不进入长期记忆。",
            "artifact",
            ["candidate"],
            "trial",
          );
        } else
          say(
            "企业编码助手",
            s.trial === "write-approval"
              ? "写入补丁仍在等待授权。先验证输入边界，再保证结果非负；请明确发送“批准应用补丁”。"
              : s.trial === "approval"
                ? "测试仍在等待授权。仅模拟四个价格边界用例，不执行真实命令。请明确发送“批准运行测试”，或继续讨论。"
                : "本任务的依据是价格补丁、独立评审和模拟测试报告。记忆采纳由你决定。",
            "comment",
            ["patch", "trial-context"],
            "trial",
          );
        break;
      }
      if (/解释|依据|为什么|怎么构建|如何构建|失败原因/.test(text)) {
        say(
          s.stage === "failed" ? "Independent Verifier" : "Lead Architect",
          s.stage === "failed"
            ? "压缩测试 fixture A-07 中，“保留架构约束”的设计没有被工程实现锁定，摘要遗漏一条约束。11/12 通过；发布被阻断。修复会加入 protected decision IDs 与压缩前后集合一致性检查。"
            : s.stage === "published"
              ? "追溯链：原始需求 → 七角色 Family 设计 → 蓝图版本 → 工程预览 → 首次验证失败 → 约束保护修复 → 独立复验 → 用户发布决定。点击产物可逐层查看。"
              : "上下文分为保护区、检索证据、工作历史和输出预算。保护区不参与摘要；长日志保存引用。记忆限定项目范围，验证通过并经用户采纳后才复用。工具授权独立于模型生成内容。",
          "artifact",
          s.stage === "failed"
            ? ["validation-1"]
            : s.stage === "published"
              ? ["release", "validation-2", "blueprint"]
              : s.revisions.length
                ? ["context", "memory", "tools"]
                : [],
        );
        break;
      }
      if (conditional.test(text)) {
        say(
          "Orchestrator",
          "已记录这个条件，尚未执行后续动作。请先明确条件，或使用下方明确的决定建议。",
        );
        break;
      }
      if (
        /暂不|不同意|拒绝|不要(?:发布|构建|开始|批准)|不发布|别发布|不批准/.test(
          text,
        )
      ) {
        if (s.stage === "design" && /设计|方案/.test(text)) {
          s.designRejected = true;
          say(
            "Lead Architect",
            "当前设计已退回修改，构建暂停。请在“编辑设计”中调整保护内容、记忆采纳或工具授权，也可以直接说明具体修改要求。",
          );
        } else say("Orchestrator", "已记录：保持当前阶段，等待你进一步决定。");
        break;
      }
      let changed = false;
      const language = text.match(
        /(?:主要使用|语言(?:改为|设为|是))[：:\s]*(Python|TypeScript|JavaScript|Java|Go)/i,
      )?.[1];
      if (language && ["clarify", "design"].includes(s.stage)) {
        runtime.language = language;
        changed = true;
      }
      const rename = text.match(
        /(?:名称改为|名字改为|重命名为)[：:\s]*([^。\n，,]+)/,
      )?.[1];
      if (rename && ["clarify", "design"].includes(s.stage)) {
        runtime.name = rename.trim();
        changed = true;
      }
      if (["clarify", "design"].includes(s.stage)) {
        if (/架构决策.*保留|保留.*架构决策/.test(text)) {
          s.protectedContext = [
            ...new Set([...s.protectedContext, "架构决策"]),
          ];
          changed = true;
        }
        if (/验证后|验证.*采纳|不能变成长期规则|不要直接复用/.test(text)) {
          s.memory = "verified";
          changed = true;
        }
        if (/直接复用/.test(text) && !/不要|不能|未经/.test(text)) {
          s.memory = "direct";
          changed = true;
        }
        if (/命令.*确认|执行前.*确认|逐次确认/.test(text)) {
          s.tools = "confirm";
          changed = true;
        }
        if (/写入.*确认/.test(text)) {
          s.tools = "writes";
          changed = true;
        }
        if (changed) {
          s.stage = "design";
          revise(s, "根据用户回复更新设计");
          say(
            "Context & Knowledge Designer",
            `已更新蓝图 ${s.revisions.at(-1)?.version}。语言：${runtime.language}。保护内容：${s.protectedContext.join("、")}。记忆：${s.memory === "verified" ? "候选—验证—用户采纳" : "项目内直接复用（待评审）"}。失败尝试留在任务记录，不形成长期规则。`,
            "artifact",
            ["brief", "blueprint", "context", "memory"],
          );
          say(
            "Runtime Systems Designer",
            `工具策略：${s.tools === "confirm" ? "读取允许，命令逐次确认" : "写入和命令均需确认"}。开发、探索与评审通过任务状态交接，评审者独立验证；恢复时检查动作 ID，避免重复执行。`,
            "artifact",
            ["tools", "family", "architecture"],
          );
          break;
        }
      }
      if (
        s.stage === "design" &&
        exact(text, ["确认设计，开始构建", "确认设计,开始构建", "开始构建"])
      ) {
        if (s.designRejected) {
          say(
            "Lead Architect",
            "设计已退回，尚未修改。请先更新具体机制，再确认构建。",
          );
          break;
        }
        say(
          "Orchestrator",
          "设计已确认，交给 Runtime Engineer。Independent Verifier 将独立验收。",
          "handoff",
        );
        say(
          "Runtime Engineer",
          `开始构建 ${runtime.name} 的 ${runtime.language} 工程预览：模型适配、上下文、记忆、工具门禁和协作模块。模拟组装完成，提交独立验证。`,
          "build",
          ["source"],
        );
        s.stage = "failed";
        s.validation.push({
          attempt: 1,
          passed: false,
          reason: "A-07：上下文压缩遗漏架构约束；保护字段未在实现中锁定",
          blueprint: s.revisions.at(-1)?.version || "v0.1",
        });
        say(
          "Independent Verifier",
          "首次验证完成：11/12 通过。A-07 上下文保真失败：摘要遗漏架构约束。已建立缺陷 AH-D01，发布已阻断。请查看失败报告并决定返工。",
          "validation",
          ["validation-1"],
        );
        break;
      }
      if (
        s.stage === "failed" &&
        exact(text, [
          "修复这个问题，再运行一次验证",
          "修复后重新验证",
          "修复并重新验证",
        ])
      ) {
        s.protectedContext = [...new Set([...s.protectedContext, "架构决策"])];
        s.memory = "verified";
        revise(s, "修复 A-07：保护字段固定保留并增加集合一致性断言");
        say(
          "Context & Knowledge Designer",
          "修复方案：架构决策进入不可压缩区；失败尝试仅作为任务证据。蓝图已修订。",
          "artifact",
          ["diff", "context"],
        );
        say(
          "Runtime Engineer",
          "已更新 protected decision IDs、压缩后校验与恢复逻辑；工程快照交给独立验证。",
          "build",
          ["source", "diff"],
        );
        s.validation.push({
          attempt: 2,
          passed: true,
          reason: "12/12 通过；A-07 架构约束在压缩后完整保留",
          blueprint: s.revisions.at(-1)?.version || "v0.2",
        });
        s.stage = "ready";
        say(
          "Independent Verifier",
          "复验完成：12/12 通过。首次失败报告保留，修复证据可追溯。当前为待发布状态，只有明确确认才会发布。",
          "validation",
          ["validation-2", "diff"],
        );
        break;
      }
      if (
        s.stage === "ready" &&
        exact(text, ["确认发布 v1.0", "确认发布v1.0", "确认发布"])
      ) {
        s.stage = "published";
        runtime.version = "v1.0";
        say(
          "Release Maintainer",
          `${runtime.name} v1.0 已发布到本地演示空间。可以创建企业编码助手并绑定此 Runtime。所有模型、构建、测试和运行结果均为模拟。`,
          "artifact",
          ["release"],
        );
        break;
      }
      say(
        "Orchestrator",
        "已记录原话。本演示支持当前阶段的设计修改、机制解释与明确决定；这条输入没有触发状态迁移。可编辑回复建议，或打开设计表单精确修改。",
      );
      break;
    }
  }
  s.events.push({ id, command: command.type, time });
  return s;
}

export function checkpoint(
  target: "design" | "failed" | "published",
): DemoState {
  let s = initialState();
  let i = 0;
  const run = (c: DemoCommand) => {
    s = transition(s, c, `checkpoint-${i++}`, "2026-09-15T09:00:00.000Z");
    s.visible = s.messages.length;
  };
  run({
    type: "create",
    name: "Enterprise Code Runtime",
    goal: "使用企业内部模型理解项目、修改代码、补充测试；独立评审，执行需要授权",
    framework: "Deep Agents",
  });
  run({ type: "team" });
  run({ type: "issue" });
  run({ type: "comment", issue: "build", text: suggestions(s, "build")[0]! });
  run({
    type: "comment",
    issue: "build",
    text: "架构决策也必须保留，失败的尝试不能变成长期规则。",
  });
  if (target === "design") return s;
  run({ type: "comment", issue: "build", text: "确认设计，开始构建" });
  if (target === "failed") return s;
  run({
    type: "comment",
    issue: "build",
    text: "修复这个问题，再运行一次验证",
  });
  run({ type: "comment", issue: "build", text: "确认发布 v1.0" });
  return s;
}
