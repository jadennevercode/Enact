// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseWithFallback } from "../api/schema";
import {
  codeGraphBuildStatusSchema,
  codeGraphCallflowSchema,
  codeGraphCapabilitySchema,
  codeGraphCommunitiesSchema,
  codeGraphStatusesSchema,
  codeGraphTreeNodeSchema,
  codeGraphViewSchema,
  codeGraphWikiIndexSchema,
  type CodeGraphBuildStatus,
} from "./schemas";

const opts = { endpoint: "test" };

describe("code graph schemas", () => {
  it("accepts a full BuildStatus and keeps unknown fields", () => {
    const parsed = codeGraphBuildStatusSchema.safeParse({
      enabled: true,
      queued: false,
      stale: true,
      build: {
        id: "b1",
        state: "ready",
        commit: "a".repeat(40),
        ref: "main",
        skipped_reason: null,
        error: null,
        stats: { files: 1, nodes: 2, edges: 3, communities: 1, duration_ms: 10, graphify_version: "0.9.61", incremental: true },
        diff: { added_nodes: 1, removed_nodes: 0, added_edges: 0, removed_edges: 0 },
        graphify_version: "0.9.61",
        created_at: "2026-09-14T00:00:00Z",
        finished_at: null,
        future_field: "kept",
      },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.build?.state).toBe("ready");
    expect(parsed.success && (parsed.data.build as Record<string, unknown>).future_field).toBe("kept");
  });

  it("keeps an unknown build state as a string instead of rejecting the status", () => {
    const parsed = codeGraphBuildStatusSchema.safeParse({
      enabled: true,
      build: { id: "b", state: "verifying", created_at: "" },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.build?.state).toBe("verifying");
  });

  it("defaults a sparse status so a chip can render from it", () => {
    const fallback: CodeGraphBuildStatus = { enabled: false, queued: false, stale: false, build: null };
    const parsed = parseWithFallback({ enabled: true }, codeGraphBuildStatusSchema, fallback, opts);
    expect(parsed).toEqual({ enabled: true, queued: false, stale: false, build: null });
  });

  it("falls back on a malformed status body", () => {
    const fallback = null;
    expect(parseWithFallback("not json", codeGraphBuildStatusSchema, fallback, opts)).toBeNull();
    expect(parseWithFallback({ enabled: "yes" }, codeGraphBuildStatusSchema, fallback, opts)).toBeNull();
  });

  it("parses the bulk statuses map and an empty one", () => {
    expect(codeGraphStatusesSchema.parse({}).statuses).toEqual({});
    const parsed = codeGraphStatusesSchema.parse({ statuses: { r1: { enabled: true } } });
    expect(parsed.statuses.r1?.enabled).toBe(true);
  });

  it("parses the capability and communities payloads", () => {
    expect(codeGraphCapabilitySchema.parse({})).toEqual({ enabled: false, graphify_version: null });
    const communities = codeGraphCommunitiesSchema.parse({
      communities: [{ id: 0, label: "handler", size: 412, cohesion: 0.83, top_nodes: [{ id: "n", label: "Handler", source_file: "a.go", source_location: "L41", degree: 87 }] }],
    });
    expect(communities.communities[0]?.top_nodes[0]?.degree).toBe(87);
    expect(parseWithFallback({ communities: [{ label: "no id" }] }, codeGraphCommunitiesSchema, null, opts)).toBeNull();
  });

  it("accepts a GraphView with either edges or links", () => {
    const withEdges = codeGraphViewSchema.parse({ level: "code", nodes: [{ id: "a" }], edges: [{ source: "a", target: "a", relation: "calls" }] });
    expect(withEdges.edges?.length).toBe(1);
    const withLinks = codeGraphViewSchema.parse({ nodes: [{ id: "a" }], links: [{ _src: "a", _tgt: "a" }] });
    expect(withLinks.links?.length).toBe(1);
    expect(withLinks.edges).toBeUndefined();
    expect(parseWithFallback({ nodes: [{ label: "missing id" }] }, codeGraphViewSchema, null, opts)).toBeNull();
  });

  it("parses a recursive tree with optional fields", () => {
    const tree = codeGraphTreeNodeSchema.parse({
      name: "root",
      total_count: 3,
      children: [{ name: "a.go", kind: "file", children: [{ name: "Handler", source_file: "a.go", source_location: "L1" }] }],
    });
    expect(tree.children?.[0]?.children?.[0]?.name).toBe("Handler");
  });

  it("parses callflow and wiki index payloads with defaults", () => {
    const callflow = codeGraphCallflowSchema.parse({ sections: [{ id: "s", mermaid: "flowchart LR" }] });
    expect(callflow.lang).toBe("en");
    expect(callflow.sections[0]?.node_count).toBe(0);
    const wiki = codeGraphWikiIndexSchema.parse({ articles: [{ slug: "handler" }] });
    expect(wiki.articles[0]?.kind).toBe("community");
    expect(parseWithFallback({ articles: [{}] }, codeGraphWikiIndexSchema, null, opts)).toBeNull();
  });
});
