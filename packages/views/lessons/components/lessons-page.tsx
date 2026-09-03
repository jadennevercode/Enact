"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, Play, Telescope } from "lucide-react";
import {
  lessonListOptions,
  retrospectiveListOptions,
} from "@enact/core/lessons/queries";
import {
  useCreateRetrospective,
  useDismissRetrospective,
  useStartRetrospective,
} from "@enact/core/lessons/mutations";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import type { Lesson, LessonStatus, Retrospective } from "@enact/core/types";
import { Button } from "@enact/ui/components/ui/button";
import { Skeleton } from "@enact/ui/components/ui/skeleton";
import { cn } from "@enact/ui/lib/utils";
import { isRetrospectivePending } from "../lib/lesson-display";
import { LessonStatusBadge, RetrospectiveStatusBadge } from "./lesson-status-badge";
import {
  lessonFilterLabel,
  retrospectiveScopeLabel,
  retrospectiveTriggerLabel,
} from "./labels";
import { AppLink } from "../../navigation";
import {
  CollectionPageHeader,
  CollectionPageHeaderAction,
  CollectionPageState,
} from "../../layout/collection-page";
import { useT, useTimeAgo } from "../../i18n";

type Tab = "lessons" | "retrospectives";

const LESSON_FILTERS: (LessonStatus | "all")[] = [
  "all",
  "proposed",
  "published",
  "rejected",
  "deprecated",
];

/**
 * Two lists, one page: the proposals waiting on someone, and the scans that
 * produce them.
 *
 * They are tabs rather than two routes because they answer one question in two
 * halves — "is anything waiting on me" and "is anything looking" — and a
 * workspace where the second is empty explains why the first is too.
 */
export function LessonsPage() {
  const { t } = useT("lessons");
  const [tab, setTab] = useState<Tab>("lessons");
  const wsId = useWorkspaceId();
  const createRetrospective = useCreateRetrospective();

  return (
    <div className="flex h-full flex-col">
      <CollectionPageHeader
        icon={GraduationCap}
        title={t(($) => $.page.title)}
        description={t(($) => $.page.tagline)}
        actions={
          <CollectionPageHeaderAction
            icon={Play}
            label={t(($) => $.page.run_retrospective)}
            disabled={createRetrospective.isPending}
            onClick={() => createRetrospective.mutate({ scope: "workspace" })}
          />
        }
      />

      <div className="flex shrink-0 gap-1 border-b px-4">
        {(["lessons", "retrospectives"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-current={tab === value ? "page" : undefined}
            className={cn(
              // The active tab is marked by weight and text colour, which hover
              // does not touch, so hovering a selected tab cannot make it look
              // less selected than an unselected one.
              "-mb-px border-b-2 px-2 py-2 text-caption transition-colors",
              tab === value
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {value === "lessons" ? t(($) => $.page.tabs.lessons) : t(($) => $.page.tabs.retrospectives)}
          </button>
        ))}
      </div>

      {createRetrospective.isError ? (
        <p role="alert" className="border-b bg-destructive/10 px-4 py-2 text-caption text-destructive">
          {createRetrospective.error instanceof Error
            ? createRetrospective.error.message
            : t(($) => $.page.retrospective_failed)}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "lessons" ? <LessonList wsId={wsId} /> : <RetrospectiveList wsId={wsId} />}
      </div>
    </div>
  );
}

function LessonList({ wsId }: { wsId: string }) {
  const { t } = useT("lessons");
  const [filter, setFilter] = useState<LessonStatus | "all">("all");
  const { data, isLoading } = useQuery(
    lessonListOptions(wsId, filter === "all" ? {} : { status: filter }),
  );

  if (isLoading) return <ListSkeleton />;

  const lessons = data?.lessons ?? [];
  const counts = data?.counts ?? {};

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap gap-1 px-4 py-3">
        {LESSON_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-caption transition-colors",
              filter === value
                ? "border-foreground bg-foreground font-medium text-background"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {lessonFilterLabel(t, value)}
            {value !== "all" && counts[value] ? (
              <span className="ml-1 tabular-nums opacity-70">{counts[value]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {lessons.length === 0 ? (
        <CollectionPageState
          icon={GraduationCap}
          title={t(($) => $.page.empty.title)}
          description={t(($) => $.page.empty.description)}
          tone="muted"
        />
      ) : (
        <ul className="flex flex-col">
          {lessons.map((lesson) => (
            <LessonRow key={lesson.id} lesson={lesson} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LessonRow({ lesson }: { lesson: Lesson }) {
  const { t } = useT("lessons");
  const timeAgo = useTimeAgo();
  const paths = useWorkspacePaths();
  const stale =
    (lesson.status === "proposed" || lesson.status === "in_review") &&
    !lesson.base_version_current;

  return (
    <li className="border-b last:border-b-0">
      <AppLink
        href={paths.lessonDetail(lesson.id)}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent"
      >
        <span className="w-14 shrink-0 font-mono text-caption text-muted-foreground">
          {lesson.key}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body">{lesson.title}</span>
          <span className="block truncate text-caption text-muted-foreground">
            {lesson.target_skill_name || lesson.proposed_skill_name || "—"}
            {" · "}
            {lesson.change_summary}
          </span>
        </span>
        {stale ? (
          <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-caption text-amber-700 dark:text-amber-300">
            {t(($) => $.row.stale)}
          </span>
        ) : null}
        <LessonStatusBadge status={lesson.status} />
        <span className="hidden w-20 shrink-0 text-right text-caption text-muted-foreground sm:block">
          {timeAgo(lesson.created_at)}
        </span>
      </AppLink>
    </li>
  );
}

function RetrospectiveList({ wsId }: { wsId: string }) {
  const { t } = useT("lessons");
  const { data: retrospectives, isLoading } = useQuery(retrospectiveListOptions(wsId));

  if (isLoading) return <ListSkeleton />;

  if (!retrospectives || retrospectives.length === 0) {
    return (
      <CollectionPageState
        icon={Telescope}
        title={t(($) => $.retrospectives.empty.title)}
        description={t(($) => $.retrospectives.empty.description)}
        tone="muted"
      />
    );
  }

  return (
    <ul className="flex flex-col">
      {retrospectives.map((retro) => (
        <RetrospectiveRow key={retro.id} retrospective={retro} />
      ))}
    </ul>
  );
}

function RetrospectiveRow({ retrospective }: { retrospective: Retrospective }) {
  const { t } = useT("lessons");
  const timeAgo = useTimeAgo();
  const paths = useWorkspacePaths();
  const start = useStartRetrospective();
  const dismiss = useDismissRetrospective();
  const pending = isRetrospectivePending(retrospective);

  return (
    <li className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">
          {retrospectiveScopeLabel(t, retrospective.scope)}
        </span>
        <span className="block truncate text-caption text-muted-foreground">
          {retrospectiveTriggerLabel(t, retrospective.trigger)}
          {" · "}
          {t(($) => $.retrospectives.lesson_count, { count: retrospective.lesson_count })}
          {retrospective.failure_reason ? ` · ${retrospective.failure_reason}` : null}
        </span>
      </span>

      {retrospective.issue_id ? (
        <AppLink
          href={paths.issueDetail(retrospective.issue_id)}
          className="shrink-0 text-caption text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t(($) => $.retrospectives.open_issue)}
        </AppLink>
      ) : null}

      {pending ? (
        <span className="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={start.isPending}
            onClick={() => start.mutate({ id: retrospective.id })}
          >
            {t(($) => $.retrospectives.start)}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate({ id: retrospective.id })}
          >
            {t(($) => $.retrospectives.dismiss)}
          </Button>
        </span>
      ) : (
        <RetrospectiveStatusBadge status={retrospective.status} />
      )}

      <span className="hidden w-20 shrink-0 text-right text-caption text-muted-foreground sm:block">
        {timeAgo(retrospective.created_at)}
      </span>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
