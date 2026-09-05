import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

// Query keys carry `wsId` because skills are workspace-scoped and a cache
// shared across workspaces would show one team another's history.
export const skillVersionKeys = {
  all: (wsId: string) => ["skill-versions", wsId] as const,
  list: (wsId: string, skillId: string) =>
    [...skillVersionKeys.all(wsId), skillId] as const,
  detail: (wsId: string, skillId: string, versionId: string) =>
    [...skillVersionKeys.all(wsId), skillId, versionId] as const,
};

export function skillVersionListOptions(wsId: string, skillId: string) {
  return queryOptions({
    queryKey: skillVersionKeys.list(wsId, skillId),
    queryFn: () => api.listSkillVersions(skillId),
    enabled: wsId.length > 0 && skillId.length > 0,
    select: (data) => data.versions,
  });
}

export function skillVersionDetailOptions(wsId: string, skillId: string, versionId: string) {
  return queryOptions({
    queryKey: skillVersionKeys.detail(wsId, skillId, versionId),
    queryFn: () => api.getSkillVersion(skillId, versionId),
    enabled: wsId.length > 0 && skillId.length > 0 && versionId.length > 0,
  });
}
