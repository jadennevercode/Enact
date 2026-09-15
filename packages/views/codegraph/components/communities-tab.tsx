"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import {
  codeGraphCommunitiesOptions,
  codeGraphWikiOptions,
  codeGraphWikiArticleOptions,
  type CodeGraphCommunity,
} from "@enact/core/codegraph";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@enact/ui/components/ui/tooltip";
import { cn } from "@enact/ui/lib/utils";
import { RichContent } from "../../rich-content";
import { useT } from "../../i18n";
import { sourceFileUrl, sourceRef } from "../source-link";

/**
 * How many subsystems the list shows before it stops.
 *
 * A real monorepo produces on the order of a thousand communities, most of
 * them a handful of nodes. Rendering all of them turns the one useful thing
 * here — the dozen subsystems that actually carry the repository — into a
 * scroll. The rest stay one click away rather than hidden.
 */
const VISIBLE_COMMUNITIES = 60;

export function CommunitiesTab({
  wsId,
  resourceId,
  repoUrl,
  commit,
  onShowInGraph,
}: {
  wsId: string;
  resourceId: string;
  repoUrl: string;
  commit: string | null;
  onShowInGraph: (communityId: number) => void;
}) {
  const { t } = useT("codegraph");
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const communitiesQuery = useQuery(codeGraphCommunitiesOptions(wsId, resourceId));
  const wikiQuery = useQuery(codeGraphWikiOptions(wsId, resourceId));

  const communities = useMemo(
    () => communitiesQuery.data?.communities ?? [],
    [communitiesQuery.data?.communities],
  );
  const matching = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return communities;
    return communities.filter((c) => c.label.toLowerCase().includes(needle));
  }, [communities, filter]);

  // Filtering is a deliberate act, so it shows everything it matched; the
  // default list is the one that needs a ceiling.
  const limited = expanded || filter.trim() ? matching : matching.slice(0, VISIBLE_COMMUNITIES);
  const hidden = matching.length - limited.length;

  const selected =
    communities.find((c) => c.id === selectedId) ?? limited[0] ?? communities[0] ?? null;

  const article = wikiQuery.data?.articles.find(
    (a) => a.community_id === selected?.id && a.kind === "community",
  );
  const articleQuery = useQuery(
    codeGraphWikiArticleOptions(wsId, resourceId, article?.slug ?? ""),
  );

  if (communitiesQuery.isPending) {
    return <p className="text-body text-muted-foreground">{t(($) => $.page.loading)}</p>;
  }
  if (communitiesQuery.isError) {
    return <p className="text-body text-muted-foreground">{t(($) => $.page.load_failed)}</p>;
  }

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <section className="enact-surface-panel flex min-h-0 flex-col overflow-hidden">
        <div className="relative border-b border-border-soft p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t(($) => $.communities.filter_placeholder)}
            aria-label={t(($) => $.communities.filter_placeholder)}
            className="pl-8"
          />
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-border-soft overflow-y-auto">
          {limited.length === 0 ? (
            <li className="px-4 py-6 text-body text-muted-foreground">
              {t(($) => $.communities.no_match)}
            </li>
          ) : (
            limited.map((community) => (
              <li key={community.id}>
                <CommunityRow
                  community={community}
                  active={community.id === selected?.id}
                  onSelect={() => setSelectedId(community.id)}
                />
              </li>
            ))
          )}
        </ul>
        {hidden > 0 ? (
          <div className="border-t border-border-soft p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center text-caption"
              onClick={() => setExpanded(true)}
            >
              {t(($) => $.communities.rest_count, { count: hidden })}
            </Button>
          </div>
        ) : null}
      </section>

      <section className="enact-surface-panel min-w-0 px-5 py-4">
        {!selected ? (
          <p className="text-body text-muted-foreground">
            {t(($) => $.communities.select_hint)}
          </p>
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-title font-semibold" title={selected.label}>
                  {selected.label}
                </h2>
                <p className="text-caption text-muted-foreground">
                  {t(($) => $.communities.size, { count: selected.size })}
                  {typeof selected.cohesion === "number"
                    ? ` · ${t(($) => $.communities.cohesion, { value: selected.cohesion!.toFixed(2) })}`
                    : ""}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => onShowInGraph(selected.id)}>
                {t(($) => $.communities.show_in_graph)}
              </Button>
            </header>

            {selected.top_nodes.length > 0 ? (
              <div>
                <h3 className="text-caption font-semibold text-muted-foreground">
                  {t(($) => $.communities.top_files)}
                </h3>
                <ul className="mt-1.5 divide-y divide-border-soft">
                  {selected.top_nodes.map((node) => {
                    const href = sourceFileUrl(
                      repoUrl,
                      commit,
                      node.source_file,
                      node.source_location,
                    );
                    const ref = sourceRef(node.source_file, node.source_location);
                    return (
                      <li
                        key={node.id}
                        className="flex items-center gap-2 py-1.5 text-body"
                      >
                        <span className="min-w-0 flex-1 truncate" title={node.label}>
                          {node.label}
                        </span>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex min-w-0 max-w-[60%] shrink-0 items-center gap-1 truncate font-mono text-caption text-muted-foreground hover:text-foreground hover:underline"
                          >
                            <span className="truncate">{ref}</span>
                            <ExternalLink className="size-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="shrink-0 truncate font-mono text-caption text-muted-foreground">
                            {ref}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="min-w-0">
              {article && articleQuery.data?.markdown ? (
                <RichContent content={articleQuery.data.markdown} density="document" />
              ) : (
                <p className="text-body text-muted-foreground">
                  {t(($) => $.communities.article_empty)}
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * One subsystem in the list.
 *
 * Labels are the build's own hub names — the most connected symbol in the
 * community — so they can be long and identifier-shaped. They truncate with
 * the full name in a tooltip rather than wrapping, which would make the list
 * scan-proof.
 *
 * The selected row keeps its weight and foreground colour under hover, so
 * hovering the current selection never visually demotes it to a plain row.
 */
function CommunityRow({
  community,
  active,
  onSelect,
}: {
  community: CodeGraphCommunity;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useT("codegraph");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onSelect}
            aria-current={active ? "true" : undefined}
            className={cn(
              "flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              active && "bg-muted/60",
            )}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-body",
                active ? "font-semibold text-foreground" : "text-foreground/80",
              )}
            >
              {community.label}
            </span>
            <span className="shrink-0 font-mono text-caption text-muted-foreground">
              {community.size}
            </span>
          </button>
        }
      />
      <TooltipContent side="right" className="max-w-sm whitespace-pre-line">
        {community.label}
        {"\n"}
        {t(($) => $.communities.size, { count: community.size })}
      </TooltipContent>
    </Tooltip>
  );
}
