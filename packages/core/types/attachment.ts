export interface Attachment {
  id: string;
  workspace_id: string;
  issue_id: string | null;
  comment_id: string | null;
  chat_session_id: string | null;
  chat_message_id: string | null;
  uploader_type: string;
  uploader_id: string;
  filename: string;
  url: string;
  download_url: string;
  /**
   * Forced-attachment ("download button") URL: credential-free and, unlike
   * `download_url` (load-intent, serves media inline for preview), always
   * Content-Disposition: attachment across every storage mode. Short-lived —
   * never persist it. Optional: a server older than this field omits it, and
   * download callers fall back to `download_url` / the stable endpoint.
   */
  attachment_download_url?: string;
  /**
   * Durable URL the client persists into markdown bodies.
   *
   * The server (`buildMarkdownURL` in server/internal/handler/file.go)
   * computes this per deployment policy:
   *   - public CDN path when storage URL is itself absolute and unsigned;
   *   - otherwise `<ENACT_PUBLIC_URL>/api/attachments/<id>/download`,
   *     which the server self-resigns / proxies on every request.
   *
   * Distinct from `url` (raw storage URL — may be private / site-relative)
   * and `download_url` (this-response click-time URL — may be a short-lived
   * CloudFront / S3 signed URL with a TTL). `markdown_url` is contracted
   * to be safe to embed in markdown bodies that outlive the current
   * session and to load as a native browser resource fetch on every
   * supported client (web / desktop / mobile webview). ENA-3192.
   *
   * Empty when the response was produced by a server old enough to
   * predate this field, or by an upload path that did not produce a
   * persisted attachment row (e.g. the no-workspace avatar branch).
   * Frontend callers that need to embed a URL into markdown should use
   * the helper in `useFileUpload` rather than reading this field
   * directly so the legacy fallbacks (download path / `att.url`) stay
   * centralized.
   */
  markdown_url: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

/**
 * One file in a project's artifact listing.
 *
 * An attachment carries no project of its own — project membership is derived
 * server-side by following the attachment to its owning issue (directly, or
 * through the comment it hangs off) and reading that issue's project. The
 * owner issue is therefore always present, and is the edge the artifacts
 * browser groups files into folders by.
 *
 * `owner_issue_id` is distinct from the inherited `issue_id`: a file attached
 * to a COMMENT has a null `issue_id` but still resolves to an owner issue
 * through that comment.
 */
export interface ProjectArtifact extends Attachment {
  owner_issue_id: string;
  owner_issue_number: number;
  /** Workspace-prefixed issue key, e.g. `ENC-42`. Computed at read time. */
  owner_issue_identifier: string;
  owner_issue_title: string;
}

export interface ListProjectArtifactsResponse {
  artifacts: ProjectArtifact[];
  total: number;
  /**
   * The listing filled the server's row cap, so the tree built from it is a
   * prefix of the truth rather than the whole project.
   */
  truncated: boolean;
}
