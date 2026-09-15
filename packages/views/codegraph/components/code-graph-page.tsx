"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, RefreshCw, Waypoints } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import { useCurrentMember } from "@enact/core/permissions";
import { workspaceResourcesOptions } from "@enact/core/resources";
import {
  codeGraphCapabilityOptions,
  codeGraphStatusOptions,
  useRebuildCodeGraph,
} from "@enact/core/codegraph";
import type { GithubRepoResourceRef, WorkspaceResource } from "@enact/core/types";
import { Button } from "@enact/ui/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@enact/ui/components/ui/tabs";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@enact/ui/components/ui/empty";
import { CollectionPageHeader } from "../../layout/collection-page";
import { PAGE_GUTTER } from "../../layout/page-header";
import { cn } from "@enact/ui/lib/utils";
import { useNavigation } from "../../navigation";
import { useT, useTimeAgo } from "../../i18n";
import { githubShortLabel } from "../../common/github-url";
import { CodeGraphStatusChip, shortCommit } from "./code-graph-status-chip";
import { OverviewTab } from "./overview-tab";
import { CommunitiesTab } from "./communities-tab";
import { GraphTab } from "./graph-tab";
import { TreeTab } from "./tree-tab";
import { CallflowTab } from "./callflow-tab";

function isGithubResource(
  resource: WorkspaceResource,
): resource is WorkspaceResource & { resource_ref: GithubRepoResourceRef } {
  return (
    resource.resource_type === "github_repo" &&
    typeof (resource.resource_ref as GithubRepoResourceRef).url === "string"
  );
}

/** One repository's code graph: what it contains and how to read it. */
export function CodeGraphPage({ resourceId }: { resourceId: string }) {
  const { t } = useT("codegraph");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const timeAgo = useTimeAgo();
  const { role } = useCurrentMember(wsId);
  const canRebuild = role === "owner" || role === "admin";

  const [tab, setTab] = useState("overview");
  // Set by "show in graph" on the subsystems tab; the graph tab reads it as a
  // starting projection rather than owning cross-tab state of its own.
  const [graphCommunity, setGraphCommunity] = useState<number | null>(null);

  const { data: resources = [], isPending: resourcesPending } = useQuery(
    workspaceResourcesOptions(wsId),
  );
  const { data: capability } = useQuery(codeGraphCapabilityOptions(wsId));
  const { data: status, isPending: statusPending } = useQuery(
    codeGraphStatusOptions(wsId, resourceId),
  );
  const rebuild = useRebuildCodeGraph(wsId);

  const resource = resources.find((r) => r.id === resourceId);
  const repo = resource && isGithubResource(resource) ? resource : null;
  const repoUrl = repo?.resource_ref.url ?? "";
  const build = status?.build ?? null;
  const commit = build?.commit ?? null;
  const stats = build?.stats ?? null;
  const ready = build?.state === "ready";

  const header = (
    <CollectionPageHeader
      icon={Waypoints}
      title={repoUrl ? githubShortLabel(repoUrl) : t(($) => $.list.title)}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigation.push(paths.codeGraphs())}
          >
            <ChevronLeft className="size-4" />
            {t(($) => $.page.back)}
          </Button>
          {canRebuild && status?.enabled ? (
            <Button
              variant="outline"
              size="sm"
              disabled={rebuild.isPending}
              onClick={() =>
                rebuild.mutate(resourceId, {
                  onSuccess: () => toast.success(t(($) => $.page.rebuild_queued)),
                  onError: () => toast.error(t(($) => $.page.rebuild_failed)),
                })
              }
            >
              <RefreshCw
                className={cn("size-3.5", rebuild.isPending && "animate-spin motion-reduce:animate-none")}
              />
              {t(($) => $.page.rebuild)}
            </Button>
          ) : null}
        </div>
      }
    />
  );

  const shell = (children: React.ReactNode) => (
    <div className="enact-management-page flex min-h-0 flex-1 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn(PAGE_GUTTER, "py-6")}>
          <div className="flex max-w-[1280px] flex-col gap-4">{children}</div>
        </div>
      </div>
    </div>
  );

  if (resourcesPending || statusPending) {
    return shell(
      <p className="text-body text-muted-foreground">{t(($) => $.page.loading)}</p>,
    );
  }

  if (!repo) {
    return shell(
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t(($) => $.page.not_found)}</EmptyTitle>
        </EmptyHeader>
      </Empty>,
    );
  }

  if (capability?.enabled === false) {
    return shell(
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t(($) => $.list.disabled_title)}</EmptyTitle>
          <EmptyDescription>{t(($) => $.list.disabled_description)}</EmptyDescription>
        </EmptyHeader>
      </Empty>,
    );
  }

  if (status && !status.enabled) {
    return shell(
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t(($) => $.page.disabled_title)}</EmptyTitle>
          <EmptyDescription>{t(($) => $.page.disabled_description)}</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" onClick={() => navigation.push(paths.resources())}>
          {t(($) => $.list.go_resources)}
        </Button>
      </Empty>,
    );
  }

  const summary = (
    <section className="enact-surface-panel flex flex-wrap items-end justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <CodeGraphStatusChip status={status} />
          {commit ? (
            <span className="font-mono text-caption text-muted-foreground">
              {t(($) => $.page.commit)} {shortCommit(commit)}
            </span>
          ) : null}
          {build?.finished_at ? (
            <span className="text-caption text-muted-foreground">
              {t(($) => $.page.built, { when: timeAgo(build.finished_at) })}
            </span>
          ) : null}
        </div>
        {status?.stale ? (
          <p className="mt-1 text-caption text-muted-foreground">
            {t(($) => $.status.stale)}
          </p>
        ) : null}
      </div>
      {stats ? (
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <Kpi label={t(($) => $.page.kpi_files)} value={stats.files} />
          <Kpi label={t(($) => $.page.kpi_nodes)} value={stats.nodes} />
          <Kpi label={t(($) => $.page.kpi_edges)} value={stats.edges} />
          <Kpi label={t(($) => $.page.kpi_communities)} value={stats.communities} />
        </dl>
      ) : null}
    </section>
  );

  if (!ready) {
    return shell(
      <>
        {summary}
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t(($) => $.page.not_ready_title)}</EmptyTitle>
            <EmptyDescription>{t(($) => $.page.not_ready_description)}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>,
    );
  }

  return shell(
    <>
      {summary}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(String(value ?? "overview"))}
        className="flex min-h-0 flex-col gap-3"
      >
        <TabsList>
          <TabsTrigger value="overview">{t(($) => $.tabs.overview)}</TabsTrigger>
          <TabsTrigger value="communities">{t(($) => $.tabs.communities)}</TabsTrigger>
          <TabsTrigger value="graph">{t(($) => $.tabs.graph)}</TabsTrigger>
          <TabsTrigger value="tree">{t(($) => $.tabs.tree)}</TabsTrigger>
          <TabsTrigger value="callflow">{t(($) => $.tabs.callflow)}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab wsId={wsId} resourceId={resourceId} build={build} />
        </TabsContent>
        <TabsContent value="communities">
          <CommunitiesTab
            wsId={wsId}
            resourceId={resourceId}
            repoUrl={repoUrl}
            commit={commit}
            onShowInGraph={(communityId) => {
              setGraphCommunity(communityId);
              setTab("graph");
            }}
          />
        </TabsContent>
        <TabsContent value="graph">
          <GraphTab
            wsId={wsId}
            resourceId={resourceId}
            repoUrl={repoUrl}
            commit={commit}
            focusCommunity={graphCommunity}
          />
        </TabsContent>
        <TabsContent value="tree">
          <TreeTab wsId={wsId} resourceId={resourceId} repoUrl={repoUrl} commit={commit} />
        </TabsContent>
        <TabsContent value="callflow">
          <CallflowTab wsId={wsId} resourceId={resourceId} />
        </TabsContent>
      </Tabs>
    </>,
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-16">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-title font-semibold tabular-nums">{value.toLocaleString()}</dd>
    </div>
  );
}
