"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  History,
  Undo2,
  X,
} from "lucide-react";
import { lessonDetailOptions } from "@enact/core/lessons/queries";
import {
  useApproveLesson,
  useRejectLesson,
  useWithdrawLesson,
} from "@enact/core/lessons/mutations";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import { Button } from "@enact/ui/components/ui/button";
import { Skeleton } from "@enact/ui/components/ui/skeleton";
import { Textarea } from "@enact/ui/components/ui/textarea";
import { canDecideLesson, isLessonOpen } from "../lib/lesson-display";
import { LessonStatusBadge } from "./lesson-status-badge";
import { LessonDiff } from "./lesson-diff";
import { lessonEventLabel } from "./labels";
import { AppLink } from "../../navigation";
import { CollectionPageState } from "../../layout/collection-page";
import { useT, useTimeAgo } from "../../i18n";

/**
 * The review surface.
 *
 * Ordered by what a reviewer needs before they can answer, not by what the row
 * happens to contain: whether this proposal is still decidable, what it claims
 * and where it says it stops, who it would affect, and only then the diff. A
 * reviewer who scrolls past the boundary to reach the diff has already skipped
 * the part that decides the answer.
 */
export function LessonDetailPage({ lessonId }: { lessonId: string }) {
  const { t } = useT("lessons");
  const timeAgo = useTimeAgo();
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { data: lesson, isLoading, isError } = useQuery(lessonDetailOptions(wsId, lessonId));

  const [reason, setReason] = useState("");
  const approve = useApproveLesson();
  const reject = useRejectLesson();
  const withdraw = useWithdrawLesson();
  const busy = approve.isPending || reject.isPending || withdraw.isPending;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !lesson || !lesson.id) {
    return (
      <CollectionPageState
        icon={AlertTriangle}
        title={t(($) => $.detail.not_found.title)}
        description={t(($) => $.detail.not_found.description)}
        tone="muted"
      />
    );
  }

  const decidable = canDecideLesson(lesson);
  const open = isLessonOpen(lesson);
  const stale = open && !lesson.base_version_current;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-3">
        <AppLink
          href={paths.lessons()}
          className="inline-flex w-fit items-center gap-1 text-caption text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {t(($) => $.detail.back)}
        </AppLink>

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-caption text-muted-foreground">{lesson.key}</span>
          <LessonStatusBadge status={lesson.status} />
          {lesson.new_asset ? (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-caption text-muted-foreground">
              {t(($) => $.detail.new_skill)}
            </span>
          ) : null}
        </div>

        <h1 className="text-title font-semibold">{lesson.title}</h1>

        <p className="text-caption text-muted-foreground">
          {t(($) => $.detail.proposed_by, {
            who:
              lesson.proposed_by_type === "agent"
                ? t(($) => $.detail.an_agent)
                : t(($) => $.detail.a_person),
            when: timeAgo(lesson.created_at),
          })}
          {lesson.target_skill_name ? (
            <>
              {" · "}
              <AppLink
                href={paths.skillDetail(lesson.target_skill_id ?? "")}
                className="underline-offset-2 hover:underline"
              >
                {lesson.target_skill_name}
              </AppLink>
            </>
          ) : null}
        </p>
      </header>

      {stale ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-caption"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">{t(($) => $.detail.stale.title)}</p>
            <p className="text-muted-foreground">{t(($) => $.detail.stale.description)}</p>
          </div>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <Field label={t(($) => $.detail.observation)} value={lesson.observation} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t(($) => $.detail.applies_when)} value={lesson.applies_when} />
          <Field label={t(($) => $.detail.counterexample)} value={lesson.counterexample} />
        </div>
        <Field label={t(($) => $.detail.change_summary)} value={lesson.change_summary} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-caption font-medium text-muted-foreground">
          {t(($) => $.detail.affected.title)}
        </h2>
        {lesson.affected_agents.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t(($) => $.detail.affected.none)}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {lesson.affected_agents.map((agent) => (
              <li
                key={agent.id}
                className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-caption"
              >
                <Bot aria-hidden="true" className="size-3 text-muted-foreground" />
                {agent.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-caption font-medium text-muted-foreground">{t(($) => $.detail.diff)}</h2>
        <LessonDiff base={lesson.base} proposed={lesson.proposed} />
      </section>

      {lesson.events.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
            <History aria-hidden="true" className="size-3.5" />
            {t(($) => $.detail.history)}
          </h2>
          <ul className="flex flex-col gap-1.5 border-l pl-3">
            {lesson.events.map((event) => (
              <li key={event.id} className="text-caption">
                <span className="font-medium">
                  {lessonEventLabel(t, event.kind)}
                </span>
                <span className="text-muted-foreground"> · {timeAgo(event.created_at)}</span>
                {event.note ? (
                  <p className="text-muted-foreground">{event.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {open ? (
        <section className="flex flex-col gap-2 rounded-md border bg-card p-3">
          <label htmlFor="lesson-decision-reason" className="text-caption font-medium">
            {t(($) => $.detail.decision.reason_label)}
          </label>
          <Textarea
            id="lesson-decision-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t(($) => $.detail.decision.reason_placeholder)}
            rows={2}
          />
          <p className="text-caption text-muted-foreground">
            {t(($) => $.detail.decision.warning)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!decidable || busy}
              onClick={() => approve.mutate({ id: lesson.id, reason })}
            >
              <Check aria-hidden="true" className="size-3.5" />
              {t(($) => $.detail.decision.approve)}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!open || busy}
              onClick={() => reject.mutate({ id: lesson.id, reason })}
            >
              <X aria-hidden="true" className="size-3.5" />
              {t(($) => $.detail.decision.reject)}
            </Button>
          </div>
        </section>
      ) : null}

      {lesson.status === "published" ? (
        <section className="flex flex-col gap-2 rounded-md border bg-card p-3">
          <p className="text-caption text-muted-foreground">{t(($) => $.detail.withdraw.description)}</p>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t(($) => $.detail.withdraw.reason_placeholder)}
            rows={2}
            aria-label={t(($) => $.detail.withdraw.reason_placeholder)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || reason.trim().length === 0}
            onClick={() => withdraw.mutate({ id: lesson.id, reason })}
            className="w-fit"
          >
            <Undo2 aria-hidden="true" className="size-3.5" />
            {t(($) => $.detail.withdraw.action)}
          </Button>
        </section>
      ) : null}

      {lesson.decision_reason && !open ? (
        <Field label={t(($) => $.detail.decision_reason)} value={lesson.decision_reason} />
      ) : null}
      {lesson.deprecation_reason ? (
        <Field label={t(($) => $.detail.deprecation_reason)} value={lesson.deprecation_reason} />
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-caption font-medium text-muted-foreground">{label}</h2>
      <p className="whitespace-pre-wrap text-body">{value}</p>
    </div>
  );
}
