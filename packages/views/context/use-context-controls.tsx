"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentWorkspace } from "@enact/core/paths";
import { agentListOptions } from "@enact/core/workspace/queries";
import {
  contextSessionOptions,
  contextCheckpointOptions,
  contextPercent,
  contextOperationActive,
  isCompactCommand,
  useCompactContext,
  useCancelContextCompaction,
  type ContextScope,
  type ContextSession,
} from "@enact/core/context";
import { providerDisplayName } from "@enact/core/runtimes";
import { Button } from "@enact/ui/components/ui/button";
import { useT } from "../i18n";

export function useContextControls(scope: ContextScope) {
  const wsId = useCurrentWorkspace()?.id ?? "";
  const { t } = useT("common");
  const { data: sessions = [] } = useQuery(contextSessionOptions(wsId, scope));
  const { data: checkpoints = [] } = useQuery(
    contextCheckpointOptions(wsId, scope),
  );
  const { data: agents = [] } = useQuery({
    ...agentListOptions(wsId),
    enabled: !!wsId && !!scope.id,
  });
  const compact = useCompactContext(wsId);
  const cancel = useCancelContextCompaction(wsId);
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const requestKeys = useRef(new Map<string, string>());
  const target =
    sessions.find((s) => s.id === selected) ??
    (sessions.length === 1 ? sessions[0] : undefined);
  const label = (s: ContextSession) =>
    `${agents.find((a) => a.id === s.agent_id)?.name ?? s.agent_id.slice(0, 8)} · ${providerDisplayName(s.provider)}`;
  const statusLabel = (status: string) => {
    switch (status) {
      case "queued":
        return t(($) => $.context.queued);
      case "running":
        return t(($) => $.context.running);
      case "succeeded":
        return t(($) => $.context.succeeded);
      case "skipped":
        return t(($) => $.context.skipped);
      case "cancelled":
        return t(($) => $.context.cancelled);
      case "failed":
      case "stale_target":
        return t(($) => $.context.failed);
      default:
        return t(($) => $.context.unknown_result);
    }
  };
  async function run(session: ContextSession): Promise<boolean> {
    if (compact.isPending) return false;
    if (contextOperationActive(session.operation?.status)) return true;
    if (
      session.capabilities.native_compact !== true ||
      session.capabilities.compact_completion_signal !== true
    ) {
      setNotice(t(($) => $.context.unsupported));
      return false;
    }
    const identity = `${session.id}:${session.generation}`;
    const key = requestKeys.current.get(identity) ?? crypto.randomUUID();
    requestKeys.current.set(identity, key);
    try {
      await compact.mutateAsync({ session, key });
      requestKeys.current.delete(identity);
      setNotice(t(($) => $.context.accepted));
      return true;
    } catch {
      setNotice(t(($) => $.context.request_failed));
      return false;
    }
  }
  async function handleCommand(content: string): Promise<boolean | null> {
    if (!isCompactCommand(content)) return null;
    if (!target) {
      setNotice(t(($) => $.context.select));
      return false;
    }
    return run(target);
  }
  const panel =
    !scope.id || (sessions.length === 0 && !notice) ? null : (
      <div
        className="px-2 py-1 text-caption text-muted-foreground"
        data-testid="context-controls"
      >
        {sessions.length > 1 && (
          <select
            aria-label={t(($) => $.context.select)}
            value={target?.id ?? ""}
            onChange={(e) => setSelected(e.target.value)}
            className="max-w-full rounded bg-background text-foreground"
          >
            <option value="">{t(($) => $.context.select)}</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {label(s)}
              </option>
            ))}
          </select>
        )}
        {(target ? [target] : sessions).map((s) => {
          const pct = contextPercent(s.snapshot);
          const active = contextOperationActive(s.operation?.status);
          return (
            <details key={s.id} className="py-1">
              <summary className="cursor-pointer">
                {label(s)} · {t(($) => $.context.title)}{" "}
                {pct === null
                  ? t(($) => $.context.unknown)
                  : `${s.snapshot?.is_estimate ? "≈" : ""}${Math.round(pct)}%`}
              </summary>
              <div className="flex flex-col gap-2 py-2">
                <span>
                  {t(($) => $.context.reading)}:{" "}
                  {s.snapshot?.used_tokens?.toLocaleString() ?? "—"} /{" "}
                  {s.snapshot?.window_tokens?.toLocaleString() ?? "—"}{" "}
                  {t(($) => $.context.tokens)} ·{" "}
                  {s.snapshot?.model || s.provider}
                </span>
                <span>
                  {t(($) => $.context.last_record)}:{" "}
                  {s.snapshot?.observed_at
                    ? new Date(s.snapshot.observed_at).toLocaleString()
                    : "—"}
                </span>
                <span>{t(($) => $.context.basis)}</span>
                {s.operation && (
                  <div role="status">
                    {statusLabel(s.operation.status)} ·{" "}
                    {s.operation.actor_id.slice(0, 8)} ·{" "}
                    {s.operation.updated_at
                      ? new Date(s.operation.updated_at).toLocaleString()
                      : ""}
                    {s.operation.status === "succeeded" &&
                      !s.operation.after && (
                        <span> · {t(($) => $.context.awaiting_reading)}</span>
                      )}
                  </div>
                )}
                {s.operations.length > 1 && (
                  <details>
                    <summary className="cursor-pointer">
                      {t(($) => $.context.activity)}
                    </summary>
                    {s.operations.map((op) => (
                      <p key={op.id}>
                        {statusLabel(op.status)} · {op.actor_id.slice(0, 8)} ·{" "}
                        {op.created_at
                          ? new Date(op.created_at).toLocaleString()
                          : "—"}
                      </p>
                    ))}
                  </details>
                )}
                <div className="flex flex-wrap gap-2">
                  {s.capabilities.native_compact === true &&
                  s.capabilities.compact_completion_signal === true ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={active || compact.isPending}
                      onClick={() => void run(s)}
                    >
                      {t(($) => $.context.compact)}
                    </Button>
                  ) : (
                    <span>{t(($) => $.context.unsupported)}</span>
                  )}
                  {s.operation?.status === "queued" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={cancel.isPending}
                      onClick={() => {
                        void cancel
                          .mutateAsync(s.operation!.id)
                          .catch(() =>
                            setNotice(t(($) => $.context.request_failed)),
                          );
                      }}
                    >
                      {t(($) => $.context.cancel)}
                    </Button>
                  )}
                </div>
              </div>
            </details>
          );
        })}
        {checkpoints.length > 0 && (
          <details>
            <summary className="cursor-pointer">
              {t(($) => $.context.handoffs)}
            </summary>
            {checkpoints.map((c) => (
              <div key={c.id} className="flex flex-col gap-2 py-2 break-words">
                <p className="whitespace-pre-wrap">{c.summary}</p>
                <p>
                  {t(($) => $.context.source)}: {c.source_task_id} ·{" "}
                  {t(($) => $.context.revision)} {c.source_revision}
                </p>
                {c.decisions.length > 0 && (
                  <p>
                    {t(($) => $.context.decisions)}: {c.decisions.join("; ")}
                  </p>
                )}
                {c.pending.length > 0 && (
                  <p>
                    {t(($) => $.context.pending)}: {c.pending.join("; ")}
                  </p>
                )}
                {c.evidence.length > 0 && (
                  <p>
                    {t(($) => $.context.evidence)}: {c.evidence.join("; ")}
                  </p>
                )}
              </div>
            ))}
          </details>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
    );
  return { panel, handleCommand };
}
