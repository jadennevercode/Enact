// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  communityIdFromNodeId,
  neighborsOf,
  normalizeCodeGraphView,
} from "./node-link";

describe("normalizeCodeGraphView", () => {
  it("returns an empty view for nothing", () => {
    expect(normalizeCodeGraphView(null)).toEqual({
      level: "code",
      nodes: [],
      edges: [],
      truncated: false,
      total_nodes: 0,
      total_edges: 0,
    });
  });

  it("accepts `links` as an alias of `edges`", () => {
    const view = normalizeCodeGraphView({
      nodes: [{ id: "a", kind: "code", label: "A" }, { id: "b", kind: "code", label: "B" }],
      links: [{ source: "a", target: "b", relation: "imports" }],
    });
    expect(view.edges).toEqual([{ source: "a", target: "b", relation: "imports" }]);
  });

  it("prefers `edges` when both spellings are present", () => {
    const view = normalizeCodeGraphView({
      nodes: [{ id: "a", kind: "code", label: "A" }, { id: "b", kind: "code", label: "B" }],
      edges: [{ source: "a", target: "b", relation: "calls" }],
      links: [{ source: "b", target: "a", relation: "imports" }],
    });
    expect(view.edges.map((e) => e.relation)).toEqual(["calls"]);
  });

  it("restores the true direction from legacy _src/_tgt", () => {
    const view = normalizeCodeGraphView({
      nodes: [{ id: "a", kind: "code", label: "A" }, { id: "b", kind: "code", label: "B" }],
      edges: [{ source: "b", target: "a", _src: "a", _tgt: "b", relation: "calls" }],
    });
    expect(view.edges[0]).toEqual({ source: "a", target: "b", relation: "calls" });
    expect("_src" in (view.edges[0] as object)).toBe(false);
  });

  it("drops edges whose endpoints were capped away and dedups node ids", () => {
    const view = normalizeCodeGraphView({
      nodes: [{ id: "a", kind: "code", label: "A" }, { id: "a", kind: "code", label: "dup" }],
      edges: [
        { source: "a", target: "zzz", relation: "calls" },
        { source: "a", target: "a", relation: "self" },
      ],
      truncated: true,
      total_nodes: 900,
      total_edges: 5000,
    });
    expect(view.nodes.map((n) => n.label)).toEqual(["A"]);
    expect(view.edges.map((e) => e.relation)).toEqual(["self"]);
    expect(view.truncated).toBe(true);
    expect(view.total_nodes).toBe(900);
  });

  it("falls back to counts when totals are absent and labels to ids", () => {
    const view = normalizeCodeGraphView({ nodes: [{ id: "x", kind: "", label: "" }] });
    expect(view.total_nodes).toBe(1);
    expect(view.nodes[0]?.label).toBe("x");
    expect(view.nodes[0]?.kind).toBe("code");
  });
});

describe("helpers", () => {
  it("reads a community id off the prefixed node id", () => {
    expect(communityIdFromNodeId("c:12")).toBe(12);
    expect(communityIdFromNodeId("c:abc")).toBeNull();
    expect(communityIdFromNodeId("handler_Handler")).toBeNull();
  });

  it("lists undirected neighbours without the node itself", () => {
    const view = normalizeCodeGraphView({
      nodes: ["a", "b", "c"].map((id) => ({ id, kind: "code", label: id })),
      edges: [
        { source: "a", target: "b", relation: "calls" },
        { source: "c", target: "a", relation: "calls" },
        { source: "a", target: "a", relation: "self" },
      ],
    });
    expect(neighborsOf(view, "a").sort()).toEqual(["b", "c"]);
  });
});
