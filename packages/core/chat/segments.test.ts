// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CHAT_SEGMENT_NO_PROJECT,
  CHAT_SEGMENT_PINNED,
  countSegmentUnread,
  segmentChatSessions,
  type ChatSegmentation,
} from "./segments";
import type { ChatSession } from "../types/chat";
import type { Project } from "../types/project";

function session(
  id: string,
  overrides: Partial<ChatSession> = {},
): ChatSession {
  return {
    id,
    workspace_id: "ws-1",
    agent_id: "agent-1",
    creator_id: "user-1",
    title: id,
    status: "active",
    has_unread: false,
    created_at: "2026-07-10T00:00:00Z",
    updated_at: "2026-07-10T00:00:00Z",
    ...overrides,
  };
}

function project(id: string, title = id): Project {
  return {
    id,
    workspace_id: "ws-1",
    title,
    description: null,
    icon: null,
    status: "in_progress",
    priority: "medium",
    lead_type: null,
    lead_id: null,
    start_date: null,
    due_date: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    issue_count: 0,
    done_count: 0,
    resource_count: 0,
  };
}

/** Narrowing helper — every assertion below is about the segmented shape. */
function segments(result: ChatSegmentation) {
  if (!result.segmented) throw new Error("expected a segmented result");
  return result.segments;
}

const alpha = project("p-alpha", "Alpha");
const beta = project("p-beta", "Beta");

describe("segmentChatSessions", () => {
  it("returns the flat list when no chat has project context", () => {
    const sessions = [session("a"), session("b")];
    expect(segmentChatSessions(sessions, [alpha])).toEqual({
      segmented: false,
      sessions,
    });
  });

  it("returns the flat list while projects have not loaded yet", () => {
    // Chats DO carry project_id, but nothing resolves — segmenting here would
    // flash every chat into "No project" before the query lands.
    const sessions = [session("a", { project_id: "p-alpha" })];
    expect(segmentChatSessions(sessions, [])).toEqual({
      segmented: false,
      sessions,
    });
  });

  it("groups chats under the project they resolve to", () => {
    const result = segments(
      segmentChatSessions(
        [
          session("a1", { project_id: alpha.id }),
          session("b1", { project_id: beta.id }),
          session("a2", { project_id: alpha.id }),
        ],
        [alpha, beta],
      ),
    );

    expect(result.map((s) => s.id)).toEqual([alpha.id, beta.id]);
    expect(result[0]!.project).toBe(alpha);
    expect(result[0]!.sessions.map((s) => s.id)).toEqual(["a1", "a2"]);
    expect(result[1]!.sessions.map((s) => s.id)).toEqual(["b1"]);
  });

  it("orders project segments by first appearance in the sorted input", () => {
    const result = segments(
      segmentChatSessions(
        [session("b1", { project_id: beta.id }), session("a1", { project_id: alpha.id })],
        [alpha, beta],
      ),
    );

    expect(result.map((s) => s.id)).toEqual([beta.id, alpha.id]);
  });

  it("lifts pinned chats into a leading pinned segment, across projects", () => {
    const result = segments(
      segmentChatSessions(
        [
          session("pinned-b", { project_id: beta.id, pinned: true }),
          session("pinned-none", { pinned: true }),
          session("a1", { project_id: alpha.id }),
        ],
        [alpha, beta],
      ),
    );

    expect(result.map((s) => s.id)).toEqual([CHAT_SEGMENT_PINNED, alpha.id]);
    expect(result[0]!.kind).toBe("pinned");
    expect(result[0]!.project).toBeNull();
    expect(result[0]!.sessions.map((s) => s.id)).toEqual(["pinned-b", "pinned-none"]);
  });

  it("puts context-less chats in a trailing no-project segment", () => {
    const result = segments(
      segmentChatSessions(
        [session("loose"), session("a1", { project_id: alpha.id })],
        [alpha],
      ),
    );

    expect(result.map((s) => s.id)).toEqual([alpha.id, CHAT_SEGMENT_NO_PROJECT]);
    expect(result[1]!.kind).toBe("no_project");
    expect(result[1]!.sessions.map((s) => s.id)).toEqual(["loose"]);
  });

  it("treats an unresolvable project_id as no project", () => {
    const result = segments(
      segmentChatSessions(
        [session("a1", { project_id: alpha.id }), session("orphan", { project_id: "deleted" })],
        [alpha],
      ),
    );

    expect(result.map((s) => s.id)).toEqual([alpha.id, CHAT_SEGMENT_NO_PROJECT]);
    expect(result[1]!.sessions.map((s) => s.id)).toEqual(["orphan"]);
  });

  it("emits no segment for a project without chats", () => {
    const result = segments(
      segmentChatSessions([session("a1", { project_id: alpha.id })], [alpha, beta]),
    );

    expect(result.map((s) => s.id)).toEqual([alpha.id]);
  });

  it("does not mutate the input list", () => {
    const sessions = [
      session("a1", { project_id: alpha.id }),
      session("pinned", { pinned: true }),
    ];
    const snapshot = sessions.map((s) => s.id);
    segmentChatSessions(sessions, [alpha]);
    expect(sessions.map((s) => s.id)).toEqual(snapshot);
  });
});

describe("countSegmentUnread", () => {
  it("sums unread replies across the segment", () => {
    expect(
      countSegmentUnread(
        [session("a", { unread_count: 2 }), session("b", { unread_count: 3 })],
        null,
      ),
    ).toBe(5);
  });

  it("treats a missing unread_count (older server) as 0", () => {
    expect(countSegmentUnread([session("a"), session("b", { unread_count: 4 })], null)).toBe(4);
  });

  it("excludes the active session, matching the row badge", () => {
    expect(
      countSegmentUnread(
        [session("a", { unread_count: 2 }), session("b", { unread_count: 3 })],
        "a",
      ),
    ).toBe(3);
  });
});
