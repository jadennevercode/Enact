/**
 * Marketplace wire types.
 *
 * The directory carries three kinds of listing — skill, agent template and MCP
 * server. Ontologies appear as a fourth tab in the UI but are not listings:
 * they are federated from Capability Hub and read through the ontology
 * endpoints, so they have their own types in ./ontology.
 */

export type MarketplaceKind = "skill" | "agent" | "mcp";

/**
 * `public` reaches every workspace in the deployment; `workspace` is an
 * internal team library that never leaves the publishing workspace.
 */
export type MarketplaceVisibility = "public" | "workspace";

/**
 * `deprecated` stays installable but drops out of browse — someone already
 * depends on it. `removed` is a takedown: nothing may install it, and the row
 * survives so install records keep naming something that exists.
 */
export type MarketplaceStatus =
  | "draft"
  | "published"
  | "deprecated"
  | "removed";

/** How an install resolves a name that is already taken. */
export type MarketplaceConflictStrategy =
  | "fail"
  | "overwrite"
  | "rename"
  | "skip";

/** One card in the directory. Carries no file content and no manifest. */
export interface MarketplaceListing {
  id: string;
  kind: MarketplaceKind;
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  visibility: MarketplaceVisibility;
  status: MarketplaceStatus;
  featured: boolean;
  install_count: number;
  publisher_workspace_id: string;
  publisher_workspace_name: string;
  latest_version: string;
  latest_version_id?: string;
  /** Whether the reader may edit, publish to, or take down this listing. */
  can_manage: boolean;
  /** Set when this workspace has installed the listing at least once. */
  installed_version?: string;
  installed_version_id?: string;
  created_at: string;
  updated_at: string;
}

/**
 * One published version. `manifest` is returned verbatim and is both the
 * reader's description and the installer's input.
 */
export interface MarketplaceVersion {
  id: string;
  listing_id: string;
  version: string;
  changelog: string;
  /** sha256 over the canonical manifest and file set. */
  digest: string;
  size_bytes: number;
  manifest: MarketplaceManifest;
  published_by: string | null;
  created_at: string;
}

export interface MarketplaceListingDetail extends MarketplaceListing {
  version: MarketplaceVersion | null;
  /** Paths the version ships. Contents are fetched one at a time. */
  file_paths: string[];
}

export interface MarketplaceFacets {
  kinds: Record<string, number>;
  categories: Record<string, number>;
  tags: Record<string, number>;
}

export interface MarketplaceCatalog {
  count: number;
  total: number;
  listings: MarketplaceListing[];
  facets: MarketplaceFacets;
}

/** What this workspace took, from where, and at which version. */
export interface MarketplaceInstall {
  id: string;
  listing_id: string;
  version_id: string;
  version: string;
  entity_kind: MarketplaceKind;
  entity_id: string;
  created_at: string;
}

// --- Manifests -------------------------------------------------------------

export interface MarketplaceSkillManifest {
  name: string;
  description: string;
  content_path: string;
  file_paths: string[];
}

/**
 * One MCP server entry as published. `config` never carries a credential:
 * `required_secrets` names the paths the publisher withheld, which the
 * installer supplies at install time.
 */
export interface MarketplaceMcpManifest {
  name: string;
  transport: string;
  /** scheme://host of a withheld URL, so a reader can see what it connects to. */
  endpoint_hint?: string;
  config: Record<string, unknown>;
  required_secrets: string[];
}

export interface MarketplaceAgentSkillRef {
  name: string;
  description: string;
  dir: string;
}

/**
 * The portable half of an agent. An agent's environment variables, its runtime
 * configuration, its runtime binding and its permission targets are absent by
 * design — see the server-side manifest type for why each one cannot travel.
 */
export interface MarketplaceAgentManifest {
  name: string;
  description: string;
  instructions: string;
  avatar_url?: string;
  model?: string;
  thinking_level?: string;
  service_tier?: string;
  /** What the publisher's runtime was. Advisory, not a requirement. */
  runtime_provider?: string;
  max_concurrent_tasks?: number;
  custom_args?: string[];
  skills?: MarketplaceAgentSkillRef[];
  mcp_servers?: MarketplaceMcpManifest[];
}

export interface MarketplaceManifest {
  kind: MarketplaceKind;
  skill?: MarketplaceSkillManifest;
  agent?: MarketplaceAgentManifest;
  mcp?: MarketplaceMcpManifest;
}

// --- Requests --------------------------------------------------------------

export interface PublishMarketplaceListingRequest {
  kind: MarketplaceKind;
  /** The workspace entity to snapshot. The server reads it; nothing is uploaded. */
  source_id: string;
  slug?: string;
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  visibility?: MarketplaceVisibility;
  version: string;
  changelog?: string;
  /**
   * Required-secret paths the publisher declares are not credentials, e.g.
   * `["url"]` for a public endpoint. Everything unnamed is withheld.
   */
  public_fields?: string[];
}

export interface PublishMarketplaceListingResponse {
  listing: MarketplaceListing;
  version: MarketplaceVersion;
}

export interface UpdateMarketplaceListingRequest {
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  visibility?: MarketplaceVisibility;
  status?: MarketplaceStatus;
}

export interface MarketplaceInstallRequest {
  version_id?: string;
  on_conflict?: MarketplaceConflictStrategy;
  name?: string;
  /** Required for an agent listing: a template names no machine. */
  runtime_id?: string;
  /**
   * Values for the paths the publisher withheld. Keyed by required-secret path
   * (`env.TOKEN`, `url`); for an agent template, prefixed with the server's
   * name (`github/env.TOKEN`).
   */
  secrets?: Record<string, string>;
}

export interface ExistingSkillIdentity {
  id: string;
  name: string;
  created_by?: string;
  can_overwrite?: boolean;
}

/**
 * Shaped like the skill importer's result so the same conflict dialog serves
 * both. Exactly one entity field is populated, matching `entity_kind`.
 */
export interface MarketplaceInstallResult {
  status: "created" | "updated" | "skipped" | "conflict" | "failed";
  reason?: string;
  entity_kind?: MarketplaceKind;
  entity_id?: string;
  skill?: unknown;
  agent?: unknown;
  mcp_server?: unknown;
  existing_skill?: ExistingSkillIdentity;
}

export interface MarketplaceFile {
  path: string;
  content: string;
}

/**
 * The provenance an installed skill carries in its config, written by the
 * install. It is deliberately not one of the refreshable origin types: a
 * marketplace update is an install of a chosen version, not a re-fetch of
 * whatever a URL serves today.
 */
export interface MarketplaceSkillOrigin {
  type: "marketplace";
  listing_id: string;
  version_id: string;
  version: string;
  name: string;
}
