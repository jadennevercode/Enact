import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

/**
 * Artifact listings are scoped to one issue or one chat session, so the keys
 * carry that scope. `all(wsId)` is the invalidation root: deleting a file, or
 * a run finishing and uploading one, invalidates every scope at once rather
 * than trying to work out which listings the change touched.
 */
export const artifactKeys = {
  all: (wsId: string) => ["artifacts", wsId] as const,
  issue: (wsId: string, issueId: string) =>
    [...artifactKeys.all(wsId), "issue", issueId] as const,
  chatSession: (wsId: string, sessionId: string) =>
    [...artifactKeys.all(wsId), "chat-session", sessionId] as const,
};

export function issueArtifactsOptions(
  wsId: string,
  issueId: string,
  limit?: number,
) {
  return queryOptions({
    queryKey: artifactKeys.issue(wsId, issueId),
    queryFn: () => api.listIssueArtifacts(issueId, limit),
    enabled: Boolean(wsId) && Boolean(issueId),
  });
}

export function chatSessionArtifactsOptions(
  wsId: string,
  sessionId: string,
  limit?: number,
) {
  return queryOptions({
    queryKey: artifactKeys.chatSession(wsId, sessionId),
    queryFn: () => api.listChatSessionArtifacts(sessionId, limit),
    enabled: Boolean(wsId) && Boolean(sessionId),
  });
}
