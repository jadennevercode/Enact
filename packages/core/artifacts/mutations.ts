import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { artifactKeys } from "./queries";
import { issueKeys } from "../issues/queries";

export interface DeleteArtifactInput {
  artifactId: string;
  /**
   * The issue the file hung off, when it had one. The file may also have been
   * rendering inline in that issue's body or a comment on it, which resolves
   * `src` through a separate listing that has to be invalidated too.
   */
  issueId?: string | null;
}

/**
 * Delete one artifact — one attachment row, and so one version of a file.
 *
 * Deleting is never optimistic. The server decides authorization (uploader or
 * workspace admin), and the row is gone for good; so the cache is invalidated
 * after the server confirms rather than patched ahead of it.
 *
 * Every artifact listing in the workspace is invalidated rather than just the
 * scope in hand: an issue's listing carries its children's files, so a child's
 * deletion changes the parent's listing too. At most one listing is mounted,
 * so this is one refetch.
 */
export function useDeleteArtifact(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ artifactId }: DeleteArtifactInput) =>
      api.deleteAttachment(artifactId),
    onSuccess: (_data, { issueId }) => {
      qc.invalidateQueries({ queryKey: artifactKeys.all(wsId) });
      if (issueId) {
        qc.invalidateQueries({ queryKey: issueKeys.attachments(issueId) });
      }
    },
  });
}
