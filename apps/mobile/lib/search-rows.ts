/**
 * Row model for the workspace search screen's single FlatList.
 *
 * Extracted from app/(app)/[workspace]/search.tsx so the ordering rules — in
 * particular the cancelled demotion (ENA-5824) — are unit-testable without
 * mounting the screen.
 */
import type { Issue, SearchIssueResult } from "@enact/core/types";
import {
  isIssueDirectHit,
  partitionStable,
} from "@enact/core/search/cancelled-rank";
import { issueBehavesAs } from "@/lib/issue-status";

export type RowItem =
  | { kind: "header"; key: string; title: string }
  | { kind: "issue"; key: string; issue: SearchIssueResult; query: string }
  | { kind: "recent"; key: string; issue: Issue };

/**
 * Builds the flat row list. Empty query → the Recent section; otherwise the
 * search results in cancelled-partition order:
 *
 *   Issues (live) → Cancelled
 *
 * Search returns one ranked issue list, and cancelled work sinks below live
 * work into a trailing section. Direct hits (exact identifier, number, or
 * title) stay in the live section. Demotion is by status CATEGORY so a custom
 * cancelled-category status sinks the same way (ENA-6243) — same rule web
 * applies via `partitionAggregatedSearchResults`.
 */
export function buildSearchRows({
  query,
  issues,
  recentIssues,
}: {
  query: string;
  issues: SearchIssueResult[];
  recentIssues: Issue[];
}): RowItem[] {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    if (recentIssues.length === 0) return [];
    return [
      { kind: "header", key: "h-recent", title: "Recent" },
      ...recentIssues.map<RowItem>((issue) => ({
        kind: "recent",
        key: `r-${issue.id}`,
        issue,
      })),
    ];
  }

  const parts = partitionStable(
    issues,
    (issue) =>
      issueBehavesAs(issue, "cancelled") &&
      !isIssueDirectHit(issue, trimmedQuery),
  );

  const rows: RowItem[] = [];
  if (parts.live.length > 0) {
    rows.push({ kind: "header", key: "h-issues", title: "Issues" });
    for (const issue of parts.live) {
      rows.push({
        kind: "issue",
        key: `i-${issue.id}`,
        issue,
        query: trimmedQuery,
      });
    }
  }
  if (parts.cancelled.length > 0) {
    rows.push({ kind: "header", key: "h-cancelled", title: "Cancelled" });
    for (const issue of parts.cancelled) {
      rows.push({
        kind: "issue",
        key: `i-${issue.id}`,
        issue,
        query: trimmedQuery,
      });
    }
  }
  return rows;
}
