/**
 * The new-workspace setup checklist and the project profile it reports on.
 *
 * Both are server-derived. A client renders them; nothing here is client state,
 * and in particular no step's `done` is ever computed in the browser — the
 * server owns that so the issue it closes and the flag the UI shows can never
 * disagree.
 */

/**
 * The steps, in the order they are filed and rendered. They unblock each other
 * in that order: no runtime means no agent, no agent means nothing can read the
 * repository, and nothing can be recommended before the workspace has said what
 * it is.
 */
export type WorkspaceSetupStepKey =
  | "runtime"
  | "repository"
  | "profile"
  | "capability";

export interface WorkspaceSetupStep {
  key: WorkspaceSetupStepKey;
  done: boolean;
  /** The step's issue. Absent only for a workspace not yet backfilled. */
  issue_id?: string;
  /** The human handle ("ENA-4"), so a client links without resolving prefixes. */
  issue_identifier?: string;
}

export interface WorkspaceSetup {
  steps: WorkspaceSetupStep[];
  complete: boolean;
  parent_issue_id?: string;
  parent_issue_identifier?: string;
  profile: WorkspaceProfile;
  /**
   * A repository-analysis run still in flight. Present means the repository
   * step is open *because something is reading it*, which is a different thing
   * to tell a member than "you have not done this".
   */
  repo_analysis_issue_id?: string;
}

/**
 * What this workspace says its project is.
 *
 * Read by two things, which is why it is a document rather than more prose in
 * `workspace.context`: every agent run starts with it, and the Marketplace
 * ranks listings against `stack` and `typical_work`.
 */
export interface WorkspaceProfile {
  summary: string;
  domain: string;
  stack: string[];
  languages: string[];
  team_size: string;
  typical_work: string[];
  constraints: string;
  /** Written by the repository-analysis run, never by a person's form. */
  repo_brief: string;
  repo_brief_sources: string[];
  updated_at: string;
  updated_by: string;
  /**
   * Whether the profile says nothing. Answered by the server so no client
   * re-derives it from eight fields and gets it subtly different — and because
   * `updated_at` alone must not count as answered.
   */
  empty: boolean;
}

/**
 * The closed vocabulary `typical_work` draws from. Mirrors
 * `workspaceprofile.TypicalWorkVocabulary` on the server, which rejects
 * anything outside it: the recommender maps these values onto what listings say
 * they are for, and a rule cannot be written against free text.
 */
export const WORKSPACE_TYPICAL_WORK = [
  "ship_code",
  "review_code",
  "plan_product",
  "research",
  "write_docs",
  "automate_ops",
  "data_analysis",
  "knowledge_modeling",
  "design",
  "support",
  "compliance",
] as const;

export type WorkspaceTypicalWork = (typeof WORKSPACE_TYPICAL_WORK)[number];

/**
 * A profile write. Every field is optional and the write is a REPLACE, so an
 * omitted field is cleared — except `repo_brief` and `repo_brief_sources`,
 * which the server carries forward when the key is absent so a member editing
 * their summary cannot discard what the repository analysis found.
 */
export interface UpdateWorkspaceProfileRequest {
  summary?: string;
  domain?: string;
  stack?: string[];
  languages?: string[];
  team_size?: string;
  typical_work?: string[];
  constraints?: string;
  repo_brief?: string;
  repo_brief_sources?: string[];
}
