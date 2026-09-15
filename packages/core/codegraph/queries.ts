import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { codeGraphApi } from "./api";
import type {
  CodeGraphBuildStatus,
  CodeGraphProjection,
  CodeGraphQueryRequest,
} from "./schemas";

export const codeGraphKeys = {
  all: (wsId: string) => ["code-graph", wsId] as const,
  capability: (wsId: string) => [...codeGraphKeys.all(wsId), "capability"] as const,
  statuses: (wsId: string) => [...codeGraphKeys.all(wsId), "statuses"] as const,
  resource: (wsId: string, resourceId: string) =>
    [...codeGraphKeys.all(wsId), "resource", resourceId] as const,
};

/** A build in flight is re-read every few seconds until it settles. */
const BUILDING_REFETCH_MS = 5_000;

function isInFlight(status: CodeGraphBuildStatus | undefined): boolean {
  if (!status) return false;
  const state = status.build?.state;
  return status.queued === true || state === "queued" || state === "building";
}

export function codeGraphCapabilityOptions(wsId: string) {
  return queryOptions({
    queryKey: codeGraphKeys.capability(wsId),
    queryFn: codeGraphApi.capability,
    staleTime: 5 * 60_000,
    enabled: !!wsId,
  });
}

export function codeGraphStatusesOptions(wsId: string) {
  return queryOptions({
    queryKey: codeGraphKeys.statuses(wsId),
    queryFn: codeGraphApi.statuses,
    enabled: !!wsId,
    refetchInterval: (query) =>
      Object.values(query.state.data?.statuses ?? {}).some(isInFlight)
        ? BUILDING_REFETCH_MS
        : false,
  });
}

export function codeGraphStatusOptions(wsId: string, resourceId: string) {
  return queryOptions({
    queryKey: [...codeGraphKeys.resource(wsId, resourceId), "status"],
    queryFn: () => codeGraphApi.status(resourceId),
    enabled: !!wsId && !!resourceId,
    refetchInterval: (query) =>
      isInFlight(query.state.data) ? BUILDING_REFETCH_MS : false,
  });
}

export function codeGraphReportOptions(wsId: string, resourceId: string) {
  return queryOptions({
    queryKey: [...codeGraphKeys.resource(wsId, resourceId), "report"],
    queryFn: () => codeGraphApi.report(resourceId),
    enabled: !!wsId && !!resourceId,
  });
}

export function codeGraphCommunitiesOptions(wsId: string, resourceId: string) {
  return queryOptions({
    queryKey: [...codeGraphKeys.resource(wsId, resourceId), "communities"],
    queryFn: () => codeGraphApi.communities(resourceId),
    enabled: !!wsId && !!resourceId,
  });
}

export function codeGraphGodNodesOptions(wsId: string, resourceId: string, top = 10) {
  return queryOptions({
    queryKey: [...codeGraphKeys.resource(wsId, resourceId), "god-nodes", top],
    queryFn: () => codeGraphApi.godNodes(resourceId, top),
    enabled: !!wsId && !!resourceId,
  });
}

export function codeGraphViewOptions(
  wsId: string,
  resourceId: string,
  projection: CodeGraphProjection,
) {
  return queryOptions({
    queryKey: [...codeGraphKeys.resource(wsId, resourceId), "view", projection],
    queryFn: () => codeGraphApi.view(resourceId, projection),
    enabled: !!wsId && !!resourceId,
    staleTime: 60_000,
  });
}

export function codeGraphTreeOptions(wsId: string, resourceId: string, maxChildren = 200) {
  return queryOptions({
    queryKey: [...codeGraphKeys.resource(wsId, resourceId), "tree", maxChildren],
    queryFn: () => codeGraphApi.tree(resourceId, maxChildren),
    enabled: !!wsId && !!resourceId,
    staleTime: 60_000,
  });
}

export function codeGraphCallflowOptions(wsId: string, resourceId: string, lang = "auto") {
  return queryOptions({
    queryKey: [...codeGraphKeys.resource(wsId, resourceId), "callflow", lang],
    queryFn: () => codeGraphApi.callflow(resourceId, lang),
    enabled: !!wsId && !!resourceId,
    staleTime: 60_000,
  });
}

export function codeGraphWikiOptions(wsId: string, resourceId: string) {
  return queryOptions({
    queryKey: [...codeGraphKeys.resource(wsId, resourceId), "wiki"],
    queryFn: () => codeGraphApi.wiki(resourceId),
    enabled: !!wsId && !!resourceId,
  });
}

export function codeGraphWikiArticleOptions(
  wsId: string,
  resourceId: string,
  slug: string,
) {
  return queryOptions({
    queryKey: [...codeGraphKeys.resource(wsId, resourceId), "wiki", slug],
    queryFn: () => codeGraphApi.wikiArticle(resourceId, slug),
    enabled: !!wsId && !!resourceId && !!slug,
  });
}

// Hooks — thin, so a component test can mock the module with plain functions.

export function useCodeGraphCapability(wsId: string) {
  return useQuery(codeGraphCapabilityOptions(wsId));
}

export function useCodeGraphStatuses(wsId: string) {
  return useQuery(codeGraphStatusesOptions(wsId));
}

export function useCodeGraphStatus(wsId: string, resourceId: string) {
  return useQuery(codeGraphStatusOptions(wsId, resourceId));
}

export function useCodeGraphReport(wsId: string, resourceId: string) {
  return useQuery(codeGraphReportOptions(wsId, resourceId));
}

export function useCodeGraphCommunities(wsId: string, resourceId: string) {
  return useQuery(codeGraphCommunitiesOptions(wsId, resourceId));
}

export function useCodeGraphGodNodes(wsId: string, resourceId: string, top = 10) {
  return useQuery(codeGraphGodNodesOptions(wsId, resourceId, top));
}

export function useCodeGraphView(
  wsId: string,
  resourceId: string,
  projection: CodeGraphProjection,
) {
  return useQuery(codeGraphViewOptions(wsId, resourceId, projection));
}

export function useCodeGraphTree(wsId: string, resourceId: string, maxChildren = 200) {
  return useQuery(codeGraphTreeOptions(wsId, resourceId, maxChildren));
}

export function useCodeGraphCallflow(wsId: string, resourceId: string, lang = "auto") {
  return useQuery(codeGraphCallflowOptions(wsId, resourceId, lang));
}

export function useCodeGraphWiki(wsId: string, resourceId: string) {
  return useQuery(codeGraphWikiOptions(wsId, resourceId));
}

export function useCodeGraphWikiArticle(wsId: string, resourceId: string, slug: string) {
  return useQuery(codeGraphWikiArticleOptions(wsId, resourceId, slug));
}

/**
 * Enqueue a rebuild. Not optimistic: the server decides whether the request
 * is accepted, and the status queries are invalidated on settle so the chip
 * and the page pick up `queued` from the server's own answer.
 */
export function useRebuildCodeGraph(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (resourceId: string) => codeGraphApi.rebuild(resourceId),
    onSettled: (_data, _error, resourceId) => {
      void qc.invalidateQueries({ queryKey: codeGraphKeys.statuses(wsId) });
      void qc.invalidateQueries({
        queryKey: [...codeGraphKeys.resource(wsId, resourceId), "status"],
      });
    },
  });
}

/** A free-text graph search; a mutation because each question is a one-off. */
export function useCodeGraphQuery(resourceId: string) {
  return useMutation({
    mutationFn: (body: CodeGraphQueryRequest) => codeGraphApi.query(resourceId, body),
  });
}
