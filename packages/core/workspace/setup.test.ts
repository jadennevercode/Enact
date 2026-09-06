// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { WorkspaceSetup } from "../types";
import { countRemainingSetupSteps, findSetupStep } from "./setup";

// The two helpers exist so no surface re-derives "which step is this" or "how
// many are left" and gets it subtly different. Both have to behave sanely for
// a checklist that could not be read, which is the case the schema's fallback
// produces: an EMPTY step list, deliberately not four not-done steps.

function setup(overrides: Partial<WorkspaceSetup> = {}): WorkspaceSetup {
  return {
    steps: [
      { key: "runtime", done: true, issue_id: "issue-runtime" },
      { key: "repository", done: false, issue_id: "issue-repo" },
      { key: "profile", done: false, issue_id: "issue-profile" },
      { key: "capability", done: false, issue_id: "issue-capability" },
    ],
    complete: false,
    profile: {
      summary: "",
      domain: "",
      stack: [],
      languages: [],
      team_size: "",
      typical_work: [],
      constraints: "",
      repo_brief: "",
      repo_brief_sources: [],
      updated_at: "",
      updated_by: "",
      empty: true,
    },
    ...overrides,
  };
}

describe("findSetupStep", () => {
  it("finds a step by key", () => {
    expect(findSetupStep(setup(), "profile")?.issue_id).toBe("issue-profile");
  });

  it("returns undefined for an unreadable checklist", () => {
    expect(findSetupStep(undefined, "runtime")).toBeUndefined();
  });

  // A newer server may add a step this client has no key for; asking for one
  // it does not know about must be undefined rather than a wrong step.
  it("returns undefined for a step the checklist does not carry", () => {
    expect(findSetupStep(setup({ steps: [] }), "runtime")).toBeUndefined();
  });
});

describe("countRemainingSetupSteps", () => {
  it("counts the steps that are not done", () => {
    expect(countRemainingSetupSteps(setup())).toBe(3);
  });

  it("counts zero when everything is done", () => {
    expect(
      countRemainingSetupSteps(
        setup({
          steps: [
            { key: "runtime", done: true },
            { key: "repository", done: true },
          ],
          complete: true,
        }),
      ),
    ).toBe(0);
  });

  // Reporting 0 rather than 4 is what makes the "N remaining" affordance hide
  // instead of telling a member they have failed four things nobody can name.
  it("reports zero for an unreadable checklist", () => {
    expect(countRemainingSetupSteps(undefined)).toBe(0);
  });
});
