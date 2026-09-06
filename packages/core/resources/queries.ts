import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ListAgentKnowledgeResponse,
  CreateWorkspaceResourceRequest,
  ListWorkspaceResourcesResponse,
  UpdateWorkspaceResourceRequest,
  WorkspaceResource,
} from "../types";

export const workspaceResourceKeys = {
  all: (wsId: string) => ["workspace-resources", wsId] as const,
  list: (wsId: string) => [...workspaceResourceKeys.all(wsId), "list"] as const,
};

export function workspaceResourcesOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceResourceKeys.list(wsId),
    queryFn: () => api.listWorkspaceResources(),
    select: (data) => data.resources,
  });
}

export function useCreateWorkspaceResource(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWorkspaceResourceRequest) =>
      api.createWorkspaceResource(data),
    onSuccess: (created) => {
      qc.setQueryData<ListWorkspaceResourcesResponse>(
        workspaceResourceKeys.list(wsId),
        (old) =>
          old && !old.resources.some((r) => r.id === created.id)
            ? {
                ...old,
                resources: [...old.resources, created],
                total: old.total + 1,
              }
            : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: workspaceResourceKeys.list(wsId) });
    },
  });
}

export function useUpdateWorkspaceResource(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      resourceId,
      data,
    }: {
      resourceId: string;
      data: UpdateWorkspaceResourceRequest;
    }) => api.updateWorkspaceResource(resourceId, data),
    onSuccess: (updated) => {
      qc.setQueryData<ListWorkspaceResourcesResponse>(
        workspaceResourceKeys.list(wsId),
        (old) =>
          old
            ? {
                ...old,
                resources: old.resources.map((r) =>
                  r.id === updated.id ? updated : r,
                ),
              }
            : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: workspaceResourceKeys.list(wsId) });
    },
  });
}

export function useDeleteWorkspaceResource(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (resourceId: string) => api.deleteWorkspaceResource(resourceId),
    onMutate: async (resourceId) => {
      await qc.cancelQueries({ queryKey: workspaceResourceKeys.list(wsId) });
      const prev = qc.getQueryData<ListWorkspaceResourcesResponse>(
        workspaceResourceKeys.list(wsId),
      );
      qc.setQueryData<ListWorkspaceResourcesResponse>(
        workspaceResourceKeys.list(wsId),
        (old) =>
          old
            ? {
                ...old,
                resources: old.resources.filter(
                  (r: WorkspaceResource) => r.id !== resourceId,
                ),
                total: old.total - 1,
              }
            : old,
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(workspaceResourceKeys.list(wsId), ctx.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: workspaceResourceKeys.list(wsId) });
    },
  });
}

// --- Agent knowledge bindings ----------------------------------------------
//
// Keyed by agent rather than by workspace, because that is what the binding
// is: a workspace can hold a knowledge base no agent reads, and the same base
// can be read by several agents. The workspace id stays in the key so the
// cache is still partitioned per workspace, as every workspace-scoped key is.

export const agentKnowledgeKeys = {
  all: (wsId: string) => ["agent-knowledge", wsId] as const,
  list: (wsId: string, agentId: string) =>
    [...agentKnowledgeKeys.all(wsId), agentId] as const,
};

export function agentKnowledgeOptions(wsId: string, agentId: string) {
  return queryOptions({
    queryKey: agentKnowledgeKeys.list(wsId, agentId),
    queryFn: () => api.listAgentKnowledge(agentId),
    select: (data: ListAgentKnowledgeResponse) => data.knowledge_sources,
    enabled: Boolean(agentId),
  });
}

/**
 * Attach and detach both return the agent's full binding list, so the cache is
 * replaced with the server's answer rather than patched. There is nothing to
 * be optimistic about here: the user stays on the page, the round trip is one
 * request, and a binding that silently failed would show an index the agent
 * does not actually have.
 */
export function useAttachAgentKnowledge(wsId: string, agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (resourceId: string) =>
      api.attachAgentKnowledge(agentId, resourceId),
    onSuccess: (data) => {
      qc.setQueryData(agentKnowledgeKeys.list(wsId, agentId), data);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: agentKnowledgeKeys.list(wsId, agentId) });
    },
  });
}

export function useRemoveAgentKnowledge(wsId: string, agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (resourceId: string) =>
      api.removeAgentKnowledge(agentId, resourceId),
    onSuccess: (data) => {
      qc.setQueryData(agentKnowledgeKeys.list(wsId, agentId), data);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: agentKnowledgeKeys.list(wsId, agentId) });
    },
  });
}
