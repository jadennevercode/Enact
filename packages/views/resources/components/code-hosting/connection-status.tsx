"use client";

import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import { useT } from "../../../i18n";

type Tone = "good" | "pending" | "bad";

const GOOD = new Set(["ok", "ready", "verified", "registered"]);
const PENDING = new Set(["pending", "unknown", "untested", "manual"]);

export function toneOf(status: string): Tone {
  if (GOOD.has(status)) return "good";
  if (PENDING.has(status)) return "pending";
  return "bad";
}

/**
 * One leg of a connection's health. The five legs are independent on purpose:
 * an authenticated API says nothing about whether the provider can reach this
 * deployment's webhook endpoint, and neither says whether a daemon on someone's
 * laptop can clone. Collapsing them into a single "connected" light is what
 * makes this class of integration undebuggable.
 */
export function ConnectionStatus({ statuses }: { statuses: Array<[string, string]> }) {
  const { t } = useT("resources");

  const explain = (status: string): string => {
    if (status === "dns_error") return t(($) => $.hosting.status_dns);
    if (status === "timeout" || status === "unreachable") return t(($) => $.hosting.status_network);
    if (status === "tls_error") return t(($) => $.hosting.status_tls);
    if (status === "unauthorized") return t(($) => $.hosting.status_401);
    if (status === "forbidden" || status === "denied") return t(($) => $.hosting.status_403);
    if (status === "manual") return t(($) => $.hosting.status_webhook_manual);
    if (status === "registered") return t(($) => $.hosting.status_webhook_registered);
    if (status === "failed") return t(($) => $.hosting.status_webhook_failed);
    if (PENDING.has(status)) return t(($) => $.hosting.status_untested);
    return "";
  };

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-5">
      {statuses.map(([label, status]) => {
        const tone = toneOf(status);
        const detail = explain(status);
        return (
          <div key={label} className="bg-background px-2.5 py-2" title={detail || undefined}>
            <dt className="flex items-center gap-1.5 text-micro font-medium text-muted-foreground">
              {tone === "good" ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-success" />
              ) : tone === "pending" ? (
                <CircleDashed className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
              )}
              {label}
            </dt>
            <dd
              className={`mt-0.5 truncate text-micro ${
                tone === "bad" ? "font-medium text-destructive" : "text-foreground"
              }`}
            >
              {status}
            </dd>
            {detail ? <p className="mt-1 line-clamp-2 text-micro text-muted-foreground">{detail}</p> : null}
          </div>
        );
      })}
    </dl>
  );
}
