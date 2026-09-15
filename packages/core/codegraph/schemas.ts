import { z } from "zod";

// Wire contract: docs/architecture/code-graph-contracts.md. Every schema is
// lenient — `.loose()` objects, defaulted fields, string enums kept as
// `z.string()` — because an installed desktop build must keep rendering a
// response from a newer server. Downstream code default-cases every enum.

export const codeGraphStatsSchema = z
  .object({
    files: z.number().default(0),
    nodes: z.number().default(0),
    edges: z.number().default(0),
    communities: z.number().default(0),
    duration_ms: z.number().default(0),
    graphify_version: z.string().default(""),
    incremental: z.boolean().default(false),
  })
  .loose();

export interface CodeGraphStats {
  files: number;
  nodes: number;
  edges: number;
  communities: number;
  duration_ms: number;
  graphify_version: string;
  incremental: boolean;
}

export const codeGraphDiffSchema = z
  .object({
    added_nodes: z.number().default(0),
    removed_nodes: z.number().default(0),
    added_edges: z.number().default(0),
    removed_edges: z.number().default(0),
  })
  .loose();

export interface CodeGraphDiff {
  added_nodes: number;
  removed_nodes: number;
  added_edges: number;
  removed_edges: number;
}

/** Known build states; the wire keeps the string open for newer servers. */
export type CodeGraphBuildState =
  | "queued"
  | "building"
  | "ready"
  | "failed"
  | "skipped";

export const codeGraphBuildSchema = z
  .object({
    id: z.string().default(""),
    state: z.string().default("queued"),
    commit: z.string().nullable().default(null),
    ref: z.string().default(""),
    skipped_reason: z.string().nullable().default(null),
    error: z.string().nullable().default(null),
    stats: codeGraphStatsSchema.nullable().default(null),
    diff: codeGraphDiffSchema.nullable().default(null),
    graphify_version: z.string().nullable().default(null),
    created_at: z.string().default(""),
    finished_at: z.string().nullable().default(null),
  })
  .loose();

export interface CodeGraphBuild {
  id: string;
  state: string;
  commit: string | null;
  ref: string;
  skipped_reason: string | null;
  error: string | null;
  stats: CodeGraphStats | null;
  diff: CodeGraphDiff | null;
  graphify_version: string | null;
  created_at: string;
  finished_at: string | null;
}

export const codeGraphBuildStatusSchema = z
  .object({
    enabled: z.boolean().default(false),
    queued: z.boolean().default(false),
    stale: z.boolean().default(false),
    build: codeGraphBuildSchema.nullable().default(null),
  })
  .loose();

export interface CodeGraphBuildStatus {
  enabled: boolean;
  queued: boolean;
  stale: boolean;
  build: CodeGraphBuild | null;
}

export const codeGraphStatusesSchema = z
  .object({
    statuses: z.record(z.string(), codeGraphBuildStatusSchema).default({}),
  })
  .loose();

export interface CodeGraphStatuses {
  statuses: Record<string, CodeGraphBuildStatus>;
}

export const codeGraphCapabilitySchema = z
  .object({
    enabled: z.boolean().default(false),
    graphify_version: z.string().nullable().default(null),
  })
  .loose();

export interface CodeGraphCapability {
  enabled: boolean;
  graphify_version: string | null;
}

export const codeGraphReportSchema = z
  .object({ report_md: z.string().default("") })
  .loose();

export interface CodeGraphReport {
  report_md: string;
}

export const codeGraphTopNodeSchema = z
  .object({
    id: z.string().default(""),
    label: z.string().default(""),
    source_file: z.string().default(""),
    source_location: z.string().nullable().default(null),
    degree: z.number().default(0),
    community_id: z.number().nullable().optional(),
    community_name: z.string().nullable().optional(),
  })
  .loose();

export interface CodeGraphTopNode {
  id: string;
  label: string;
  source_file: string;
  source_location: string | null;
  degree: number;
  community_id?: number | null;
  community_name?: string | null;
}

export const codeGraphCommunitySchema = z
  .object({
    id: z.number(),
    label: z.string().default(""),
    size: z.number().default(0),
    cohesion: z.number().nullable().default(null),
    top_nodes: z.array(codeGraphTopNodeSchema).default([]),
  })
  .loose();

export interface CodeGraphCommunity {
  id: number;
  label: string;
  size: number;
  cohesion: number | null;
  top_nodes: CodeGraphTopNode[];
}

export const codeGraphCommunitiesSchema = z
  .object({ communities: z.array(codeGraphCommunitySchema).default([]) })
  .loose();

export interface CodeGraphCommunities {
  communities: CodeGraphCommunity[];
}

export const codeGraphGodNodesSchema = z
  .object({ nodes: z.array(codeGraphTopNodeSchema).default([]) })
  .loose();

export interface CodeGraphGodNodes {
  nodes: CodeGraphTopNode[];
}

// GraphView. A `community` node carries `size`/`cohesion`; a `code` node carries
// its source location. Both are optional on the wire so one schema covers both.
export const codeGraphViewNodeSchema = z
  .object({
    id: z.string(),
    kind: z.string().default("code"),
    label: z.string().default(""),
    file_type: z.string().optional(),
    source_file: z.string().optional(),
    source_location: z.string().nullable().optional(),
    community_id: z.number().nullable().optional(),
    community_name: z.string().nullable().optional(),
    degree: z.number().optional(),
    size: z.number().optional(),
    cohesion: z.number().nullable().optional(),
  })
  .loose();

export interface CodeGraphViewNode {
  id: string;
  kind: string;
  label: string;
  file_type?: string;
  source_file?: string;
  source_location?: string | null;
  community_id?: number | null;
  community_name?: string | null;
  degree?: number;
  size?: number;
  cohesion?: number | null;
}

// Edge endpoints: current writers emit `source`/`target`; graphs written by
// older graphify versions kept the true direction in `_src`/`_tgt`. The
// normalizer in node-link.ts folds the legacy pair back, so both are accepted.
export const codeGraphViewEdgeSchema = z
  .object({
    source: z.string().optional(),
    target: z.string().optional(),
    _src: z.string().optional(),
    _tgt: z.string().optional(),
    relation: z.string().default(""),
    confidence: z.string().optional(),
    confidence_score: z.number().optional(),
    weight: z.number().optional(),
  })
  .loose();

export interface CodeGraphViewEdge {
  source: string;
  target: string;
  relation: string;
  confidence?: string;
  confidence_score?: number;
  weight?: number;
}

// `links` is NetworkX's node-link name for the edge array; graphify's own
// exporter writes it, and the container may pass it through unchanged.
export const codeGraphViewSchema = z
  .object({
    level: z.string().default("code"),
    nodes: z.array(codeGraphViewNodeSchema).default([]),
    edges: z.array(codeGraphViewEdgeSchema).optional(),
    links: z.array(codeGraphViewEdgeSchema).optional(),
    truncated: z.boolean().default(false),
    total_nodes: z.number().default(0),
    total_edges: z.number().default(0),
  })
  .loose();

export interface CodeGraphView {
  level: string;
  nodes: CodeGraphViewNode[];
  edges: CodeGraphViewEdge[];
  truncated: boolean;
  total_nodes: number;
  total_edges: number;
}

export interface CodeGraphTreeNode {
  name: string;
  total_count?: number;
  kind?: string;
  source_file?: string;
  source_location?: string | null;
  children?: CodeGraphTreeNode[];
}

// Pass-through of graphify's `tree_html.build_tree`; only `name` is promised.
export const codeGraphTreeNodeSchema: z.ZodType<CodeGraphTreeNode> = z.lazy(
  () =>
    z
      .object({
        name: z.string().default(""),
        total_count: z.number().optional(),
        kind: z.string().optional(),
        source_file: z.string().optional(),
        source_location: z.string().nullable().optional(),
        children: z.array(codeGraphTreeNodeSchema).optional(),
      })
      .loose() as unknown as z.ZodType<CodeGraphTreeNode>,
);

export const codeGraphCallflowSectionSchema = z
  .object({
    id: z.string().default(""),
    name: z.string().default(""),
    node_count: z.number().default(0),
    edge_count: z.number().default(0),
    mermaid: z.string().default(""),
  })
  .loose();

export interface CodeGraphCallflowSection {
  id: string;
  name: string;
  node_count: number;
  edge_count: number;
  mermaid: string;
}

export const codeGraphCallflowSchema = z
  .object({
    lang: z.string().default("en"),
    overview_mermaid: z.string().default(""),
    sections: z.array(codeGraphCallflowSectionSchema).default([]),
  })
  .loose();

export interface CodeGraphCallflow {
  lang: string;
  overview_mermaid: string;
  sections: CodeGraphCallflowSection[];
}

export const codeGraphWikiArticleRefSchema = z
  .object({
    slug: z.string(),
    title: z.string().default(""),
    kind: z.string().default("community"),
    community_id: z.number().nullable().optional(),
  })
  .loose();

export interface CodeGraphWikiArticleRef {
  slug: string;
  title: string;
  kind: string;
  community_id?: number | null;
}

export const codeGraphWikiIndexSchema = z
  .object({
    index_md: z.string().default(""),
    articles: z.array(codeGraphWikiArticleRefSchema).default([]),
  })
  .loose();

export interface CodeGraphWikiIndex {
  index_md: string;
  articles: CodeGraphWikiArticleRef[];
}

export const codeGraphWikiArticleSchema = z
  .object({
    slug: z.string().default(""),
    title: z.string().default(""),
    markdown: z.string().default(""),
  })
  .loose();

export interface CodeGraphWikiArticle {
  slug: string;
  title: string;
  markdown: string;
}

export const codeGraphTextResultSchema = z
  .object({ text: z.string().default("") })
  .loose();

export interface CodeGraphTextResult {
  text: string;
}

export const codeGraphPathResultSchema = z
  .object({
    text: z.string().default(""),
    path: z.array(z.string()).default([]),
  })
  .loose();

export interface CodeGraphPathResult {
  text: string;
  path: string[];
}

export const codeGraphExplainResultSchema = z
  .object({
    text: z.string().default(""),
    matches: z.array(z.string()).default([]),
    ambiguous: z.boolean().default(false),
  })
  .loose();

export interface CodeGraphExplainResult {
  text: string;
  matches: string[];
  ambiguous: boolean;
}

export const codeGraphRebuildResultSchema = z
  .object({ build_id: z.string().default("") })
  .loose();

export interface CodeGraphRebuildResult {
  build_id: string;
}

/** One of the three server-side projections of a repository graph. */
export type CodeGraphProjection =
  | { level: "community"; limit?: number }
  | { community: number; limit?: number }
  | { focus: string; depth?: number; limit?: number };

export interface CodeGraphQueryRequest {
  question: string;
  mode?: "bfs" | "dfs";
  depth?: number;
  token_budget?: number;
  context?: string[];
}
