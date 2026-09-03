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
 * agent, several skills and several MCP servers in one transaction, and a
 * skill install can rename or replace an existing skill — so after one of
 * these, no cached list of any of those things can be trusted.
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
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
