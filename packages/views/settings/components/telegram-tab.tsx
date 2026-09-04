"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, ExternalLink, Trash2 } from "lucide-react";
import { TelegramMark } from "./telegram-mark";
import { cn } from "@enact/ui/lib/utils";
import { Button } from "@enact/ui/components/ui/button";
import { Card, CardContent } from "@enact/ui/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import { Input } from "@enact/ui/components/ui/input";
import { Label } from "@enact/ui/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@enact/ui/components/ui/alert-dialog";
import { useAuthStore } from "@enact/core/auth";
import { useWorkspaceId } from "@enact/core/hooks";
import { memberListOptions } from "@enact/core/workspace/queries";
import { useActorName } from "@enact/core/workspace/hooks";
import { telegramInstallationsOptions, telegramKeys } from "@enact/core/telegram";
import { api } from "@enact/core/api";
import type { TelegramInstallation } from "@enact/core/types";
import { ActorAvatar } from "../../common/actor-avatar";
import { openExternal } from "../../platform";
import { useT } from "../../i18n";

// TelegramTab is the workspace settings panel for Telegram bot installations,
// mirroring SlackTab: listing is member-visible; the disconnect action is
// admin-only (backend-enforced; the UI hides the button to match). Adding a
// new installation flows through the Agent detail page — the install path is
// per-agent (one bot per agent, the (workspace_id, agent_id, channel_type)
// UNIQUE in channel_installation).
export function TelegramTab() {
  const { t } = useT("settings");
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentMember = members.find((m) => m.user_id === user?.id) ?? null;
  const canManage =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  const { data, isLoading, isError } = useQuery({
    ...telegramInstallationsOptions(wsId),
    enabled: !!wsId,
  });
  const installations = data?.installations ?? [];
  const configured = data?.configured === true;

  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleDisconnect() {
    if (!disconnectTarget || disconnecting) return;
    setDisconnecting(true);
    try {
      // Await the server before touching cache/UI (repo rule: no optimistic
      // removal on flows that confirm/destroy).
      await api.deleteTelegramInstallation(wsId, disconnectTarget);
      await qc.invalidateQueries({ queryKey: telegramKeys.installations(wsId) });
      toast.success(t(($) => $.telegram.toast_disconnected));
      setDisconnectTarget(null);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t(($) => $.telegram.toast_disconnect_failed),
      );
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="enact-integrations-stack">
      {isError ? (
        <Card>
          <CardContent>
            <p className="enact-integration-description">
              {t(($) => $.telegram.load_failed)}
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent>
            <p className="enact-integration-description">{t(($) => $.telegram.loading)}</p>
          </CardContent>
        </Card>
      ) : !configured ? (
        <Card>
          <CardContent className="enact-integration-state-card">
            <p className="enact-integration-row-title">{t(($) => $.telegram.not_enabled_title)}</p>
            <p className="enact-integration-meta">
              {t(($) => $.telegram.not_enabled_description_prefix)}{" "}
              <code className="enact-integration-inline-code">
                ENACT_TELEGRAM_SECRET_KEY
              </code>{" "}
              {t(($) => $.telegram.not_enabled_description_suffix)}{" "}
              {t(($) => $.telegram.not_enabled_self_host_hint)}
            </p>
          </CardContent>
        </Card>
      ) : (
        <section className="enact-integration-section">
          <h2 className="enact-integration-section-title">{t(($) => $.telegram.connected_bots)}</h2>
          {installations.length === 0 ? (
            <Card>
              <CardContent className="enact-integration-state-card">
                <p className="enact-integration-row-title">{t(($) => $.telegram.empty_title)}</p>
                <p className="enact-integration-meta">
                  {t(($) => $.telegram.empty_description_prefix)}{" "}
                  <strong>{t(($) => $.telegram.empty_description_cta)}</strong>{" "}
                  {t(($) => $.telegram.empty_description_suffix)}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="enact-integration-list">
                {installations.map((inst) => (
                  <InstallationRow
                    key={inst.id}
                    installation={inst}
                    canManage={canManage}
                    onDisconnect={() => setDisconnectTarget(inst.id)}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </section>
      )}

      <AlertDialog
        open={!!disconnectTarget}
        onOpenChange={(v) => {
          if (!v && !disconnecting) setDisconnectTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.telegram.disconnect_confirm_title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.telegram.disconnect_confirm_description)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>
              {t(($) => $.telegram.disconnect_confirm_cancel)}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting
                ? t(($) => $.telegram.disconnecting)
                : t(($) => $.telegram.disconnect)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InstallationRow({
  installation,
  canManage,
  onDisconnect,
}: {
  installation: TelegramInstallation;
  canManage: boolean;
  onDisconnect: () => void;
}) {
  const { t } = useT("settings");
  const { getAgentName } = useActorName();
  const isActive = installation.status === "active";
  const agentName = getAgentName(installation.agent_id);
  return (
    <div className="enact-integration-row">
      <div className="enact-integration-row-main">
        <ActorAvatar
          actorType="agent"
          actorId={installation.agent_id}
          size="lg"
          enableHoverCard
          profileLink
        />
        <div className="enact-integration-copy">
          <p className="enact-integration-row-title">
            {agentName}
            {installation.bot_username ? (
              <span className="enact-integration-provider-identity">
                @{installation.bot_username}
              </span>
            ) : null}
            {!isActive && (
              <span className="enact-integration-chip" data-inline="true">
                {t(($) => $.telegram.revoked_badge)}
              </span>
            )}
          </p>
          <p className="enact-integration-detail">
            {t(($) => $.telegram.installed_at_label, {
              when: new Date(installation.installed_at).toLocaleString(),
            })}
          </p>
        </div>
      </div>
      {canManage && isActive && (
        <Button variant="outline" size="sm" onClick={onDisconnect}>
          <Trash2 className="enact-integration-action-icon" />
          {t(($) => $.telegram.disconnect)}
        </Button>
      )}
    </div>
  );
}

// telegramDocsUrl points at the Telegram integration guide on the docs site,
// localized like the Slack docs link.
function telegramDocsUrl(lang: string | undefined): string {
  const prefix = lang?.startsWith("zh")
    ? "/zh"
    : lang?.startsWith("ja")
      ? "/ja"
      : lang?.startsWith("ko")
        ? "/ko"
        : "";
  return `https://enact.ai/docs${prefix}/telegram-bot-integration`;
}

// TelegramAgentBindButton is the per-agent CTA on the agent detail page.
// Telegram uses the paste-a-token model: the admin creates a bot with
// @BotFather and pastes its token; the backend validates via getMe before
// persisting. Visibility mirrors SlackAgentBindButton (owner/admin only).
export function TelegramAgentBindButton({
  agentId,
  agentName,
  className,
  onShowConnectedDetails,
}: {
  agentId: string;
  agentName?: string;
  className?: string;
  /** Compact read-only connected row that invokes this instead of the full
   * badge — the agent inspector passes a "jump to the Integrations tab"
   * handler so management actions live in one place. */
  onShowConnectedDetails?: () => void;
}) {
  const { t, i18n } = useT("settings");
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: listing } = useQuery({
    ...telegramInstallationsOptions(wsId),
    enabled: !!wsId,
  });
  const installSupported = listing?.install_supported === true;

  const { data: members = [] } = useQuery({
    ...memberListOptions(wsId),
    enabled: !!wsId,
  });
  const currentMember = members.find((m) => m.user_id === user?.id) ?? null;
  const canManage =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  if (!canManage) return null;

  const existing = listing?.installations.find(
    (inst) => inst.agent_id === agentId && inst.status === "active",
  );
  if (existing) {
    return onShowConnectedDetails ? (
      <TelegramAgentBotStatusRow
        onClick={onShowConnectedDetails}
        className={className}
      />
    ) : (
      <TelegramAgentBotConnectedBadge installation={existing} className={className} />
    );
  }

  if (!installSupported) return null;

  function closeDialog() {
    if (submitting) return;
    setDialogOpen(false);
    setBotToken("");
  }

  async function handleSubmit() {
    const bot_token = botToken.trim();
    if (submitting || !agentId || !bot_token) return;
    setSubmitting(true);
    try {
      const installation = await api.registerTelegramBot(wsId, agentId, { bot_token });
      if (!installation.id || installation.status !== "active") {
        throw new Error("Telegram connection returned an invalid installation");
      }
      // The telegram_installation realtime event also refreshes this list, but
      // invalidate explicitly so the connected badge appears immediately.
      await qc.invalidateQueries({ queryKey: telegramKeys.installations(wsId) });
      toast.success(t(($) => $.telegram.connect_success_toast));
      setDialogOpen(false);
      setBotToken("");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t(($) => $.telegram.connect_failed_toast),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = botToken.trim() !== "" && !submitting;

  return (
    <div
      className={cn("enact-integration-connect-actions", className)}
      data-testid="telegram-agent-bind-buttons"
    >
      <Button
        variant="outline"
        size="sm"
        onClick={() => setDialogOpen(true)}
        disabled={!agentId}
        title={
          agentName
            ? t(($) => $.telegram.bind_button_title, { agent: agentName })
            : undefined
        }
        data-testid="telegram-agent-connect"
      >
        <TelegramMark className="enact-integration-provider-mark-compact" />
        {t(($) => $.telegram.bind_button)}
      </Button>

      <Dialog
        open={dialogOpen}
        onOpenChange={(v) => (v ? setDialogOpen(true) : closeDialog())}
      >
        <DialogContent className="enact-integration-dialog" data-testid="telegram-connect-dialog">
          <DialogHeader>
            <DialogTitle>{t(($) => $.telegram.connect_dialog_title)}</DialogTitle>
          </DialogHeader>

          <p className="enact-integration-meta">
            {t(($) => $.telegram.connect_dialog_description)}
          </p>

          <button
            type="button"
            onClick={() => openExternal(telegramDocsUrl(i18n.language))}
            className="enact-integration-doc-link"
            data-testid="telegram-docs-link"
          >
            <ExternalLink className="enact-integration-action-icon-large" />
            {t(($) => $.telegram.connect_docs_link)}
          </button>

          <div className="enact-integration-field">
            <Label htmlFor="telegram-bot-token">
              {t(($) => $.telegram.bot_token_label)}
            </Label>
            <Input
              id="telegram-bot-token"
              data-testid="telegram-bot-token"
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456789:AA…"
              autoComplete="off"
              spellCheck={false}
              disabled={submitting}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={closeDialog}
              disabled={submitting}
            >
              {t(($) => $.telegram.connect_cancel)}
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              data-testid="telegram-connect-submit"
            >
              {submitting
                ? t(($) => $.telegram.connect_submitting)
                : t(($) => $.telegram.connect_submit)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// TelegramAgentBotStatusRow is the compact, read-only connected affordance the
// agent inspector renders; it deep-links into the Integrations tab.
function TelegramAgentBotStatusRow({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  const { t } = useT("settings");
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "enact-integration-status-row",
        className,
      )}
      data-testid="telegram-agent-bot-status"
    >
      <span className="enact-integration-status-dot" data-status="active" />
      <span className="enact-integration-truncate">{t(($) => $.telegram.agent_bot_connected_label)}</span>
      <ChevronRight className="enact-integration-status-chevron" />
    </button>
  );
}

// TelegramAgentBotConnectedBadge is the full "already connected" affordance:
// status + Disconnect, then an "Open in Telegram" deep link to the bot.
function TelegramAgentBotConnectedBadge({
  installation,
  className,
}: {
  installation: TelegramInstallation;
  className?: string;
}) {
  const { t } = useT("settings");
  const wsId = useWorkspaceId();
  const qc = useQueryClient();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleDisconnect() {
    if (disconnecting) return;
    setDisconnecting(true);
    try {
      await api.deleteTelegramInstallation(wsId, installation.id);
      await qc.invalidateQueries({ queryKey: telegramKeys.installations(wsId) });
      toast.success(t(($) => $.telegram.toast_disconnected));
      setConfirmOpen(false);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t(($) => $.telegram.toast_disconnect_failed),
      );
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div
      className={cn("enact-integration-connected", className)}
      data-testid="telegram-agent-bot-connected"
    >
      <div className="enact-integration-connected-header">
        <span className="enact-integration-connected-status">
          <span className="enact-integration-status-dot" data-status="active" />
          <span className="enact-integration-truncate">
            {t(($) => $.telegram.agent_bot_connected_label)}
            {installation.bot_username ? ` · @${installation.bot_username}` : ""}
          </span>
        </span>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={disconnecting}
          title={t(($) => $.telegram.agent_bot_disconnect_tooltip)}
          aria-label={t(($) => $.telegram.disconnect)}
          data-testid="telegram-agent-bot-disconnect"
        >
          <Trash2 className="enact-integration-action-icon" />
          {disconnecting
            ? t(($) => $.telegram.disconnecting)
            : t(($) => $.telegram.disconnect)}
        </Button>
      </div>

      {installation.bot_username && (
        <button
          type="button"
          onClick={() => openExternal(`https://t.me/${installation.bot_username}`)}
          className="enact-integration-manage-link"
          title={t(($) => $.telegram.agent_bot_manage_tooltip)}
        >
          <ExternalLink className="enact-integration-action-icon" />
          {t(($) => $.telegram.agent_bot_manage_link)}
        </button>
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(v) => {
          if (!v && !disconnecting) setConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.telegram.disconnect_confirm_title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.telegram.disconnect_confirm_description)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>
              {t(($) => $.telegram.disconnect_confirm_cancel)}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting
                ? t(($) => $.telegram.disconnecting)
                : t(($) => $.telegram.disconnect)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
