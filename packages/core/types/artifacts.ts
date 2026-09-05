import type { Attachment } from "./attachment";

/**
 * One file in an issue's or a chat session's artifact listing.
 *
 * An attachment carries no folder of its own — the folder a file appears in is
 * derived server-side by following the attachment to its owning issue
 * (directly, or through the comment it hangs off). A file uploaded in chat has
 * no owning issue at all, so every owner field is nullable; under the chat
 * scope that is the ordinary case.
 *
 * `owner_issue_id` is distinct from the inherited `issue_id`: a file attached
 * to a COMMENT has a null `issue_id` but still resolves to an owner issue
 * through that comment.
 */
export interface Artifact extends Attachment {
  owner_issue_id: string | null;
  owner_issue_number: number | null;
  /** Workspace-prefixed issue key, e.g. `ENC-42`. Computed at read time. */
  owner_issue_identifier: string | null;
  owner_issue_title: string | null;
}

export interface ListArtifactsResponse {
  artifacts: Artifact[];
  total: number;
  /**
   * The listing filled the server's row cap, so the tree built from it is a
   * prefix of the truth rather than the whole scope.
   */
  truncated: boolean;
  /**
   * The resolved issue an issue-scoped listing was taken for. The route may
   * name it by identifier (`ENC-42`), so this is the only way the client can
   * tell the issue's own files from a child's. Absent for a chat listing.
   */
  scope_issue_id: string | null;
}
