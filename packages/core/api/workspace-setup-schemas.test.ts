// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  EMPTY_MARKETPLACE_RECOMMENDATIONS,
  EMPTY_WORKSPACE_PROFILE,
  EMPTY_WORKSPACE_SETUP,
  MarketplaceRecommendationsSchema,
  WorkspaceProfileSchema,
  WorkspaceSetupSchema,
} from "./schemas";
import { parseWithFallback } from "./schema";

// Every default in these schemas is chosen to fail in the direction that does
// not mislead. These are the tests that would catch one being flipped to
// whatever seemed convenient.

describe("WorkspaceProfileSchema", () => {
  it("reads a full profile", () => {
    const parsed = WorkspaceProfileSchema.parse({
      summary: "A control tower.",
      stack: ["go"],
      typical_work: ["ship_code"],
      empty: false,
    });
    expect(parsed.summary).toBe("A control tower.");
    expect(parsed.stack).toEqual(["go"]);
    expect(parsed.empty).toBe(false);
  });

  // `empty` gates the setup step and the recommendation rail. A profile this
  // client could not read must not be presented as answered — the surfaces
  // that consult it treat "answered" as permission to move on.
  it("defaults empty to true when the server omits it", () => {
    expect(WorkspaceProfileSchema.parse({}).empty).toBe(true);
  });

  it("defaults every list to an array so a form can bind without a null check", () => {
    const parsed = WorkspaceProfileSchema.parse({});
    expect(parsed.stack).toEqual([]);
    expect(parsed.languages).toEqual([]);
    expect(parsed.typical_work).toEqual([]);
    expect(parsed.repo_brief_sources).toEqual([]);
  });

  it("falls back to an empty profile on a malformed response", () => {
    const parsed = parseWithFallback(
      { summary: 42, stack: "not an array" },
      WorkspaceProfileSchema,
      EMPTY_WORKSPACE_PROFILE,
      { endpoint: "test" },
    );
    expect(parsed).toEqual(EMPTY_WORKSPACE_PROFILE);
    expect(parsed.empty).toBe(true);
  });
});

describe("WorkspaceSetupSchema", () => {
  it("reads a checklist", () => {
    const parsed = WorkspaceSetupSchema.parse({
      steps: [{ key: "runtime", done: true, issue_id: "issue-1" }],
      complete: false,
      parent_issue_id: "issue-parent",
      profile: { empty: false, summary: "x" },
    });
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0]?.key).toBe("runtime");
    expect(parsed.profile.empty).toBe(false);
  });

  // An empty list rather than four not-done steps: a checklist that could not
  // be read must render as nothing to show, not as four things the member has
  // supposedly failed to do.
  it("falls back to no steps at all on a malformed response", () => {
    const parsed = parseWithFallback(
      { steps: "not an array" },
      WorkspaceSetupSchema,
      EMPTY_WORKSPACE_SETUP,
      { endpoint: "test" },
    );
    expect(parsed.steps).toEqual([]);
    expect(parsed.complete).toBe(false);
  });

  // A newer server may add a step key this client has no copy for. Dropping
  // the whole checklist over one unknown row would be worse than rendering it.
  it("keeps a step whose key this client does not know", () => {
    const parsed = WorkspaceSetupSchema.parse({
      steps: [{ key: "something_new", done: false }],
    });
    expect(parsed.steps[0]?.key).toBe("something_new");
  });
});

describe("MarketplaceRecommendationsSchema", () => {
  it("reads a ranking with its evidence", () => {
    const parsed = MarketplaceRecommendationsSchema.parse({
      recommendations: [
        {
          listing: { id: "listing-1", kind: "skill", name: "Review" },
          score: 10,
          matched: true,
          reasons: [{ kind: "stack", term: "go", field: "tag", score: 10 }],
        },
      ],
      profile_empty: false,
      considered: 12,
    });
    expect(parsed.recommendations[0]?.matched).toBe(true);
    expect(parsed.recommendations[0]?.reasons[0]?.term).toBe("go");
  });

  // The safe direction: an unreadable field must never let the UI claim a
  // listing matches this workspace's profile.
  it("defaults matched to false", () => {
    const parsed = MarketplaceRecommendationsSchema.parse({
      recommendations: [
        { listing: { id: "listing-1", kind: "skill", name: "Review" }, score: 1 },
      ],
    });
    expect(parsed.recommendations[0]?.matched).toBe(false);
  });

  // A reason kind this client has no label for still carries its term, which
  // is the useful half.
  it("keeps a reason whose kind this client does not know", () => {
    const parsed = MarketplaceRecommendationsSchema.parse({
      recommendations: [
        {
          listing: { id: "listing-1", kind: "skill", name: "Review" },
          reasons: [{ kind: "some_future_signal", term: "kubernetes" }],
        },
      ],
    });
    expect(parsed.recommendations[0]?.reasons[0]?.term).toBe("kubernetes");
  });

  it("falls back to an empty ranking on a malformed response", () => {
    const parsed = parseWithFallback(
      { recommendations: "not an array" },
      MarketplaceRecommendationsSchema,
      EMPTY_MARKETPLACE_RECOMMENDATIONS,
      { endpoint: "test" },
    );
    expect(parsed.recommendations).toEqual([]);
    expect(parsed.profile_empty).toBe(false);
  });
});
