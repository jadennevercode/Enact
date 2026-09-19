"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink, Search } from "lucide-react";
import {
  codeGraphViewOptions,
  communityIdFromNodeId,
  neighborsOf,
  useCodeGraphQuery,
  type CodeGraphProjection,
  type CodeGraphViewNode,
} from "@enact/core/codegraph";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import { useT } from "../../i18n";
import { CodeGraphCanvas } from "./code-graph-canvas";
import { sourceFileUrl, sourceRef } from "../source-link";

/**
 * Projection sizes.
 *
 * The meta graph asks for the hundred largest subsystems, never all of them:
 * a real repository produces on the order of a thousand, and a thousand-node
 * hairball answers no question. Drill-downs keep the 500-node ceiling the
 * browser can lay out and a person can read.
 */
const META_LIMIT = 100;
const DETAIL_LIMIT = 500;

export function GraphTab({
  wsId,
  resourceId,
  repoUrl,
  commit,
  focusCommunity,
}: {
  wsId: string;
  resourceId: string;
  repoUrl: string;
  commit: string | null;
  focusCommunity: number | null;
}) {
  const { t } = useT("codegraph");
  const [projection, setProjection] = useState<CodeGraphProjection>({
    level: "community",
    limit: META_LIMIT,
  });
  const [selected, setSelected] = useState<CodeGraphViewNode | undefined>();
  const [question, setQuestion] = useState("");
  const search = useCodeGraphQuery(resourceId);

  // A "show in graph" from the subsystems tab opens that subsystem directly.
  useEffect(() => {
    if (focusCommunity === null) return;
    setProjection({ community: focusCommunity, limit: DETAIL_LIMIT });
    setSelected(undefined);
  }, [focusCommunity]);

  const { data: view, isPending, isError } = useQuery(
    codeGraphViewOptions(wsId, resourceId, projection),
  );

  const isMeta = "level" in projection;
  const title = isMeta
    ? t(($) => $.graph.meta_title)
    : "community" in projection
      ? t(($) => $.graph.community_title, { label: String(projection.community) })
      : t(($) => $.graph.focus_title, { label: selected?.label ?? "" });

  // Search answers are text (the same budgeted rendering an agent gets). Node
  // ids that appear verbatim in the answer are highlighted on the canvas; when
  // none match, the answer still stands on its own.
  const highlightIds = useMemo(() => {
    const answer = search.data?.text;
    if (!answer || !view) return undefined;
    const hits = view.nodes.filter((node) => answer.includes(node.id)).map((n) => n.id);
    return hits.length > 0 ? hits : undefined;
  }, [search.data?.text, view]);

  const neighbours = useMemo(
    () => (view && selected ? neighborsOf(view, selected.id) : []),
    [view, selected],
  );
  const nodeById = useMemo(
    () => new Map((view?.nodes ?? []).map((n) => [n.id, n])),
    [view?.nodes],
  );

  const openNode = (node: CodeGraphViewNode) => {
    const communityId = communityIdFromNodeId(node.id) ?? node.community_id ?? null;
    if (node.kind === "community" && communityId !== null) {
      setProjection({ community: communityId, limit: DETAIL_LIMIT });
      setSelected(undefined);
      return;
    }
    setProjection({ focus: node.id, depth: 2, limit: DETAIL_LIMIT });
    setSelected(node);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {!isMeta ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setProjection({ level: "community", limit: META_LIMIT });
              setSelected(undefined);
            }}
          >
            <ChevronLeft className="size-4" />
            {t(($) => $.graph.back_to_meta)}
          </Button>
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-title-sm font-semibold">{title}</h2>
        <form
          className="relative w-full sm:w-80"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = question.trim();
            if (trimmed) search.mutate({ question: trimmed });
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t(($) => $.graph.search_placeholder)}
            aria-label={t(($) => $.graph.search_placeholder)}
            className="pl-8 pr-16"
          />
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            className="absolute right-1 top-1 h-7 px-2 text-caption"
            disabled={!question.trim() || search.isPending}
          >
            {t(($) => $.graph.search_run)}
          </Button>
        </form>
      </div>

      {isMeta ? (
        <p className="text-caption text-muted-foreground">{t(($) => $.graph.meta_hint)}</p>
      ) : null}

      {search.isError ? (
        <p className="text-body text-destructive">{t(($) => $.graph.search_failed)}</p>
      ) : search.data?.text ? (
        <section className="enact-surface-panel px-4 py-3">
          <h3 className="text-caption font-semibold text-muted-foreground">
            {t(($) => $.graph.search_result)}
          </h3>
          <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-caption">
            {search.data.text}
          </pre>
        </section>
      ) : null}

      {view?.truncated ? (
        <p
          role="status"
          className="rounded-md border border-warning/25 bg-warning/5 px-3 py-2 text-caption"
        >
          {t(($) => $.graph.truncated, {
            shown: view.nodes.length,
            total: view.total_nodes,
          })}
        </p>
      ) : null}

      {isPending ? (
        <p className="text-body text-muted-foreground">{t(($) => $.page.loading)}</p>
      ) : isError || !view ? (
        <p className="text-body text-muted-foreground">{t(($) => $.page.load_failed)}</p>
      ) : (
        <div className="enact-surface-panel grid min-w-0 overflow-hidden xl:grid-cols-[minmax(0,1fr)_20rem]">
          <CodeGraphCanvas
            view={view}
            selectedId={selected?.id}
            highlightIds={highlightIds}
            onSelectNode={setSelected}
            onOpenNode={openNode}
          />
          <aside className="max-h-[560px] space-y-3 overflow-auto border-t border-border-soft p-4 xl:border-l xl:border-t-0">
            <h3 className="text-body font-semibold">{t(($) => $.graph.inspector)}</h3>
            {!selected ? (
              <p className="text-body leading-relaxed text-muted-foreground">
                {t(($) => $.graph.select_hint)}
              </p>
            ) : (
              <SelectionDetail
                node={selected}
                neighbours={neighbours}
                nodeById={nodeById}
                repoUrl={repoUrl}
                commit={commit}
                onOpen={openNode}
                onSelect={setSelected}
              />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function SelectionDetail({
  node,
  neighbours,
  nodeById,
  repoUrl,
  commit,
  onOpen,
  onSelect,
}: {
  node: CodeGraphViewNode;
  neighbours: string[];
  nodeById: Map<string, CodeGraphViewNode>;
  repoUrl: string;
  commit: string | null;
  onOpen: (node: CodeGraphViewNode) => void;
  onSelect: (node: CodeGraphViewNode) => void;
}) {
  const { t } = useT("codegraph");
  const href = sourceFileUrl(repoUrl, commit, node.source_file, node.source_location);
  const ref = sourceRef(node.source_file, node.source_location);
  return (
    <>
      <div>
        <p className="text-caption text-muted-foreground">
          {node.kind === "community"
            ? t(($) => $.graph.kind_community)
            : t(($) => $.graph.kind_code)}
        </p>
        <h4 className="break-words text-title-sm font-semibold">{node.label}</h4>
        {node.kind === "community" && typeof node.size === "number" ? (
          <p className="text-caption text-muted-foreground">
            {t(($) => $.graph.members, { count: node.size })}
          </p>
        ) : null}
      </div>

      {ref ? (
        href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 break-all font-mono text-caption text-muted-foreground hover:text-foreground hover:underline"
          >
            {ref}
            <ExternalLink className="size-3 shrink-0" />
          </a>
        ) : (
          <p className="break-all font-mono text-caption text-muted-foreground">{ref}</p>
        )
      ) : null}

      <Button variant="outline" size="sm" className="w-full" onClick={() => onOpen(node)}>
        {node.kind === "community"
          ? t(($) => $.graph.open_subsystem)
          : t(($) => $.graph.focus_node)}
      </Button>

      {neighbours.length > 0 ? (
        <div>
          <h5 className="text-caption font-semibold text-muted-foreground">
            {t(($) => $.graph.neighbors)}
          </h5>
          <ul className="mt-1 space-y-1">
            {neighbours.slice(0, 30).map((id) => {
              const neighbour = nodeById.get(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => neighbour && onSelect(neighbour)}
                    className="block w-full truncate rounded-md border border-border-soft px-2 py-1 text-left text-caption transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={neighbour?.label ?? id}
                  >
                    {neighbour?.label ?? id}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </>
  );
}
