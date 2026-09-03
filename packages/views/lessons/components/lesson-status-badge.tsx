"use client";

import { cn } from "@enact/ui/lib/utils";
import {
  STATUS_TONE_CLASS,
  lessonStatusTone,
  retrospectiveStatusTone,
} from "../lib/lesson-display";
import { lessonStatusLabel, retrospectiveStatusLabel } from "./labels";
import { useT } from "../../i18n";

export function LessonStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const { t } = useT("lessons");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-caption font-medium",
        STATUS_TONE_CLASS[lessonStatusTone(status)],
        className,
      )}
    >
      {lessonStatusLabel(t, status)}
    </span>
  );
}

export function RetrospectiveStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const { t } = useT("lessons");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-caption font-medium",
        STATUS_TONE_CLASS[retrospectiveStatusTone(status)],
        className,
      )}
    >
      {retrospectiveStatusLabel(t, status)}
    </span>
  );
}
