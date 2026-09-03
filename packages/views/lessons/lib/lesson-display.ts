import type { Lesson, LessonStatus, Retrospective, RetrospectiveStatus } from "@enact/core/types";

// Presentation decisions that are really product decisions, kept out of the
// components so they can be asserted directly. Each switch carries a `default`
// branch: a backend that grows a status must degrade to something neutral in an
// installed desktop build rather than render nothing.

export type StatusTone = "pending" | "positive" | "negative" | "muted";

export function lessonStatusTone(status: LessonStatus | string): StatusTone {
  switch (status) {
    case "proposed":
    case "in_review":
      return "pending";
    case "published":
      return "positive";
    case "rejected":
      return "negative";
    case "deprecated":
      return "muted";
    default:
      return "muted";
  }
}

export function retrospectiveStatusTone(status: RetrospectiveStatus | string): StatusTone {
  switch (status) {
    case "queued":
    case "running":
      return "pending";
    case "completed":
      return "positive";
    case "failed":
      return "negative";
    case "suggested":
      return "pending";
    case "dismissed":
      return "muted";
    default:
      return "muted";
  }
}

export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  positive: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  negative: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

/** A lesson still waiting on someone. */
export function isLessonOpen(lesson: Pick<Lesson, "status">): boolean {
  return lesson.status === "proposed" || lesson.status === "in_review";
}

/**
 * Whether a decision can be offered at all.
 *
 * A stale proposal is refused by the server, so offering the button would be a
 * button that always fails. `base_version_current` is explicitly compared to
 * `false` rather than read as truthy: a backend that stops sending it must not
 * turn every proposal unapprovable, nor every one approvable.
 */
export function canDecideLesson(lesson: Pick<Lesson, "status" | "base_version_current">): boolean {
  return isLessonOpen(lesson) && lesson.base_version_current === true;
}

/** A retrospective the user has been asked about and has not answered. */
export function isRetrospectivePending(retro: Pick<Retrospective, "status">): boolean {
  return retro.status === "suggested";
}

/** A retrospective that is doing something right now. */
export function isRetrospectiveActive(retro: Pick<Retrospective, "status">): boolean {
  return retro.status === "queued" || retro.status === "running";
}
