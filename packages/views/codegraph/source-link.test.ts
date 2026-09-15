// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lineAnchor, sourceFileUrl, sourceRef } from "./source-link";

const commit = "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0";

describe("sourceFileUrl", () => {
  it("pins the link to the built commit", () => {
    expect(
      sourceFileUrl("https://github.com/acme/backend.git", commit, "server/main.go", "L41"),
    ).toBe(`https://github.com/acme/backend/blob/${commit}/server/main.go#L41`);
  });

  it("handles scp shorthand remotes", () => {
    expect(sourceFileUrl("git@github.com:acme/backend.git", commit, "a.go")).toBe(
      `https://github.com/acme/backend/blob/${commit}/a.go`,
    );
  });

  it("falls back to HEAD when the build recorded no commit", () => {
    expect(sourceFileUrl("https://github.com/acme/backend", null, "a.go")).toBe(
      "https://github.com/acme/backend/blob/HEAD/a.go",
    );
  });

  it("returns null when there is nothing safe to link", () => {
    expect(sourceFileUrl("https://github.com/acme/backend", commit, "")).toBeNull();
    expect(sourceFileUrl("not a url", commit, "a.go")).toBeNull();
    expect(sourceFileUrl("http://localhost:3000/x/y", commit, "a.go")).toBeNull();
  });

  it("strips a leading slash so the blob path stays valid", () => {
    expect(sourceFileUrl("https://github.com/acme/b", commit, "/a.go")).toBe(
      `https://github.com/acme/b/blob/${commit}/a.go`,
    );
  });
});

describe("lineAnchor and sourceRef", () => {
  it("accepts graphify's L-prefixed position and ignores anything else", () => {
    expect(lineAnchor("L41")).toBe("#L41");
    expect(lineAnchor("41")).toBe("#L41");
    expect(lineAnchor("L41-L52")).toBe("");
    expect(lineAnchor(null)).toBe("");
  });

  it("renders a pasteable file:line reference", () => {
    expect(sourceRef("a/b.go", "L41")).toBe("a/b.go:41");
    expect(sourceRef("a/b.go", null)).toBe("a/b.go");
    expect(sourceRef(undefined)).toBe("");
  });
});
