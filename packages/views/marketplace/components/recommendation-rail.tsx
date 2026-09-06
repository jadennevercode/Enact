"use client";

import { useQuery } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import type {
  MarketplaceListing,
  MarketplaceRecommendation,
  MarketplaceRecommendationReason,
} from "@enact/core/types";
import { useWorkspaceId } from "@enact/core/hooks";
import {
  marketplaceRecommendationsOptions,
  useDismissMarketplaceRecommendation,
} from "@enact/core/marketplace";
import { Button } from "@enact/ui/components/ui/button";
import { Skeleton } from "@enact/ui/components/ui/skeleton";
import { cn } from "@enact/ui/lib/utils";
import { useT } from "../../i18n";
import { marketplaceKindIcon, marketplaceKindTone, type MarketplaceTab } from "../lib/kind";

interface RecommendationRailProps {
  onOpen: (listing: MarketplaceListing) => void;
  /** Rendered when the workspace has no profile to rank against. */
  onDescribeProject?: () => void;
}

/**
 * What this workspace could add, ranked against what it says its project is.
 *
 * The rail's whole job is to be answerable. Every card states why it is there,
 * in the workspace's own vocabulary — "matches go, in this listing's tags" —
 * because a recommendation a member cannot interrogate is one they can only
 * accept or ignore. That is also why dismissing is one click away and sits on
 * the card rather than behind a menu.
 *
 * Three states, and none of them is a blank rail:
 *
 *   - no profile → say so, and offer the one action that fixes it. An empty
 *     rail here would read as "there is nothing for you", when the truth is
 *     "we have not been told anything about you".
 *   - nothing matched → say how many were considered, so "nothing fits out of
 *     forty" is distinguishable from "the directory is empty".
 *   - fallback results → labelled as what the deployment ships, never as a fit.
 */
export function RecommendationRail({ onOpen, onDescribeProject }: RecommendationRailProps) {
  const { t } = useT("marketplace");
  const wsId = useWorkspaceId();
  const query = useQuery(marketplaceRecommendationsOptions(wsId));
  const dismiss = useDismissMarketplaceRecommendation(wsId);

  if (query.isPending) {
    return (
      <section className="flex flex-col gap-3">
        <RailHeading />
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <li key={index}>
              <Skeleton className="h-32 w-full rounded-lg" />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  // A failed ranking is not worth an error state on a page whose main content
  // loaded fine. The directory below is still browsable.
  if (query.isError || !query.data) return null;

  const { recommendations, profile_empty: profileEmpty, considered } = query.data;

  if (profileEmpty) {
    return (
      <section className="flex flex-col gap-3">
        <RailHeading />
        <div className="rounded-lg border border-dashed border-surface-border bg-surface-raised/40 p-4">
          <p className="text-body text-muted-foreground">
            {t(($) => $.recommendations.no_profile)}
          </p>
          {onDescribeProject ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={onDescribeProject}
            >
              {t(($) => $.recommendations.describe_project)}
            </Button>
          ) : null}
        </div>
      </section>
    );
  }

  if (recommendations.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <RailHeading />
        <p className="text-caption text-muted-foreground">
          {t(($) => $.recommendations.none_matched, { count: considered })}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <RailHeading />
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {recommendations.map((recommendation) => (
          <li key={recommendation.listing.id}>
            <RecommendationCard
              recommendation={recommendation}
              onOpen={onOpen}
              onDismiss={() => dismiss.mutate(recommendation.listing.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );

  function RailHeading() {
    return (
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-title font-medium">{t(($) => $.recommendations.title)}</h2>
      </div>
    );
  }
}

interface RecommendationCardProps {
  recommendation: MarketplaceRecommendation;
  onOpen: (listing: MarketplaceListing) => void;
  onDismiss: () => void;
}

function RecommendationCard({ recommendation, onOpen, onDismiss }: RecommendationCardProps) {
  const { t } = useT("marketplace");
  const { listing, reasons, matched } = recommendation;
  const kind = listing.kind as MarketplaceTab;
  const Icon = marketplaceKindIcon(kind);

  return (
    <div
      className={cn(
        "group relative flex h-full flex-col gap-2 rounded-lg border border-surface-border",
        "bg-surface-raised p-4 text-left transition-colors hover:border-foreground/20",
      )}
    >
      {/* Dismissing is a decision about this workspace's directory, so it sits
          on the card rather than behind a menu — but it is quiet until hover
          or keyboard focus, because it is not the primary action. */}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={t(($) => $.recommendations.dismiss)}
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        className="absolute right-2 top-2 size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>

      <button
        type="button"
        onClick={() => onOpen(listing)}
        className="flex flex-col gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
      >
        <div className="flex items-center gap-2">
          <span className={cn("flex size-6 items-center justify-center rounded", marketplaceKindTone(kind))}>
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
          <span className="min-w-0 truncate text-body font-medium">{listing.name}</span>
        </div>
        {listing.description ? (
          <p className="line-clamp-2 text-caption text-muted-foreground">{listing.description}</p>
        ) : null}
      </button>

      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
        {matched ? (
          reasons
            .filter((reason) => reason.term !== "")
            .slice(0, 3)
            .map((reason) => (
              <ReasonChip key={`${reason.kind}-${reason.term}`} reason={reason} />
            ))
        ) : (
          <span className="text-caption text-muted-foreground">
            {t(($) => $.recommendations.not_specific)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One reason, stated as the profile value that matched and where it was found.
 * An unrecognized `kind` from a newer server still renders its term rather than
 * disappearing — the term is the useful half.
 */
function ReasonChip({ reason }: { reason: MarketplaceRecommendationReason }) {
  const { t } = useT("marketplace");
  const label = t(($) => $.recommendations.reason[reason.kind as "stack"]) ?? reason.kind;
  return (
    <span className="rounded border border-surface-border px-1.5 py-0.5 text-caption text-muted-foreground">
      {label ? `${label}: ` : ""}
      <span className="text-foreground">{reason.term}</span>
    </span>
  );
}
