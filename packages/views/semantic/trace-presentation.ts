import type { SemanticGraph, SemanticGraphNode } from "@enact/core/semantic";

export function traceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readableFact(value: unknown, registry: unknown): string {
  const terms = traceRecord(registry);
  return String(value ?? "").replace(/\bt_[a-f0-9]{24}\b/g, token => {
    const term = traceRecord(terms[token]);
    return ["string", "number", "boolean"].includes(typeof term.value) ? String(term.value) : token;
  });
}

export function traceStepId(node: SemanticGraphNode, steps: Record<string, unknown>[]): string {
  // Match only a recorded step, including its rule/fact descendants. The native
  // trace stores query IDs in metadata.id, not metadata.step_id.
  return String(steps.find(step => typeof step.id === "string" && (
    node.metadata.step_id === step.id || node.metadata.id === step.id || node.step_id === step.id ||
    node.id === `step:${step.id}` || node.id.startsWith(`step:${step.id}:`)
  ))?.id || "");
}

export function readableTrace<T extends SemanticGraph & { steps: Record<string, unknown>[] }>(trace: T): T {
  return { ...trace, nodes: trace.nodes.map(node => {
    const step = trace.steps.find(step => step.id === traceStepId(node, trace.steps));
    const output = traceRecord(step?.output);
    const statement = node.kind === "fact" || node.kind === "conclusion" ? readableFact(node.label, output.term_registry) : undefined;
    const ruleName = node.kind === "rule" && typeof node.metadata.rule_name === "string" ? node.metadata.rule_name : undefined;
    return { ...node, label: statement || ruleName || node.label };
  }) };
}
