/**
 * Token-based Git provider integration types (Forgejo, Gitea, GitLab). Unlike
 * GitHub there is no App/installation model: each workspace stores a
 * token-based connection to a provider instance. Pull requests mirrored from any
 * of these providers surface through the shared GitHubPullRequest shape, tagged
 * with the matching `provider`.
 */

export type VCSProvider = "forgejo" | "gitea" | "gitlab";

export interface VCSConnection {
  id: string;
  workspace_id: string;
  provider: VCSProvider;
  /** Instance base URL, e.g. https://forgejo.example.com (no trailing slash). */
  instance_url: string;
  /** Login (user or org) the stored access token authenticates as. */
  account_login: string;
  /** Absolute webhook endpoint to register on the provider. Empty when the server
   * has no public URL configured; the UI then prefixes `webhook_path`. */
  webhook_url: string;
  webhook_path: string;
  created_at: string;
  token_type: "service_account" | "project" | "group" | "personal" | string;
  token_scopes: string[];
  token_expires_at: string | null;
  clone_host: string;
  has_custom_ca: boolean;
  last_validated_at: string | null;
  api_status: string;
  webhook_status: string;
  git_read_status: string;
  git_write_status: string;
  change_request_status: string;
}

export interface ListVCSConnectionsResponse {
  connections: VCSConnection[];
  /** Whether the deployment has ENACT_VCS_SECRET_KEY configured. Without it no
   * credential can be sealed, so the connect form is replaced by setup
   * guidance rather than hidden. Older backends omit it; treat as false. */
  configured?: boolean;
  /** Whether the caller can connect / disconnect. Non-admins get false. */
  can_manage?: boolean;
  requirements?: {
    gitlab?: {
      api_token_scope: string;
      git_token_scope: string;
      preferred_token_type: string;
      webhook_events: string[];
    };
  };
}

export interface ConnectVCSRequest {
  provider: VCSProvider;
  instance_url: string;
  /** Legacy single-token input; new GitLab connections use api_token + git_token. */
  access_token?: string;
  api_token?: string;
  git_token?: string;
  token_type?: "service_account" | "project" | "group" | "personal";
  token_scopes?: string[];
  token_expires_at?: string;
  clone_host?: string;
  ca_pem?: string;
}

export interface ConnectVCSResponse extends VCSConnection {
  /** One-time plaintext webhook secret to paste into the provider (HMAC secret
   * for Forgejo/Gitea, X-Gitlab-Token value for GitLab). Not retrievable
   * afterwards (stored encrypted); reconnecting rotates it. */
  webhook_secret: string;
}

export interface VCSRepository {
  id: number;
  path_with_namespace: string;
  web_url: string;
  http_url_to_repo: string;
  description: string;
  visibility: string;
  archived: boolean;
  default_branch: string;
  permissions?: {
    project_access?: { access_level: number } | null;
    group_access?: { access_level: number } | null;
  };
}

export interface ListVCSRepositoriesResponse {
  repositories: VCSRepository[];
  total_count: number;
  next_page: number | null;
}

export interface TestVCSConnectionResponse {
  connection: VCSConnection;
  api: { status: string; detail: string };
  webhook: { status: string; detail: string };
  git: { read_status: string; write_status: string; detail: string };
}
