import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { workspaceKeys } from "../workspace/queries";
import { marketplaceKeys } from "./queries";
import type {
  MarketplaceInstallRequest,
  PublishMarketplaceListingRequest,
  UpdateMarketplaceListingRequest,
} from "../types";

/**
 * Marketplace writes.
 *
 * None of these is optimistic. Publishing and installing both create something
 * on the server whose identity the client cannot predict — a version id, a
 * renamed skill, an agent with its skills attached — and both are followed by
 * navigating to what was created. The rule in CLAUDE.md is that a flow which
 * navigates awaits the server, and these do.
 */

/**
 * Publishes a workspace entity, creating the listing on first publish and
 * adding a version on every publish.
 */
export function usePublishMarketplaceListing(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: PublishMarketplaceListingRequest) =>
      api.publishMarketplaceListing(data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: marketplaceKeys.all(wsId) });
    },
  });
}

export function useUpdateMarketplaceListing(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, ...data }: { listingId: string } & UpdateMarketplaceListingRequest) =>
      api.updateMarketplaceListing(listingId, data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: marketplaceKeys.all(wsId) });
    },
  });
}

export function useDeleteMarketplaceListing(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (listingId: string) => api.deleteMarketplaceListing(listingId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: marketplaceKeys.all(wsId) });
    },
  });
}

/**
 * Installs a listing into the current workspace.
 *
 * The invalidation is deliberately broad. An agent template install creates an
 * agent, several skills and several MCP servers in one transaction, an Agent
 * Family install creates several of each plus the squad, and a skill install
 * can rename or replace an existing skill — so after one of these, no cached
 * list of any of those things can be trusted.
 */
export function useInstallMarketplaceListing(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, ...data }: { listingId: string } & MarketplaceInstallRequest) =>
      api.installMarketplaceListing(listingId, data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: marketplaceKeys.all(wsId) });
      queryClient.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) });
      queryClient.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
      queryClient.invalidateQueries({ queryKey: workspaceKeys.mcpServers(wsId) });
      queryClient.invalidateQueries({ queryKey: workspaceKeys.squads(wsId) });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

/**
 * Turns a recommendation down, or puts it back.
 *
 * These ARE optimistic, unlike everything above: the outcome is locally
 * predictable (the card leaves the rail, or returns), the member stays on the
 * page, failure is rare, and rollback is putting one row back. That is exactly
 * the case CLAUDE.md allows it for — and a dismissal that takes a server round
 * trip before the card moves feels broken in a way an install does not.
 *
 * The whole recommendation subtree is invalidated on settle rather than
 * patched, because dropping one row changes what fits under the server's limit:
 * a seventh listing may now be shown, and only the server knows which.
 */
export function useDismissMarketplaceRecommendation(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (listingId: string) => api.dismissMarketplaceRecommendation(listingId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: marketplaceKeys.all(wsId) });
      // Dismissing is one of the two ways the setup checklist's capability
      // step is satisfied, so the checklist is stale the moment this lands.
      queryClient.invalidateQueries({ queryKey: workspaceKeys.setup(wsId) });
    },
  });
}

export function useRestoreMarketplaceRecommendation(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (listingId: string) => api.restoreMarketplaceRecommendation(listingId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: marketplaceKeys.all(wsId) });
    },
  });
}
