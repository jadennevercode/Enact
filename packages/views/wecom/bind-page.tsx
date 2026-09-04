"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@enact/ui/components/ui/card";
import { Button } from "@enact/ui/components/ui/button";
import { api } from "@enact/core/api";
import { useAuthStore } from "@enact/core/auth";
import { AppLink } from "../navigation";
import { useT } from "../i18n";

type RedeemState =
  | { kind: "idle" }
  | { kind: "redeeming" }
  | { kind: "done"; workspaceId: string; installationId: string }
  | { kind: "needs-auth" }
  | { kind: "error"; reason: string };

// WecomBindPage is the destination the WeCom smart-bot's "link your Enact
// account" prompt points at. Same shape as SlackBindPage — the user lands
// here logged out OR logged in; we require auth before redeeming because
// the redeemer's Enact identity is taken from the session (the token
// alone never proves who is binding — see wecom.BindingTokenService.
// RedeemAndBind).
//
// The token comes in via ?token=<raw>. We POST it to /api/wecom/binding/
// redeem; the backend returns 410 (invalid/expired), 409 (already bound to
// another user), 403 (not a workspace member) or 200 with the bound
// installation. Each maps to distinct copy via wecom_bind in common.json.
export function WecomBindPage({ token }: { token: string | null }) {
  const { t } = useT("common");
  const user = useAuthStore((s) => s.user);
  const isAuthLoading = useAuthStore((s) => s.isLoading);
  const [state, setState] = useState<RedeemState>({ kind: "idle" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "error", reason: "missing_token" });
      return;
    }
    if (isAuthLoading) return;
    if (!user) {
      setState({ kind: "needs-auth" });
      return;
    }
    if (state.kind !== "idle" && state.kind !== "needs-auth") return;
    setState({ kind: "redeeming" });
    (async () => {
      try {
        const resp = await api.redeemWecomBindingToken(token);
        setState({
          kind: "done",
          workspaceId: resp.workspace_id,
          installationId: resp.installation_id,
        });
      } catch (e) {
        setState({
          kind: "error",
          reason: redemptionFailureReason(e),
        });
      }
    })();
  }, [token, user, isAuthLoading, state.kind]);

  return (
    <div className="enact-integration-bind-page">
      <Card className="enact-integration-bind-card" data-state={state.kind}>
        <CardContent className="enact-integration-bind-content">
          <h1 className="enact-integration-bind-title">{t(($) => $.wecom_bind.page_title)}</h1>
          {state.kind === "idle" || state.kind === "redeeming" ? (
            <p className="enact-integration-bind-copy">{t(($) => $.wecom_bind.redeeming)}</p>
          ) : state.kind === "needs-auth" ? (
            <>
              <p className="enact-integration-bind-copy">
                {t(($) => $.wecom_bind.needs_auth_description)}
              </p>
              <Button
                size="sm"
                render={
                  <AppLink
                    href={`/login?next=${encodeURIComponent(
                      `/wecom/bind?token=${encodeURIComponent(token ?? "")}`,
                    )}`}
                  />
                }
                nativeButton={false}
              >
                {t(($) => $.wecom_bind.sign_in)}
              </Button>
            </>
          ) : state.kind === "done" ? (
            <>
              <p className="enact-integration-bind-state-title">{t(($) => $.wecom_bind.done_title)}</p>
              <p className="enact-integration-bind-detail">
                {t(($) => $.wecom_bind.done_description)}
              </p>
            </>
          ) : (
            <>
              <p className="enact-integration-bind-state-title">{t(($) => $.wecom_bind.error_title)}</p>
              <p className="enact-integration-bind-detail">
                {(() => {
                  switch (state.reason) {
                    case "missing_token":
                      return t(($) => $.wecom_bind.error_missing_token);
                    case "expired":
                      return t(($) => $.wecom_bind.error_expired);
                    case "already_bound":
                      return t(($) => $.wecom_bind.error_already_bound);
                    case "not_member":
                      return t(($) => $.wecom_bind.error_not_member);
                    default:
                      return t(($) => $.wecom_bind.error_unknown);
                  }
                })()}
              </p>
              <p className="enact-integration-bind-hint">
                {t(($) => $.wecom_bind.error_admin_hint)}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function redemptionFailureReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  const lower = msg.toLowerCase();
  if (lower.includes("invalid") || lower.includes("expired") || lower.includes("410")) {
    return "expired";
  }
  if (lower.includes("already bound") || lower.includes("409")) {
    return "already_bound";
  }
  if (lower.includes("workspace member") || lower.includes("403")) {
    return "not_member";
  }
  return "unknown";
}
