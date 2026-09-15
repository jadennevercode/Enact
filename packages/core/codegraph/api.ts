import type { z } from "zod";
import { api } from "../api";
import { parseWithFallback } from "../api/schema";
import { normalizeCodeGraphView, type RawCodeGraphView } from "./node-link";
import {
  codeGraphCallflowSchema,
  codeGraphCapabilitySchema,
  codeGraphCommunitiesSchema,
  codeGraphExplainResultSchema,
  codeGraphGodNodesSchema,
  codeGraphPathResultSchema,
  codeGraphRebuildResultSchema,
  codeGraphReportSchema,
  codeGraphBuildStatusSchema,
  codeGraphStatusesSchema,
  codeGraphTextResultSchema,
  codeGraphTreeNodeSchema,
  codeGraphViewSchema,
  codeGraphWikiArticleSchema,
  codeGraphWikiIndexSchema,
  type CodeGraphBuildStatus,
  type CodeGraphCallflow,
  type CodeGraphCapability,
  type CodeGraphCommunities,
  type CodeGraphExplainResult,
  type CodeGraphGodNodes,
  type CodeGraphPathResult,
  type CodeGraphProjection,
  type CodeGraphQueryRequest,
  type CodeGraphRebuildResult,
  type CodeGraphReport,
  type CodeGraphStatuses,
  type CodeGraphTextResult,
  type CodeGraphTreeNode,
  type CodeGraphView,
  type CodeGraphWikiArticle,
  type CodeGraphWikiIndex,
} from "./schemas";

/**
 * One request against `/api/code-graph`, validated at the boundary. A response
 * that fails its schema surfaces as a thrown error rather than a partially
 * typed object, so the page shows its error state instead of rendering
 * `undefined` into a chart.
 */
export async function codeGraphRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const raw = await api.codeGraphRequest(path, {
    method: options?.method ?? "GET",
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const result = parseWithFallback<T | null>(raw, schema, null, {
    endpoint: `/api/code-graph${path.split("?")[0] ?? path}`,
  });
  if (result === null) {
    throw new Error(
      "The server returned an unsupported response. Refresh or update Enact.",
    );
  }
  return result;
}

const id = encodeURIComponent;
const resource = (resourceId: string) => `/resources/${id(resourceId)}`;

export function projectionQuery(projection: CodeGraphProjection): string {
  const params = new URLSearchParams();
  if ("level" in projection) {
    params.set("level", projection.level);
  } else if ("community" in projection) {
    params.set("community", String(projection.community));
  } else {
    params.set("focus", projection.focus);
    if (projection.depth !== undefined) params.set("depth", String(projection.depth));
  }
  if (projection.limit !== undefined) params.set("limit", String(projection.limit));
  return params.toString();
}

export const codeGraphApi = {
  capability: (): Promise<CodeGraphCapability> =>
    codeGraphRequest("/capability", codeGraphCapabilitySchema),
  statuses: (): Promise<CodeGraphStatuses> =>
    codeGraphRequest("/status", codeGraphStatusesSchema),
  status: (resourceId: string): Promise<CodeGraphBuildStatus> =>
    codeGraphRequest(`${resource(resourceId)}/status`, codeGraphBuildStatusSchema),
  rebuild: (resourceId: string): Promise<CodeGraphRebuildResult> =>
    codeGraphRequest(`${resource(resourceId)}/rebuild`, codeGraphRebuildResultSchema, {
      method: "POST",
    }),
  report: (resourceId: string): Promise<CodeGraphReport> =>
    codeGraphRequest(`${resource(resourceId)}/report`, codeGraphReportSchema),
  communities: (resourceId: string): Promise<CodeGraphCommunities> =>
    codeGraphRequest(`${resource(resourceId)}/communities`, codeGraphCommunitiesSchema),
  godNodes: (resourceId: string, top = 10): Promise<CodeGraphGodNodes> =>
    codeGraphRequest(`${resource(resourceId)}/god-nodes?top=${top}`, codeGraphGodNodesSchema),
  view: async (
    resourceId: string,
    projection: CodeGraphProjection,
  ): Promise<CodeGraphView> => {
    const raw = await codeGraphRequest<RawCodeGraphView>(
      `${resource(resourceId)}/graph?${projectionQuery(projection)}`,
      codeGraphViewSchema as unknown as z.ZodType<RawCodeGraphView>,
    );
    return normalizeCodeGraphView(raw);
  },
  tree: (resourceId: string, maxChildren = 200): Promise<CodeGraphTreeNode> =>
    codeGraphRequest(
      `${resource(resourceId)}/tree?max_children=${maxChildren}`,
      codeGraphTreeNodeSchema,
    ),
  callflow: (resourceId: string, lang = "auto"): Promise<CodeGraphCallflow> =>
    codeGraphRequest(
      `${resource(resourceId)}/callflow?lang=${id(lang)}`,
      codeGraphCallflowSchema,
    ),
  wiki: (resourceId: string): Promise<CodeGraphWikiIndex> =>
    codeGraphRequest(`${resource(resourceId)}/wiki`, codeGraphWikiIndexSchema),
  wikiArticle: (resourceId: string, slug: string): Promise<CodeGraphWikiArticle> =>
    codeGraphRequest(`${resource(resourceId)}/wiki/${id(slug)}`, codeGraphWikiArticleSchema),
  query: (resourceId: string, body: CodeGraphQueryRequest): Promise<CodeGraphTextResult> =>
    codeGraphRequest(`${resource(resourceId)}/query`, codeGraphTextResultSchema, {
      method: "POST",
      body,
    }),
  path: (
    resourceId: string,
    body: { source: string; target: string; undirected?: boolean },
  ): Promise<CodeGraphPathResult> =>
    codeGraphRequest(`${resource(resourceId)}/path`, codeGraphPathResultSchema, {
      method: "POST",
      body,
    }),
  explain: (resourceId: string, node: string): Promise<CodeGraphExplainResult> =>
    codeGraphRequest(`${resource(resourceId)}/explain`, codeGraphExplainResultSchema, {
      method: "POST",
      body: { node },
    }),
  affected: (
    resourceId: string,
    body: { seed: string; depth?: number; relations?: string[] },
  ): Promise<CodeGraphTextResult> =>
    codeGraphRequest(`${resource(resourceId)}/affected`, codeGraphTextResultSchema, {
      method: "POST",
      body,
    }),
};
