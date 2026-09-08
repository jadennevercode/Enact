// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseWithFallback } from "../api/schema";
import {
  applicationSchema,
  runSchema,
  buildSchema,
  connectionSchema,
} from "./schemas";
describe("semantic API compatibility", () => {
  it("keeps unknown server status while supplying absent step lists", () => {
    const run = runSchema.parse({ id: "r1", status: "reconciling" });
    expect(run.status).toBe("reconciling");
    expect(run.steps).toEqual([]);
  });
  it("rejects a missing identity instead of manufacturing a callable object", () => {
    expect(
      parseWithFallback({}, connectionSchema, null, {
        endpoint: "/connections",
      }),
    ).toBeNull();
  });
  it("converts workspace app fields and survives absent publication", () => {
    expect(
      applicationSchema.parse({
        id: "a1",
        name: "Quality",
        ontology_release_id: "r1",
      }),
    ).toMatchObject({ ontologyReleaseId: "r1", publishedBuildId: null });
  });
  it("refuses malformed executable assets", () => {
    const raw = {
      id: "b1",
      digest: "d",
      source_revision: "abc",
      manifest: { version: 1, entry: "index.html", ontology_release_id: "r1" },
      files: { "index.html": { content: 12, media_type: "text/html" } },
    };
    expect(buildSchema.safeParse(raw).success).toBe(false);
  });
});
