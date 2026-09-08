import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { semanticRequest } from "./api";
import { semanticKeys } from "./queries";
const record = z.record(z.string(), z.unknown());
const constructionSchema = z.object({ id: z.string(), ontology_id: z.string(), issue_id: z.string(), status: z.string(), stage: z.string(), source_snapshot_ids: z.array(z.string()).catch([]), created_at: z.string().catch("") }).passthrough().transform(v => ({ ...v, ontologyId: v.ontology_id, issueId: v.issue_id, sourceSnapshotIds: v.source_snapshot_ids, createdAt: v.created_at }));
const issue = z.object({ id: z.string(), identifier: z.string().optional(), title: z.string().optional() }).passthrough();
const detail = z.object({ construction: constructionSchema, issue, tasks: z.array(record).catch([]), events: z.array(record).catch([]), model_operations: z.array(record).catch([]) }).transform(v => ({ ...v, modelOperations: v.model_operations }));
export const constructionApi = {
  list: (id: string) => semanticRequest(`/ontologies/${encodeURIComponent(id)}/constructions`, z.array(constructionSchema)),
  start: (id: string, body: unknown) => semanticRequest(`/ontologies/${encodeURIComponent(id)}/constructions`, z.object({ construction: constructionSchema, issue }), { method: "POST", body }),
  detail: (id: string) => semanticRequest(`/constructions/${encodeURIComponent(id)}`, detail),
  revise: (id: string, body: unknown) => semanticRequest(`/constructions/${encodeURIComponent(id)}/revise`, z.unknown(), { method: "POST", body }),
};
export const constructionOptions = (wsId: string, ontologyId: string) => queryOptions({ queryKey: [...semanticKeys.all(wsId), "constructions", ontologyId], queryFn: () => constructionApi.list(ontologyId), refetchInterval: 6000 });
export const constructionDetailOptions = (wsId: string, id: string) => queryOptions({ queryKey: [...semanticKeys.all(wsId), "construction", id], queryFn: () => constructionApi.detail(id), enabled: !!id, refetchInterval: 4000 });
