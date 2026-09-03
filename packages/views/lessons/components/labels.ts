import type { TFunction } from "i18next";

// Enum labels resolved by an explicit switch rather than a computed key.
//
// Two reasons, and only the second is about types. A server-driven enum needs a
// `default` branch — an installed desktop build talks to newer backends, and a
// status this build has never heard of must render as something rather than as
// a missing translation. And the repo's `t` is the selector API, which cannot
// take a key built at runtime: that is the tradeoff that makes every other key
// in the app checked at compile time.

type LessonsT = TFunction<"lessons">;

export function lessonStatusLabel(t: LessonsT, status: string): string {
  switch (status) {
    case "proposed":
      return t(($) => $.lesson_status.proposed);
    case "in_review":
      return t(($) => $.lesson_status.in_review);
    case "published":
      return t(($) => $.lesson_status.published);
    case "rejected":
      return t(($) => $.lesson_status.rejected);
    case "deprecated":
      return t(($) => $.lesson_status.deprecated);
    default:
      return status;
  }
}

export function retrospectiveStatusLabel(t: LessonsT, status: string): string {
  switch (status) {
    case "suggested":
      return t(($) => $.retrospective_status.suggested);
    case "dismissed":
      return t(($) => $.retrospective_status.dismissed);
    case "queued":
      return t(($) => $.retrospective_status.queued);
    case "running":
      return t(($) => $.retrospective_status.running);
    case "completed":
      return t(($) => $.retrospective_status.completed);
    case "failed":
      return t(($) => $.retrospective_status.failed);
    default:
      return status;
  }
}

export function retrospectiveScopeLabel(t: LessonsT, scope: string): string {
  switch (scope) {
    case "issue":
      return t(($) => $.retrospectives.scope.issue);
    case "project":
      return t(($) => $.retrospectives.scope.project);
    case "workspace":
      return t(($) => $.retrospectives.scope.workspace);
    default:
      return scope;
  }
}

export function retrospectiveTriggerLabel(t: LessonsT, trigger: string): string {
  switch (trigger) {
    case "suggestion":
      return t(($) => $.retrospectives.trigger.suggestion);
    case "manual":
      return t(($) => $.retrospectives.trigger.manual);
    case "schedule":
      return t(($) => $.retrospectives.trigger.schedule);
    default:
      return trigger;
  }
}

export function lessonEventLabel(t: LessonsT, kind: string): string {
  switch (kind) {
    case "proposed":
      return t(($) => $.event.proposed);
    case "submitted":
      return t(($) => $.event.submitted);
    case "approved":
      return t(($) => $.event.approved);
    case "rejected":
      return t(($) => $.event.rejected);
    case "published":
      return t(($) => $.event.published);
    case "deprecated":
      return t(($) => $.event.deprecated);
    case "amended":
      return t(($) => $.event.amended);
    case "reopened":
      return t(($) => $.event.reopened);
    default:
      return kind;
  }
}

export function skillVersionSourceLabel(t: LessonsT, source: string): string {
  switch (source) {
    case "backfill":
      return t(($) => $.versions.source.backfill);
    case "manual":
      return t(($) => $.versions.source.manual);
    case "import":
      return t(($) => $.versions.source.import);
    case "refresh":
      return t(($) => $.versions.source.refresh);
    case "lesson":
      return t(($) => $.versions.source.lesson);
    case "rollback":
      return t(($) => $.versions.source.rollback);
    case "seed":
      return t(($) => $.versions.source.seed);
    default:
      return source;
  }
}

export function lessonFilterLabel(t: LessonsT, filter: string): string {
  switch (filter) {
    case "all":
      return t(($) => $.filters.all);
    case "proposed":
      return t(($) => $.filters.proposed);
    case "published":
      return t(($) => $.filters.published);
    case "rejected":
      return t(($) => $.filters.rejected);
    case "deprecated":
      return t(($) => $.filters.deprecated);
    default:
      return filter;
  }
}
