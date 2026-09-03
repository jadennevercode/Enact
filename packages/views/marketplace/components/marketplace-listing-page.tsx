"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpCircle,
  Check,
  Download,
  MoreHorizontal,
  Store,
  Upload,
} from "lucide-react";
import type { MarketplaceKind, MarketplaceManifest } from "@enact/core/types";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import {
  hasMarketplaceUpdate,
  marketplaceListingOptions,
  marketplaceVersionsOptions,
  useUpdateMarketplaceListing,
} from "@enact/core/marketplace";
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@enact/ui/components/ui/dropdown-menu";
import { Skeleton } from "@enact/ui/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@enact/ui/components/ui/tabs";
import { cn } from "@enact/ui/lib/utils";
import { useNavigation } from "../../navigation";
import { CollectionPageState } from "../../layout/collection-page";
import { useT, useTimeAgo } from "../../i18n";
import { marketplaceKindIcon, marketplaceKindTone } from "../lib/kind";
import { InstallDialog } from "./install-dialog";
import { ListingFiles } from "./listing-files";
import { PublishDialog } from "./publish-dialog";

interface MarketplaceListingPageProps {
  listingId: string;
}

/**
 * One listing.
 *
 * The page is ordered by the decision a reader is making: what this is and who
 * stands behind it, then what installing it would actually put in their
 * workspace, then the files if they want to read the thing before taking it.
 */
export function MarketplaceListingPage({ listingId }: MarketplaceListingPageProps) {
  const { t } = useT("marketplace");
  const timeAgo = useTimeAgo();
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { push } = useNavigation();

  const [versionId, setVersionId] = useState<string | undefined>(undefined);
  const [installOpen, setInstallOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const listingQuery = useQuery(marketplaceListingOptions(wsId, listingId, versionId));
  const versionsQuery = useQuery(marketplaceVersionsOptions(wsId, listingId));
  const updateListing = useUpdateMarketplaceListing(wsId);

  const listing = listingQuery.data;

  if (listingQuery.isPending) {
    return (
      <div className="mx-auto w-full max-w-[1100px] p-4 sm:p-6">
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  if (!listing) {
    return (
      <CollectionPageState
        icon={Store}
        title={t(($) => $.detail.unavailable)}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => push(paths.marketplace())}
          >
            {t(($) => $.detail.back)}
          </Button>
        }
      />
    );
  }

  const kind = listing.kind as MarketplaceKind;
  const Icon = marketplaceKindIcon(kind);
  const manifest = listing.version?.manifest;
  const installed = Boolean(listing.installed_version_id);
  const updatable = hasMarketplaceUpdate(listing);
  const installable =
    listing.status === "published" || listing.status === "deprecated";

  const openInstalledEntity = (entityKind: string, entityId: string) => {
    if (entityKind === "skill") push(paths.skillDetail(entityId));
    else if (entityKind === "agent") push(paths.agentDetail(entityId));
    else push(paths.settings());
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 p-4 sm:p-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 w-fit gap-1.5 text-muted-foreground"
            onClick={() => push(paths.marketplace())}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t(($) => $.detail.back)}
          </Button>

          <header className="flex flex-wrap items-start gap-4">
            <span
              className={cn(
                "flex size-14 shrink-0 items-center justify-center rounded-lg",
                marketplaceKindTone(kind),
              )}
            >
              <Icon className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="min-w-0 text-title font-semibold">{listing.name}</h1>
                {listing.latest_version ? (
                  <span className="font-mono text-caption tabular-nums text-muted-foreground">
                    {t(($) => $.version, { version: listing.latest_version })}
                  </span>
                ) : null}
                {listing.status !== "published" ? (
                  <Badge variant="outline">
                    {t(($) => $.status[listing.status as "draft"])}
                  </Badge>
                ) : null}
                {listing.visibility === "workspace" ? (
                  <Badge variant="secondary">
                    {t(($) => $.visibility.workspace)}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-caption text-muted-foreground">
                {t(($) => $.by, { publisher: listing.publisher_workspace_name })}
              </p>
              {listing.description ? (
                <p className="mt-3 max-w-prose text-body text-muted-foreground">
                  {listing.description}
                </p>
              ) : null}
              {listing.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {listing.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-caption">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {installable ? (
                <Button
                  type="button"
                  onClick={() => setInstallOpen(true)}
                  variant={updatable || !installed ? "default" : "outline"}
                >
                  {updatable ? (
                    <>
                      <ArrowUpCircle className="size-3.5" aria-hidden="true" />
                      {t(($) => $.install.update)}
                    </>
                  ) : installed ? (
                    <>
                      <Check className="size-3.5" aria-hidden="true" />
                      {t(($) => $.installed)}
                    </>
                  ) : (
                    <>
                      <Download className="size-3.5" aria-hidden="true" />
                      {t(($) => $.install.action)}
                    </>
                  )}
                </Button>
              ) : null}

              {listing.can_manage ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t(($) => $.manage.title)}
                      >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setPublishOpen(true)}>
                      <Upload className="size-3.5" aria-hidden="true" />
                      {t(($) => $.manage.new_version)}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        updateListing.mutate({
                          listingId: listing.id,
                          visibility:
                            listing.visibility === "public" ? "workspace" : "public",
                        })
                      }
                    >
                      {listing.visibility === "public"
                        ? t(($) => $.manage.make_private)
                        : t(($) => $.manage.make_public)}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        updateListing.mutate({
                          listingId: listing.id,
                          status:
                            listing.status === "deprecated" ? "published" : "deprecated",
                        })
                      }
                    >
                      {listing.status === "deprecated"
                        ? t(($) => $.manage.undeprecate)
                        : t(($) => $.manage.deprecate)}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() =>
                        updateListing.mutate({
                          listingId: listing.id,
                          status: "removed",
                        })
                      }
                    >
                      {t(($) => $.manage.remove)}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </header>

          {!listing.version ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-body text-muted-foreground">
              {t(($) => $.detail.no_version)}
            </p>
          ) : (
            <Tabs defaultValue="overview" className="min-w-0">
              <TabsList>
                <TabsTrigger value="overview">
                  {t(($) => $.detail.overview)}
                </TabsTrigger>
                <TabsTrigger value="files" disabled={listing.file_paths.length === 0}>
                  {t(($) => $.detail.files)}
                </TabsTrigger>
                <TabsTrigger value="versions">
                  {t(($) => $.detail.versions)}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="pt-4">
                <ManifestOverview manifest={manifest} kind={kind} />
              </TabsContent>

              <TabsContent value="files" className="pt-4">
                <ListingFiles
                  listingId={listing.id}
                  versionId={listing.version.id}
                  paths={listing.file_paths}
                />
              </TabsContent>

              <TabsContent value="versions" className="pt-4">
                <ul className="flex flex-col gap-2">
                  {versionsQuery.data?.map((version) => {
                    const active = version.id === listing.version?.id;
                    return (
                      <li key={version.id}>
                        <button
                          type="button"
                          onClick={() => setVersionId(version.id)}
                          data-active={active || undefined}
                          className={cn(
                            "flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left outline-none transition-colors",
                            "border-surface-border hover:bg-surface-hover",
                            "focus-visible:ring-2 focus-visible:ring-ring",
                            "data-active:border-foreground/30 data-active:font-medium",
                          )}
                        >
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-body tabular-nums">
                              {version.version}
                            </span>
                            <span className="text-caption text-muted-foreground">
                              {t(($) => $.detail.published_on, {
                                date: timeAgo(version.created_at),
                              })}
                            </span>
                          </span>
                          <span className="text-caption text-muted-foreground">
                            {version.changelog || t(($) => $.detail.no_changelog)}
                          </span>
                          <span className="truncate font-mono text-caption text-faint-foreground">
                            {t(($) => $.detail.digest)} {version.digest.slice(0, 12)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>

      {listing.version ? (
        <InstallDialog
          listing={listing}
          open={installOpen}
          onOpenChange={setInstallOpen}
          onInstalled={openInstalledEntity}
        />
      ) : null}

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        defaultKind={kind}
        onPublished={() => {
          setPublishOpen(false);
          setVersionId(undefined);
        }}
      />
    </div>
  );
}

/**
 * What installing this would actually put in the workspace, per kind. The
 * withheld values are called out for every kind that has them, because that is
 * the part of an install a reader has to prepare for.
 */
function ManifestOverview({
  manifest,
  kind,
}: {
  manifest: MarketplaceManifest | undefined;
  kind: MarketplaceKind;
}) {
  const { t } = useT("marketplace");
  if (!manifest) return null;

  const agent = manifest.agent;
  const mcp = manifest.mcp;

  if (kind === "agent" && agent) {
    const skills = (agent.skills ?? []) as { name: string; description: string }[];
    const servers = (agent.mcp_servers ?? []) as {
      name: string;
      endpoint_hint?: string;
      required_secrets: string[];
    }[];
    return (
      <div className="flex flex-col gap-6">
        {typeof agent.runtime_provider === "string" && agent.runtime_provider ? (
          <p className="text-caption text-muted-foreground">
            {t(($) => $.detail.runtime_provider, {
              provider: agent.runtime_provider as string,
            })}
          </p>
        ) : null}
        <section>
          <h2 className="mb-2 text-body font-medium">
            {t(($) => $.detail.instructions)}
          </h2>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-surface-border bg-surface-raised/40 p-3 text-caption">
            {String(agent.instructions ?? "")}
          </pre>
        </section>
        {skills.length > 0 ? (
          <section>
            <h2 className="mb-2 text-body font-medium">
              {t(($) => $.detail.carries_skills)}
            </h2>
            <ul className="flex flex-col gap-1.5">
              {skills.map((skill) => (
                <li
                  key={skill.name}
                  className="rounded-md border border-surface-border px-3 py-2"
                >
                  <p className="text-caption font-medium">{skill.name}</p>
                  <p className="text-caption text-muted-foreground">
                    {skill.description}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {servers.length > 0 ? (
          <section>
            <h2 className="mb-2 text-body font-medium">
              {t(($) => $.detail.expects_mcp)}
            </h2>
            <ul className="flex flex-col gap-1.5">
              {servers.map((server) => (
                <li
                  key={server.name}
                  className="rounded-md border border-surface-border px-3 py-2"
                >
                  <p className="font-mono text-caption font-medium">{server.name}</p>
                  {server.endpoint_hint ? (
                    <p className="text-caption text-muted-foreground">
                      {t(($) => $.detail.endpoint, { endpoint: server.endpoint_hint })}
                    </p>
                  ) : null}
                  <p className="text-caption text-muted-foreground">
                    {server.required_secrets.length > 0
                      ? t(($) => $.detail.requires_secrets, {
                          fields: server.required_secrets.join(", "),
                        })
                      : t(($) => $.detail.requires_nothing)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  if (kind === "mcp" && mcp) {
    const required = (mcp.required_secrets ?? []) as string[];
    return (
      <div className="flex flex-col gap-3">
        {typeof mcp.endpoint_hint === "string" && mcp.endpoint_hint ? (
          <p className="text-caption text-muted-foreground">
            {t(($) => $.detail.endpoint, { endpoint: mcp.endpoint_hint as string })}
          </p>
        ) : null}
        <p className="text-caption text-muted-foreground">
          {required.length > 0
            ? t(($) => $.detail.requires_secrets, { fields: required.join(", ") })
            : t(($) => $.detail.requires_nothing)}
        </p>
        <pre className="max-h-96 overflow-auto rounded-md border border-surface-border bg-surface-raised/40 p-3 font-mono text-caption">
          {JSON.stringify(mcp.config ?? {}, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <p className="text-caption text-muted-foreground">
      {t(($) => $.detail.select_file)}
    </p>
  );
}
