"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  ChevronRight,
  ExternalLink,
  Loader2,
  Network,
} from "lucide-react";
import type {
  OntologyCatalogItem,
  OntologySummary,
} from "@enact/core/types";
import { useWorkspaceId } from "@enact/core/hooks";
import {
  ontologyDetailOptions,
  ontologyListOptions,
} from "@enact/core/workspace/queries";
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@enact/ui/components/ui/tabs";
import { RichContent } from "../../rich-content";
import { useLocale, useT } from "../../i18n";
import { openExternal } from "../../platform";

function localized(
  locale: string,
  english: string | null | undefined,
  chinese: string | null | undefined,
) {
  return locale.startsWith("zh") && chinese ? chinese : english ?? chinese ?? "";
}

export function OntologiesPage() {
  const { t } = useT("settings");
  const locale = useLocale();
  const wsId = useWorkspaceId();
  const [selected, setSelected] = useState<OntologySummary | null>(null);
  const listQuery = useQuery(ontologyListOptions(wsId));
  const detailQuery = useQuery(
    ontologyDetailOptions(wsId, selected?.name ?? ""),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1440px] p-4 sm:p-6">
          {listQuery.isPending ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-body text-muted-foreground">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              {t(($) => $.ontology.loading)}
            </div>
          ) : listQuery.isError ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center">
              <p className="text-body text-muted-foreground">
                {t(($) => $.ontology.load_failed)}
              </p>
              <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
                {t(($) => $.ontology.retry)}
              </Button>
            </div>
          ) : (listQuery.data?.length ?? 0) === 0 ? (
            <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed px-6 text-body text-muted-foreground">
              {t(($) => $.ontology.empty)}
            </div>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {listQuery.data?.map((ontology) => {
                const displayName = localized(
                  locale,
                  ontology.name,
                  ontology.nameZh,
                );
                return (
                  <li key={ontology.name} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelected(ontology)}
                      className="group flex h-full w-full flex-col rounded-lg border border-surface-border bg-surface-raised/40 p-4 text-left outline-none hover:border-foreground/20 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex w-full min-w-0 items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
                          <Network className="size-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="min-w-0 truncate text-body font-semibold">
                              {displayName}
                            </span>
                            <Badge variant="outline">
                              {t(($) => $.ontology.version, {
                                version: ontology.version,
                              })}
                            </Badge>
                            <Badge variant="secondary">
                              {ontology.isLayered
                                ? t(($) => $.ontology.layered)
                                : t(($) => $.ontology.unified)}
                            </Badge>
                          </span>
                          {displayName !== ontology.name ? (
                            <span
                              className="mt-0.5 block truncate font-mono text-caption text-faint-foreground"
                              translate="no"
                            >
                              {ontology.name}
                            </span>
                          ) : null}
                        </span>
                        <ChevronRight
                          className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                          aria-hidden="true"
                        />
                      </span>
                      <span className="mt-3 line-clamp-2 min-h-10 w-full text-caption leading-5 text-muted-foreground">
                        {localized(
                          locale,
                          ontology.description,
                          ontology.descriptionZh,
                        )}
                      </span>
                      <span className="mt-4 grid w-full grid-cols-4 gap-2 border-t border-surface-border pt-3">
                        <OntologyCompactStat
                          locale={locale}
                          label={t(($) => $.ontology.entities)}
                          value={ontology.entityCount}
                        />
                        <OntologyCompactStat
                          locale={locale}
                          label={t(($) => $.ontology.actions)}
                          value={ontology.actionCount}
                        />
                        <OntologyCompactStat
                          locale={locale}
                          label={t(($) => $.ontology.policies)}
                          value={ontology.policyCount}
                        />
                        <OntologyCompactStat
                          locale={locale}
                          label={t(($) => $.ontology.capabilities)}
                          value={ontology.capabilityCount}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="enact-dialog-wide flex max-h-[85vh] flex-col overflow-hidden">
          <DialogHeader className="pr-8">
            <DialogTitle>
              {selected
                ? localized(locale, selected.name, selected.nameZh)
                : t(($) => $.ontology.details_title)}
            </DialogTitle>
            <DialogDescription>
              {selected
                ? localized(
                    locale,
                    selected.description,
                    selected.descriptionZh,
                  )
                : ""}
            </DialogDescription>
            {selected ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge variant="outline">
                  {t(($) => $.ontology.version, { version: selected.version })}
                </Badge>
                <Badge variant="secondary">
                  {selected.isLayered
                    ? t(($) => $.ontology.layered)
                    : t(($) => $.ontology.unified)}
                </Badge>
                {localized(locale, selected.name, selected.nameZh) !==
                selected.name ? (
                  <span
                    className="font-mono text-caption text-faint-foreground"
                    translate="no"
                  >
                    {selected.name}
                  </span>
                ) : null}
              </div>
            ) : null}
          </DialogHeader>

          <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border pb-3">
              <TabsList variant="line">
                <TabsTrigger value="overview">
                  {t(($) => $.ontology.overview_tab)}
                </TabsTrigger>
                <TabsTrigger value="preview">
                  {t(($) => $.ontology.preview_tab)}
                </TabsTrigger>
              </TabsList>
              {selected?.capHubUrl ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openExternal(selected.capHubUrl)}
                >
                  <ExternalLink className="size-3.5" />
                  {t(($) => $.ontology.open_caphub)}
                </Button>
              ) : null}
            </div>

            {detailQuery.isPending ? (
              <div className="flex min-h-64 flex-1 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
              </div>
            ) : detailQuery.isError ? (
              <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 text-center">
                <p className="text-body text-muted-foreground">
                  {t(($) => $.ontology.load_failed)}
                </p>
                <Button variant="outline" size="sm" onClick={() => detailQuery.refetch()}>
                  {t(($) => $.ontology.retry)}
                </Button>
              </div>
            ) : (
              <>
                <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto pt-5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <OntologyStat
                      locale={locale}
                      label={t(($) => $.ontology.entities)}
                      value={detailQuery.data?.entityCount ?? 0}
                    />
                    <OntologyStat
                      locale={locale}
                      label={t(($) => $.ontology.actions)}
                      value={detailQuery.data?.actionCount ?? 0}
                    />
                    <OntologyStat
                      locale={locale}
                      label={t(($) => $.ontology.policies)}
                      value={detailQuery.data?.policyCount ?? 0}
                    />
                    <OntologyStat
                      locale={locale}
                      label={t(($) => $.ontology.capabilities)}
                      value={detailQuery.data?.capabilityCount ?? 0}
                    />
                  </div>
                  <div className="mt-6 grid gap-6 md:grid-cols-2">
                    <OntologyItems title={t(($) => $.ontology.entities)} items={detailQuery.data?.entities ?? []} locale={locale} emptyLabel={t(($) => $.ontology.no_items)} />
                    <OntologyItems title={t(($) => $.ontology.capabilities)} items={detailQuery.data?.capabilities ?? []} locale={locale} emptyLabel={t(($) => $.ontology.no_items)} />
                    <OntologyItems title={t(($) => $.ontology.actions)} items={detailQuery.data?.actions ?? []} locale={locale} emptyLabel={t(($) => $.ontology.no_items)} />
                    <OntologyItems title={t(($) => $.ontology.policies)} items={detailQuery.data?.policies ?? []} locale={locale} emptyLabel={t(($) => $.ontology.no_items)} />
                  </div>
                </TabsContent>
                <TabsContent value="preview" className="min-h-0 flex-1 overflow-y-auto pt-5">
                  {detailQuery.data?.preview ? (
                    <RichContent content={detailQuery.data.preview} />
                  ) : (
                    <div className="flex min-h-64 items-center justify-center text-body text-muted-foreground">
                      {t(($) => $.ontology.preview_empty)}
                    </div>
                  )}
                </TabsContent>
              </>
            )}
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OntologyCompactStat({
  label,
  value,
  locale,
}: {
  label: string;
  value: number;
  locale: string;
}) {
  return (
    <span className="min-w-0">
      <span className="block text-body font-semibold tabular-nums">
        {new Intl.NumberFormat(locale).format(value)}
      </span>
      <span className="block truncate text-caption text-muted-foreground">
        {label}
      </span>
    </span>
  );
}

function OntologyStat({
  label,
  value,
  locale,
}: {
  label: string;
  value: number;
  locale: string;
}) {
  return (
    <div className="rounded-md border border-surface-border px-3 py-2.5">
      <div className="text-title font-semibold tabular-nums">
        {new Intl.NumberFormat(locale).format(value)}
      </div>
      <div className="text-caption text-muted-foreground">{label}</div>
    </div>
  );
}

function OntologyItems({
  title,
  items,
  locale,
  emptyLabel,
}: {
  title: string;
  items: OntologyCatalogItem[];
  locale: string;
  emptyLabel: string;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-body font-semibold">
        <BookOpen className="size-4 text-muted-foreground" />
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-caption text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-surface-border rounded-md border border-surface-border">
          {items.map((item) => (
            <li key={item.name} className="px-3 py-2">
              <div className="text-body font-medium">
                {localized(locale, item.name, item.nameZh)}
              </div>
              {localized(locale, item.description, item.descriptionZh) ? (
                <div className="mt-0.5 line-clamp-2 text-caption text-muted-foreground">
                  {localized(locale, item.description, item.descriptionZh)}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
