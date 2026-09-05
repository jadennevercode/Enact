// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  RETROSPECT_ORIGIN_TYPE,
  RETROSPECT_SYSTEM_KEY,
  isRetrospectIssue,
} from "./retrospect";

describe("isRetrospectIssue", () => {
  it("recognizes an issue the retrospect loop filed", () => {
    expect(isRetrospectIssue({ origin_type: RETROSPECT_ORIGIN_TYPE })).toBe(
      true,
    );
  });

  it("treats every other provenance as not a retrospect", () => {
    for (const origin of ["autopilot", "quick_create", "agent_create", ""]) {
      expect(isRetrospectIssue({ origin_type: origin })).toBe(false);
    }
  });

  it("treats a missing origin as not a retrospect rather than unknown", () => {
    // Endpoints that do not project the column send nothing. A marker must
    // stay off in that case; it must never fall back to "probably human" for
    // anything that hides or filters.
    expect(isRetrospectIssue({})).toBe(false);
    expect(isRetrospectIssue({ origin_type: undefined })).toBe(false);
  });
});

describe("retrospect identity", () => {
  it("pins the server's system key and origin string", () => {
    // Both cross the wire verbatim: `system_key` identifies the agent (the
    // display name is owner-editable) and `origin_type` stamps the sub-issue.
    // Changing either here without the server silently turns both off.
    expect(RETROSPECT_SYSTEM_KEY).toBe("retrospect");
    expect(RETROSPECT_ORIGIN_TYPE).toBe("retrospect");
  });
});
