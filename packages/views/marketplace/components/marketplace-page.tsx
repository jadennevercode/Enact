"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, Store, Upload } from "lucide-react";
import type {
  MarketplaceInstalledFilter,
  MarketplaceListing,
} from "@enact/core/types";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import { marketplaceCatalogOptions } from "@enact/core/marketplace";
import { ontologyListOptions } from "@enact/core/workspace/queries";
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import { Skeleton } from "@enact/ui/components/ui/skeleton";
import { cn } from "@enact/ui/lib/utils";
import { useNavigation } from "../../navigation";
import {
  CollectionPageHeader,
  CollectionPageHeaderAction,
  CollectionPageState,
} from "../../layout/collection-page";
import { useT } from "../../i18n";
import {
  MARKETPLACE_TABS,
  marketplaceKindIcon,
  tabAsKind,
  type MarketplaceTab,
} from "../lib/kind";
import { InstalledFilterChips } from "./installed-filter-chips";
import { MarketplaceCard } from "./marketplace-card";
import { OntologyTab } from "./ontology-tab";
import { PublishDialog } from "./publish-dialog";

/**
 * The directory.
 *
 * Five tabs, of which four list Enact's own listings and the fifth reads
 * Capability Hub's ontology catalog. They sit side by side because that is how
 * a reader thinks about them — "what capability can I get" — even though only
 * four of them are rows in this product's database.
 *
 * The installed filter spans every tab, ontologies included: "do I already
 * have this" is the same question whether the answer is an install record or
 * an attached domain.
 */
export function MarketplacePage() {
  const { t } = useT("marketplace");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { push } = useNavigation();

  const [tab, setTab] = useState<MarketplaceTab>("skill");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [installedFilter, setInstalledFilter] =
    useState<MarketplaceInstalledFilter | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const kind = tabAsKind(tab);
  const catalogQuery = useQuery({
    ...marketplaceCatalogOptions(wsId, {
      kind: kind ?? undefined,
      q: query.trim() || undefined,
      tag: tag ?? undefined,
      mine: mine || undefined,
      installed: installedFilter ?? undefined,
    }),
    // The federated tab does not read this endpoint at all.
    enabled: wsId !== "" && kind !== null,
  });
  const ontologyQuery = useQuery({
    ...ontologyListOptions(wsId),
    enabled: wsId !== "" && kind === null,
  });

  const catalog = catalogQuery.data;
  // Facet chips come from the server's count over the whole visible set, so
  // picking one tag does not make the others disappear from the row.
  const tags = useMemo(() => {
    const counts = catalog?.facets.tags ?? {};
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12);
  }, [catalog]);

  const openListing = (listing: MarketplaceListing) => {
    push(paths.marketplaceListing(listing.id));
  };

  const counts = catalog?.facets.kinds ?? {};

  // The installed counts come from whichever tab is open: the server's facets
  // for a listing kind, the attached flags for the federated one. Both are
  // counted over the whole visible set, so choosing a chip never changes the
  // other chip's number.
  const installedCounts = useMemo(() => {
    if (kind === null) {
      const ontologies = ontologyQuery.data ?? [];
      const attached = ontologies.filter((entry) => entry.attached).length;
      return { installed: attached, not_installed: ontologies.length - attached };
    }
    const facets = catalog?.facets.installed ?? {};
    return {
      installed: facets.installed,
      not_installed: facets.not_installed,
    };
  }, [kind, ontologyQuery.data, catalog]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={Store}
        title={t(($) => $.title)}
        description={t(($) => $.description)}
        actions={
          <CollectionPageHeaderAction
            icon={Upload}
            label={t(($) => $.publish.action)}
            onClick={() => setPublishOpen(true)}
          />
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            {MARKETPLACE_TABS.map((candidate) => {
              const Icon = marketplaceKindIcon(candidate);
              const active = candidate === tab;
              const count =
                candidate === "ontology"
                  ? ontologyQuery.data?.length
                  : counts[candidate];
              return (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => {
                    setTab(candidate);
                    setTag(null);
                  }}
                  data-active={active || undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-caption outline-none transition-colors",
                    "border-transparent text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                    "focus-visible:ring-2 focus-visible:ring-ring",
                    // The active tab is expressed in weight and border, both
                    // dimensions hover does not touch, so hovering a selected
                    // tab cannot visually downgrade it to a plain hover.
                    "data-active:border-surface-border data-active:bg-surface-raised data-active:font-medium data-active:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {t(($) => $.kind[candidate])}
                  {typeof count === "number" && count > 0 ? (
                    <span className="font-mono text-caption tabular-nums opacity-60">
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {kind !== null ? (
              <div className="relative min-w-0 flex-1 sm:max-w-sm">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t(($) => $.search_placeholder)}
                  className="h-8 pl-8"
                />
              </div>
            ) : null}
            <InstalledFilterChips
              value={installedFilter}
              counts={installedCounts}
              onChange={setInstalledFilter}
            />
            {kind !== null ? (
              <Button
                type="button"
                size="sm"
                variant={mine ? "secondary" : "ghost"}
                onClick={() => setMine((value) => !value)}
              >
                {t(($) => $.mine)}
              </Button>
            ) : null}
            {tag || query || installedFilter ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTag(null);
                  setQuery("");
                  setInstalledFilter(null);
                }}
              >
                {t(($) => $.clear_filters)}
              </Button>
            ) : null}
          </div>

          {kind === null ? (
            <OntologyTab installedFilter={installedFilter} />
          ) : (
            <>
              {tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map(([name, count]) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setTag(tag === name ? null : name)}
                      className="outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
                    >
                      <Badge
                        variant={tag === name ? "default" : "secondary"}
                        className="cursor-pointer text-caption"
                      >
                        {name}
                        <span className="ml-1 font-mono tabular-nums opacity-60">
                          {count}
                        </span>
                      </Badge>
                    </button>
                  ))}
                </div>
              ) : null}

              {catalogQuery.isPending ? (
                <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <li key={index}>
                      <Skeleton className="h-36 w-full rounded-lg" />
                    </li>
                  ))}
                </ul>
              ) : catalogQuery.isError ? (
                <CollectionPageState
                  icon={Store}
                  title={t(($) => $.load_failed)}
                  actions={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => catalogQuery.refetch()}
                    >
                      {t(($) => $.retry)}
                    </Button>
                  }
                />
              ) : (catalog?.listings.length ?? 0) === 0 ? (
                <CollectionPageState
                  icon={Store}
                  title={
                    mine
                      ? t(($) => $.empty_mine)
                      : query || tag || installedFilter
                        ? t(($) => $.empty_filtered)
                        : t(($) => $.empty)
                  }
                />
              ) : (
                <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {catalog?.listings.map((listing) => (
                    <li key={listing.id} className="min-w-0">
                      <MarketplaceCard listing={listing} onOpen={openListing} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        defaultKind={kind ?? "skill"}
        onPublished={(listingId) => {
          setPublishOpen(false);
          push(paths.marketplaceListing(listingId));
        }}
      />

      {catalogQuery.isFetching && !catalogQuery.isPending ? (
        <span className="pointer-events-none fixed bottom-4 right-4 flex items-center gap-1.5 rounded-md bg-surface-raised px-2 py-1 text-caption text-muted-foreground shadow-sm">
          <Loader2
            className="size-3 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        </span>
      ) : null}
    </div>
  );
}
