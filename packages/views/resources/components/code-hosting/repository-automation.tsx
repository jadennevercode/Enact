"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@enact/core/api";
import { deriveGitHubSettings } from "@enact/core/github";
import { useCurrentWorkspace } from "@enact/core/paths";
import { workspaceKeys } from "@enact/core/workspace/queries";
import type { Workspace } from "@enact/core/types";
import { Label } from "@enact/ui/components/ui/label";
import { Switch } from "@enact/ui/components/ui/switch";
import { useT } from "../../../i18n";

/**
 * Behaviour that applies to every connected provider alike: a GitHub pull
 * request and a GitLab merge request are the same thing to an issue, so these
 * are workspace settings rather than per-connection ones.
 */
export function RepositoryAutomation({ canManage }: { canManage: boolean }) {
  const { t } = useT("resources");
  const workspace = useCurrentWorkspace();
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const flags = deriveGitHubSettings(workspace);
  const settings = (workspace?.settings as Record<string, unknown>) ?? {};

  const rows = [
    {
      key: "github_pr_sidebar_enabled",
      label: t(($) => $.hosting.automation_show),
      hint: t(($) => $.hosting.automation_show_hint),
      checked: flags.prSidebar,
    },
    {
      key: "github_auto_link_prs_enabled",
      label: t(($) => $.hosting.automation_link),
      hint: t(($) => $.hosting.automation_link_hint),
      checked: flags.autoLinkPRs,
    },
    {
      key: "github_close_on_merge_enabled",
      label: t(($) => $.hosting.automation_close),
      hint: t(($) => $.hosting.automation_close_hint),
      // Absent means on: this predates the setting, and the behaviour shipped
      // enabled.
      checked: settings.github_close_on_merge_enabled !== false,
    },
    {
      key: "co_authored_by_enabled",
      label: t(($) => $.hosting.automation_coauthor),
      hint: t(($) => $.hosting.automation_coauthor_hint),
      checked: flags.coAuthor,
    },
  ] as const;

  async function persist(key: string, value: boolean) {
    if (!workspace) return;
    setSaving(key);
    try {
      const updated = await api.updateWorkspace(workspace.id, {
        settings: { ...settings, [key]: value },
      });
      qc.setQueryData(workspaceKeys.list(), (old: Workspace[] | undefined) =>
        old?.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.hosting.save_failed));
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border">
      <header className="border-b px-4 py-3">
        <h3 className="text-body font-medium">{t(($) => $.hosting.automation_title)}</h3>
        <p className="text-caption text-muted-foreground">{t(($) => $.hosting.automation_description)}</p>
      </header>
      <div className="divide-y">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <Label htmlFor={row.key}>{row.label}</Label>
              <p className="text-micro text-muted-foreground">{row.hint}</p>
            </div>
            <Switch
              id={row.key}
              checked={row.checked}
              disabled={!canManage || saving === row.key}
              onCheckedChange={(value) => void persist(row.key, value)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
