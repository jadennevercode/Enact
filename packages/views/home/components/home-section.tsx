"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@enact/ui/lib/utils";
import { AppLink } from "../../navigation";
import { useT } from "../../i18n";

/** How many rows a block shows before it defers to its full page. */
export const HOME_SECTION_LIMIT = 5;

interface HomeSectionProps {
  /** Stable slug. The heading id is built from it, so it must not be the
   *  localized title — that contains spaces, and a space-separated
   *  `aria-labelledby` is read as several ids. */
  id: string;
  icon: LucideIcon;
  title: string;
  /** Total matches, which is often larger than the rows rendered. */
  count?: number;
  /** Where the full list lives, and what to call it. */
  seeAll?: { href: string; label: string };
  /** Shown in place of rows when there is nothing to do. */
  emptyText: string;
  pending?: boolean;
  children?: React.ReactNode;
  isEmpty: boolean;
  className?: string;
}

/**
 * One block of the workspace home.
 *
 * Every block is a short answer plus a way to the long one: a home that tries
 * to be a second copy of each list ends up maintained as one. The count is on
 * the heading rather than the rows so a block reads at a glance even when its
 * five rows are the tail of fifty.
 */
export function HomeSection({
  id,
  icon: Icon,
  title,
  count,
  seeAll,
  emptyText,
  pending = false,
  isEmpty,
  children,
  className,
}: HomeSectionProps) {
  const { t } = useT("home");
  return (
    <section
      aria-labelledby={`home-${id}`}
      className={cn(
        "enact-home-section flex min-w-0 flex-col rounded-lg border border-border bg-card",
        className,
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <h2 id={`home-${id}`} className="truncate text-label font-medium">
          {title}
        </h2>
        {count !== undefined && count > 0 && (
          <span className="text-muted-foreground shrink-0 text-caption tabular-nums">
            {count}
          </span>
        )}
        {seeAll && !isEmpty && (
          <AppLink
            href={seeAll.href}
            newTabTitle={seeAll.label}
            className="text-muted-foreground hover:text-foreground ml-auto shrink-0 text-caption"
          >
            {t(($) => $.see_all)}
          </AppLink>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col pb-2">
        {pending ? (
          <SectionSkeleton />
        ) : isEmpty ? (
          <p className="text-muted-foreground px-3 pb-2 text-caption">
            {emptyText}
          </p>
        ) : (
          <ul className="flex flex-col">{children}</ul>
        )}
      </div>
    </section>
  );
}

/**
 * One row. A link when it has a destination, a plain row when it does not —
 * a row that looks clickable and is not is worse than a row that looks inert.
 */
export function HomeRow({
  href,
  leading,
  title,
  meta,
  newTabTitle,
}: {
  href?: string;
  leading?: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
  newTabTitle?: string;
}) {
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1 truncate text-body">{title}</span>
      {meta !== undefined && (
        <span className="text-muted-foreground shrink-0 text-caption">
          {meta}
        </span>
      )}
    </>
  );
  return (
    <li>
      {href ? (
        <AppLink
          href={href}
          newTabTitle={newTabTitle ?? title}
          className="enact-home-row flex items-center gap-2 px-3 py-1.5"
        >
          {body}
        </AppLink>
      ) : (
        <div className="flex items-center gap-2 px-3 py-1.5">{body}</div>
      )}
    </li>
  );
}

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 px-3 pt-1" aria-hidden>
      {/* Ragged widths so the placeholder reads as text rather than as bars. */}
      {["w-2/3", "w-1/2", "w-5/12"].map((width) => (
        <div
          key={width}
          className={cn("enact-sidebar-pin-skeleton-part h-3", width)}
        />
      ))}
    </div>
  );
}
