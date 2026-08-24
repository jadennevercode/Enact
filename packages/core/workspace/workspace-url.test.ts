import { describe, expect, it } from "vitest";
import { workspaceUrlHost } from "./workspace-url";

describe("workspaceUrlHost", () => {
  it("returns the host of a full app URL", () => {
    expect(workspaceUrlHost("https://enact.example.com")).toBe(
      "enact.example.com",
    );
  });

  it("ignores scheme, path, and trailing slash", () => {
    expect(workspaceUrlHost("https://enact.example.com/")).toBe(
      "enact.example.com",
    );
    expect(workspaceUrlHost("http://enact.example.com/app/onboarding")).toBe(
      "enact.example.com",
    );
  });

  it("preserves a non-default port", () => {
    expect(workspaceUrlHost("https://my.host:3000")).toBe("my.host:3000");
  });

  it("accepts a bare host without a scheme", () => {
    expect(workspaceUrlHost("enact.example.com")).toBe("enact.example.com");
    expect(workspaceUrlHost("enact.example.com/path")).toBe(
      "enact.example.com",
    );
  });

  it("falls back to the brand host when no app URL is configured", () => {
    expect(workspaceUrlHost("")).toBe("enact.ai");
    expect(workspaceUrlHost("   ")).toBe("enact.ai");
    expect(workspaceUrlHost(null)).toBe("enact.ai");
    expect(workspaceUrlHost(undefined)).toBe("enact.ai");
  });
});
