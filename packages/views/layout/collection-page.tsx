"use client";

import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@enact/ui/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@enact/ui/components/ui/empty";
import { cn } from "@enact/ui/lib/utils";
import { PageHeader } from "./page-header";

interface CollectionPageHeaderProps {
  icon: LucideIcon;
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  learnMore?: {
    href: string;
    label: ReactNode;
  };
  actions?: ReactNode;
  className?: string;
}

/**
 * Shared dashboard collection header: entity icon, title, optional count and
 * supporting copy on the left; page-level actions on the right.
 */
export function CollectionPageHeader({
  icon: Icon,
  title,
  count,
  description,
  learnMore,
  actions,
  className,
}: CollectionPageHeaderProps) {
  return (
    <PageHeader className={className}>
      {/* Title block: icon and title on one line, the supporting sentence
          under them. The description used to hang off the end of the title
          and truncate; a page's one sentence about itself deserves a line. */}
      <div className="enact-collection-heading flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Icon
            aria-hidden="true"
            className="enact-collection-icon size-4 shrink-0"
          />
          <h1 className="enact-collection-title truncate">{title}</h1>
          {typeof count === "number" && count > 0 ? (
            <span className="enact-collection-count shrink-0">{count}</span>
          ) : null}
        </div>
        {description ? (
          <p className="enact-collection-description hidden min-w-0 truncate pl-6 md:block">
            {description}
            {learnMore ? (
              <>
                {" "}
                <a
                  href={learnMore.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="enact-collection-learn-more underline"
                >
                  {learnMore.label}
                </a>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="enact-collection-actions flex shrink-0 items-center justify-end gap-2">
          {actions}
        </div>
      ) : null}
    </PageHeader>
  );
}

interface CollectionPageHeaderActionProps
  extends Omit<ComponentProps<typeof Button>, "children"> {
  icon: LucideIcon;
  label: string;
}

/** Responsive collection action: icon-only below md, labelled above md. */
export function CollectionPageHeaderAction({
  icon: Icon,
  label,
  className,
  type = "button",
  size = "sm",
  variant = "outline",
  ...props
}: CollectionPageHeaderActionProps) {
  const accessibleLabel = props["aria-label"] ?? label;

  return (
    <Button
      type={type}
      size={size}
      variant={variant}
      className={cn(
        "enact-collection-action h-8 w-8 gap-1 px-0 md:w-auto md:px-2.5",
        className,
      )}
      aria-label={accessibleLabel}
      {...props}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="hidden md:inline">{label}</span>
    </Button>
  );
}

type PageStateTone = "muted" | "destructive" | "warning";

interface CollectionPageStateProps {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: PageStateTone;
  role?: "alert" | "status";
  className?: string;
}

/** Shared centered state for collection empty, error and not-found views. */
export function CollectionPageState({
  icon: Icon,
  title,
  description,
  actions,
  tone = "muted",
  role,
  className,
}: CollectionPageStateProps) {
  return (
    <Empty
      role={role}
      className={cn(
        "enact-collection-state rounded-none border-0 px-6 py-16",
        className,
      )}
    >
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          data-tone={tone}
          className="enact-collection-state-media size-12 rounded-full [&_svg]:size-6"
        >
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription className="enact-collection-state-description max-w-md">
            {description}
          </EmptyDescription>
        ) : null}
      </EmptyHeader>
      {actions ? (
        <EmptyContent className="enact-collection-state-actions mt-1 flex-row justify-center">
          {actions}
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
