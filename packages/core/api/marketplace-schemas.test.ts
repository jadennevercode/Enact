// @vitest-environment node

import { describe, expect, it } from "vitest";
import { MarketplaceListingDetailSchema, MarketplaceManifestSchema } from "./schemas";

// A manifest is mostly validated as a loose object because the server owns its
// shape. `prerequisites` is the one field the client reads before the install,
// so its default and its failure mode are pinned here.

describe("MarketplaceManifestSchema", () => {
  it("defaults prerequisites to an empty list when the server sends none", () => {
    const parsed = MarketplaceManifestSchema.parse({ kind: "skill" });
    expect(parsed.prerequisites).toEqual([]);
  });

  it("keeps the prerequisites a publisher declared", () => {
    const parsed = MarketplaceManifestSchema.parse({
      kind: "squad",
      prerequisites: ["python3 on the runtime host"],
    });
    expect(parsed.prerequisites).toEqual(["python3 on the runtime host"]);
  });

  it("rejects prerequisites that are not a list of strings", () => {
    expect(MarketplaceManifestSchema.safeParse({ prerequisites: "python3" }).success).toBe(false);
    expect(MarketplaceManifestSchema.safeParse({ prerequisites: [1, 2] }).success).toBe(false);
  });
});

describe("MarketplaceListingDetailSchema", () => {
  it("carries prerequisites through the version manifest", () => {
    const parsed = MarketplaceListingDetailSchema.parse({
      id: "listing-1",
      version: { id: "version-1", manifest: { kind: "skill", prerequisites: ["python3"] } },
    });
    expect(parsed.version?.manifest.prerequisites).toEqual(["python3"]);
  });

  it("reads a detail whose version has no manifest at all", () => {
    const parsed = MarketplaceListingDetailSchema.parse({ id: "listing-1", version: { id: "v" } });
    expect(parsed.version?.manifest.prerequisites).toEqual([]);
  });
});
