// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { Workspace } from "@enact/core/types";
import { resolveWebPostAuthDestination } from "./post-auth-destination";

const workspace = { id: "ws-1", slug: "acme" } as Workspace;

describe("resolveWebPostAuthDestination", () => {
  it("sends workspace-less users to automatic setup", () => {
    expect(resolveWebPostAuthDestination([], false)).toBe("/onboarding");
    expect(resolveWebPostAuthDestination([], true)).toBe("/onboarding");
  });

  it("opens an existing workspace for an onboarded user", () => {
    expect(resolveWebPostAuthDestination([workspace], true)).toBe(
      "/acme/issues",
    );
  });
});
