/**
 * Token-based code hosting connections: GitHub (both github.com and Enterprise
 * Server), GitLab, Forgejo and Gitea. A workspace admin stores an instance URL
 * and a token; nothing here needs deployment-level provider setup.
 *
 * GitHub also reaches Enact through a GitHub App installation, which is a
 * different record entirely (see types/github.ts). Both are offered: the App is
 * the stronger credential where it can be installed, and a token is the only
 * option for Enterprise Server or a deployment that cannot register an App.
 *
 * Pull requests mirrored from any of these providers surface through the shared
 * GitHubPullRequest shape, tagged with the matching `provider`.
 */

export type VCSProvider = "forgejo" | "gitea" | "gitlab" | "github";

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
  /**
   * What kind of credential this is. GitLab names the bearer (a service
   * account, a project, a group); GitHub names the token format. Stored
   * verbatim so the UI can show which kind a connection actually holds.
   */
  token_type: "service_account" | "project" | "group" | "personal" | "fine_grained" | string;
  /**
   * Scopes as the provider reported them, never as the client claimed. Empty is
   * a real answer for a GitHub fine-grained token, whose per-repository
   * permissions no endpoint enumerates — read it as "unverifiable", not "none".
   */
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
  /** What each provider needs, so the connect form can say it in one place. */
  requirements?: {
    gitlab?: {
      api_token_scope: string;
      git_token_scope: string;
      preferred_token_type: string;
      webhook_events: string[];
    };
    github?: {
      fine_grained_permissions: string[];
      classic_scopes: string[];
      preferred_token_type: string;
      webhook_events: string[];
    };
  };
}

export interface ConnectVCSRequest {
  provider: VCSProvider;
  instance_url: string;
  /** Legacy single-token input; Forgejo and Gitea still use it. */
  access_token?: string;
  api_token?: string;
  /**
   * Only GitLab needs this: it scopes `api` and `write_repository` onto
   * separate credentials. One GitHub token does both, so omit it there and the
   * server reuses api_token.
   */
  git_token?: string;
  token_type?: "service_account" | "project" | "group" | "personal" | "fine_grained";
  token_scopes?: string[];
  /** Optional. A non-expiring token is valid, if weaker. */
  token_expires_at?: string;
  /**
   * The hostname Git traffic uses when it differs from the API host. The server
   * rewrites each attached repository's remote to it.
   */
  clone_host?: string;
  ca_pem?: string;
}

export interface ConnectVCSResponse extends VCSConnection {
  /** One-time plaintext webhook secret to paste into the provider (HMAC secret
   * for Forgejo/Gitea, X-Gitlab-Token value for GitLab). Not retrievable
   * afterwards (stored encrypted); reconnecting rotates it. */
  webhook_secret: string;
}

/**
 * One picker row, normalized across providers. GitLab's numeric access levels
 * and GitHub's permission booleans are both resolved to `can_push` server-side,
 * so the picker does not have to know either provider's rules.
 */
export interface VCSRepository {
  id: string;
  full_name: string;
  web_url: string;
  clone_url: string;
  description: string;
  visibility: string;
  archived: boolean;
  default_branch: string;
  /** A repository the credential cannot push to can never receive a branch. */
  can_push: boolean;
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

/** One repository's outcome from a webhook registration sweep. */
export interface VCSWebhookRegistrationResult {
  repository: string;
  /** registered | manual | failed — see the connection's webhook_status. */
  status: string;
}

export interface RegisterVCSWebhooksResponse {
  connection: VCSConnection;
  repositories: VCSWebhookRegistrationResult[];
}
