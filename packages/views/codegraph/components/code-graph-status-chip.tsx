"use client";

import { LoaderCircle, TriangleAlert, Waypoints } from "lucide-react";
import type { CodeGraphBuildStatus } from "@enact/core/codegraph";
import { Button } from "@enact/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@enact/ui/components/ui/tooltip";
import { cn } from "@enact/ui/lib/utils";
import { useT, useTimeAgo } from "../../i18n";

/**
 * The state a chip renders, resolved from the build row rather than read off
 * one field: `queued` is a property of the status (a rebuild can be queued
 * while the previous build is still `ready`), and an unknown state string from
 * a newer server must not render as a blank chip.
 */
export type CodeGraphChipState =
  | "ready"
  | "queued"
  | "building"
  | "failed"
  | "skipped"
  | "unknown";

export function codeGraphChipState(
  status: CodeGraphBuildStatus | undefined,
): CodeGraphChipState | null {
  if (!status?.enabled) return null;
  const state = status.build?.state;
  if (status.queued === true && state !== "building") return "queued";
  switch (state) {
    case "ready":
    case "queued":
    case "building":
    case "failed":
    case "skipped":
      return state;
    case undefined:
      return "queued";
    default:
      return "unknown";
  }
}

export function shortCommit(commit: string | null | undefined): string {
  return commit ? commit.slice(0, 7) : "";
}

/**
 * The repository row's code graph chip.
 *
 * Every non-ready state says why and what happens next, because this chip is
 * the only place the setting reports itself: a repository that silently shows
 * nothing reads as a broken feature rather than one still working.
 */
export function CodeGraphStatusChip({
  status,
  onOpen,
  onRetry,
  retrying = false,
  className,
}: {
  status: CodeGraphBuildStatus | undefined;
  onOpen?: () => void;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  const { t } = useT("codegraph");
  const timeAgo = useTimeAgo();
  const state = codeGraphChipState(status);
  if (!state) return null;

  const build = status?.build ?? null;
  const commit = shortCommit(build?.commit);
  const finished = build?.finished_at;
  const reason =
    build?.skipped_reason === "too_large"
      ? t(($) => $.status.reason_too_large)
      : build?.skipped_reason || build?.error || "";

  const label = t(($) => $.status[state]);
  const detail =
    state === "ready"
      ? commit
      : state === "skipped" || state === "failed"
        ? reason
        : "";

  const tone =
    state === "failed"
      ? "text-destructive"
      : state === "skipped" || state === "unknown"
        ? "text-muted-foreground"
        : state === "ready"
          ? "text-foreground"
          : "text-muted-foreground";

  const body = (
    <span className="flex min-w-0 items-center gap-1.5">
      {state === "building" || state === "queued" ? (
        <LoaderCircle className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />
      ) : state === "failed" ? (
        <TriangleAlert className="size-3 shrink-0" />
      ) : (
        <Waypoints className="size-3 shrink-0" />
      )}
      <span className="truncate">
        {t(($) => $.status.label)} {label}
        {detail ? ` · ${detail}` : ""}
      </span>
    </span>
  );

  const tooltip = [
    build?.commit ? `${build.commit}` : null,
    finished ? timeAgo(finished) : null,
    status?.stale === true ? t(($) => $.status.stale) : null,
    state === "failed" && build?.error ? build.error : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Ready is the only actionable state: the chip becomes the way into the
  // graph. The others are status text, so they stay inert rather than offering
  // a destination that would show an empty page.
  const chip =
    state === "ready" && onOpen ? (
      <button
        type="button"
        onClick={onOpen}
        // Underline on hover rather than a background swap: the chip sits in a
        // row that already lifts on hover, and two hover treatments stacked
        // read as two separate targets.
        className={cn(
          "max-w-[18rem] rounded-sm text-caption transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          tone,
          className,
        )}
        aria-label={t(($) => $.list.open)}
      >
        {body}
      </button>
    ) : (
      <span className={cn("max-w-[18rem] text-caption", tone, className)}>{body}</span>
    );

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger render={chip} />
          <TooltipContent side="top" className="whitespace-pre-line">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        chip
      )}
      {state === "failed" && onRetry ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-caption"
          disabled={retrying}
          onClick={onRetry}
        >
          {t(($) => $.status.retry)}
        </Button>
      ) : null}
    </span>
  );
}
