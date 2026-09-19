import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const vcsKeys = {
  all: (wsId: string) => ["vcs", wsId] as const,
  connections: (wsId: string) => [...vcsKeys.all(wsId), "connections"] as const,
  repositories: (wsId: string, connectionId: string, search: string) =>
    [...vcsKeys.all(wsId), "repositories", connectionId, search] as const,
};

export const vcsConnectionsOptions = (wsId: string) =>
  queryOptions({
    queryKey: vcsKeys.connections(wsId),
    queryFn: () => api.listVCSConnections(wsId),
    enabled: !!wsId,
  });

export const vcsRepositoriesOptions = (wsId: string, connectionId: string, search = "", page = 1) =>
  queryOptions({
    queryKey: [...vcsKeys.repositories(wsId, connectionId, search), page],
    queryFn: () => api.listVCSRepositories(wsId, connectionId, page, search),
    enabled: !!wsId && !!connectionId,
    // A picker page is a live view of what the token can reach: a repository
    // created or shared moments ago should appear without a reload, and the
    // list is small enough that refetching costs little.
    staleTime: 0,
  });
