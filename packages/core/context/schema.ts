import { z } from "zod";
import { parseWithFallback } from "../api/schema";

export const contextSnapshotSchema = z.object({
  used_tokens: z.number().nonnegative().nullable().catch(null),
  window_tokens: z.number().positive().nullable().catch(null),
  model: z.string().catch(""),
  basis: z.string().catch("unknown"),
  is_estimate: z.boolean().catch(true),
  observed_at: z.string().catch(""),
});
export const contextOperationSchema = z.object({
  id: z.string().min(1),
  session_id: z.string(),
  status: z.string().catch("unknown"),
  actor_id: z.string().catch(""),
  reason: z.string().catch(""),
  created_at: z.string().catch(""),
  updated_at: z.string().catch(""),
  before: contextSnapshotSchema.nullable().catch(null),
  after: contextSnapshotSchema.nullable().catch(null),
});
export const contextSessionSchema = z.object({
  id: z.string().min(1),
  agent_id: z.string(),
  runtime_id: z.string().catch(""),
  scope_id: z.string(),
  scope_type: z.string(),
  provider: z.string().catch(""),
  generation: z.number().int().positive(),
  epoch: z.number().catch(0),
  event_seq: z.number().catch(0),
  updated_at: z.string().catch(""),
  snapshot: contextSnapshotSchema.nullable().catch(null),
  capabilities: z
    .object({
      native_compact: z.boolean().catch(false),
      compact_completion_signal: z.boolean().catch(false),
    })
    .catch({ native_compact: false, compact_completion_signal: false }),
  operation: contextOperationSchema.nullable().catch(null),
  operations: z.array(contextOperationSchema).catch([]),
});
export type ContextSession = z.infer<typeof contextSessionSchema>;
export type ContextOperation = z.infer<typeof contextOperationSchema>;
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;
export type ContextScope = { type: "issue" | "chat"; id: string };
export function parseContextSessions(raw: unknown): ContextSession[] {
  return parseWithFallback(
    raw,
    z.object({ sessions: z.array(contextSessionSchema) }),
    { sessions: [] as ContextSession[] },
    { endpoint: "context-sessions" },
  ).sessions;
}
export function parseContextOperation(raw: unknown): ContextOperation | null {
  return parseWithFallback(
    raw,
    contextOperationSchema,
    null as ContextOperation | null,
    { endpoint: "context-operations" },
  );
}
export function contextPercent(
  snapshot: ContextSnapshot | null,
): number | null {
  if (
    snapshot?.used_tokens == null ||
    snapshot.window_tokens == null ||
    snapshot.window_tokens <= 0 ||
    snapshot.used_tokens < 0
  )
    return null;
  return Math.min(
    100,
    Math.max(0, (snapshot.used_tokens / snapshot.window_tokens) * 100),
  );
}
export function contextOperationActive(status?: string): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "reconciliation_required"
  );
}
export function isCompactCommand(content: string): boolean {
  return content.trim() === "/compact";
}

export const checkpointSchema = z.object({
  id: z.string(),
  source_task_id: z.string(),
  source_revision: z.string(),
  summary: z.string(),
  decisions: z.array(z.string()).catch([]),
  pending: z.array(z.string()).catch([]),
  evidence: z.array(z.string()).catch([]),
});
export type ContextCheckpoint = z.infer<typeof checkpointSchema>;
export function parseContextCheckpoints(raw: unknown): ContextCheckpoint[] {
  return parseWithFallback(
    raw,
    z.object({ checkpoints: z.array(checkpointSchema) }),
    { checkpoints: [] as ContextCheckpoint[] },
    { endpoint: "context-checkpoints" },
  ).checkpoints;
}
