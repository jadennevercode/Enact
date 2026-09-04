"use client";

import { issueStatusCategory } from "@enact/core/issues";
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { selectRecentContexts, useRecentContextStore, type RecentContextEntry } from "@enact/core/chat";
import { issueDetailOptions } from "@enact/core/issues/queries";
import type { Issue } from "@enact/core/types";
import type { MentionItem } from "../../editor/extensions/mention-suggestion";
import { useNavigation } from "../../navigation";

const MAX_RECENT_MENTION_ITEMS = 8;

function mentionKey(item: Pick<MentionItem, "type" | "id">): string {
  return `${item.type}:${item.id}`;
}

function issueToMentionItem(
  issue: Pick<Issue, "id" | "identifier" | "title" | "status"> & Partial<Pick<Issue, "status_category">>,
  group: "current" | "recent",
): MentionItem {
  return {
    id: issue.id,
    label: issue.identifier,
    type: "issue",
    description: issue.title,
    status: issue.status,
    // Carried, not dropped: the list picks its glyph and its dimming from the
    // category, so losing it here made a custom done status in Current/Recent
    // render as an active Todo. (ENA-6243)
    statusCategory: issueStatusCategory(issue) ?? undefined,
    group,
  };
}

function recentEntryToMentionItem(entry: RecentContextEntry): MentionItem {
  return {
    id: entry.id,
    label: entry.label ?? entry.id,
    type: entry.type,
    description: entry.subtitle,
    status: entry.status,
    group: "recent",
  };
}

function hydrateRecentEntry(entry: RecentContextEntry, data: Issue | undefined): MentionItem {
  if (!data) return recentEntryToMentionItem(entry);
  return issueToMentionItem(data, "recent");
}

export function parseCurrentContextRoute(pathname: string, searchParams: URLSearchParams): { type: "issue"; id: string } | null {
  const issueMatch = pathname.match(/^\/[^/]+\/issues\/([^/]+)$/);
  if (issueMatch?.[1]) return { type: "issue", id: decodeURIComponent(issueMatch[1]) };

  const inboxMatch = pathname.match(/^\/[^/]+\/inbox$/);
  const inboxIssueId = searchParams.get("issue");
  if (inboxMatch && inboxIssueId) return { type: "issue", id: inboxIssueId };

  return null;
}

export function useChatContextItems(wsId: string): MentionItem[] {
  const { pathname, searchParams } = useNavigation();
  const currentRoute = parseCurrentContextRoute(pathname, searchParams);
  const recentEntries = useRecentContextStore(selectRecentContexts(wsId));
  const visibleRecentEntries = useMemo(
    () => recentEntries.slice(0, MAX_RECENT_MENTION_ITEMS),
    [recentEntries],
  );

  const { data: currentIssue } = useQuery({
    ...issueDetailOptions(wsId, currentRoute?.id ?? ""),
    enabled: !!currentRoute,
  });

  const recentQueries = useQueries({
    queries: visibleRecentEntries.map((entry) => ({
      ...issueDetailOptions(wsId, entry.id),
      staleTime: 30_000,
    })),
  });

  return useMemo(() => {
    const currentItems: MentionItem[] = [];
    if (currentIssue) currentItems.push(issueToMentionItem(currentIssue, "current"));

    const hidden = new Set(currentItems.map(mentionKey));
    const recentItems = visibleRecentEntries
      .map((entry, index) => hydrateRecentEntry(entry, recentQueries[index]?.data as Issue | undefined))
      .filter((item) => !hidden.has(mentionKey(item)))
      .slice(0, MAX_RECENT_MENTION_ITEMS);

    return [...currentItems, ...recentItems];
  }, [currentIssue, recentQueries, visibleRecentEntries]);
}
