import type { VCSConnection, VCSProvider } from "@enact/core/types";

/**
 * The connection kinds a workspace admin can create from the product. Forgejo
 * and Gitea are deliberately absent: the server accepts them, but nothing here
 * offers repository browsing or change requests for them, so presenting them as
 * a choice would promise a connection that only mirrors webhooks.
 */
export type ConnectableProvider = "github" | "github_enterprise" | "gitlab";

export const GITHUB_DOT_COM_URL = "https://github.com";

export interface ProviderProfile {
  /** The `provider` value the API stores. */
  apiProvider: VCSProvider;
  /** Whether the instance URL is fixed (github.com) or the admin supplies it. */
  fixedInstanceURL?: string;
  /**
   * GitLab scopes `api` and `write_repository` onto separate credentials.
   * Everywhere else one token does both, and asking twice would only invite
   * pasting the same value into both boxes.
   */
  needsSeparateGitToken: boolean;
  /** Token kinds offered for this provider, in the order they should appear. */
  tokenTypes: readonly string[];
}

export const PROVIDER_PROFILES: Record<ConnectableProvider, ProviderProfile> = {
  github: {
    apiProvider: "github",
    fixedInstanceURL: GITHUB_DOT_COM_URL,
    needsSeparateGitToken: false,
    tokenTypes: ["fine_grained", "personal"],
  },
  github_enterprise: {
    apiProvider: "github",
    needsSeparateGitToken: false,
    tokenTypes: ["fine_grained", "personal"],
  },
  gitlab: {
    apiProvider: "gitlab",
    needsSeparateGitToken: true,
    tokenTypes: ["service_account", "project", "group", "personal"],
  },
};

/**
 * Which form to open when editing an existing connection. A stored connection
 * records only `github`, so the enterprise variant is recovered from its host —
 * the distinction matters because github.com must not offer an editable
 * instance URL.
 */
export function providerOf(connection: VCSConnection): ConnectableProvider {
  if (connection.provider !== "github") return "gitlab";
  return isGitHubDotCom(connection.instance_url) ? "github" : "github_enterprise";
}

export function isGitHubDotCom(instanceURL: string): boolean {
  try {
    const host = new URL(instanceURL).hostname.toLowerCase();
    return host === "github.com" || host === "www.github.com" || host === "api.github.com";
  } catch {
    return false;
  }
}

/** The host an operator recognizes, without the scheme they never typed. */
export function displayHost(instanceURL: string): string {
  try {
    return new URL(instanceURL).host;
  } catch {
    return instanceURL;
  }
}
