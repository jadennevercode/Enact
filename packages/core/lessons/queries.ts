import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import type { ListLessonsParams } from "../types";

// Query keys carry `wsId` because lessons are workspace-scoped and a cache
// shared across workspaces would show one team another's proposals.
export const lessonKeys = {
  all: (wsId: string) => ["lessons", wsId] as const,
  list: (wsId: string, params: ListLessonsParams = {}) =>
    [...lessonKeys.all(wsId), "list", params] as const,
  detail: (wsId: string, id: string) => [...lessonKeys.all(wsId), "detail", id] as const,
  forSkill: (wsId: string, skillId: string) =>
    [...lessonKeys.all(wsId), "skill", skillId] as const,
};

export const skillVersionKeys = {
  all: (wsId: string) => ["skill-versions", wsId] as const,
  list: (wsId: string, skillId: string) =>
    [...skillVersionKeys.all(wsId), skillId] as const,
  detail: (wsId: string, skillId: string, versionId: string) =>
    [...skillVersionKeys.all(wsId), skillId, versionId] as const,
};

export const retrospectiveKeys = {
  all: (wsId: string) => ["retrospectives", wsId] as const,
  list: (wsId: string, status?: string) =>
    [...retrospectiveKeys.all(wsId), "list", status ?? ""] as const,
  detail: (wsId: string, id: string) =>
    [...retrospectiveKeys.all(wsId), "detail", id] as const,
  forIssue: (wsId: string, issueId: string) =>
    [...retrospectiveKeys.all(wsId), "issue", issueId] as const,
};

export function lessonListOptions(wsId: string, params: ListLessonsParams = {}) {
  return queryOptions({
    queryKey: lessonKeys.list(wsId, params),
    queryFn: () => api.listLessons(params),
    enabled: wsId.length > 0,
  });
}

export function lessonDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: lessonKeys.detail(wsId, id),
    queryFn: () => api.getLesson(id),
    enabled: wsId.length > 0 && id.length > 0,
  });
}

export function lessonsForSkillOptions(wsId: string, skillId: string) {
  return queryOptions({
    queryKey: lessonKeys.forSkill(wsId, skillId),
    queryFn: () => api.listLessons({ skill_id: skillId }),
    enabled: wsId.length > 0 && skillId.length > 0,
    select: (data) => data.lessons,
  });
}

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

export function retrospectiveListOptions(wsId: string, status?: string) {
  return queryOptions({
    queryKey: retrospectiveKeys.list(wsId, status),
    queryFn: () => api.listRetrospectives(status),
    enabled: wsId.length > 0,
    select: (data) => data.retrospectives,
  });
}

export function retrospectiveDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: retrospectiveKeys.detail(wsId, id),
    queryFn: () => api.getRetrospective(id),
    enabled: wsId.length > 0 && id.length > 0,
  });
}

// The issue page asks this on every load. A retrospective is offered once per
// issue and then never changes unless someone answers it, so this is stale for
// a long time and cheap to keep.
export function issueRetrospectiveOptions(wsId: string, issueId: string) {
  return queryOptions({
    queryKey: retrospectiveKeys.forIssue(wsId, issueId),
    queryFn: () => api.getIssueRetrospective(issueId),
    enabled: wsId.length > 0 && issueId.length > 0,
    staleTime: 60_000,
    select: (data) => data.retrospective,
  });
}
