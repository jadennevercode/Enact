"use client";

import { useQuery } from "@tanstack/react-query";
import { codeGraphReportOptions, type CodeGraphBuild } from "@enact/core/codegraph";
import { RichContent } from "../../rich-content";
import { useT } from "../../i18n";

/**
 * The build's own report, rendered as written.
 *
 * The numbers in it (how many subsystems were shown, how many thin ones were
 * omitted) are the build's account of itself, so they are never recomputed
 * here — a second, disagreeing count would be worse than none.
 */
export function OverviewTab({
  wsId,
  resourceId,
  build,
}: {
  wsId: string;
  resourceId: string;
  build: CodeGraphBuild | null;
}) {
  const { t } = useT("codegraph");
  const { data, isPending, isError } = useQuery(codeGraphReportOptions(wsId, resourceId));
  const diff = build?.diff ?? null;

  return (
    <div className="flex flex-col gap-4">
      {diff ? (
        <section className="enact-surface-panel px-4 py-3">
          <h3 className="text-caption font-semibold text-muted-foreground">
            {t(($) => $.page.diff_title)}
          </h3>
          <p className="mt-1 text-body">
            {t(($) => $.page.diff_nodes, {
              added: diff.added_nodes,
              removed: diff.removed_nodes,
            })}
          </p>
          <p className="text-body">
            {t(($) => $.page.diff_edges, {
              added: diff.added_edges,
              removed: diff.removed_edges,
            })}
          </p>
        </section>
      ) : null}

      <section className="enact-surface-panel min-w-0 px-5 py-4">
        {isPending ? (
          <p className="text-body text-muted-foreground">{t(($) => $.page.loading)}</p>
        ) : isError ? (
          <p className="text-body text-muted-foreground">{t(($) => $.page.load_failed)}</p>
        ) : data?.report_md ? (
          <RichContent content={data.report_md} density="document" />
        ) : (
          <p className="text-body text-muted-foreground">
            {t(($) => $.overview.report_empty)}
          </p>
        )}
      </section>
    </div>
  );
}
