"use client";

import { ArrowUpCircle, Check, Circle } from "lucide-react";
import { Badge } from "@enact/ui/components/ui/badge";
import { cn } from "@enact/ui/lib/utils";
import { useT } from "../../i18n";

interface InstallStateBadgeProps {
  /** Whether this workspace already holds a copy of the thing. */
  installed: boolean;
  /**
   * Set when a newer version exists than the one this workspace took. An
   * update is a stronger statement than "installed" and replaces it.
   */
  updateToVersion?: string;
  className?: string;
}

/**
 * Whether this workspace holds the thing in front of the reader.
 *
 * Every item in the directory carries one, in all three states, because the
 * question a browsing reader actually asks is "do I already have this" — and a
 * badge that only appears when the answer is yes leaves them reading its
 * absence, which is not the same as reading an answer.
 *
 * The three states are told apart by more than colour: a filled check, an
 * outline circle, and an arrow, so the distinction survives a monochrome
 * screen and does not depend on a reader who can compare two greens.
 */
export function InstallStateBadge({
  installed,
  updateToVersion,
  className,
}: InstallStateBadgeProps) {
  const { t } = useT("marketplace");

  if (updateToVersion) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "gap-1 border-info/40 text-caption font-medium text-info",
          className,
        )}
      >
        <ArrowUpCircle className="size-3" aria-hidden="true" />
        {t(($) => $.update_available, { version: updateToVersion })}
      </Badge>
    );
  }

  if (installed) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "gap-1 border-success/40 text-caption font-medium text-success",
          className,
        )}
      >
        <Check className="size-3" aria-hidden="true" />
        {t(($) => $.installed)}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn("gap-1 text-caption text-muted-foreground", className)}
    >
      <Circle className="size-3" aria-hidden="true" />
      {t(($) => $.not_installed)}
    </Badge>
  );
}
