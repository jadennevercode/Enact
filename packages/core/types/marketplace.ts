/**
 * Marketplace wire types.
 *
 * The directory carries four kinds of listing — skill, agent template, MCP
 * server and Agent Family (`squad` in code, its glossary name in the UI).
 * Ontologies appear as a fifth tab in the UI but are not listings: they are
 * federated from Capability Hub and read through the ontology endpoints, so
 * they have their own types in ./ontology.
 */

export type MarketplaceKind = "skill" | "agent" | "mcp" | "squad";

/** The installed-state filter a browse can narrow by. */
export type MarketplaceInstalledFilter = "installed" | "not_installed";

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
  /** Whether this workspace holds a copy. The badge every card carries. */
  installed: boolean;
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
  /** Counts of the visible set under `installed` and `not_installed`. */
  installed: Record<string, number>;
}

/**
 * Why a listing was recommended.
 *
 * `kind` is one of "stack" | "work" | "domain" | "official" | "featured" |
 * "popular", but it is typed as a bare string: a newer server may send a kind
 * this client has no copy for, and a reason it cannot label is better rendered
 * as its raw term than dropped.
 *
 * `term` and `field` are present only for the three reasons that come from the
 * workspace's own profile — they name the value that matched and where it was
 * found, which is what makes a recommendation something a member can disagree
 * with.
 */
export interface MarketplaceRecommendationReason {
  kind: string;
  term: string;
  field: string;
  score: number;
}

export interface MarketplaceRecommendation {
  listing: MarketplaceListing;
  score: number;
  reasons: MarketplaceRecommendationReason[];
  /**
   * Whether any reason came from this workspace's profile. False means the
   * result is not about this workspace at all — it is what the deployment
   * ships, surfaced because nothing better matched — and the UI must say so
   * rather than presenting it as a fit.
   */
  matched: boolean;
}

export interface MarketplaceRecommendations {
  recommendations: MarketplaceRecommendation[];
  /**
   * The ranking had nothing to go on. The rail turns this into "tell us about
   * your project" rather than into an empty list, which would read as "there is
   * nothing here for you".
   */
  profile_empty: boolean;
  /**
   * How many listings were eligible before scoring. It is what makes an empty
   * rail explicable: nothing matched out of forty is a different message from
   * nothing matched out of zero.
   */
  considered: number;
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

/** One agent member of a published Agent Family. */
export interface MarketplaceSquadAgentRef {
  /** Prefix of this member's files, e.g. `agents/reviewer`. */
  dir: string;
  /** The squad role it was published under; `leader` for the leader. */
  role: string;
  agent: MarketplaceAgentManifest;
}

/**
 * An Agent Family as published: the squad's own prose and every agent member
 * as a full template. Human members never travel; the leader is named by the
 * `dir` of the member it is.
 */
export interface MarketplaceSquadManifest {
  name: string;
  description: string;
  instructions: string;
  avatar_url?: string;
  leader_dir: string;
  agents: MarketplaceSquadAgentRef[];
}

export interface MarketplaceManifest {
  kind: MarketplaceKind;
  /**
   * Conditions the installing side has to meet before a copy will run — an
   * interpreter on the runtime host, people added to a family. Publisher prose;
   * the UI states it before the install and shows nothing when it is empty.
   */
  prerequisites?: string[];
  skill?: MarketplaceSkillManifest;
  agent?: MarketplaceAgentManifest;
  mcp?: MarketplaceMcpManifest;
  squad?: MarketplaceSquadManifest;
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
  squad?: unknown;
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
