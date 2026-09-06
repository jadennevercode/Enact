// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { Issue, SearchIssueResult } from "@enact/core/types";
import { buildSearchRows } from "./search-rows";

function issue(
  partial: Partial<SearchIssueResult> & { id: string },
): SearchIssueResult {
  return {
    id: partial.id,
    number: partial.number ?? 1,
    identifier: partial.identifier ?? `ENA-${partial.number ?? 1}`,
    title: partial.title ?? "Untitled",
    status: partial.status ?? "todo",
    match_source: partial.match_source ?? "title",
  } as SearchIssueResult;
}

/** Header titles and row keys, top to bottom — what the user actually sees. */
const shape = (rows: ReturnType<typeof buildSearchRows>) =>
  rows.map((r) => (r.kind === "header" ? `#${r.title}` : r.key));

describe("buildSearchRows", () => {
  it("renders Recent for an empty query", () => {
    const rows = buildSearchRows({
      query: "  ",
      issues: [],
      recentIssues: [{ id: "r1" } as Issue, { id: "r2" } as Issue],
    });
    expect(shape(rows)).toEqual(["#Recent", "r-r1", "r-r2"]);
  });

  it("returns nothing when there is neither a query nor recent history", () => {
    expect(
      buildSearchRows({ query: "", issues: [], recentIssues: [] }),
    ).toEqual([]);
  });

  // ENA-5824: cancelled work sinks into a trailing section rather than keeping
  // its server rank among live rows.
  it("puts a cancelled issue below every live issue", () => {
    const rows = buildSearchRows({
      query: "search",
      issues: [
        issue({ id: "i-dead", number: 1, title: "search a", status: "cancelled" }),
        issue({ id: "i-live", number: 2, title: "search b", status: "todo" }),
        issue({ id: "i-done", number: 3, title: "search c", status: "done" }),
      ],
      recentIssues: [],
    });

    expect(shape(rows)).toEqual([
      "#Issues",
      // 'done' stays live — only cancelled work is demoted.
      "i-i-live",
      "i-i-done",
      "#Cancelled",
      "i-i-dead",
    ]);
  });

  it("keeps a cancelled direct hit at the top", () => {
    const rows = buildSearchRows({
      query: "ENA-7",
      issues: [issue({ id: "i-hit", number: 7, identifier: "ENA-7", status: "cancelled" })],
      recentIssues: [],
    });

    expect(shape(rows)).toEqual(["#Issues", "i-i-hit"]);
  });

  it("omits the Cancelled section when nothing is demoted", () => {
    const rows = buildSearchRows({
      query: "search",
      issues: [issue({ id: "i1", status: "todo" })],
      recentIssues: [],
    });
    expect(shape(rows)).toEqual(["#Issues", "i-i1"]);
  });
});
