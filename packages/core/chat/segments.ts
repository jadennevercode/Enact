import type { Project } from "../types/project";
import type { ChatSession } from "../types/chat";

/** Segment holding every pinned chat, regardless of its project context. */
export const CHAT_SEGMENT_PINNED = "__pinned__";
/** Segment holding chats with no (or an unresolvable) project context. */
export const CHAT_SEGMENT_NO_PROJECT = "__no_project__";

export type ChatSegmentKind = "pinned" | "project" | "no_project";

export interface ChatSegment {
  /** Stable collapse key: a project id, or one of the two sentinels above. */
  id: string;
  kind: ChatSegmentKind;
  /** The project this segment stands for; null for the pinned / no-project segments. */
  project: Project | null;
  sessions: ChatSession[];
}

/**
 * Either a flat list (rendered exactly as it always was) or project segments.
 * Discriminated rather than "an array that might have one anonymous group" so
 * the caller cannot accidentally render a header for the flat case.
 */
export type ChatSegmentation =
  | { segmented: false; sessions: ChatSession[] }
  | { segmented: true; segments: ChatSegment[] };

/**
 * Splits the chat history list into per-project segments.
 *
 * `sessions` must already be in display order (i.e. through `sortChatSessions`
 * — pinned first, then most-recent activity). The partition is stable, so
 * segment order falls out of that input: the pinned segment leads, project
 * segments follow in order of their most recently active chat, and the
 * no-project segment always comes last. That keeps the list's existing
 * "most recent first" mental model without a second sort to keep in sync.
 *
 * Segmenting is opt-out by data, not by preference: unless at least one chat
 * resolves to a known project there is nothing to segment BY, so the result is
 * the flat list. That covers both the user who never sets project context and
 * the render where `projects` has not loaded yet — the latter would otherwise
 * flash every chat into "No project" before the query lands.
 *
 * A `project_id` pointing at a project that is not in `projects` (deleted, or
 * not visible to this user) falls into the no-project segment. Projects with no
 * chats produce no segment.
 */
export function segmentChatSessions(
  sessions: ChatSession[],
  projects: readonly Project[],
): ChatSegmentation {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const resolvedProject = (session: ChatSession): Project | null =>
    session.project_id ? (projectById.get(session.project_id) ?? null) : null;

  if (!sessions.some((s) => resolvedProject(s) !== null)) {
    return { segmented: false, sessions };
  }

  const pinned: ChatSession[] = [];
  const noProject: ChatSession[] = [];
  // Insertion-ordered: first occurrence of a project fixes its segment position.
  const byProject = new Map<string, ChatSession[]>();

  for (const session of sessions) {
    if (session.pinned) {
      pinned.push(session);
      continue;
    }
    const project = resolvedProject(session);
    if (!project) {
      noProject.push(session);
      continue;
    }
    const bucket = byProject.get(project.id);
    if (bucket) bucket.push(session);
    else byProject.set(project.id, [session]);
  }

  const segments: ChatSegment[] = [];
  if (pinned.length > 0) {
    segments.push({
      id: CHAT_SEGMENT_PINNED,
      kind: "pinned",
      project: null,
      sessions: pinned,
    });
  }
  for (const [projectId, projectSessions] of byProject) {
    segments.push({
      id: projectId,
      kind: "project",
      // Present by construction: the id came from a resolved project.
      project: projectById.get(projectId) ?? null,
      sessions: projectSessions,
    });
  }
  if (noProject.length > 0) {
    segments.push({
      id: CHAT_SEGMENT_NO_PROJECT,
      kind: "no_project",
      project: null,
      sessions: noProject,
    });
  }

  return { segmented: true, segments };
}

/**
 * Unread replies inside one segment, for the badge a collapsed segment header
 * carries — folding a segment away must not silently swallow new replies.
 *
 * The active session contributes 0, matching the row badge: the user is looking
 * at it, so counting it would leave a badge no click can clear.
 */
export function countSegmentUnread(
  sessions: readonly ChatSession[],
  activeSessionId: string | null,
): number {
  return sessions.reduce(
    (total, session) =>
      total + (session.id === activeSessionId ? 0 : (session.unread_count ?? 0)),
    0,
  );
}
