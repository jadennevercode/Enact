"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Network } from "lucide-react";
import type { MarketplaceInstalledFilter } from "@enact/core/types";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import { ontologyListOptions } from "@enact/core/workspace/queries";
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import { Skeleton } from "@enact/ui/components/ui/skeleton";
import { cn } from "@enact/ui/lib/utils";
import { useLocale, useT } from "../../i18n";
import { useNavigation } from "../../navigation";
import { CollectionPageState } from "../../layout/collection-page";
import { marketplaceKindTone } from "../lib/kind";
import { InstallStateBadge } from "./install-state-badge";

interface OntologyTabProps {
  /** Narrows to attached or unattached domains; null shows both. */
  installedFilter?: MarketplaceInstalledFilter | null;
}

/**
 * The federated tab.
 *
 * Ontologies are not listings: they live in Capability Hub and are attached to
 * an agent, which is where the existing Ontologies page already does the work.
 * This tab exists so a reader looking for capability finds them in the same
 * place as everything else, and then hands off rather than growing a second
 * copy of that page's attach flow here.
 *
 * "Attached" is this tab's version of "installed", and it is badged with the
 * same component the listing cards use: the question is the same one, and a
 * reader should not have to learn two vocabularies for it inside one page.
 */
export function OntologyTab({ installedFilter = null }: OntologyTabProps) {
  const { t } = useT("marketplace");
  const { t: tSettings } = useT("settings");
  const locale = useLocale();
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { push } = useNavigation();

  const listQuery = useQuery(ontologyListOptions(wsId));

  const ontologies = useMemo(() => {
    const all = listQuery.data ?? [];
    if (installedFilter === null) return all;
    const wantAttached = installedFilter === "installed";
    return all.filter((ontology) => ontology.attached === wantAttached);
  }, [listQuery.data, installedFilter]);

  if (listQuery.isPending) {
    return (
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <li key={index}>
            <Skeleton className="h-32 w-full rounded-lg" />
          </li>
        ))}
      </ul>
    );
  }

  if (listQuery.isError) {
    return (
      <CollectionPageState
        icon={Network}
        title={tSettings(($) => $.ontology.load_failed)}
        actions={
          <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
            {t(($) => $.retry)}
          </Button>
        }
      />
    );
  }

  if (ontologies.length === 0) {
    return (
      <CollectionPageState
        icon={Network}
        title={
          installedFilter === null
            ? tSettings(($) => $.ontology.empty)
            : t(($) => $.empty_filtered)
        }
      />
    );
  }

  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {ontologies.map((ontology) => {
        const displayName =
          locale.startsWith("zh") && ontology.nameZh
            ? ontology.nameZh
            : ontology.name;
        const description =
          locale.startsWith("zh") && ontology.descriptionZh
            ? ontology.descriptionZh
            : ontology.description;
        return (
          <li key={ontology.name} className="min-w-0">
            <button
              type="button"
              onClick={() => push(paths.ontologies())}
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
                    marketplaceKindTone("ontology"),
                  )}
                >
                  <Network className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-body font-semibold">
                      {displayName}
                    </span>
                    <span className="shrink-0 font-mono text-caption tabular-nums text-muted-foreground">
                      {t(($) => $.version, { version: ontology.version })}
                    </span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-1.5 pt-1">
                    <Badge variant="secondary" className="text-caption">
                      {tSettings(($) => $.ontology.entities)}
                      <span className="ml-1 font-mono tabular-nums opacity-60">
                        {ontology.entityCount}
                      </span>
                    </Badge>
                    <Badge variant="secondary" className="text-caption">
                      {tSettings(($) => $.ontology.actions)}
                      <span className="ml-1 font-mono tabular-nums opacity-60">
                        {ontology.actionCount}
                      </span>
                    </Badge>
                  </span>
                </span>
              </span>
              <p className="line-clamp-2 min-h-8 text-caption text-muted-foreground">
                {description}
              </p>
              <span className="mt-auto flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1 text-caption text-muted-foreground group-hover:text-foreground">
                  {tSettings(($) => $.ontology.title)}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </span>
                <InstallStateBadge
                  installed={ontology.attached === true}
                  className="ml-auto"
                />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
