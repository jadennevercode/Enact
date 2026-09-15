import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { semanticRequest } from "./api";
import { semanticKeys } from "./queries";
import { coordinatorResumeResponseSchema } from "./coordinator-resume";

const item = z
  .object({
    label: z.string(),
    value: z.string(),
    classification: z.string(),
    source_refs: z.array(z.string()).catch([]),
    decision_id: z.string().catch(""),
  })
  .transform((v) => ({
    label: v.label,
    value: v.value,
    classification: v.classification,
    sourceRefs: v.source_refs,
    decisionId: v.decision_id,
  }));
export const reviewPacketSchema = z
  .object({
    id: z.string(),
    construction_id: z.string(),
    gate: z.string(),
    sequence: z.number(),
    status: z.string(),
    artifact_digest: z.string(),
    review_subject_digest: z.string(),
    created_at: z.string(),
    created_by_task_id: z.string().nullable().optional(),
    packet: z.object({
      title: z.string(),
      summary: z.string(),
      groups: z
        .array(z.object({ title: z.string(), items: z.array(item) }))
        .catch([]),
      checks: z
        .array(
          z.object({
            label: z.string(),
            status: z.string(),
            detail: z.string().catch(""),
          }),
        )
        .catch([]),
      unresolved: z.array(z.string()).catch([]),
      proposal: z.record(z.string(), z.unknown()).catch({}),
    }),
    decision: z
      .object({
        decision: z.string(),
        rationale: z.string().catch(""),
        decided_by: z.string(),
        created_at: z.string(),
      })
      .nullable()
      .optional(),
  })
  .transform((v) => ({
    id: v.id,
    constructionId: v.construction_id,
    gate: v.gate,
    sequence: v.sequence,
    status: v.status,
    artifactDigest: v.artifact_digest,
    reviewSubjectDigest: v.review_subject_digest,
    createdAt: v.created_at,
    createdByTaskId: v.created_by_task_id,
    packet: v.packet,
    decision: v.decision
      ? {
          decision: v.decision.decision,
          rationale: v.decision.rationale,
          decidedBy: v.decision.decided_by,
          createdAt: v.decision.created_at,
        }
      : null,
  }));
export type ReviewPacket = z.infer<typeof reviewPacketSchema>;
export type ReviewPacketDecision = {
  decision: "approve" | "request_changes";
  rationale: string;
  expectedArtifactDigest: string;
  expectedReviewSubjectDigest: string;
};
export const reviewPacketApi = {
  list: (constructionId: string) =>
    semanticRequest(
      `/constructions/${encodeURIComponent(constructionId)}/review-packets`,
      z.array(reviewPacketSchema),
    ),
  decide: (packetId: string, input: ReviewPacketDecision) =>
    semanticRequest(
      `/review-packets/${encodeURIComponent(packetId)}/decisions`,
      coordinatorResumeResponseSchema,
      {
        method: "POST",
        body: {
          decision: input.decision,
          rationale: input.rationale,
          expected_artifact_digest: input.expectedArtifactDigest,
          expected_review_subject_digest: input.expectedReviewSubjectDigest,
        },
      },
    ),
};
export const reviewPacketOptions = (wsId: string, constructionId: string) =>
  queryOptions({
    queryKey: [...semanticKeys.all(wsId), "review-packets", constructionId],
    queryFn: () => reviewPacketApi.list(constructionId),
    enabled: !!constructionId,
    refetchInterval: 5000,
  });

// Keep the newest report for each gate within this issue, including prior model revisions.
export function reviewPacketsForIssue(
  packets: ReviewPacket[],
  tasks: { id: string; issueId: string }[],
  issueId: string,
): ReviewPacket[] {
  const taskIds = new Set(tasks.filter((task) => task.issueId === issueId).map((task) => task.id));
  const latest = new Map<string, ReviewPacket>();
  for (const packet of packets) {
    if (!packet.createdByTaskId || !taskIds.has(packet.createdByTaskId)) continue;
    if (!latest.has(packet.gate) || latest.get(packet.gate)!.sequence < packet.sequence)
      latest.set(packet.gate, packet);
  }
  return [...latest.values()].sort((a, b) => a.sequence - b.sequence);
}
