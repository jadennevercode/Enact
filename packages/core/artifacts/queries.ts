import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const artifactKeys = {
  all: (wsId: string) => ["artifacts", wsId] as const,
  list: (wsId: string) => [...artifactKeys.all(wsId), "list"] as const,
};

export function artifactsOptions(wsId: string, limit?: number) {
  return queryOptions({
    queryKey: artifactKeys.list(wsId),
    queryFn: () => api.listArtifacts(limit),
  });
}
