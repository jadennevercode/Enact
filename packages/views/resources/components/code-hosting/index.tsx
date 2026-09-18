"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@enact/core/api";
import { githubInstallationsOptions } from "@enact/core/github";
import { useWorkspaceId } from "@enact/core/hooks";
import { vcsConnectionsOptions } from "@enact/core/vcs";
import type { VCSConnection } from "@enact/core/types";
import { Alert, AlertDescription, AlertTitle } from "@enact/ui/components/ui/alert";
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
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import { Card, CardContent } from "@enact/ui/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@enact/ui/components/ui/dropdown-menu";
import { GitHubMark } from "../../../settings/components/github-mark";
import { useT } from "../../../i18n";
import { ConnectionCard } from "./connection-card";
import { ConnectDialog } from "./connect-dialog";
import { RepositoryAutomation } from "./repository-automation";
import { RepositoryPicker } from "./repository-picker";
import { providerOf, type ConnectableProvider } from "./provider";

// Brand and host names are not translated.
const GITHUB_LABEL = "GitHub";
const GITHUB_DOT_COM_HOST = "github.com";

/**
 * Sources → Code & directories, code hosting section.
 *
 * Two kinds of connection appear here and both are real. A GitHub App
 * installation is the stronger credential — short-lived, single-repository
 * tokens, webhooks registered for you — but registering an App is a deployment
 * task and it can only ever reach github.com. A token connection is what a
 * workspace admin can complete alone, and the only option for GitHub Enterprise
 * Server or an internal GitLab.
 */
export function CodeHostingConnections() {
  const { t } = useT("resources");
  const wsId = useWorkspaceId();
  const qc = useQueryClient();

  const { data: vcsData } = useQuery(vcsConnectionsOptions(wsId));
  const { data: githubData } = useQuery(githubInstallationsOptions(wsId));

  const [connectProvider, setConnectProvider] = useState<ConnectableProvider | null>(null);
  const [rotateTarget, setRotateTarget] = useState<VCSConnection | null>(null);
  const [pickerConnection, setPickerConnection] = useState<VCSConnection | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<VCSConnection | null>(null);
  const [disconnectInstallation, setDisconnectInstallation] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: "test" | "webhooks" } | null>(null);
  const [connectingApp, setConnectingApp] = useState(false);

  const connections = vcsData?.connections ?? [];
  const installations = githubData?.installations ?? [];
  const canManage = vcsData?.can_manage === true || githubData?.can_manage === true;
  const keyConfigured = vcsData?.configured === true;

  async function refreshConnections() {
    await qc.invalidateQueries({ queryKey: ["vcs", wsId] });
  }

  async function connectGitHubApp() {
    setConnectingApp(true);
    try {
      const response = await api.getGitHubConnectURL(wsId, "repositories");
      if (!response.configured || !response.url) throw new Error(t(($) => $.github_not_configured));
      window.open(response.url, "_blank", "noopener");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.github_connect_failed));
    } finally {
      setConnectingApp(false);
    }
  }

  async function testConnection(connection: VCSConnection) {
    setBusy({ id: connection.id, action: "test" });
    try {
      const result = await api.testVCSConnection(wsId, connection.id);
      await refreshConnections();
      if (result.api.status === "ok") toast.success(t(($) => $.hosting.test_success));
      else toast.error(result.api.detail);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.hosting.test_failed));
    } finally {
      setBusy(null);
    }
  }

  async function registerWebhooks(connection: VCSConnection) {
    setBusy({ id: connection.id, action: "webhooks" });
    try {
      const result = await api.registerVCSWebhooks(wsId, connection.id);
      await refreshConnections();
      const failed = result.repositories.filter((row) => row.status !== "registered");
      if (result.repositories.length === 0) {
        toast.message(t(($) => $.hosting.webhooks_no_repositories));
      } else if (failed.length === 0) {
        toast.success(t(($) => $.hosting.webhooks_registered, { count: result.repositories.length }));
      } else {
        toast.warning(t(($) => $.hosting.webhooks_partial, { count: failed.length }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.hosting.webhooks_failed));
    } finally {
      setBusy(null);
    }
  }

  async function confirmDisconnect() {
    const connection = disconnectTarget;
    const installationId = disconnectInstallation;
    setDisconnectTarget(null);
    setDisconnectInstallation(null);
    try {
      if (connection) {
        await api.deleteVCSConnection(wsId, connection.id);
        await refreshConnections();
      } else if (installationId) {
        await api.deleteGitHubInstallation(wsId, installationId);
        await qc.invalidateQueries({ queryKey: ["github", wsId] });
      }
      toast.success(t(($) => $.hosting.disconnected));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.hosting.disconnect_failed));
    }
  }

  const isEmpty = installations.length === 0 && connections.length === 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold">{t(($) => $.hosting.title)}</h2>
          <p className="text-caption text-muted-foreground">{t(($) => $.hosting.description)}</p>
        </div>
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="sm" disabled={!keyConfigured}>
                  <Plus className="size-3.5" />
                  {t(($) => $.hosting.connect)}
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => setConnectProvider("github")}>
                <GitHubMark className="size-4" />
                {t(($) => $.hosting.connect_github)}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setConnectProvider("github_enterprise")}>
                <Server className="size-4" />
                {t(($) => $.hosting.connect_github_enterprise)}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setConnectProvider("gitlab")}>
                <Server className="size-4" />
                {t(($) => $.hosting.connect_gitlab)}
              </DropdownMenuItem>
              {githubData?.configured === true ? (
                <DropdownMenuItem disabled={connectingApp} onClick={() => void connectGitHubApp()}>
                  <KeyRound className="size-4" />
                  {t(($) => $.hosting.connect_github_app)}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {/* Without an encryption key no credential can be sealed. Saying so beats
          a disabled button with no explanation, which is what this used to be. */}
      {canManage && !keyConfigured ? (
        <Alert variant="destructive">
          <AlertTitle>{t(($) => $.hosting.key_missing_title)}</AlertTitle>
          <AlertDescription>{t(($) => $.hosting.key_missing_description)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {installations.map((installation) => (
          <Card key={installation.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <GitHubMark className="size-6 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{GITHUB_LABEL}</p>
                    <p className="truncate text-caption text-muted-foreground">
                      {`${GITHUB_DOT_COM_HOST} · ${installation.account_login}`}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {t(($) => $.hosting.token_types.installation)}
                </Badge>
              </div>
              <p className="text-micro text-muted-foreground">
                {t(($) => $.hosting.app_installation_hint)}
              </p>
              {canManage ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDisconnectInstallation(installation.id)}
                >
                  <Trash2 className="size-3.5" />
                  {t(($) => $.hosting.disconnect)}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}

        {connections.map((connection) => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            canManage={canManage}
            busy={busy?.id === connection.id ? busy.action : null}
            actions={{
              onTest: (target) => void testConnection(target),
              onBrowse: setPickerConnection,
              onRotateCredentials: setRotateTarget,
              onRegisterWebhooks: (target) => void registerWebhooks(target),
              onDisconnect: setDisconnectTarget,
            }}
          />
        ))}

        {isEmpty ? (
          <Card className="lg:col-span-2">
            <CardContent className="flex items-center gap-3 p-4 text-caption text-muted-foreground">
              <Server className="size-5 shrink-0" />
              {canManage ? t(($) => $.hosting.empty_admin) : t(($) => $.hosting.empty_member)}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <RepositoryAutomation canManage={canManage} />

      <ConnectDialog
        provider={connectProvider}
        requirements={vcsData?.requirements}
        onOpenChange={(open) => {
          if (!open) setConnectProvider(null);
        }}
      />
      <ConnectDialog
        provider={rotateTarget ? providerOf(rotateTarget) : null}
        connection={rotateTarget ?? undefined}
        requirements={vcsData?.requirements}
        onOpenChange={(open) => {
          if (!open) setRotateTarget(null);
        }}
      />
      <RepositoryPicker
        connection={pickerConnection}
        onOpenChange={(open) => {
          if (!open) setPickerConnection(null);
        }}
      />

      <AlertDialog
        open={!!disconnectTarget || !!disconnectInstallation}
        onOpenChange={(open) => {
          if (!open) {
            setDisconnectTarget(null);
            setDisconnectInstallation(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.hosting.disconnect)}</AlertDialogTitle>
            <AlertDialogDescription>{t(($) => $.hosting.disconnect_confirm)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(($) => $.hosting.cancel)}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDisconnect()}>
              {t(($) => $.hosting.disconnect)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
