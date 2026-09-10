import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { semanticRequest } from "./api";
import { semanticKeys } from "./queries";
import { coordinatorResumeSchema } from "./coordinator-resume";

const questionSchema = z
  .object({
    key: z.string(),
    topic: z.string(),
    prompt: z.string(),
    why: z.string(),
    status: z.enum(["unanswered", "answered", "skipped"]),
    answer: z.string().optional(),
    answer_kind: z.string().optional(),
    answered_by: z.string().optional(),
    decision_id: z.string().optional(),
  })
  .transform((v) => ({
    key: v.key,
    topic: v.topic,
    prompt: v.prompt,
    why: v.why,
    status: v.status,
    answer: v.answer,
    answerKind: v.answer_kind,
    answeredBy: v.answered_by,
    decisionId: v.decision_id,
  }));
const cardSchema = z
  .object({
    key: z.string(),
    kind: z.enum([
      "entity",
      "attribute",
      "relationship",
      "action",
      "policy",
      "data_binding",
      "action_binding",
    ]),
    label: z.string(),
    description: z.string(),
    classification: z.string(),
    source_refs: z.array(z.string()).catch([]),
    status: z.enum([
      "proposed",
      "confirmed",
      "corrected",
      "unknown",
      "rejected",
    ]),
    rationale: z.string().optional(),
    decided_by: z.string().optional(),
    decision_id: z.string().optional(),
  })
  .transform((v) => ({
    key: v.key,
    kind: v.kind,
    label: v.label,
    description: v.description,
    classification: v.classification,
    sourceRefs: v.source_refs,
    status: v.status,
    rationale: v.rationale,
    decidedBy: v.decided_by,
    decisionId: v.decision_id,
  }));
export const authoringSchema = z
  .object({
    construction_id: z.string(),
    revision: z.number().int().nonnegative(),
    interview: z.object({
      scope: z.record(z.string(), z.unknown()).optional(),
      status: z.enum(["collecting", "ready"]),
      round: z.number(),
      questions: z.array(questionSchema),
    }),
    cards: z.array(cardSchema),
    coordinator_resume: coordinatorResumeSchema.nullish(),
  })
  .transform((v) => ({
    constructionId: v.construction_id,
    coordinatorResume: v.coordinator_resume ?? undefined,
    revision: v.revision,
    interview: v.interview,
    cards: v.cards,
  }));
export type OntologyAuthoring = z.infer<typeof authoringSchema>;
export type AuthoringCard = OntologyAuthoring["cards"][number];
export type AuthoringResponse = {
  expectedRevision: number;
  answers?: {
    questionKey: string;
    answer: string;
    answerKind?: "answer" | "unknown";
  }[];
  cardDecisions?: {
    cardKey: string;
    decision: "confirm" | "correct" | "unknown" | "reject";
    rationale: string;
    correction?: {
      kind?: AuthoringCard["kind"];
      label?: string;
      description?: string;
    };
  }[];
};
export const authoringApi = {
  forIssue: async (issueId: string) => {
    try {
      return await semanticRequest(
        `/constructions/for-issue/${encodeURIComponent(issueId)}`,
        z
          .object({ construction_id: z.string() })
          .transform((v) => ({ constructionId: v.construction_id })),
      );
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 404)
        return null;
      throw error;
    }
  },
  get: (constructionId: string) =>
    semanticRequest(
      `/constructions/${encodeURIComponent(constructionId)}/authoring`,
      authoringSchema,
    ),
  respond: (constructionId: string, input: AuthoringResponse) =>
    semanticRequest(
      `/constructions/${encodeURIComponent(constructionId)}/authoring/respond`,
      authoringSchema,
      {
        method: "POST",
        body: {
          expected_revision: input.expectedRevision,
          answers: input.answers?.map((v) => ({
            question_key: v.questionKey,
            answer: v.answer,
            answer_kind: v.answerKind,
          })),
          card_decisions: input.cardDecisions?.map((v) => ({
            card_key: v.cardKey,
            decision: v.decision,
            rationale: v.rationale,
            correction: v.correction,
          })),
        },
      },
    ),
};
export const issueConstructionOptions = (wsId: string, issueId: string) =>
  queryOptions({
    queryKey: [...semanticKeys.all(wsId), "issue-construction", issueId],
    queryFn: () => authoringApi.forIssue(issueId),
    enabled: !!issueId,
    retry: false,
    refetchInterval: 10000,
  });
export const authoringOptions = (wsId: string, constructionId: string) =>
  queryOptions({
    queryKey: [...semanticKeys.all(wsId), "authoring", constructionId],
    queryFn: () => authoringApi.get(constructionId),
    enabled: !!constructionId,
    refetchInterval: 5000,
  });
