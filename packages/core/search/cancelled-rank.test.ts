import { describe, it, expect } from "vitest";
import type { SearchIssueResult } from "../types/api";
import {
  isIssueDirectHit,
  parseSearchQueryNumber,
  partitionCancelledIssues,
  partitionStable,
} from "./cancelled-rank";

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

describe("parseSearchQueryNumber", () => {
  it("reads an identifier and a bare number, like the server does", () => {
    expect(parseSearchQueryNumber("ENA-123")).toBe(123);
    expect(parseSearchQueryNumber("ena-123")).toBe(123);
    expect(parseSearchQueryNumber("  123 ")).toBe(123);
  });

  it("returns null for anything that is not a target", () => {
    expect(parseSearchQueryNumber("search")).toBeNull();
    expect(parseSearchQueryNumber("ENA-")).toBeNull();
    expect(parseSearchQueryNumber("0")).toBeNull();
    expect(parseSearchQueryNumber("")).toBeNull();
  });
});

describe("direct hits", () => {
  it("treats an exact identifier, number, or title as targeting the issue", () => {
    const it1 = issue({ id: "i1", number: 42, identifier: "ENA-42", title: "Ship it" });
    expect(isIssueDirectHit(it1, "ENA-42")).toBe(true);
    expect(isIssueDirectHit(it1, "42")).toBe(true);
    expect(isIssueDirectHit(it1, "  ship IT ")).toBe(true);
    expect(isIssueDirectHit(it1, "ship")).toBe(false);
  });

  // The @mention picker holds the identifier and title but no `number`, so the
  // number has to be derived from the identifier for it to share this rule.
  it("derives the issue number from the identifier when number is absent", () => {
    const row = { identifier: "ENA-77", title: "Abandoned plan" };
    expect(isIssueDirectHit(row, "77")).toBe(true);
    expect(isIssueDirectHit(row, "ENA-77")).toBe(true);
    expect(isIssueDirectHit(row, "ena-77")).toBe(true);
    expect(isIssueDirectHit(row, "Abandoned plan")).toBe(true);
    expect(isIssueDirectHit(row, "plan")).toBe(false);
    expect(isIssueDirectHit(row, "78")).toBe(false);
  });

  it("prefers an explicit number over the identifier", () => {
    // Defensive: if the two ever disagree, `number` is the authoritative field.
    const row = { number: 42, identifier: "ENA-77", title: "t" };
    expect(isIssueDirectHit(row, "42")).toBe(true);
    expect(isIssueDirectHit(row, "77")).toBe(false);
  });

  it("is not a direct hit when nothing identifies the row", () => {
    expect(isIssueDirectHit({}, "ENA-1")).toBe(false);
  });
});

describe("partitionStable", () => {
  it("preserves relative order on both sides", () => {
    const { live, cancelled } = partitionStable(
      [1, 2, 3, 4, 5, 6],
      (n) => n % 2 === 0,
    );
    expect(live).toEqual([1, 3, 5]);
    expect(cancelled).toEqual([2, 4, 6]);
  });
});

describe("partitionCancelledIssues", () => {
  it("demotes cancelled rows while keeping server order within each side", () => {
    const parts = partitionCancelledIssues(
      [
        issue({ id: "i1", number: 1, title: "search a", status: "cancelled" }),
        issue({ id: "i2", number: 2, title: "search b", status: "todo" }),
        issue({ id: "i3", number: 3, title: "search c", status: "cancelled" }),
        issue({ id: "i4", number: 4, title: "search d", status: "done" }),
      ],
      "search",
    );

    // 'done' is live: finished work is still worth referencing.
    expect(parts.live.map((i) => i.id)).toEqual(["i2", "i4"]);
    expect(parts.cancelled.map((i) => i.id)).toEqual(["i1", "i3"]);
  });

  it("exempts a direct hit from demotion", () => {
    const parts = partitionCancelledIssues(
      [issue({ id: "i-hit", number: 7, identifier: "ENA-7", status: "cancelled" })],
      "ENA-7",
    );

    expect(parts.live.map((i) => i.id)).toEqual(["i-hit"]);
    expect(parts.cancelled).toEqual([]);
  });

  it("demotes nothing when no row is cancelled", () => {
    const parts = partitionCancelledIssues([issue({ id: "i1", status: "todo" })], "x");
    expect(parts.cancelled).toEqual([]);
    expect(parts.live.map((i) => i.id)).toEqual(["i1"]);
  });
});
