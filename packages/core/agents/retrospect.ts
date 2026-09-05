import type { Issue } from "../types";

/**
 * Mirrors `service.RetrospectSystemKey` on the server. Like Mika's key, this —
 * and never the display name — identifies the agent, because the name is
 * owner-editable and a rename would otherwise make the workspace look as
 * though it had never configured a retrospector.
 */
export const RETROSPECT_SYSTEM_KEY = "retrospect";

/**
 * `Issue.origin_type` of a review the retrospect loop filed on its own.
 * Mirrors the server's `origin_type = 'retrospect'`.
 */
export const RETROSPECT_ORIGIN_TYPE = "retrospect";

/**
 * Whether this issue was filed by the retrospect loop rather than written by
 * someone.
 *
 * `origin_type` is absent on endpoints that do not project the column, so a
 * false here means "not known to be a retrospect". That is enough to decide
 * whether to show a marker, and is deliberately not a basis for hiding
 * anything.
 */
export function isRetrospectIssue(issue: Pick<Issue, "origin_type">): boolean {
  return issue.origin_type === RETROSPECT_ORIGIN_TYPE;
}
