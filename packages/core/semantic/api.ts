import { z } from "zod";
import { api } from "../api";
import { parseWithFallback } from "../api/schema";
import {
  connectionSchema,
  ontologySchema,
  releaseSchema,
  runSchema,
  applicationSchema,
  buildSchema,
  deploymentSchema,
} from "./schemas";

export async function semanticRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: { method?: string; body?: unknown; idempotencyKey?: string },
): Promise<T> {
  const raw = await api.semanticRequest(path, {
    method: options?.method ?? "GET",
    body:
      options?.body === undefined ? undefined : JSON.stringify(options.body),
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined,
  });
  const result = parseWithFallback<T | null>(raw, schema, null, {
    endpoint: `/api/semantic${path}`,
  });
  if (result === null)
    throw new Error(
      "The server returned an unsupported response. Refresh or update Enact.",
    );
  return result;
}
const id = encodeURIComponent;
export const semanticApi = {
  connections: () => semanticRequest("/connections", z.array(connectionSchema)),
  ontologies: () => semanticRequest("/ontologies", z.array(ontologySchema)),
  releases: (ontologyId: string) =>
    semanticRequest(
      `/ontologies/${id(ontologyId)}/releases`,
      z.array(releaseSchema),
    ),
  runs: () => semanticRequest("/runs", z.array(runSchema)),
  run: (runId: string) => semanticRequest(`/runs/${id(runId)}`, runSchema),
  applications: () => semanticRequest("/apps", z.array(applicationSchema)),
  application: (appId: string) =>
    semanticRequest(`/apps/${id(appId)}`, applicationSchema),
  builds: (appId: string) =>
    semanticRequest(`/apps/${id(appId)}/builds`, z.array(buildSchema)),
  deployments: (appId: string) =>
    semanticRequest(
      `/apps/${id(appId)}/deployments`,
      z.array(deploymentSchema),
    ),
  build: (appId: string, buildId: string) =>
    semanticRequest(`/apps/${id(appId)}/builds/${id(buildId)}`, buildSchema),
  createConnection: (body: unknown) =>
    semanticRequest("/connections", connectionSchema, { method: "POST", body }),
  updateConnection: (connectionId: string, body: unknown) =>
    semanticRequest(`/connections/${id(connectionId)}`, connectionSchema, {
      method: "PUT",
      body,
    }),
  createOntology: (body: unknown) =>
    semanticRequest("/ontologies", ontologySchema, { method: "POST", body }),
  updateOntology: (ontologyId: string, body: unknown) =>
    semanticRequest(`/ontologies/${id(ontologyId)}`, ontologySchema, {
      method: "PUT",
      body,
    }),
  publishOntology: (ontologyId: string, body: unknown) =>
    semanticRequest(`/ontologies/${id(ontologyId)}/releases`, releaseSchema, {
      method: "POST",
      body,
    }),
  createRun: (body: unknown) =>
    semanticRequest("/runs", runSchema, { method: "POST", body }),
  createApplication: (body: unknown) =>
    semanticRequest("/apps", applicationSchema, { method: "POST", body }),
  command: (path: string, body?: unknown, idempotencyKey?: string) =>
    semanticRequest(path, z.unknown(), {
      method: "POST",
      body: body ?? {},
      idempotencyKey,
    }),
};
