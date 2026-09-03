"use client";

import { useQuery } from "@tanstack/react-query";
import { Telescope } from "lucide-react";
import { issueRetrospectiveOptions } from "@enact/core/lessons/queries";
import {
  useDismissRetrospective,
  useStartRetrospective,
} from "@enact/core/lessons/mutations";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import { Button } from "@enact/ui/components/ui/button";
import { isRetrospectiveActive, isRetrospectivePending } from "../lib/lesson-display";
import { AppLink } from "../../navigation";
import { useT } from "../../i18n";

/**
 * The question the product asks after work an agent helped with is finished.
 *
 * Renders nothing at all unless the server has already decided to ask — the
 * offer is created once per issue, server-side, under conditions this component
 * deliberately does not reimplement. A client that decided for itself when to
 * ask would ask again every time the page loaded.
 *
 * Both answers are one click and both are final for this issue. Declining is
 * the common answer and is presented as an ordinary choice rather than a
 * dismissal to be nagged out of.
 */
export function IssueRetrospectiveBar({ issueId }: { issueId: string }) {
  const { t } = useT("lessons");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { data: retrospective } = useQuery(issueRetrospectiveOptions(wsId, issueId));
  const start = useStartRetrospective();
  const dismiss = useDismissRetrospective();

  if (!retrospective) return null;
  // Declined, or nothing came of it. Neither is worth a row on the issue.
  if (retrospective.status === "dismissed" || retrospective.status === "failed") return null;

  if (isRetrospectivePending(retrospective)) {
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-3">
        <Telescope aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium">{t(($) => $.issue_bar.title)}</p>
          <p className="text-caption text-muted-foreground">{t(($) => $.issue_bar.description)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            size="sm"
            disabled={start.isPending}
            onClick={() => start.mutate({ id: retrospective.id })}
          >
            {t(($) => $.issue_bar.start)}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate({ id: retrospective.id })}
          >
            {t(($) => $.issue_bar.dismiss)}
          </Button>
        </div>
      </section>
    );
  }

  if (isRetrospectiveActive(retrospective)) {
    return (
      <section className="flex items-center gap-3 rounded-md border bg-card p-3">
        <Telescope aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-caption text-muted-foreground">
          {t(($) => $.issue_bar.running)}
        </p>
        {retrospective.issue_id ? (
          <AppLink
            href={paths.issueDetail(retrospective.issue_id)}
            className="shrink-0 text-caption underline-offset-2 hover:underline"
          >
            {t(($) => $.issue_bar.view)}
          </AppLink>
        ) : null}
      </section>
    );
  }

  return (
    <section className="flex items-center gap-3 rounded-md border bg-card p-3">
      <Telescope aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-caption text-muted-foreground">
        {t(($) => $.issue_bar.completed, { count: retrospective.lesson_count })}
      </p>
      <AppLink
        href={paths.lessons()}
        className="shrink-0 text-caption underline-offset-2 hover:underline"
      >
        {t(($) => $.issue_bar.view)}
      </AppLink>
    </section>
  );
}
