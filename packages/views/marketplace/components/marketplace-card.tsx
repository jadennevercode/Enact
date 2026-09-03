"use client";

import { ArrowUpCircle, Check } from "lucide-react";
import type { MarketplaceListing } from "@enact/core/types";
import { hasMarketplaceUpdate } from "@enact/core/marketplace";
import { Badge } from "@enact/ui/components/ui/badge";
import { cn } from "@enact/ui/lib/utils";
import { useT } from "../../i18n";
import {
  marketplaceKindIcon,
  marketplaceKindTone,
  type MarketplaceTab,
} from "../lib/kind";

interface MarketplaceCardProps {
  listing: MarketplaceListing;
  onOpen: (listing: MarketplaceListing) => void;
}

/**
 * One listing in the directory.
 *
 * The card answers, in order, the three questions a reader has: what is this,
 * who is accountable for it, and do I already have it. Install count is last
 * and quiet — it is the weakest of the three signals and should not out-shout
 * the publisher's name.
 */
export function MarketplaceCard({ listing, onOpen }: MarketplaceCardProps) {
  const { t } = useT("marketplace");
  const kind = listing.kind as MarketplaceTab;
  const Icon = marketplaceKindIcon(kind);
  const installed = Boolean(listing.installed_version_id);
  const updatable = hasMarketplaceUpdate(listing);

  return (
    <button
      type="button"
      onClick={() => onOpen(listing)}
      className={cn(
        "group flex h-full w-full flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised/40 p-4 text-left outline-none",
        "transition-colors hover:border-foreground/20 hover:bg-surface-hover",
        "focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-md",
            marketplaceKindTone(kind),
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-body font-semibold">
              {listing.name}
            </span>
            {listing.latest_version ? (
              <span className="shrink-0 font-mono text-caption tabular-nums text-muted-foreground">
                {t(($) => $.version, { version: listing.latest_version })}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-caption text-muted-foreground">
            {t(($) => $.by, { publisher: listing.publisher_workspace_name })}
          </span>
        </span>
      </span>

      <p className="line-clamp-2 min-h-8 text-caption text-muted-foreground">
        {listing.description}
      </p>

      <span className="mt-auto flex min-w-0 flex-wrap items-center gap-1.5">
        {listing.status === "deprecated" ? (
          <Badge variant="outline" className="text-caption">
            {t(($) => $.status.deprecated)}
          </Badge>
        ) : null}
        {listing.status === "draft" ? (
          <Badge variant="outline" className="text-caption">
            {t(($) => $.status.draft)}
          </Badge>
        ) : null}
        {listing.status === "removed" ? (
          <Badge variant="outline" className="text-caption">
            {t(($) => $.status.removed)}
          </Badge>
        ) : null}
        {listing.visibility === "workspace" ? (
          <Badge variant="secondary" className="text-caption">
            {t(($) => $.visibility.workspace)}
          </Badge>
        ) : null}
        {listing.tags.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="secondary" className="text-caption">
            {tag}
          </Badge>
        ))}

        <span className="ml-auto flex shrink-0 items-center gap-2">
          {updatable ? (
            <span className="flex items-center gap-1 text-caption font-medium text-sky-600 dark:text-sky-400">
              <ArrowUpCircle className="size-3.5" aria-hidden="true" />
              {t(($) => $.update_available, { version: listing.latest_version })}
            </span>
          ) : installed ? (
            <span className="flex items-center gap-1 text-caption text-muted-foreground">
              <Check className="size-3.5" aria-hidden="true" />
              {t(($) => $.installed)}
            </span>
          ) : listing.install_count > 0 ? (
            <span className="font-mono text-caption tabular-nums text-muted-foreground">
              {t(($) => $.installs, { count: listing.install_count })}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
