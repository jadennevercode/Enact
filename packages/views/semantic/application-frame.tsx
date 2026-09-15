"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  semanticApi,
  applicationError,
  applicationIssueTargetSchema,
  applicationIssueOpenInputSchema,
  applicationBridgeRequestSchema,
  type ApplicationBridgeRequest,
  type ApplicationBuild,
} from "@enact/core/semantic";
import { useCommentDraftStore } from "@enact/core/issues/stores";
import { getCurrentSlug } from "@enact/core/platform";
import { useWorkspacePaths } from "@enact/core/paths";
import { useNavigation } from "../navigation";
import { Button } from "@enact/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import { buildApplicationEnvelope } from "./application-document";
import { ActionReview, canDecideApproval } from "./action-review";
import { Failure, useSemanticText } from "./shared";
interface Decision {
  request: ApplicationBridgeRequest;
  approval: unknown;
  preview?: unknown;
  loadingRelated?: boolean;
  relatedError?: unknown;
  respond: (approved: boolean) => void;
}
export function ApplicationFrame({
  appId,
  build,
  initialRunId,
}: {
  appId: string;
  build: ApplicationBuild;
  initialRunId?: string;
}) {
  const navigation = useNavigation(),
    paths = useWorkspacePaths();
  const t = useSemanticText(),
    frame = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<unknown>(),
    [decision, setDecision] = useState<Decision | null>(null);
  const pending = useRef(false);
  const currentNavigation = useRef({ navigation, paths });
  currentNavigation.current = { navigation, paths };
  const document = useMemo(() => {
    try {
      return { html: buildApplicationEnvelope(build) };
    } catch (error) {
      return { error };
    }
  }, [build]);
  useEffect(() => {
    setDecision(null);
    let channel: MessageChannel | undefined;
    let closed = false;
    const ready = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== "enact.application.ready"
      )
        return;
      if (channel) return;
      channel = new MessageChannel();
      const port = channel.port1;
      port.onmessage = async (event: MessageEvent) => {
        const parsed = applicationBridgeRequestSchema.safeParse(event.data);
        if (!parsed.success) return;
        const request = parsed.data;
        const invoke = (operation: string, input: Record<string, unknown>) =>
          semanticApi.command(`/apps/${encodeURIComponent(appId)}/invoke`, {
            build_id: build.id,
            operation,
            input:
              operation === "context" && initialRunId
                ? { ...input, requested_run_id: initialRunId }
                : input,
          });
        const reply = (ok: boolean, value: unknown) => {
          if (!closed)
            port.postMessage(
              ok
                ? { id: request.id, ok, value }
                : { id: request.id, ok: false, error: value },
            );
        };
        const perform = async () => {
          try {
            const issueInput = request.operation === "issue.open"
              ? applicationIssueOpenInputSchema.parse(request.input) : null;
            const workspaceSlug = getCurrentSlug();
            if (issueInput?.draft_message && !workspaceSlug)
              throw new Error("Select a workspace before bringing a question to a task");
            // Keep question text local. The server only resolves the authorized task.
            const result = await invoke(request.operation, issueInput ? { run_id: issueInput.run_id } : request.input);
            if (closed) return;
            if (issueInput) {
              const target = applicationIssueTargetSchema.safeParse(result);
              if (!target.success || target.data.runId !== issueInput.run_id)
                throw new Error("Investigation Issue is unavailable");
              if (workspaceSlug !== getCurrentSlug())
                throw new Error("Workspace changed. Return to the investigation and try again");
              if (issueInput.draft_message && workspaceSlug) {
                useCommentDraftStore.getState().queuePrefill(`new:${target.data.issueId}`, {
                  id: crypto.randomUUID(), content: issueInput.draft_message, workspaceSlug,
                });
              }
              reply(true, { ...target.data, ...(issueInput.draft_message ? { draft_status: "saved" } : {}) });
              const current = currentNavigation.current;
              current.navigation.push(
                current.paths.issueDetail(target.data.issueId),
              );
            } else reply(true, result);
          } catch (error) {
            reply(false, applicationError(error));
          }
        };
        if (request.operation === "approval.decide") {
          if (pending.current) {
            reply(false, "Another decision is awaiting your response");
            return;
          }
          pending.current = true;
          try {
            const approval = await invoke("approval.get", {
              approval_id: request.input.approval_id,
            });
            if (closed) return;
            setDecision({
              request,
              approval,
              respond: (approved) => {
                setDecision(null);
                pending.current = false;
                if (approved && canDecideApproval(approval)) void perform();
                else
                  reply(
                    false,
                    approved
                      ? "This approval is no longer available for a decision"
                      : "Decision cancelled by the user",
                  );
              },
            });
          } catch (error) {
            pending.current = false;
            reply(false, applicationError(error));
          }
        } else await perform();
      };
      port.start();
      frame.current?.contentWindow?.postMessage(
        { type: "enact.application.init" },
        "*",
        [channel.port2],
      );
    };
    window.addEventListener("message", ready);
    return () => {
      closed = true;
      pending.current = false;
      window.removeEventListener("message", ready);
      channel?.port1.close();
    };
  }, [appId, build.id, initialRunId]);
  async function viewRelatedApproval(approvalId: string) {
    if (!decision) return;
    const originalRequest = decision.request;
    setDecision((current) =>
      current?.request === originalRequest
        ? { ...current, loadingRelated: true, relatedError: undefined }
        : current,
    );
    try {
      const preview = await semanticApi.command(
        `/apps/${encodeURIComponent(appId)}/invoke`,
        {
          build_id: build.id,
          operation: "approval.get",
          input: { approval_id: approvalId },
        },
      );
      setDecision((current) =>
        current?.request === originalRequest
          ? { ...current, preview, loadingRelated: false }
          : current,
      );
    } catch (relatedError) {
      setDecision((current) =>
        current?.request === originalRequest
          ? { ...current, relatedError, loadingRelated: false }
          : current,
      );
    }
  }
  if (document.error) return <Failure error={document.error} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Failure error={error} />
      <iframe
        key={`${appId}:${build.id}:${initialRunId || ""}`}
        ref={frame}
        title="Business application"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={document.html}
        onError={() => setError(new Error("Application failed to load"))}
        className="min-h-[650px] w-full flex-1 rounded-lg border bg-background"
      />
      <Dialog
        open={!!decision}
        onOpenChange={(open) => {
          if (!open) decision?.respond(false);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {decision?.preview !== undefined
                ? t("actionReviewRelatedTitle")
                : decision?.request.input.approve === true
                  ? t("actionReviewApproveTitle")
                  : t("actionReviewRejectTitle")}
            </DialogTitle>
            <DialogDescription>{t("actionReviewSummary")}</DialogDescription>
          </DialogHeader>
          {decision?.preview !== undefined && (
            <p className="text-body leading-relaxed text-muted-foreground">
              {t("actionReviewRelatedReadOnly")}
            </p>
          )}
          <Failure error={decision?.relatedError} />
          {decision?.loadingRelated && (
            <p role="status" className="text-caption text-muted-foreground">
              {t("loading")}
            </p>
          )}
          <ActionReview
            approval={decision?.preview ?? decision?.approval}
            reviewReason={
              decision?.preview === undefined
                ? String(decision?.request.input.reason ?? "")
                : undefined
            }
            onViewRelated={
              decision?.loadingRelated
                ? undefined
                : (id) => void viewRelatedApproval(id)
            }
          />
          <div className="flex flex-wrap gap-3">
            {decision?.preview !== undefined ? (
              <Button
                variant="outline"
                disabled={decision?.loadingRelated}
                onClick={() =>
                  setDecision((current) =>
                    current
                      ? {
                          ...current,
                          preview: undefined,
                          relatedError: undefined,
                        }
                      : current,
                  )
                }
              >
                {t("actionReviewReturnOriginal")}
              </Button>
            ) : (
              canDecideApproval(decision?.approval) && (
                <Button
                  disabled={decision?.loadingRelated}
                  onClick={() => decision?.respond(true)}
                >
                  {decision?.request.input.approve === true
                    ? t("approve")
                    : t("reject")}
                </Button>
              )
            )}
            <Button variant="outline" onClick={() => decision?.respond(false)}>
              {t("cancel")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
