import { z } from "zod";
import { semanticRequest } from "./api";

export const coordinatorResumeSchema = z.object({
  status: z.string(),
  message: z.string().optional(),
});
export const coordinatorResumeResponseSchema = z
  .object({
    coordinator_resume: coordinatorResumeSchema.nullish(),
  })
  .transform((value) => ({
    coordinatorResume: value.coordinator_resume ?? undefined,
  }));
export type CoordinatorResume = z.infer<typeof coordinatorResumeSchema>;
export const resumeConstructionCoordinator = (constructionId: string) =>
  semanticRequest(
    `/constructions/${encodeURIComponent(constructionId)}/resume`,
    coordinatorResumeResponseSchema,
    { method: "POST", body: {} },
  );
