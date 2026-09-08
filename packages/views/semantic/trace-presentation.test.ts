import { describe, expect, it } from "vitest";
import { semanticGraphNodeSchema, traceSchema } from "@enact/core/semantic";
import { readableFact, readableTrace, traceStepId } from "./trace-presentation";

const token = "t_0123456789abcdef01234567";
describe("recorded ontology trace presentation", () => {
  it("links query nodes and derived facts back to their actual recorded step", () => {
    const steps = [{ id: "query-a" }, { id: "evaluation-b" }];
    expect(traceStepId(semanticGraphNodeSchema.parse({ id: "step:query-a", kind: "query", metadata: { id: "query-a" } }), steps)).toBe("query-a");
    expect(traceStepId(semanticGraphNodeSchema.parse({ id: "step:evaluation-b:rule:digest", kind: "rule" }), steps)).toBe("evaluation-b");
    expect(traceStepId(semanticGraphNodeSchema.parse({ id: "step:absent:fact:digest", metadata: { step_id: "absent" } }), steps)).toBe("");
  });
  it("decodes only scalar terms from the recorded evaluation and preserves unknown tokens", () => {
    expect(readableFact(`stock(${token})`, { [token]: { value: "STOCK-AT01-88213" } })).toBe("stock(STOCK-AT01-88213)");
    expect(readableFact(`complete(${token})`, { [token]: { value: false } })).toBe("complete(false)");
    expect(readableFact(`version(${token})`, { [token]: { value: 0 } })).toBe("version(0)");
    expect(readableFact(`stock(${token})`, { [token]: { value: { injected: "label" } } })).toBe(`stock(${token})`);
  });
  it("never borrows terms from a different evaluation or changes persisted evidence", () => {
    const trace = traceSchema.parse({ nodes: [
      { id: "step:a:fact:one", kind: "fact", label: `stock(${token})` },
      { id: "step:b:fact:two", kind: "fact", label: `stock(${token})` },
      { id: "step:a:rule:one", kind: "rule", label: "rule-id", metadata: { rule_name: "创建遏制草案" } },
    ], edges: [], steps: [{ id: "a", output: { term_registry: { [token]: { value: "STOCK-A" } } } }, { id: "b", output: {} }] });
    const shown = readableTrace(trace);
    expect(shown.nodes.map(node => node.label)).toEqual(["stock(STOCK-A)", `stock(${token})`, "创建遏制草案"]);
    expect(trace.nodes[0]?.label).toBe(`stock(${token})`);
    expect(shown.steps).toBe(trace.steps);
  });
});
