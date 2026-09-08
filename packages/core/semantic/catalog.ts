import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { semanticRequest } from "./api";
import { semanticKeys } from "./queries";
import { ontologySchema } from "./schemas";

const record = z.record(z.string(), z.unknown());
const strings = z.array(z.string()).catch([]);
export const connectorSchema = z.object({
  id: z.string(), name: z.string(), description: z.string().catch(""),
  capabilities: strings, available: z.boolean().catch(false),
  dependency_status: z.string().catch("unknown"),
  auth_fields: z.array(z.union([z.string(), record])).catch([]), features: strings,
}).transform(v => ({ ...v, dependencyStatus: v.dependency_status, authFields: v.auth_fields }));
export const catalogFieldSchema = z.object({name: z.string(), type: z.string().catch("unknown"), nullable: z.boolean().catch(true), primary_key: z.boolean().optional(), description: z.string().catch("")}).passthrough().transform(v => ({...v, primaryKey: v.primary_key}));
export const catalogEntrySchema = z.object({
  id: z.string(), kind: z.string().catch("resource"), name: z.string().catch(""),
  parent_id: z.string().nullable().optional(), path: z.string().catch(""), description: z.string().catch(""),
  capabilities: strings, fields: z.array(catalogFieldSchema).catch([]), relationships: z.array(record).catch([]),
  input_schema: record.catch({}), output_schema: record.catch({}), method: z.string().catch(""), operation_id: z.string().catch(""),
  call_example: z.unknown().optional(), metadata: record.catch({}),
}).transform(v => ({...v, parentId: v.parent_id, inputSchema: v.input_schema, outputSchema: v.output_schema, operationId: v.operation_id, callExample: v.call_example}));
export const catalogSchema = z.object({
  id: z.string().catch(""), connection_id: z.string().catch(""), state: z.string().catch("undiscovered"),
  source_digest: z.string().catch(""), source_revision: z.string().catch(""),
  entries: z.array(catalogEntrySchema).catch([]), warnings: z.array(z.unknown()).catch([]), created_at: z.string().catch(""),
}).transform(v => ({...v, connectionId:v.connection_id, sourceDigest:v.source_digest, sourceRevision:v.source_revision, createdAt:v.created_at}));
export const snapshotSchema = z.object({
  id:z.string(), connection_id:z.string().catch(""), source_digest:z.string().catch(""), source_revision:z.string().catch(""), created_at:z.string().catch(""),
  documents:z.array(z.object({id:z.string().catch(""),content:z.string().catch(""),source_path:z.string().catch(""),source_commit:z.string().catch(""),source_hash:z.string().catch(""),metadata:record.catch({})}).transform(v=>({...v,sourcePath:v.source_path,sourceCommit:v.source_commit,sourceHash:v.source_hash}))).catch([]),
}).transform(v=>({...v,connectionId:v.connection_id,sourceDigest:v.source_digest,sourceRevision:v.source_revision,createdAt:v.created_at}));
export const previewSchema = z.object({records:z.array(z.unknown()).catch([]),columns:z.array(z.unknown()).catch([]),total:z.number().optional(),source_digest:z.string().catch(""),metadata:record.catch({})}).transform(v=>({...v,sourceDigest:v.source_digest}));
export const semanticGraphNodeSchema = z.object({id:z.string(),label:z.string().optional(),name:z.string().optional(),type:z.string().optional(),kind:z.string().optional(),properties:record.catch({}),metadata:record.catch({})}).passthrough();
export const semanticGraphEdgeSchema = z.object({id:z.string().optional(),source:z.string(),target:z.string(),label:z.string().optional(),type:z.string().optional(),kind:z.string().optional(),properties:record.catch({})}).passthrough();
export const semanticGraphSchema = z.object({nodes:z.array(semanticGraphNodeSchema).catch([]),edges:z.array(semanticGraphEdgeSchema).catch([])}).passthrough();
export const traceSchema = semanticGraphSchema.extend({run_id:z.string().catch(""),release_id:z.string().catch(""),steps:z.array(record).catch([]),approvals:z.array(record).catch([]),receipts:z.array(record).catch([]),source:z.string().catch("")});
export type Connector = z.infer<typeof connectorSchema>;
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type SourceSnapshot = z.infer<typeof snapshotSchema>;
export type SemanticGraph = z.infer<typeof semanticGraphSchema>;
export type SemanticGraphNode = z.infer<typeof semanticGraphNodeSchema>;
export type SemanticGraphEdge = z.infer<typeof semanticGraphEdgeSchema>;
const id=encodeURIComponent;
export const catalogApi = {
  connectors:()=>semanticRequest("/connectors",z.object({connectors:z.array(connectorSchema)})),
  catalog:(connectionId:string)=>semanticRequest(`/connections/${id(connectionId)}/catalog`,catalogSchema),
  discover:(connectionId:string)=>semanticRequest(`/connections/${id(connectionId)}/discover`,catalogSchema,{method:"POST",body:{}}),
  preview:(connectionId:string,entryId:string,parameters:Record<string,unknown>={})=>semanticRequest(`/connections/${id(connectionId)}/preview`,previewSchema,{method:"POST",body:{entry_id:entryId,limit:20,parameters}}),
  snapshots:(connectionId:string)=>semanticRequest(`/connections/${id(connectionId)}/snapshots`,z.array(snapshotSchema)),
  snapshot:(connectionId:string,body:unknown={})=>semanticRequest(`/connections/${id(connectionId)}/snapshots`,snapshotSchema,{method:"POST",body}),
  graph:(ontologyId:string)=>semanticRequest(`/ontologies/${id(ontologyId)}/graph`,semanticGraphSchema,{method:"POST",body:{}}),
  trace:(runId:string)=>semanticRequest(`/runs/${id(runId)}/trace`,traceSchema),
  native:(ontologyId:string,body:unknown)=>semanticRequest(`/ontologies/${id(ontologyId)}/native`,z.object({ontology:ontologySchema}).passthrough(),{method:"POST",body}),
  revisions:(ontologyId:string)=>semanticRequest(`/ontologies/${id(ontologyId)}/revisions`,z.array(record)),
};
export const connectorOptions=(wsId:string)=>queryOptions({queryKey:[...semanticKeys.all(wsId),"connectors"],queryFn:catalogApi.connectors});
export const catalogOptions=(wsId:string,connectionId:string)=>queryOptions({queryKey:[...semanticKeys.all(wsId),"catalog",connectionId],queryFn:()=>catalogApi.catalog(connectionId),enabled:!!connectionId});
export const snapshotOptions=(wsId:string,connectionId:string)=>queryOptions({queryKey:[...semanticKeys.all(wsId),"snapshots",connectionId],queryFn:()=>catalogApi.snapshots(connectionId),enabled:!!connectionId});
export const graphOptions=(wsId:string,ontologyId:string,revision:string)=>queryOptions({queryKey:[...semanticKeys.all(wsId),"graph",ontologyId,revision],queryFn:()=>catalogApi.graph(ontologyId),enabled:!!ontologyId});
export const traceOptions=(wsId:string,runId:string)=>queryOptions({queryKey:[...semanticKeys.all(wsId),"trace",runId],queryFn:()=>catalogApi.trace(runId),enabled:!!runId,refetchInterval:5000});
export const revisionOptions=(wsId:string,ontologyId:string)=>queryOptions({queryKey:[...semanticKeys.all(wsId),"revisions",ontologyId],queryFn:()=>catalogApi.revisions(ontologyId),enabled:!!ontologyId});
