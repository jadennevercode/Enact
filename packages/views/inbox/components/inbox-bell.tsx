"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import { inboxListOptions, deduplicateInboxItems } from "@enact/core/inbox/queries";
import { useMarkInboxRead, useMarkAllInboxRead } from "@enact/core/inbox/mutations";
import type { InboxItem } from "@enact/core/types";
import { cn } from "@enact/ui/lib/utils";
import { Button } from "@enact/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@enact/ui/components/ui/popover";
import { useTimeAgo } from "./inbox-list-item";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";

const EMPTY_INBOX: InboxItem[] = [];

/** How many unread notifications the popover shows before deferring to Home. */
const PEEK_LIMIT = 6;

/**
 * The inbox, one glance wide.
 *
 * The full inbox is a tab of Home, which is the right home for triage but the
 * wrong shape for "did anything just happen". This answers that from wherever
 * the viewer is, and hands off to the tab as soon as the answer is more than
 * a few rows.
 */
export function InboxBell() {
  const { t } = useT("inbox");
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const navigation = useNavigation();
  const markRead = useMarkInboxRead();
  const markAllRead = useMarkAllInboxRead();
  const timeAgo = useTimeAgo();

  const { data: items = EMPTY_INBOX } = useQuery({
    ...inboxListOptions(wsId),
    enabled: !!wsId,
  });
  const unread = useMemo(
    () => deduplicateInboxItems(items).filter((item) => !item.read),
    [items],
  );

  const open = (item: InboxItem) => {
    if (!item.read) markRead.mutate(item.id);
    navigation.push(
      item.issue_id ? p.issueDetail(item.issue_id) : p.homeTab("inbox"),
    );
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="enact-topbar-action relative size-8"
            aria-label={t(($) => $.bell.label, { count: unread.length })}
          >
            <Bell className="size-4" />
            {unread.length > 0 && (
              <span
                aria-hidden="true"
                className="enact-topbar-bell-dot absolute top-1 right-1 size-1.5 rounded-full"
              />
            )}
          </Button>
        }
      />
      <PopoverContent align="end" sideOffset={6} className="w-80 p-0">
        <header className="flex h-10 items-center gap-2 px-3">
          <span className="text-label font-medium">
            {t(($) => $.page.title)}
          </span>
          {unread.length > 0 && (
            <>
              <span className="text-muted-foreground text-caption tabular-nums">
                {unread.length}
              </span>
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                className="enact-topbar-bell-action text-muted-foreground ml-auto text-caption"
              >
                {t(($) => $.menu.mark_all_read)}
              </button>
            </>
          )}
        </header>

        {unread.length === 0 ? (
          <p className="text-muted-foreground px-3 pb-3 text-caption">
            {t(($) => $.bell.empty)}
          </p>
        ) : (
          <ul className="flex max-h-80 flex-col overflow-y-auto pb-1">
            {unread.slice(0, PEEK_LIMIT).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => open(item)}
                  className={cn(
                    "enact-topbar-bell-row flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left",
                  )}
                >
                  <span className="line-clamp-2 text-body">{item.title}</span>
                  <span className="text-muted-foreground text-caption">
                    {timeAgo(item.created_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <footer className="border-border border-t">
          <button
            type="button"
            onClick={() => navigation.push(p.homeTab("inbox"))}
            className="enact-topbar-bell-action flex h-9 w-full items-center justify-center text-caption"
          >
            {t(($) => $.bell.see_all)}
          </button>
        </footer>
      </PopoverContent>
    </Popover>
  );
}
