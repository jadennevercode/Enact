"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@enact/core/hooks";
import {
  useCreateWorkspaceResource,
  useUpdateWorkspaceResource,
  workspaceResourcesOptions,
} from "@enact/core/resources";
import { vcsRepositoriesOptions } from "@enact/core/vcs";
import type { VCSConnection, VCSRepository } from "@enact/core/types";
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import { Checkbox } from "@enact/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import { Input } from "@enact/ui/components/ui/input";
import { repositoryIdentity } from "../../../common/github-url";
import { useT } from "../../../i18n";
import { displayHost } from "./provider";

/**
 * One picker for every provider. `can_push` and `visibility` arrive already
 * resolved by the server, so nothing here needs to know that GitLab expresses
 * push as access level 30 while GitHub sends a boolean.
 */
export function RepositoryPicker({
  connection,
  onOpenChange,
}: {
  connection: VCSConnection | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT("resources");
  const wsId = useWorkspaceId();
  const create = useCreateWorkspaceResource(wsId);
  const update = useUpdateWorkspaceResource(wsId);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<string, VCSRepository>>(new Map());
  const [saving, setSaving] = useState(false);

  const { data: resources = [] } = useQuery(workspaceResourcesOptions(wsId));
  const query = useQuery(vcsRepositoriesOptions(wsId, connection?.id ?? "", search, page));

  const repoResources = useMemo(
    () => resources.filter((resource) => resource.resource_type === "github_repo"),
    [resources],
  );
  // Already attached and fully configured: the row is shown but not selectable.
  const configured = useMemo(
    () =>
      new Set(
        repoResources
          .filter((resource) => resource.configuration_status !== "pending")
          .map((resource) => repositoryIdentity(String((resource.resource_ref as { url?: string }).url ?? "")))
          .filter((identity): identity is string => !!identity),
      ),
    [repoResources],
  );
  // Attached but still pending a connection: selecting it completes the binding
  // in place rather than creating a second row for the same repository.
  const pending = useMemo(() => {
    const entries = repoResources
      .filter((resource) => resource.configuration_status === "pending")
      .map(
        (resource) =>
          [
            repositoryIdentity(String((resource.resource_ref as { url?: string }).url ?? "")),
            resource,
          ] as const,
      )
      .filter((entry): entry is readonly [string, (typeof repoResources)[number]] => !!entry[0]);
    return new Map(entries);
  }, [repoResources]);

  async function attach() {
    if (!connection) return;
    setSaving(true);
    try {
      for (const repository of selected.values()) {
        const ref = {
          provider: connection.provider,
          provider_connection_id: connection.id,
          provider_repository_id: repository.id,
          full_name: repository.full_name,
          url: repository.clone_url,
          default_branch_hint: repository.default_branch,
          enabled: true,
        };
        const existing = pending.get(repositoryIdentity(repository.clone_url) ?? "");
        if (existing) {
          await update.mutateAsync({
            resourceId: existing.id,
            data: { label: repository.full_name, resource_ref: ref },
          });
        } else {
          await create.mutateAsync({
            resource_type: "github_repo",
            label: repository.full_name,
            resource_ref: ref,
          });
        }
      }
      toast.success(t(($) => $.hosting.repositories_added, { count: selected.size }));
      setSelected(new Map());
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.toast_attach_failed));
    } finally {
      setSaving(false);
    }
  }

  const repositories = query.data?.repositories ?? [];

  return (
    <Dialog open={!!connection} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>{t(($) => $.hosting.picker_title)}</DialogTitle>
          <DialogDescription>
            {connection ? displayHost(connection.instance_url) : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t(($) => $.hosting.search)}
            />
          </div>
        </div>

        <div className="min-h-[240px] flex-1 overflow-y-auto border-y">
          {query.isPending ? (
            <div className="flex justify-center p-12">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : query.isError ? (
            <p className="p-8 text-center text-caption text-destructive">
              {t(($) => $.hosting.repositories_load_failed)}
            </p>
          ) : repositories.length === 0 ? (
            <p className="p-8 text-center text-caption text-muted-foreground">
              {t(($) => $.hosting.repositories_empty)}
            </p>
          ) : (
            <ul className="divide-y">
              {repositories.map((repository) => {
                const identity = repositoryIdentity(repository.clone_url);
                const alreadyAttached = !!identity && configured.has(identity);
                // A repository the credential cannot push to can never receive
                // an agent's branch, so offering it would only fail later.
                const disabled = alreadyAttached || repository.archived || !repository.can_push;
                const checked = selected.has(repository.id);
                return (
                  <li key={repository.id}>
                    <label
                      className={`flex items-start gap-3 px-6 py-3 transition-colors ${
                        disabled ? "opacity-60" : "cursor-pointer hover:bg-muted/40"
                      }`}
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(next) =>
                          setSelected((old) => {
                            const map = new Map(old);
                            if (next) map.set(repository.id, repository);
                            else map.delete(repository.id);
                            return map;
                          })
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-medium">{repository.full_name}</p>
                        <p className="truncate text-caption text-muted-foreground">
                          {repository.default_branch || "—"}
                          {repository.description ? ` · ${repository.description}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        {repository.visibility !== "public" ? (
                          <Badge variant="secondary">{repository.visibility}</Badge>
                        ) : null}
                        {repository.archived ? (
                          <Badge variant="secondary">{t(($) => $.github_archived)}</Badge>
                        ) : null}
                        {!repository.can_push ? (
                          <Badge variant="secondary">{t(($) => $.hosting.no_push)}</Badge>
                        ) : null}
                        {alreadyAttached ? (
                          <Badge variant="secondary">{t(($) => $.github_added)}</Badge>
                        ) : null}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between px-6 py-4 sm:justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              aria-label={t(($) => $.hosting.previous_page)}
              onClick={() => setPage((current) => current - 1)}
            >
              ←
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!query.data?.next_page}
              aria-label={t(($) => $.hosting.next_page)}
              onClick={() => setPage((current) => current + 1)}
            >
              →
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-caption text-muted-foreground">
              {t(($) => $.github_selected_count, { count: selected.size })}
            </span>
            <Button onClick={() => void attach()} disabled={saving || selected.size === 0}>
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t(($) => $.github_import)}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
