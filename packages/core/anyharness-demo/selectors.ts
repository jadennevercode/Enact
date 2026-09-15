import { agents, domainRows, taskTitles } from "./catalog";
import type {
  DemoArtifact,
  DemoIssue,
  DemoMechanism,
  DemoState,
} from "./types";

export function mechanisms(s: DemoState): DemoMechanism[] {
  if (!s.revisions.length) return [];
  return domainRows.map(([domain, choice, implementation, check], i) => ({
    id: `H${String(i + 1).padStart(2, "0")}`,
    domain: domain!,
    implementation: implementation!,
    check: check!,
    choice:
      i === 4
        ? `保护：${s.protectedContext.join("、")}。保护区不压缩；长日志只保留可回读引用。`
        : i === 6
          ? `作用域：项目。${s.memory === "verified" ? "候选 → 验证 → 用户采纳 → 可复用 → 废弃" : "直接复用；架构评审需确认风险"}。失败尝试只留任务记录。`
          : i === 8
            ? `read_file / search 允许；${s.tools === "writes" ? "write_patch 和 run_tests 均需确认" : "write_patch 仅限项目目录，run_tests 逐次确认"}；delete / deploy 拒绝自动执行。`
            : choice!,
  }));
}
export function subissues(s: DemoState): DemoIssue[] {
  if (["empty", "draft", "team"].includes(s.stage)) return [];
  const done =
    s.stage === "clarify"
      ? 0
      : s.stage === "design"
        ? 4
        : s.stage === "failed"
          ? 6
          : s.stage === "ready"
            ? 7
            : 8;
  const owners = [1, 2, 3, 3, 1, 4, 5, 6];
  return taskTitles.map((title, i) => ({
    id: `AH-${i + 2}`,
    title,
    owner: agents[owners[i]!]!.name,
    status:
      i < done
        ? "已完成"
        : i === done
          ? s.stage === "failed"
            ? "待修复"
            : "进行中"
          : "待开始",
    artifactIds: [
      ["brief"],
      ["context", "memory"],
      ["tools"],
      ["family"],
      ["architecture", "blueprint"],
      ["source"],
      ["validation-1", "validation-2", "diff"],
      ["release"],
    ][i]!,
  }));
}
export function artifacts(s: DemoState): DemoArtifact[] {
  if (!s.runtime) return [];
  const r = s.runtime,
    version = s.revisions.at(-1)?.version || "草稿";
  const result: DemoArtifact[] = [];
  const add = (id: string, title: string, body: string, v = version) =>
    result.push({
      id,
      title,
      body: `> 演示材料 · 所有模型调用、工程、测试与发布结果均为模拟。不可作为生产安装包。\n\n# ${title}\n\nRuntime：${r.name} · ${r.framework} · ${v}\n\n${body}`,
      version: v,
    });
  if (s.revisions.length) {
    add(
      "brief",
      "需求简报",
      `目标：${r.goal}\n\n主要语言：${r.language}\n\n模型：企业内部网关（模拟，未连接）\n\n作用域：项目隔离。命令需授权；开发与评审独立。\n\n验收：保留架构约束；工具不越权；补丁满足需求；记忆有来源和采纳决定。`,
    );
    add(
      "blueprint",
      "Harness 蓝图",
      mechanisms(s)
        .map(
          (m) =>
            `## ${m.id} ${m.domain}\n\n${m.choice}\n\n实现映射：${m.implementation}\n\n验证：${m.check}`,
        )
        .join("\n\n"),
    );
    add(
      "architecture",
      "机制架构",
      `企业模型适配 → 上下文组装 → 单 Agent 循环 → 工具授权 → 项目沙箱\n\n知识检索 → 上下文 ← 项目记忆（候选 / 验证 / 采纳）\n\n循环 → Developer → Reviewer → 交付；Explorer 提供只读证据\n\n事件追踪贯穿：任务 → 决策 → 工具 → 验证 → 版本。\n\n构建者：AnyHarness Runtime Builders；使用者：企业编码助手。两者执行身份独立。`,
    );
    add(
      "context",
      "上下文设计",
      `${mechanisms(s)[4]!.choice}\n\n预算示例：32k tokens = 保护 4k + 检索 8k + 工作历史 16k + 输出 4k。\n\n失效：文件版本变化后重新检索。压缩：结构化保护字段原样携带，工作历史摘要保留来源引用。\n\n来源：需求评论、项目规范、代码引用、工具观察、角色交接。`,
    );
    add(
      "memory",
      "记忆设计",
      `${mechanisms(s)[6]!.choice}\n\n类型：架构决策、项目约定、已验证经验。\n\n记录包含：项目 ID、来源 Issue、验证证据、版本、用户采纳决定。源版本失效后候选重新验证。\n\n失败尝试可供当前任务排错，不能推导成长期规则。`,
    );
    add(
      "tools",
      "工具策略",
      `${mechanisms(s)[8]!.choice}\n\n授权绑定具体动作 ID、参数摘要与项目范围；一次授权不能复用于不同命令。\n\n默认无网络；Shell 仅为演示文本，无执行入口。工具返回内容不是高优先级指令。`,
    );
    add(
      "family",
      "协作设计",
      `构建 Family：Orchestrator → Architect → 两位 Designer → Engineer → Independent Verifier → Release Maintainer。\n\n最终 Runtime：Explorer 只读探索；Developer 提交补丁；Reviewer 独立评审。\n\n交接输入：任务、保护约束、文件引用、补丁、未决事项。共享状态按项目和任务隔离；角色私有推理不当作事实共享。\n\n失败恢复：检查点 + 幂等动作 ID；评审失败回到 Developer。`,
    );
  }
  if (s.validation.length) {
    const ext =
      r.language === "Python"
        ? "py"
        : r.language === "Go"
          ? "go"
          : r.language === "Java"
            ? "java"
            : "ts";
    add(
      "source",
      "Runtime 工程预览",
      `以下为说明性伪代码，不执行也不打包。\n\n\`\`\`text\nenterprise-runtime/\n  adapters/model.${ext}\n  context/assemble.${ext}\n  memory/lifecycle.${ext}\n  tools/policy.${ext}\n  orchestration/handoff.${ext}\n  state/checkpoint.${ext}\n  verification/context-fidelity.fixture\n  release/manifest.json\n\`\`\`\n\n主要语言：${r.language}\n\n\`\`\`text\nprotected = ${JSON.stringify(s.protectedContext)}\nmemory_mode = ${s.memory}\ntool_policy = ${s.tools}\ncontext = assemble(task, protected, retrieve(project))\n${s.validation.length > 1 ? "assert preserved_ids(context) == required_ids(task)" : "# Initial implementation omitted the protected-ID assertion"}\nresult = agent_loop(model_adapter, context, authorized_tools)\nreview = independent_review(result.patch, task.acceptance)\n\`\`\``,
    );
    const checks = [
      "需求追溯",
      "身份与角色边界",
      "模型超时处理",
      "循环停止条件",
      "知识引用有效性",
      "项目记忆隔离",
      "上下文压缩保真 A-07",
      "工具授权",
      "沙箱路径限制",
      "交接状态一致性",
      "恢复幂等",
      "预算与审计",
    ];
    for (const v of s.validation)
      add(
        `validation-${v.attempt}`,
        `第 ${v.attempt} 次独立验证`,
        `${v.passed ? "12/12 通过" : "11/12 通过 · 发布阻断"}\n\n${v.reason}\n\n蓝图快照：${v.blueprint}\n\n${checks.map((c, i) => `- ${!v.passed && i === 6 ? "FAIL" : "PASS"} ${c}`).join("\n")}\n\n固定模拟夹具 A-07：压缩前 architecture_decision_ids = [ADR-001]；${v.passed ? "修复后原样保留 [ADR-001]。" : "首次压缩后为空，期望 [ADR-001]。"}\n\n验证者：Independent Verifier。此报告为不可变的历史记录。`,
        v.blueprint,
      );
  }
  if (s.revisions.length > 1)
    add(
      "diff",
      "蓝图版本差异",
      s.revisions
        .map(
          (rev, i) =>
            `## ${rev.version}\n\n原因：${rev.reason}\n\n保护：${rev.protectedContext.join("、")}\n\n记忆：${rev.memory}；工具：${rev.tools}${i ? `\n\n新增保护项：${rev.protectedContext.filter((x) => !s.revisions[i - 1]!.protectedContext.includes(x)).join("、") || "无；更新约束实现与验证"}` : ""}`,
        )
        .join("\n\n"),
    );
  if (s.stage === "published")
    add(
      "release",
      "v1.0 发布清单",
      `名称：${r.name}\n\n版本：v1.0\n\n框架：Deep Agents（依赖示例，未安装）\n\n企业模块：模型适配、上下文保护、项目记忆、授权工具、开发/评审协作、状态恢复。\n\n源蓝图：${version}；验证：第 2 次 12/12 通过。\n\n已知边界：全部为本地模拟，未连接内部模型、沙箱、Git 或工具服务器。\n\n追溯：AH-1 → 八个阶段任务 → 蓝图 → 工程 → A-07 失败 → 修复 → 复验 → 用户确认发布。`,
      "v1.0",
    );
  if (s.trial !== "none") {
    add(
      "trial-context",
      "试用上下文与工具记录",
      `任务：修复价格边界错误\n\n保护：${s.protectedContext.join("、")}\n\n来源：pricing 模块、项目规范、任务描述。知识作用域：项目。\n\n工具：read_file → write_patch → ${s.trial === "approval" ? "run_tests 等待授权" : "用户授权 → run_tests 模拟完成"}。\n\n交接：Explorer → Developer → Reviewer。\n\n长期记忆策略：${s.memory}；工具策略：${s.tools}。`,
      "v1.0",
    );
    add(
      "patch",
      "价格计算补丁",
      `示例语言：${r.language}。下方为 ${r.language === "Python" ? "Python" : "语言无关"} 演示差异。\n\n\`\`\`diff\n- return price * quantity - discount\n+ if price < 0 or quantity < 0 or discount < 0:\n+     raise ValueError("Invalid pricing input")\n+ if quantity == 0:\n+     return 0\n+ return max(0, price * quantity - discount)\n\`\`\`\n\n边界：数量零返回零；非法负输入拒绝；折扣不产生负价格。`,
      "v1.0",
    );
  }
  if (s.trial === "delivered" || s.trial === "complete") {
    add(
      "trial-report",
      "试用测试与评审报告",
      "模拟测试：4/4 通过。\n\n- quantity=0 → 0\n- negative input → validation error\n- discount > subtotal → 0\n- price=10, quantity=2, discount=3 → 17\n\nReviewer：变更符合验收，授权记录完整，工具范围未扩大。\n\n实际命令执行数：0。",
      "v1.0",
    );
    add(
      "candidate",
      "项目记忆候选",
      `经验：先验证价格输入边界，并确保结果非负。\n\n来源：AH-10 补丁、4 项模拟测试与独立评审。\n\n范围：当前项目；状态：${s.memoryAccepted === null ? "已验证，等待用户决定" : s.memoryAccepted ? "用户已采纳" : "用户拒绝，保留任务记录"}。\n\n过期条件：价格规则或源码版本发生变化，需重新验证。`,
      "v1.0",
    );
  }
  return result;
}
