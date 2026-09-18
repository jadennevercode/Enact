"use client";

import React from "react";
import { GitBranch, KeyRound, LoaderCircle, RefreshCw, Search, Trash2, Webhook } from "lucide-react";
import type { VCSConnection } from "@enact/core/types";
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import { Card, CardContent } from "@enact/ui/components/ui/card";
import { GitHubMark } from "../../../settings/components/github-mark";
import { useT } from "../../../i18n";
import { ConnectionStatus } from "./connection-status";
import { displayHost } from "./provider";

export interface ConnectionCardActions {
  onTest: (connection: VCSConnection) => void;
  onBrowse: (connection: VCSConnection) => void;
  onRotateCredentials: (connection: VCSConnection) => void;
  onRegisterWebhooks: (connection: VCSConnection) => void;
  onDisconnect: (connection: VCSConnection) => void;
}

/**
 * A token connection. Everything an operator needs in order to answer "why is
 * this not working" is on the card: which legs are healthy, what the credential
 * is, when it expires, and where deliveries are expected.
 */
export function ConnectionCard({
  connection,
  canManage,
  busy,
  actions,
}: {
  connection: VCSConnection;
  canManage: boolean;
  busy: "test" | "webhooks" | null;
  actions: ConnectionCardActions;
}) {
  const { t } = useT("resources");
  const isGitHub = connection.provider === "github";
  const changeRequestLabel = isGitHub ? "PR" : "MR";

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {isGitHub ? (
              <GitHubMark className="size-6 shrink-0" />
            ) : (
              <GitBranch className="size-6 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <p className="truncate font-medium">{isGitHub ? "GitHub" : "GitLab"}</p>
              <p className="truncate text-caption text-muted-foreground">
                {displayHost(connection.instance_url)} · {connection.account_login}
              </p>
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {t(($) => $.hosting.token_types[connection.token_type as keyof typeof $.hosting.token_types]) ||
              connection.token_type.replace(/_/g, " ")}
          </Badge>
        </div>

        <ConnectionStatus
          statuses={[
            ["API", connection.api_status],
            ["Webhook", connection.webhook_status],
            ["Git read", connection.git_read_status],
            ["Git write", connection.git_write_status],
            [changeRequestLabel, connection.change_request_status],
          ]}
        />

        <dl className="grid gap-x-4 gap-y-1 text-micro text-muted-foreground sm:grid-cols-2">
          <Detail label={t(($) => $.hosting.scopes)}>
            {connection.token_scopes.length > 0
              ? connection.token_scopes.join(", ")
              : t(($) => $.hosting.scopes_unreported)}
          </Detail>
          <Detail label={t(($) => $.hosting.expires)}>
            {connection.token_expires_at?.slice(0, 10) ?? t(($) => $.hosting.never_expires)}
          </Detail>
          <Detail label={t(($) => $.hosting.clone_host)}>{connection.clone_host || "—"}</Detail>
          <Detail label={t(($) => $.hosting.trust)}>
            {connection.has_custom_ca ? t(($) => $.hosting.custom_ca) : t(($) => $.hosting.system_ca)}
          </Detail>
          <Detail label={t(($) => $.hosting.last_validated)}>
            {connection.last_validated_at?.slice(0, 19).replace("T", " ") ?? t(($) => $.hosting.not_set)}
          </Detail>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => actions.onBrowse(connection)}>
            <Search className="size-3.5" />
            {t(($) => $.hosting.browse)}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => actions.onTest(connection)}
            disabled={busy === "test"}
          >
            {busy === "test" ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {t(($) => $.hosting.test)}
          </Button>
          {canManage ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => actions.onRegisterWebhooks(connection)}
                disabled={busy === "webhooks"}
              >
                {busy === "webhooks" ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Webhook className="size-3.5" />
                )}
                {t(($) => $.hosting.register_webhooks)}
              </Button>
              <Button size="sm" variant="outline" onClick={() => actions.onRotateCredentials(connection)}>
                <KeyRound className="size-3.5" />
                {t(($) => $.hosting.rotate_credentials)}
              </Button>
              <Button size="sm" variant="outline" onClick={() => actions.onDisconnect(connection)}>
                <Trash2 className="size-3.5" />
                {t(($) => $.hosting.disconnect)}
              </Button>
            </>
          ) : null}
        </div>

        {/* An enterprise instance often restricts outbound requests, so the
            address deliveries come from has to be visible, not buried. */}
        <p className="text-micro text-muted-foreground">
          {t(($) => $.hosting.webhook_allowlist)}{" "}
          <code className="break-all">{connection.webhook_url || connection.webhook_path}</code>
        </p>
      </CardContent>
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0">{label}:</dt>
      <dd className="min-w-0 truncate text-foreground">{children}</dd>
    </div>
  );
}
