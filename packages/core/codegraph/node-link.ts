import type {
  CodeGraphView,
  CodeGraphViewEdge,
  CodeGraphViewNode,
} from "./schemas";

/**
 * Raw GraphView as the wire may spell it: NetworkX node-link data calls the
 * edge array `links`, and graphs written by older graphify versions kept the
 * true direction in `_src`/`_tgt` while `source`/`target` were flipped for an
 * undirected export. Both spellings are folded into one shape here so no
 * renderer has to know about either.
 */
export interface RawCodeGraphView {
  level?: string;
  nodes?: CodeGraphViewNode[];
  edges?: RawCodeGraphViewEdge[];
  links?: RawCodeGraphViewEdge[];
  truncated?: boolean;
  total_nodes?: number;
  total_edges?: number;
}

export interface RawCodeGraphViewEdge {
  source?: string;
  target?: string;
  _src?: string;
  _tgt?: string;
  relation?: string;
  confidence?: string;
  confidence_score?: number;
  weight?: number;
}

const EMPTY_VIEW: CodeGraphView = {
  level: "code",
  nodes: [],
  edges: [],
  truncated: false,
  total_nodes: 0,
  total_edges: 0,
};

/**
 * Normalize a wire GraphView into the one shape the UI consumes.
 *
 * - `links` is accepted as an alias of `edges` (edges wins when both exist).
 * - `_src`/`_tgt` take precedence over `source`/`target` when present.
 * - Edges whose endpoints are not both in `nodes` are dropped: the container
 *   caps nodes by degree, so a capped view can legitimately carry dangling
 *   edges, and a renderer given one would throw on the missing node.
 * - Duplicate node ids keep the first occurrence.
 */
export function normalizeCodeGraphView(
  raw: RawCodeGraphView | null | undefined,
): CodeGraphView {
  if (!raw) return EMPTY_VIEW;
  const seen = new Set<string>();
  const nodes: CodeGraphViewNode[] = [];
  for (const node of raw.nodes ?? []) {
    if (!node || typeof node.id !== "string" || seen.has(node.id)) continue;
    seen.add(node.id);
    nodes.push({ ...node, kind: node.kind || "code", label: node.label || node.id });
  }
  const rawEdges = raw.edges ?? raw.links ?? [];
  const edges: CodeGraphViewEdge[] = [];
  for (const edge of rawEdges) {
    if (!edge) continue;
    const source = edge._src ?? edge.source;
    const target = edge._tgt ?? edge.target;
    if (!source || !target || !seen.has(source) || !seen.has(target)) continue;
    const { _src: _ignoredSrc, _tgt: _ignoredTgt, ...rest } = edge;
    edges.push({ ...rest, source, target, relation: edge.relation ?? "" });
  }
  return {
    level: raw.level || "code",
    nodes,
    edges,
    truncated: raw.truncated === true,
    total_nodes: typeof raw.total_nodes === "number" ? raw.total_nodes : nodes.length,
    total_edges: typeof raw.total_edges === "number" ? raw.total_edges : edges.length,
  };
}

/** Community node ids are prefixed by the container so they never collide with code ids. */
export const COMMUNITY_NODE_PREFIX = "c:";

export function communityIdFromNodeId(id: string): number | null {
  if (!id.startsWith(COMMUNITY_NODE_PREFIX)) return null;
  const n = Number(id.slice(COMMUNITY_NODE_PREFIX.length));
  return Number.isInteger(n) ? n : null;
}

/** Undirected adjacency: node id → neighbouring node ids, deduplicated. */
export function neighborsOf(view: CodeGraphView, id: string): string[] {
  const out = new Set<string>();
  for (const edge of view.edges) {
    if (edge.source === id) out.add(edge.target);
    else if (edge.target === id) out.add(edge.source);
  }
  out.delete(id);
  return [...out];
}
