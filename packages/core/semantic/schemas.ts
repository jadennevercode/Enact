import { z } from "zod";

const object = z.record(z.string(), z.unknown());
const timestamp = z.string().catch("");
const stringList = z.array(z.string()).catch([]);
export const connectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
    endpoint: z.string().catch(""),
    config: object.catch({}),
    enabled: z.boolean().catch(true),
    capabilities: stringList,
    created_at: timestamp,
  })
  .transform((v) => ({
    id: v.id,
    name: v.name,
    kind: v.kind,
    endpoint: v.endpoint,
    config: v.config,
    enabled: v.enabled,
    capabilities: v.capabilities.length ? v.capabilities : Array.isArray(v.config.capabilities) ? v.config.capabilities.filter((x): x is string => typeof x === "string") : [],
    createdAt: v.created_at,
  }));
export const ontologySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().catch(""),
    bundle: object.catch({}),
    binding_config: object.catch({}),
    test_data: object.catch({}),
    created_at: timestamp,
    updated_at: timestamp,
  })
  .transform((v) => ({
    id: v.id,
    name: v.name,
    description: v.description,
    bundle: v.bundle,
    bindingConfig: v.binding_config,
    testData: v.test_data,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
  }));
export const releaseSchema = z
  .object({
    id: z.string(),
    ontology_id: z.string(),
    version: z.string(),
    digest: z.string().catch(""),
    artifact: object.catch({}),
    binding_config: object.catch({}),
    retired_at: z.string().nullable().catch(null),
    retirement_reason: z.string().catch(""),
    created_at: timestamp,
  })
  .transform((v) => ({
    id: v.id,
    ontologyId: v.ontology_id,
    version: v.version,
    digest: v.digest,
    artifact: v.artifact,
    bindingConfig: v.binding_config,
    retiredAt: v.retired_at,
    retirementReason: v.retirement_reason,
    createdAt: v.created_at,
  }));
export const stepSchema = z
  .object({
    id: z.string(),
    kind: z.string().catch("step"),
    status: z.string().catch("unknown"),
    title: z.string().catch(""),
    error: z.string().catch(""),
    input: object.catch({}),
    output: z.unknown().optional(),
    created_at: timestamp,
  })
  .passthrough()
  .transform((v) => ({ ...v, createdAt: v.created_at }));
export const approvalSchema = z
  .object({
    id: z.string(),
    run_id: z.string().catch(""),
    binding_id: z.string().catch(""),
    status: z.string().catch("pending"),
    parameters: object.catch({}),
    reason: z.string().catch(""),
    created_at: timestamp,
  })
  .passthrough()
  .transform((v) => ({
    ...v,
    runId: v.run_id,
    bindingId: v.binding_id,
    createdAt: v.created_at,
  }));
export const receiptSchema = z
  .object({
    id: z.string(),
    status: z.string().catch("unknown"),
    binding_id: z.string().catch(""),
    result: z.unknown().optional(),
    response: z.unknown().optional(),
    readback: z.unknown().optional(),
    created_at: timestamp,
  })
  .passthrough()
  .transform((v) => ({
    ...v,
    bindingId: v.binding_id,
    createdAt: v.created_at,
  }));
export const runSchema = z
  .object({
    id: z.string(),
    issue_id: z.string().nullable().catch(null),
    application_id: z.string().nullable().catch(null),
    application_build_id: z.string().nullable().catch(null),
    release_id: z.string().catch(""),
    question: z.string().catch(""),
    status: z.string().catch("created"),
    steps: z.array(stepSchema).catch([]),
    approvals: z.array(approvalSchema).catch([]),
    receipts: z.array(receiptSchema).catch([]),
    created_at: timestamp,
  })
  .transform((v) => ({
    id: v.id,
    issueId: v.issue_id,
    applicationId: v.application_id,
    applicationBuildId: v.application_build_id,
    releaseId: v.release_id,
    question: v.question,
    status: v.status,
    steps: v.steps,
    approvals: v.approvals,
    receipts: v.receipts,
    createdAt: v.created_at,
  }));
export const applicationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().catch(""),
    ontology_release_id: z.string(),
    published_build_id: z.string().nullable().catch(null),
    created_at: timestamp,
  })
  .transform((v) => ({
    id: v.id,
    name: v.name,
    description: v.description,
    ontologyReleaseId: v.ontology_release_id,
    publishedBuildId: v.published_build_id,
    createdAt: v.created_at,
  }));
export const manifestSchema = z
  .object({
    version: z.literal(1),
    entry: z.literal("index.html"),
    ontology_release_id: z.string(),
    queries: stringList,
    actions: stringList,
  })
  .transform((v) => ({
    version: v.version,
    entry: v.entry,
    ontologyReleaseId: v.ontology_release_id,
    queries: v.queries,
    actions: v.actions,
  }));
export const buildSchema = z
  .object({
    id: z.string(),
    source_revision: z.string(),
    digest: z.string(),
    manifest: manifestSchema,
    report: object.catch({}),
    created_at: timestamp,
    source_files: z.record(z.string(), z.string()).optional(),
    files: z
      .record(
        z.string(),
        z
          .object({ content: z.string(), media_type: z.string() })
          .transform((v) => ({ content: v.content, mediaType: v.media_type })),
      )
      .optional(),
  })
  .transform((v) => ({
    id: v.id,
    sourceRevision: v.source_revision,
    digest: v.digest,
    manifest: v.manifest,
    report: v.report,
    createdAt: v.created_at,
    files: v.files,
    sourceFiles: v.source_files,
  }));
export type Connection = z.infer<typeof connectionSchema>;
export type Ontology = z.infer<typeof ontologySchema>;
export type OntologyRelease = z.infer<typeof releaseSchema>;
export type SemanticRun = z.infer<typeof runSchema>;
export type SemanticApproval = z.infer<typeof approvalSchema>;
export type Application = z.infer<typeof applicationSchema>;
export type ApplicationBuild = z.infer<typeof buildSchema>;

export const deploymentSchema = z
  .object({
    id: z.string(),
    build_id: z.string(),
    published_by: z.string(),
    created_at: timestamp,
  })
  .transform((v) => ({
    id: v.id,
    buildId: v.build_id,
    publishedBy: v.published_by,
    createdAt: v.created_at,
  }));

export const applicationBridgeRequestSchema = z.object({
  id: z.string().max(100),
  operation: z.enum([
    "context",
    "run.create",
    "run.list",
    "run.get",
    "run.attach",
    "run.trace",
    "query",
    "evaluate",
    "action.prepare",
    "approval.get",
    "approval.decide",
    "action.execute",
    "receipt.get",
    "receipt.reconcile",
  ]),
  input: z.record(z.string(), z.unknown()).default({}),
});
export type ApplicationBridgeRequest = z.infer<
  typeof applicationBridgeRequestSchema
>;
