// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useIssuesScope, useIssuesScopeStore } from "./issues-scope-store";

describe("issues scope store", () => {
  beforeEach(() => {
    useIssuesScopeStore.setState({ scopes: {} });
  });

  it("records the Issues page's tab under its own key", () => {
    const { setScope } = useIssuesScopeStore.getState();
    setScope("issues", "members");

    const { scopes } = useIssuesScopeStore.getState();
    expect(scopes["issues"]).toBe("members");
  });

  it("defaults an untouched page to the unrestricted tab", () => {
    // Same fallback the useIssuesScope hook applies.
    const { scopes } = useIssuesScopeStore.getState();
    expect(scopes["issues"] ?? "all").toBe("all");
    expect(useIssuesScope).toBeTypeOf("function");
  });

  it("migrates the v0 global tab onto the Issues page only", () => {
    const migrate = useIssuesScopeStore.persist.getOptions().migrate!;
    expect(migrate({ scope: "agents" }, 0)).toEqual({
      scopes: { issues: "agents" },
    });
    // v0 "all" (or garbage) starts every page fresh.
    expect(migrate({ scope: "all" }, 0)).toEqual({ scopes: {} });
    expect(migrate({ bogus: true }, 0)).toEqual({ scopes: {} });
    expect(migrate(undefined, 0)).toEqual({ scopes: {} });
  });

  it("drops v1 per-project page keys, which address a deleted entity", () => {
    const migrate = useIssuesScopeStore.persist.getOptions().migrate!;
    expect(
      migrate(
        { scopes: { issues: "members", "project:p1": "agents", "project:p2": "all" } },
        1,
      ),
    ).toEqual({ scopes: { issues: "members" } });
    // A payload with nothing but project keys migrates to an empty record
    // rather than to undefined.
    expect(migrate({ scopes: { "project:p1": "agents" } }, 1)).toEqual({ scopes: {} });
    expect(migrate({}, 1)).toEqual({ scopes: {} });
    expect(migrate(undefined, 1)).toEqual({ scopes: {} });
  });
});
