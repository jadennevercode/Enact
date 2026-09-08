import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { semanticApi } from "./api";

export const semanticKeys = {
  all: (wsId: string) => ["semantic", wsId] as const,
};
export function semanticOptions(wsId: string) {
  return {
    connections: queryOptions({
      queryKey: [...semanticKeys.all(wsId), "connections"],
      queryFn: semanticApi.connections,
    }),
    ontologies: queryOptions({
      queryKey: [...semanticKeys.all(wsId), "ontologies"],
      queryFn: semanticApi.ontologies,
    }),
    runs: queryOptions({
      queryKey: [...semanticKeys.all(wsId), "runs"],
      queryFn: semanticApi.runs,
    }),
    applications: queryOptions({
      queryKey: [...semanticKeys.all(wsId), "applications"],
      queryFn: semanticApi.applications,
    }),
  };
}
export const releaseOptions = (wsId: string, ontologyId: string) =>
  queryOptions({
    queryKey: [...semanticKeys.all(wsId), "releases", ontologyId],
    queryFn: () => semanticApi.releases(ontologyId),
    enabled: !!ontologyId,
  });
export const runOptions = (wsId: string, runId: string) =>
  queryOptions({
    queryKey: [...semanticKeys.all(wsId), "run", runId],
    queryFn: () => semanticApi.run(runId),
    enabled: !!runId,
    refetchInterval: 5000,
  });
export const buildsOptions = (wsId: string, appId: string) =>
  queryOptions({
    queryKey: [...semanticKeys.all(wsId), "builds", appId],
    queryFn: () => semanticApi.builds(appId),
    enabled: !!appId,
  });
export const buildOptions = (wsId: string, appId: string, buildId: string) =>
  queryOptions({
    queryKey: [...semanticKeys.all(wsId), "build", appId, buildId],
    queryFn: () => semanticApi.build(appId, buildId),
    enabled: !!appId && !!buildId,
  });
export function useSemanticMutation<T = void>(
  wsId: string,
  fn: (input: T) => Promise<unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: semanticKeys.all(wsId) }),
  });
}

export const deploymentsOptions = (wsId: string, appId: string) =>
  queryOptions({
    queryKey: [...semanticKeys.all(wsId), "deployments", appId],
    queryFn: () => semanticApi.deployments(appId),
    enabled: !!appId,
  });
