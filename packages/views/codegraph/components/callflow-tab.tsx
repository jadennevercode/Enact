"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { codeGraphCallflowOptions } from "@enact/core/codegraph";
import { cn } from "@enact/ui/lib/utils";
import { MermaidDiagram } from "../../editor/mermaid-diagram";
import { useT } from "../../i18n";

/**
 * The build's Mermaid diagrams, rendered by the same component that renders a
 * ```mermaid fence in an issue — one diagram renderer in the product, not two.
 */
export function CallflowTab({
  wsId,
  resourceId,
}: {
  wsId: string;
  resourceId: string;
}) {
  const { t } = useT("codegraph");
  const { data, isPending, isError } = useQuery(
    codeGraphCallflowOptions(wsId, resourceId),
  );
  const [sectionId, setSectionId] = useState<string | null>(null);

  if (isPending) {
    return <p className="text-body text-muted-foreground">{t(($) => $.page.loading)}</p>;
  }
  if (isError) {
    return <p className="text-body text-muted-foreground">{t(($) => $.page.load_failed)}</p>;
  }

  const sections = data?.sections ?? [];
  const overview = data?.overview_mermaid ?? "";
  if (!overview && sections.length === 0) {
    return <p className="text-body text-muted-foreground">{t(($) => $.callflow.empty)}</p>;
  }

  const active = sections.find((section) => section.id === sectionId) ?? sections[0] ?? null;

  return (
    <div className="flex flex-col gap-4">
      {overview ? (
        <section className="enact-surface-panel min-w-0 overflow-hidden">
          <h2 className="border-b border-border-soft px-4 py-3 text-title-sm font-semibold">
            {t(($) => $.callflow.overview)}
          </h2>
          <div className="overflow-x-auto p-4">
            <MermaidDiagram chart={overview} />
          </div>
        </section>
      ) : null}

      {sections.length > 0 ? (
        <section className="enact-surface-panel min-w-0 overflow-hidden">
          <h2 className="border-b border-border-soft px-4 py-3 text-title-sm font-semibold">
            {t(($) => $.callflow.sections)}
          </h2>
          <div className="flex flex-wrap gap-1.5 border-b border-border-soft p-2">
            {sections.map((section) => {
              const isActive = section.id === active?.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setSectionId(section.id)}
                  aria-current={isActive ? "true" : undefined}
                  // Active stays bold and foreground-coloured under hover, so
                  // hovering the current section never looks like leaving it.
                  className={cn(
                    "max-w-[16rem] truncate rounded-md px-2.5 py-1 text-caption transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-muted/60 font-semibold text-foreground"
                      : "text-muted-foreground",
                  )}
                  title={section.name}
                >
                  {section.name}
                </button>
              );
            })}
          </div>
          {active ? (
            <div className="min-w-0 p-4">
              <p className="mb-2 text-caption text-muted-foreground">
                {t(($) => $.callflow.counts, {
                  nodes: active.node_count,
                  edges: active.edge_count,
                })}
              </p>
              <div className="overflow-x-auto">
                <MermaidDiagram chart={active.mermaid} />
              </div>
            </div>
          ) : (
            <p className="p-4 text-body text-muted-foreground">
              {t(($) => $.callflow.select_hint)}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
