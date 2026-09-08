import type { IssueStatusCategory } from "../../types";

// These three are keyed on CATEGORY, not on status key. A workspace can define
// any number of custom statuses, but every one of them belongs to exactly one
// of the 7 categories below — so board columns, the presentation config and the
// paginated fetch all keep a fixed shape. Resolve a status KEY to its category
// with the workspace catalog (`useIssueStatuses`) before indexing these.
// (ENA-6243)
//
// Colour comes from the per-category status tokens rather than from the generic
// semantic roles. The two used to disagree — In Progress borrowed `--warning`
// and Done borrowed `--info`, so a board read amber for "working" and blue for
// "finished" — and nothing tied a category to a tone on purpose. See
// design-system/enact/MASTER.md §3.4 for the shape each category also carries;
// colour is never the only cue.

export const STATUS_ORDER: IssueStatusCategory[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
];

export const ALL_STATUSES: IssueStatusCategory[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
];

export const STATUS_CONFIG: Record<
  IssueStatusCategory,
  {
    label: string;
    iconColor: string;
    hoverBg: string;
    dividerColor: string;
    columnBg: string;
  }
> = {
  backlog: { label: "Backlog", iconColor: "text-status-backlog", hoverBg: "hover:bg-accent", dividerColor: "bg-status-backlog", columnBg: "bg-muted/40" },
  todo: { label: "Todo", iconColor: "text-status-todo", hoverBg: "hover:bg-accent", dividerColor: "bg-status-todo", columnBg: "bg-muted/40" },
  in_progress: { label: "In Progress", iconColor: "text-status-in-progress", hoverBg: "hover:bg-status-in-progress/10", dividerColor: "bg-status-in-progress", columnBg: "bg-status-in-progress/5" },
  in_review: { label: "In Review", iconColor: "text-status-in-review", hoverBg: "hover:bg-status-in-review/10", dividerColor: "bg-status-in-review", columnBg: "bg-status-in-review/5" },
  done: { label: "Done", iconColor: "text-status-done", hoverBg: "hover:bg-status-done/10", dividerColor: "bg-status-done", columnBg: "bg-status-done/5" },
  blocked: { label: "Blocked", iconColor: "text-status-blocked", hoverBg: "hover:bg-status-blocked/10", dividerColor: "bg-status-blocked", columnBg: "bg-status-blocked/5" },
  cancelled: { label: "Cancelled", iconColor: "text-status-cancelled", hoverBg: "hover:bg-accent", dividerColor: "bg-status-cancelled", columnBg: "bg-muted/40" },
};
