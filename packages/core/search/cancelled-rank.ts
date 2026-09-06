/**
 * Cancelled demotion for search results (ENA-5824).
 *
 * The search API already ranks cancelled work below live work, but the client
 * still renders the two as separate sections, and the split has to survive
 * truncation.
 *
 * The partition is *stable*: relative order inside each side is preserved, so
 * the server's ranking still decides everything except "live before
 * cancelled". Applying it before any truncation is what makes cancelled rows
 * give up their slot rather than merely their position.
 *
 * Direct hits are exempt, matching the server: an exact identifier, an exact
 * bare number, or an exact title means the user is targeting that one record
 * and demoting it would hide exactly what they asked for.
 */

import type { SearchIssueResult } from "../types/api";
import { issueBehavesAs } from "../issues/status-category";

/**
 * Mirrors the server's identifier pattern (parseQueryNumber in
 * server/internal/handler/issue.go): "ENA-123" or a bare "123".
 */
const IDENTIFIER_NUMBER_RE = /^[a-z]+-(\d+)$/i;

/** Extracts the issue number a query targets, or null when it targets none. */
export function parseSearchQueryNumber(query: string): number | null {
  const q = query.trim();
  const m = IDENTIFIER_NUMBER_RE.exec(q);
  if (m) {
    const n = Number.parseInt(m[1]!, 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  if (/^\d+$/.test(q)) {
    const n = Number.parseInt(q, 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

function isExactTitle(title: string | null | undefined, query: string): boolean {
  if (!title) return false;
  const q = query.trim();
  if (!q) return false;
  return title.trim().toLowerCase() === q.toLowerCase();
}

/**
 * A query targets this specific issue: exact identifier / bare number, or the
 * full title.
 *
 * Every field is optional so callers holding only part of a row can share the
 * one rule — the @mention picker, for instance, carries the identifier and the
 * title but no `number`, which is then derived from the identifier.
 *
 * Note: the server compares the title against an escapeLike'd parameter, so a
 * title containing `_` or `%` never counts as a direct hit there (a pre-existing
 * tier-1 escaping quirk, see buildSearchQuery). Client-side we compare the raw
 * strings, which can only ever *keep* such an issue in the live partition —
 * never demote something the server kept up — so the two stay compatible.
 */
export function isIssueDirectHit(
  issue: {
    title?: string | null;
    number?: number | null;
    identifier?: string | null;
  },
  query: string,
): boolean {
  const targetNumber = parseSearchQueryNumber(query);
  if (targetNumber !== null) {
    const issueNumber =
      issue.number ??
      (issue.identifier ? parseSearchQueryNumber(issue.identifier) : null);
    if (issueNumber === targetNumber) return true;
  }
  if (
    issue.identifier &&
    issue.identifier.trim().toLowerCase() === query.trim().toLowerCase()
  ) {
    return true;
  }
  return isExactTitle(issue.title, query);
}

export interface CancelledPartition<T> {
  /** Everything that is not demoted, in its original relative order. */
  live: T[];
  /** Demoted cancelled rows, in their original relative order. */
  cancelled: T[];
}

/**
 * Stable partition on an arbitrary predicate. Split out so the caller decides
 * what "cancelled and not exempt" means for its own row shape, while the
 * order-preserving guarantee lives in one place.
 */
export function partitionStable<T>(
  items: readonly T[],
  demote: (item: T) => boolean,
): CancelledPartition<T> {
  const live: T[] = [];
  const cancelled: T[] = [];
  for (const item of items) {
    if (demote(item)) cancelled.push(item);
    else live.push(item);
  }
  return { live, cancelled };
}

/**
 * Partitions a search result set for rendering.
 *
 * Render order must be: live issues → cancelled issues. Callers that truncate
 * must truncate the concatenation in that order, so the cancelled tail is what
 * gets dropped rather than merely reordered.
 */
export function partitionCancelledIssues(
  issues: readonly SearchIssueResult[],
  query: string,
): CancelledPartition<SearchIssueResult> {
  return partitionStable(
    issues,
    // By CATEGORY: a custom status in the cancelled category is cancelled
    // work and has to sink the same way. (ENA-6243)
    (issue) => issueBehavesAs(issue, "cancelled") && !isIssueDirectHit(issue, query),
  );
}
