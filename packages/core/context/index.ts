import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "../api";
import type { ContextScope, ContextSession } from "./schema";
export * from "./schema";
export const contextKeys = {
  all: (wsId: string) => ["workspaces", wsId, "context-sessions"] as const,
  scope: (wsId: string, scope: ContextScope) =>
    [...contextKeys.all(wsId), scope.type, scope.id] as const,
};
export function contextSessionOptions(wsId: string, scope: ContextScope) {
  return queryOptions({
    queryKey: contextKeys.scope(wsId, scope),
    queryFn: () => api.listContextSessions(scope),
    enabled: !!wsId && !!scope.id,
    staleTime: 15000,
    refetchInterval: 15000,
  });
}
export function useCompactContext(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ session, key }: { session: ContextSession; key: string }) =>
      api.compactContext(session.id, session.generation, key),
    onSettled: () => qc.invalidateQueries({ queryKey: contextKeys.all(wsId) }),
  });
}
export function useCancelContextCompaction(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelContextCompaction(id),
    onSettled: () => qc.invalidateQueries({ queryKey: contextKeys.all(wsId) }),
  });
}

export function contextCheckpointOptions(wsId: string, scope: ContextScope) {
  return queryOptions({
    queryKey: [...contextKeys.scope(wsId, scope), "checkpoints"],
    queryFn: () => api.listContextCheckpoints(scope),
    enabled: !!wsId && !!scope.id,
    staleTime: 30000,
  });
}
