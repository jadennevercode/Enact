"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RotateCw, TriangleAlert } from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import {
  resumeConstructionCoordinator,
  semanticKeys,
  type CoordinatorResume,
} from "@enact/core/semantic";
import { Button } from "@enact/ui/components/ui/button";
import { Failure, useSemanticText } from "./shared";

export function CoordinatorResumeStatus({
  resume,
  retry,
  pending = false,
  error,
}: {
  resume?: CoordinatorResume;
  retry: () => Promise<unknown>;
  pending?: boolean;
  error?: unknown;
}) {
  const t = useSemanticText();
  if (!resume) return null;
  const queued = ["queued", "coalesced"].includes(resume.status);
  const deferred = resume.status === "deferred";
  const Icon = queued || deferred ? CheckCircle2 : TriangleAlert;
  return (
    <section
      role="status"
      aria-live="polite"
      className={`space-y-3 rounded-xl border p-4 ${queued ? "border-primary/25 bg-primary/5" : "border-warning/30 bg-warning/5"}`}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="text-body font-semibold">
            {t("coordinatorDecisionSaved")}
          </p>
          <p className="text-body leading-relaxed text-muted-foreground">
            {t(
              queued
                ? "coordinatorQueued"
                : deferred
                  ? "coordinatorDeferred"
                  : "coordinatorResumeFailed",
            )}
          </p>
          {resume.message && (
            <p className="text-caption leading-relaxed text-muted-foreground">
              {resume.message}
            </p>
          )}
        </div>
      </div>
      {resume.status === "failed" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => void retry()}
        >
          <RotateCw className="size-4" aria-hidden="true" />
          {t(pending ? "coordinatorRetrying" : "coordinatorRetry")}
        </Button>
      )}
      <Failure error={error} />
    </section>
  );
}

export function CoordinatorResumeNotice({
  constructionId,
  resume,
}: {
  constructionId: string;
  resume?: CoordinatorResume;
}) {
  const wsId = useWorkspaceId(),
    queryClient = useQueryClient();
  const [retried, setRetried] = useState<{
    source: CoordinatorResume | undefined;
    value: CoordinatorResume | undefined;
  }>();
  const [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>();
  async function retry() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await resumeConstructionCoordinator(constructionId);
      setRetried({ source: resume, value: result.coordinatorResume });
      await queryClient.invalidateQueries({ queryKey: semanticKeys.all(wsId) });
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <CoordinatorResumeStatus
      resume={retried?.source === resume ? (retried?.value ?? resume) : resume}
      retry={retry}
      pending={pending}
      error={error}
    />
  );
}
