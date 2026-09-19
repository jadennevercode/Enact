"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Waypoints } from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import { workspaceResourcesOptions } from "@enact/core/resources";
import {
  codeGraphCapabilityOptions,
  codeGraphStatusesOptions,
} from "@enact/core/codegraph";
import type { GithubRepoResourceRef, WorkspaceResource } from "@enact/core/types";
import { Button } from "@enact/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@enact/ui/components/ui/empty";
import { cn } from "@enact/ui/lib/utils";
import { CollectionPageHeader } from "../../layout/collection-page";
import { PAGE_GUTTER } from "../../layout/page-header";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { githubShortLabel } from "../../common/github-url";
import { CodeGraphStatusChip } from "./code-graph-status-chip";

function codeGraphRepos(
  resources: WorkspaceResource[],
): (WorkspaceResource & { resource_ref: GithubRepoResourceRef })[] {
  return resources.filter(
    (resource): resource is WorkspaceResource & { resource_ref: GithubRepoResourceRef } =>
      resource.resource_type === "github_repo" &&
      (resource.resource_ref as GithubRepoResourceRef).code_graph === true,
  );
}

/** The repositories this workspace has had indexed, and how each stands. */
export function CodeGraphsPage() {
  const { t } = useT("codegraph");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();

  const { data: resources = [], isPending, isError } = useQuery(
    workspaceResourcesOptions(wsId),
  );
  const { data: capability } = useQuery(codeGraphCapabilityOptions(wsId));
  const { data: statuses } = useQuery(codeGraphStatusesOptions(wsId));
  const repos = codeGraphRepos(resources);

  return (
    <div className="enact-management-page flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={Waypoints}
        title={t(($) => $.list.title)}
        count={repos.length}
        actions={
          <Button variant="outline" onClick={() => navigation.push(paths.resources())}>
            {t(($) => $.list.go_resources)}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn(PAGE_GUTTER, "py-6")}>
          <div className="flex max-w-[1120px] flex-col gap-4">
            <p className="max-w-[70ch] text-body text-muted-foreground">
              {t(($) => $.list.description)}
            </p>

            {capability?.enabled === false ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t(($) => $.list.disabled_title)}</EmptyTitle>
                  <EmptyDescription>
                    {t(($) => $.list.disabled_description)}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : isPending ? (
              <p className="text-body text-muted-foreground">{t(($) => $.page.loading)}</p>
            ) : isError ? (
              <p className="text-body text-muted-foreground">
                {t(($) => $.list.load_failed)}
              </p>
            ) : repos.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t(($) => $.list.empty_title)}</EmptyTitle>
                  <EmptyDescription>{t(($) => $.list.empty_description)}</EmptyDescription>
                </EmptyHeader>
                <Button
                  variant="outline"
                  onClick={() => navigation.push(paths.resources())}
                >
                  {t(($) => $.list.go_resources)}
                </Button>
              </Empty>
            ) : (
              <section className="enact-surface-panel overflow-hidden">
                <ul className="divide-y divide-border-soft">
                  {repos.map((repo) => (
                    <li key={repo.id}>
                      <button
                        type="button"
                        onClick={() => navigation.push(paths.codeGraph(repo.id))}
                        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <Waypoints className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium">
                            {githubShortLabel(repo.resource_ref.url)}
                          </span>
                          {repo.label ? (
                            <span className="block truncate text-caption text-muted-foreground">
                              {repo.label}
                            </span>
                          ) : null}
                        </span>
                        <CodeGraphStatusChip status={statuses?.statuses[repo.id]} />
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
