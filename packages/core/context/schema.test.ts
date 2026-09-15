// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parseContextSessions,
  parseContextOperation,
  contextPercent,
  isCompactCommand,
} from "./schema";
describe("context API boundary", () => {
  it("degrades malformed and missing responses without enabling maintenance", () => {
    expect(parseContextSessions(null)).toEqual([]);
    expect(parseContextSessions({ sessions: [{}] })).toEqual([]);
    expect(parseContextOperation({ status: "succeeded" })).toBeNull();
    const rows = parseContextSessions({
      sessions: [
        {
          id: "s",
          agent_id: "a",
          scope_id: "i",
          scope_type: "issue",
          generation: 1,
          capabilities: { native_compact: "true" },
        },
      ],
    });
    expect(rows[0]?.capabilities.native_compact).toBe(false);
    expect(contextPercent(rows[0]?.snapshot ?? null)).toBeNull();
  });
  it("uses current occupancy and tolerates future statuses", () => {
    const op = parseContextOperation({
      id: "o",
      session_id: "s",
      status: "future_status",
      after: { used_tokens: 12000, window_tokens: 100000 },
    });
    expect(op?.status).toBe("future_status");
    expect(contextPercent(op?.after ?? null)).toBe(12);
    expect(contextPercent({ ...op!.after!, window_tokens: 0 })).toBeNull();
  });
  it("intercepts only the standalone maintenance command", () => {
    expect(isCompactCommand(" /compact\n")).toBe(true);
    for (const text of [
      "/compact summarize this",
      "Please use /compact",
      "`/compact`",
      "/compact\nkeep this paragraph",
    ]) {
      expect(isCompactCommand(text)).toBe(false);
    }
  });
});
