import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
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
