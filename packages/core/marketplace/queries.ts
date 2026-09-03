import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import type {
  MarketplaceInstall,
  MarketplaceKind,
  MarketplaceListing,
} from "../types";

/**
 * Marketplace query keys.
 *
 * Everything hangs off the workspace, even though the public half of the
 * directory is the same rows for everyone: what a workspace may see, what it
 * has already installed, and whether it may manage a listing all differ per
 * workspace, so a workspace switch has to drop the cache.
 */
export const marketplaceKeys = {
  all: (wsId: string) => ["workspaces", wsId, "marketplace"] as const,
  catalog: (wsId: string, filters: MarketplaceCatalogFilters) =>
    ["workspaces", wsId, "marketplace", "catalog", filters] as const,
  listing: (wsId: string, listingId: string, versionId?: string) =>
    ["workspaces", wsId, "marketplace", "listing", listingId, versionId ?? "latest"] as const,
  versions: (wsId: string, listingId: string) =>
    ["workspaces", wsId, "marketplace", "listing", listingId, "versions"] as const,
  file: (wsId: string, listingId: string, path: string, versionId?: string) =>
    ["workspaces", wsId, "marketplace", "listing", listingId, "file", versionId ?? "latest", path] as const,
  installs: (wsId: string) => ["workspaces", wsId, "marketplace", "installs"] as const,
};

export interface MarketplaceCatalogFilters {
  kind?: MarketplaceKind;
  category?: string;
  tag?: string;
  q?: string;
  includeDeprecated?: boolean;
  /** Restricts the result to listings this workspace published. */
  mine?: boolean;
}

/**
 * The directory browse. Filters live in the query key rather than in a `select`
 * so a filter change refetches: the server computes the facet counts, and
 * recomputing them client-side from a filtered list would report the wrong
 * numbers on every chip.
 */
export function marketplaceCatalogOptions(
  wsId: string,
  filters: MarketplaceCatalogFilters = {},
) {
  return queryOptions({
    queryKey: marketplaceKeys.catalog(wsId, filters),
    queryFn: () => api.listMarketplaceListings(filters),
    enabled: wsId !== "",
  });
}

export function marketplaceListingOptions(
  wsId: string,
  listingId: string,
  versionId?: string,
) {
  return queryOptions({
    queryKey: marketplaceKeys.listing(wsId, listingId, versionId),
    queryFn: () => api.getMarketplaceListing(listingId, versionId),
    enabled: wsId !== "" && listingId !== "",
  });
}

export function marketplaceVersionsOptions(wsId: string, listingId: string) {
  return queryOptions({
    queryKey: marketplaceKeys.versions(wsId, listingId),
    queryFn: () => api.listMarketplaceVersions(listingId),
    enabled: wsId !== "" && listingId !== "",
  });
}

/**
 * One file of a published version. Fetched on demand — a listing's file tree
 * can run to hundreds of kilobytes and a reader opens one file at a time.
 */
export function marketplaceFileOptions(
  wsId: string,
  listingId: string,
  path: string,
  versionId?: string,
) {
  return queryOptions({
    queryKey: marketplaceKeys.file(wsId, listingId, path, versionId),
    queryFn: () => api.getMarketplaceFile(listingId, path, versionId),
    enabled: wsId !== "" && listingId !== "" && path !== "",
    // A published version is immutable, so its files never change under a
    // reader. Nothing here goes stale.
    staleTime: Infinity,
  });
}

/**
 * This workspace's install records. Drives the "installed" badge in the
 * directory and the "a newer version is available" prompt on the entity.
 */
export function marketplaceInstallsOptions(wsId: string) {
  return queryOptions({
    queryKey: marketplaceKeys.installs(wsId),
    queryFn: () => api.listMarketplaceInstalls(),
    enabled: wsId !== "",
  });
}

/**
 * Folds install records down to the current one per installed entity, so a
 * skill or agent page can ask "where did this come from?" with one lookup.
 * The records arrive newest-first, so the first one seen for an entity wins.
 */
export function selectInstallsByEntity(
  installs: MarketplaceInstall[],
): Map<string, MarketplaceInstall> {
  const byEntity = new Map<string, MarketplaceInstall>();
  for (const install of installs) {
    if (!byEntity.has(install.entity_id)) byEntity.set(install.entity_id, install);
  }
  return byEntity;
}

/**
 * True when the listing has a version newer than the one this workspace
 * installed. Compares version ids, not version strings: a publisher's version
 * numbering is theirs to choose and may not sort.
 */
export function hasMarketplaceUpdate(listing: MarketplaceListing): boolean {
  if (!listing.installed_version_id || !listing.latest_version_id) return false;
  return listing.installed_version_id !== listing.latest_version_id;
}
