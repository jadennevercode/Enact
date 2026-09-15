import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { dijkstra } from "graphology-shortest-path";
import type { SemanticGraph, SemanticGraphNode } from "@enact/core/semantic";
import { nodeLabel } from "../graph-presentation";

// Semantica Explorer graphAnalytics and graphSceneState adapted to an injected
// release-scoped graph. Group nodes are display objects, never business facts.
export function graphologyGraph(source: SemanticGraph): Graph {
  const graph = new Graph({
    type: "directed",
    multi: true,
    allowSelfLoops: true,
  });
  source.nodes.forEach((n) => {
    if (!graph.hasNode(n.id))
      graph.addNode(n.id, { original: n, label: nodeLabel(n) });
  });
  source.edges.forEach((e, i) => {
    if (graph.hasNode(e.source) && graph.hasNode(e.target))
      graph.addDirectedEdgeWithKey(
        `${e.id || "edge"}:${i}`,
        e.source,
        e.target,
        { original: e, weight: 1 },
      );
  });
  return graph;
}

export function neighborhoodDistances(
  graph: Graph,
  start: string,
): Map<string, number> {
  const distances = new Map<string, number>();
  if (!graph.hasNode(start)) return distances;
  distances.set(start, 0);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const node = queue[cursor]!;
    for (const neighbor of graph.neighbors(node))
      if (!distances.has(neighbor)) {
        distances.set(neighbor, distances.get(node)! + 1);
        queue.push(neighbor);
      }
  }
  return distances;
}

export function directedPath(
  graph: Graph,
  source: string,
  target: string,
): string[] {
  if (!graph.hasNode(source) || !graph.hasNode(target)) return [];
  return dijkstra.bidirectional(graph, source, target, "weight") || [];
}

export function groupedGraph(source: SemanticGraph): SemanticGraph {
  const graph = graphologyGraph(source);
  if (graph.order < 2 || graph.size === 0) return source;
  const result = louvain.detailed(graph, {
    getEdgeWeight: "weight",
    randomWalk: false,
  });
  const groups = new Map<number, SemanticGraphNode[]>();
  source.nodes.forEach((node) => {
    const group = Number(result.communities[node.id]);
    groups.set(group, [...(groups.get(group) || []), node]);
  });
  const nodes: SemanticGraph["nodes"] = [],
    membership = new Map<string, string>();
  groups.forEach((members, community) => {
    if (members.length === 1) {
      nodes.push(members[0]!);
      membership.set(members[0]!.id, members[0]!.id);
      return;
    }
    const id = `__community__:${community}`;
    members.sort(
      (a, b) =>
        graph.degree(b.id) - graph.degree(a.id) || a.id.localeCompare(b.id),
    );
    nodes.push({
      id,
      label: `${nodeLabel(members[0]!)} +${members.length - 1}`,
      kind: "group",
      properties: {},
      metadata: {
        members: members.map((n) => n.id),
        memberCount: members.length,
      },
      layer: "schema",
    });
    members.forEach((n) => membership.set(n.id, id));
  });
  const byPair = new Map<string, SemanticGraph["edges"][number]>();
  source.edges.forEach((e) => {
    const from = membership.get(e.source),
      to = membership.get(e.target);
    if (!from || !to || from === to) return;
    const key = `${from}:${to}`,
      prior = byPair.get(key);
    byPair.set(key, {
      id: key,
      source: from,
      target: to,
      kind: "group",
      label: String(Number(prior?.properties.count || 0) + 1),
      properties: { count: Number(prior?.properties.count || 0) + 1 },
    });
  });
  return { ...source, nodes, edges: [...byPair.values()] };
}
