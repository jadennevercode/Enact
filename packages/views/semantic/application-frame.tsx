"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  semanticApi,
  applicationBridgeRequestSchema,
  type ApplicationBridgeRequest,
  type ApplicationBuild,
} from "@enact/core/semantic";
import { Button } from "@enact/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import { buildApplicationEnvelope } from "./application-document";
import { Failure, RecordView, useSemanticText } from "./shared";
interface Decision {
  request: ApplicationBridgeRequest;
  approval: unknown;
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
  const t = useSemanticText(),
    frame = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<unknown>(),
    [decision, setDecision] = useState<Decision | null>(null);
  const pending = useRef(false);
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
            input: operation === "context" && initialRunId ? { ...input, requested_run_id: initialRunId } : input,
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
            reply(true, await invoke(request.operation, request.input));
          } catch (error) {
            reply(
              false,
              error instanceof Error
                ? error.message
                : "Application request failed",
            );
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
                if (approved) void perform();
                else reply(false, "Decision cancelled by the user");
              },
            });
          } catch (error) {
            pending.current = false;
            reply(
              false,
              error instanceof Error ? error.message : "Cannot load approval",
            );
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
  if (document.error) return <Failure error={document.error} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Failure error={error} />
      <iframe
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
        <DialogContent className="max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {decision?.request.input.approve === true
                ? t("approve")
                : t("reject")}
            </DialogTitle>
          </DialogHeader>
          <RecordView value={decision?.approval} />
          <p className="text-body">
            {String(decision?.request.input.reason ?? "")}
          </p>
          <div className="flex gap-3">
            <Button onClick={() => decision?.respond(true)}>
              {decision?.request.input.approve === true
                ? t("approve")
                : t("reject")}
            </Button>
            <Button variant="outline" onClick={() => decision?.respond(false)}>
              {t("cancel")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
