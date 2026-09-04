"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, GitCommitHorizontal, Link2, PanelRight } from "lucide-react";
import { Button } from "@enact/ui/components/ui/button";
import { Card, CardContent } from "@enact/ui/components/ui/card";
import { Label } from "@enact/ui/components/ui/label";
import { Switch } from "@enact/ui/components/ui/switch";
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
import { useCurrentWorkspace } from "@enact/core/paths";
import { memberListOptions, workspaceKeys } from "@enact/core/workspace/queries";
import {
  deriveGitHubSettings,
  githubInstallationsOptions,
} from "@enact/core/github";
import { api } from "@enact/core/api";
import type { Workspace } from "@enact/core/types";
import { AppLink, useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { SettingsTab } from "./settings-layout";
import { GitHubMark } from "./github-mark";

type SettingsKey =
  | "github_enabled"
  | "github_pr_sidebar_enabled"
  | "co_authored_by_enabled"
  | "github_auto_link_prs_enabled";

export function GitHubTab() {
  const { t } = useT("settings");
  const workspace = useCurrentWorkspace();
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const navigation = useNavigation();
  const user = useAuthStore((s) => s.user);

  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentMember = members.find((m) => m.user_id === user?.id) ?? null;
  // `canView` gates the read-only installation list (every workspace member
  // sees it after ENA-2413); `canManage` gates the Connect / Disconnect
  // actions and comes from the backend response (`can_manage`) so the
  // frontend never claims management rights the server would reject.
  const canView = !!currentMember;

  const { data: installationData } = useQuery({
    ...githubInstallationsOptions(wsId),
    enabled: !!wsId && canView,
  });
  const installations = installationData?.installations ?? [];
  const configured = installationData?.configured ?? false;
  const canManage = installationData?.can_manage === true;
  const connected = installations.length > 0;
  const primaryInstallation = installations[0] ?? null;

  const flags = deriveGitHubSettings(workspace);
  const [savingKey, setSavingKey] = useState<SettingsKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  async function persistSetting(key: SettingsKey, next: boolean) {
    if (!workspace || savingKey) return;
    setSavingKey(key);
    try {
      const merged = {
        ...((workspace.settings as Record<string, unknown>) ?? {}),
        [key]: next,
      };
      const updated = await api.updateWorkspace(workspace.id, { settings: merged });
      qc.setQueryData(workspaceKeys.list(), (old: Workspace[] | undefined) =>
        old?.map((ws) => (ws.id === updated.id ? updated : ws)),
      );
      toast.success(t(($) => $.auto_save.toast_saved), {
        id: "settings-auto-save",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t(($) => $.github.toast_failed));
    } finally {
      setSavingKey(null);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    try {
      const resp = await api.getGitHubConnectURL(wsId);
      if (!resp.configured || !resp.url) {
        toast.error(t(($) => $.github.toast_not_configured));
        return;
      }
      window.open(resp.url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t(($) => $.github.toast_open_failed));
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!disconnectTarget || disconnecting) return;
    setDisconnecting(true);
    try {
      await api.deleteGitHubInstallation(wsId, disconnectTarget);
      await qc.invalidateQueries({ queryKey: ["github", wsId] });
      toast.success(t(($) => $.github.toast_disconnected));
      setDisconnectTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t(($) => $.github.toast_disconnect_failed));
    } finally {
      setDisconnecting(false);
    }
  }

  if (!workspace) return null;

  const repositoriesHref = `${navigation.pathname}?tab=repositories`;

  return (
    <SettingsTab
      title={t(($) => $.page.tabs.github)}
      description={t(($) => $.github.page_description)}
    >
      <section className="enact-integration-section">
        <Card>
          <CardContent>
            <div className="enact-integration-layout-row">
              <div className="enact-integration-feature-main">
                <div className="enact-integration-feature-icon">
                  <GitHubMark className="enact-integration-provider-mark" />
                </div>
                <div className="enact-integration-copy">
                  <Label htmlFor="github-master" className="enact-integration-row-title">
                    {t(($) => $.github.section_master)}
                  </Label>
                  <p className="enact-integration-description">
                    {flags.enabled
                      ? t(($) => $.github.master_description_on)
                      : t(($) => $.github.master_description_off)}
                  </p>
                </div>
              </div>
              <Switch
                id="github-master"
                checked={flags.enabled}
                onCheckedChange={(v) => persistSetting("github_enabled", v)}
                disabled={!canManage || savingKey === "github_enabled"}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="enact-integration-section">
        <h2 className="enact-integration-section-title">{t(($) => $.github.section_connection)}</h2>
        <Card>
          <CardContent className="enact-integration-card-body">
            <div className="enact-integration-layout-row">
              <div className="enact-integration-feature-main">
                <GitHubMark className="enact-integration-provider-mark enact-integration-provider-mark-hero" />
                <div className="enact-integration-copy">
                  <p className="enact-integration-row-title">{t(($) => $.github.connection_title)}</p>
                  {connected ? (
                    <>
                      <p className="enact-integration-meta">
                        {t(($) => $.github.connected_to, {
                          login: installations.map((i) => i.account_login).join(", "),
                        })}
                      </p>
                      {primaryInstallation?.connected_by && (
                        <p className="enact-integration-meta">
                          {t(($) => $.github.connected_by, {
                            name: primaryInstallation.connected_by!,
                          })}
                        </p>
                      )}
                    </>
                  ) : canManage ? (
                    <p className="enact-integration-meta">
                      {t(($) => $.github.connection_description_prefix)}{" "}
                      <code className="enact-integration-inline-code">
                        {t(($) => $.github.connection_identifier_example)}
                      </code>{" "}
                      {t(($) => $.github.connection_description_suffix)}{" "}
                      <strong>{t(($) => $.github.connection_description_done)}</strong>.
                    </p>
                  ) : (
                    <p className="enact-integration-meta">
                      {t(($) => $.github.contact_admin_to_connect)}
                    </p>
                  )}
                </div>
              </div>
              {canManage && (
                <div className="enact-integration-actions">
                  {connected && primaryInstallation ? (
                    // Disconnect must stay reachable even when the master switch
                    // is off — disconnect is a separate intent (revoke the App
                    // grant) from hiding the feature.
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDisconnectTarget(primaryInstallation.id)}
                    >
                      {t(($) => $.github.disconnect)}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={handleConnect}
                      disabled={connecting || !configured}
                      title={
                        !configured
                          ? t(($) => $.github.connect_disabled_tooltip)
                          : undefined
                      }
                    >
                      {connecting
                        ? t(($) => $.github.connect_opening)
                        : t(($) => $.github.connect_github)}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {canManage && !configured && (
              <p className="enact-integration-meta">
                {t(($) => $.github.not_configured)}{" "}
                <code className="enact-integration-inline-code">GITHUB_APP_SLUG</code>{" "}
                {t(($) => $.github.not_configured_and)}{" "}
                <code className="enact-integration-inline-code">GITHUB_WEBHOOK_SECRET</code>.
              </p>
            )}

            {!canManage && connected && (
              <p className="enact-integration-meta">
                {t(($) => $.github.read_only_hint)}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="enact-integration-section">
        <h2 className="enact-integration-section-title">{t(($) => $.github.section_features)}</h2>
        <Card className="enact-integration-card-flush">
          <CardContent className="enact-integration-feature-list">
            <FeatureRow
              id="github-pr-sidebar"
              icon={<PanelRight className="enact-integration-provider-mark" />}
              label={t(($) => $.github.feature_pr_sidebar_label)}
              description={
                <p className="enact-integration-description">
                  {t(($) => $.github.feature_pr_sidebar_description)}
                </p>
              }
              checked={flags.prSidebar}
              disabled={!canManage || !flags.enabled || savingKey === "github_pr_sidebar_enabled"}
              onCheckedChange={(v) => persistSetting("github_pr_sidebar_enabled", v)}
            />

            <FeatureRow
              id="github-coauthor"
              icon={<GitCommitHorizontal className="enact-integration-provider-mark" />}
              label={t(($) => $.github.feature_co_author_label)}
              description={
                <p className="enact-integration-description">
                  {t(($) => $.github.feature_co_author_description_prefix)}{" "}
                  <code className="enact-integration-inline-code">
                    {"Co-authored-by: enact-agent <github@enact.ai>"}
                  </code>{" "}
                  {t(($) => $.github.feature_co_author_description_suffix)}
                </p>
              }
              checked={flags.coAuthor}
              disabled={!canManage || !flags.enabled || savingKey === "co_authored_by_enabled"}
              onCheckedChange={(v) => persistSetting("co_authored_by_enabled", v)}
            />

            <FeatureRow
              id="github-auto-link"
              icon={<Link2 className="enact-integration-provider-mark" />}
              label={t(($) => $.github.feature_auto_link_label)}
              description={
                <p className="enact-integration-description">
                  {t(($) => $.github.feature_auto_link_description)}
                </p>
              }
              checked={flags.autoLinkPRs}
              disabled={!canManage || !flags.enabled || savingKey === "github_auto_link_prs_enabled"}
              onCheckedChange={(v) => persistSetting("github_auto_link_prs_enabled", v)}
            />
          </CardContent>
        </Card>
      </section>

      <section className="enact-integration-section">
        <h2 className="enact-integration-section-title">{t(($) => $.github.section_repositories)}</h2>
        <Card>
          <CardContent>
            <div className="enact-integration-repository-row">
              <p className="enact-integration-row-title">
                {t(($) => $.github.repositories_shortcut_label)}
              </p>
              <Button
                variant="outline"
                size="sm"
                render={<AppLink href={repositoriesHref} />}
                nativeButton={false}
              >
                <ExternalLink className="enact-integration-action-icon" />
                {t(($) => $.github.repositories_shortcut_link)}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <AlertDialog
        open={!!disconnectTarget}
        onOpenChange={(v) => {
          if (!v && !disconnecting) setDisconnectTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.github.disconnect_confirm_title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.github.disconnect_confirm_description)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>
              {t(($) => $.github.disconnect_confirm_cancel)}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting
                ? t(($) => $.github.disconnecting)
                : t(($) => $.github.disconnect_confirm_action)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsTab>
  );
}

function FeatureRow({
  id,
  icon,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: React.ReactNode;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="enact-integration-feature-row">
      <div className="enact-integration-feature-main">
        <div className="enact-integration-feature-icon">{icon}</div>
        <div className="enact-integration-copy">
          <Label htmlFor={id} className="enact-integration-row-title">
            {label}
          </Label>
          {description}
        </div>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
