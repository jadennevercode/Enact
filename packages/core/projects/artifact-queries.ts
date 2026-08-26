import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import { projectKeys } from "./queries";

export const projectArtifactKeys = {
  list: (wsId: string, projectId: string) =>
    [...projectKeys.detail(wsId, projectId), "artifacts"] as const,
};

export function projectArtifactsOptions(wsId: string, projectId: string) {
  return queryOptions({
    queryKey: projectArtifactKeys.list(wsId, projectId),
    queryFn: () => api.listProjectArtifacts(projectId),
  });
}
