import { z } from "zod";
import { ApiError } from "../api";

const existingDraftSchema = z.object({
  approval_id: z.string().uuid(),
  run_id: z.string().uuid(),
  status: z.string().regex(/^[a-z_]{1,40}$/),
});

export function applicationError(error: unknown) {
  const result: {
    message: string;
    status?: number;
    existing_draft?: z.infer<typeof existingDraftSchema>;
  } = {
    message:
      error instanceof Error ? error.message : "Application request failed",
  };
  if (
    !(error instanceof ApiError) ||
    !Number.isInteger(error.status) ||
    error.status < 400 ||
    error.status > 599
  )
    return result;
  result.status = error.status;
  if (error.status === 409 && error.body && typeof error.body === "object") {
    const body = error.body as Record<string, unknown>;
    const draft = existingDraftSchema.safeParse(body.existing_draft);
    if (draft.success) result.existing_draft = draft.data;
  }
  return result;
}
