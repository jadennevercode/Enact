// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  directedPath,
  graphologyGraph,
  groupedGraph,
  neighborhoodDistances,
} from "./graph-scene";
import type { SemanticGraph } from "@enact/core/semantic";
const graph: SemanticGraph = {
  nodes: ["part", "batch", "plant", "policy", "action", "receipt"].map(
    (id) => ({ id, label: id, properties: {}, metadata: {} }),
  ),
  edges: [
    ["part", "batch"],
    ["batch", "plant"],
    ["policy", "action"],
    ["action", "receipt"],
  ].map(([source, target]) => ({
    source: source!,
    target: target!,
    properties: {},
  })),
};
describe("Semantica scoped graph scene", () => {
  it("uses directed paths without reversing a relationship", () => {
    const data = graphologyGraph(graph);
    expect(directedPath(data, "part", "plant")).toEqual([
      "part",
      "batch",
      "plant",
    ]);
    expect(directedPath(data, "plant", "part")).toEqual([]);
    expect(neighborhoodDistances(data, "batch").get("part")).toBe(1);
  });
  it("preserves every real identity in community display groups", () => {
    const display = groupedGraph(graph);
    const members = display.nodes.flatMap((node) =>
      Array.isArray(node.metadata.members) ? node.metadata.members : [node.id],
    );
    expect(new Set(members)).toEqual(
      new Set(graph.nodes.map((node) => node.id)),
    );
    expect(display.nodes.length).toBeLessThan(graph.nodes.length);
    expect(graph.nodes).toHaveLength(6);
    expect(graph.edges).toHaveLength(4);
  });
});
