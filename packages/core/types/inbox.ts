import type { IssueStatus } from "./issue";

export type InboxSeverity = "action_required" | "attention" | "info";

export type InboxItemType =
  | "issue_assigned"
  | "issue_subscribed"
  | "unassigned"
  | "assignee_changed"
  | "status_changed"
  | "priority_changed"
  | "start_date_changed"
  | "due_date_changed"
  | "new_comment"
  | "mentioned"
  | "review_requested"
  | "task_completed"
  | "task_failed"
  | "agent_blocked"
  | "agent_completed"
  | "reaction_added"
  | "quick_create_done"
  | "quick_create_failed"
  // Quick create whose outcome could not be verified. Distinct from
  // quick_create_failed because it must NOT be rendered with failure framing:
  // the issue may actually have been created.
  | "quick_create_unconfirmed"
  // A lesson is waiting on someone who can decide it. action_required: the
  // proposal sits there doing nothing until a person answers.
  | "lesson_proposed"
  // The proposer's answer. Approved, rejected or withdrawn all arrive as this
  // one type; the `status` in `details` says which.
  | "lesson_decided"
  // Work an agent did just finished and a retrospective is on offer. info, not
  // action_required: declining is a valid and common answer, and framing it as
  // a chore would make the inbox lie about that.
  | "retrospective_suggested";

/**
 * One workspace's unread inbox count in the cross-workspace summary
 * (`GET /api/inbox/unread-summary`). The sidebar uses this to light a dot on
 * the workspace switcher when a workspace OTHER than the active one has
 * unread items.
 */
export interface InboxWorkspaceUnread {
  workspace_id: string;
  count: number;
}

export interface InboxItem {
  id: string;
  workspace_id: string;
  recipient_type: "member" | "agent";
  recipient_id: string;
  actor_type: "member" | "agent" | "system" | null;
  actor_id: string | null;
  type: InboxItemType;
  severity: InboxSeverity;
  issue_id: string | null;
  title: string;
  body: string | null;
  issue_status: IssueStatus | null;
  read: boolean;
  archived: boolean;
  created_at: string;
  details: Record<string, string> | null;
}
