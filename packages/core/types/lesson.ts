// Lessons and retrospectives.
//
// A lesson is a proposal to change one skill, written against one version of
// it. A retrospective is one scan by the Lesson Learner over finished work,
// which is where lessons come from.
//
// Two fields on the wire deserve attention before writing UI against them:
//
//   * `base_version_current` is false once the skill has moved on. A stale
//     proposal cannot be approved, and the server refuses it rather than
//     silently applying a diff to text nobody read. Say so before the reviewer
//     reads the diff, not after they press the button.
//   * `proposed` and `base` are both fully resolved server-side. A field the
//     proposal left alone is filled in from the base version, so the two sides
//     are directly comparable and no client has to reimplement "unchanged
//     means look at the other one".

/** Where a lesson stands. `deprecated` means published and later withdrawn. */
export type LessonStatus =
  | "proposed"
  | "in_review"
  | "published"
  | "rejected"
  | "deprecated";

/** What kind of asset a lesson changes. Only skills today. */
export type LessonTargetKind = "skill";

export interface LessonEvidence {
  kind: "task" | "issue" | "comment";
  id: string;
  note?: string;
}

export interface LessonSkillFile {
  path: string;
  content: string;
}

/** One complete side of the proposed change. */
export interface LessonSkillState {
  name: string;
  description: string;
  content: string;
  files: LessonSkillFile[];
}

/** An agent that mounts the target skill, and would therefore change behaviour. */
export interface LessonAffectedAgent {
  id: string;
  name: string;
  enabled: boolean;
}

export interface LessonEvent {
  id: string;
  kind: string;
  actor_type: string;
  actor_id: string | null;
  note: string;
  details: unknown;
  created_at: string;
}

export interface Lesson {
  id: string;
  workspace_id: string;
  number: number;
  /** The number as people say it: `LP-12`. */
  key: string;
  title: string;
  status: LessonStatus;

  target_kind: LessonTargetKind;
  target_skill_id: string | null;
  target_skill_name?: string;
  base_version_id: string | null;
  base_version?: number;
  /** False once the skill has changed since this was written. */
  base_version_current: boolean;
  new_asset: boolean;
  proposed_skill_name?: string;

  observation: string;
  evidence: LessonEvidence[];
  applies_when: string;
  counterexample: string;
  change_summary: string;

  retrospective_id: string | null;
  source_task_id: string | null;
  source_issue_id: string | null;
  proposed_by_type: "member" | "agent";
  proposed_by_id: string | null;

  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string;

  published_version_id: string | null;
  published_at: string | null;
  deprecated_at: string | null;
  deprecation_reason: string;
  reverted_version_id: string | null;
  parent_lesson_id: string | null;

  created_at: string;
  updated_at: string;
}

export interface LessonDetail extends Lesson {
  /** Null when the lesson proposes a skill that does not exist yet. */
  base: LessonSkillState | null;
  proposed: LessonSkillState;
  affected_agents: LessonAffectedAgent[];
  events: LessonEvent[];
}

export interface ListLessonsResponse {
  lessons: Lesson[];
  /** Row counts per status, for the filter chips. */
  counts: Record<string, number>;
}

export interface ListLessonsParams {
  status?: LessonStatus;
  skill_id?: string;
  retrospective_id?: string;
  limit?: number;
  offset?: number;
}

export interface CreateLessonRequest {
  title: string;
  observation: string;
  applies_when: string;
  counterexample: string;
  change_summary: string;
  evidence?: LessonEvidence[];
  target_skill_id?: string;
  base_version_id?: string;
  new_asset?: boolean;
  skill_name?: string;
  proposed_name?: string;
  proposed_description?: string;
  proposed_content?: string;
  proposed_files?: LessonSkillFile[];
  retrospective_id?: string;
  source_task_id?: string;
  source_issue_id?: string;
  parent_lesson_id?: string;
}

export interface UpdateLessonRequest {
  title?: string;
  observation?: string;
  applies_when?: string;
  counterexample?: string;
  change_summary?: string;
  evidence?: LessonEvidence[];
  proposed_name?: string;
  proposed_description?: string;
  proposed_content?: string;
  proposed_files?: LessonSkillFile[];
}

export interface LessonDecisionRequest {
  reason?: string;
}

// Skill versions

/** What produced a version. `backfill` exists only on rows written when version
 *  history was introduced and is never produced at runtime. */
export type SkillVersionSource =
  | "backfill"
  | "manual"
  | "import"
  | "refresh"
  | "lesson"
  | "rollback"
  | "seed";

export interface SkillVersion {
  id: string;
  skill_id: string;
  workspace_id: string;
  version: number;
  name: string;
  description: string;
  config: Record<string, unknown>;
  content_hash: string;
  source: SkillVersionSource;
  lesson_id: string | null;
  created_by: string | null;
  summary: string;
  created_at: string;
  is_current: boolean;
}

export interface SkillVersionDetail extends SkillVersion {
  content: string;
  files: LessonSkillFile[];
}

export interface ListSkillVersionsResponse {
  versions: SkillVersion[];
}

// Retrospectives

/** `suggested` means asked but not answered. Accepting moves it to `queued`;
 *  declining to `dismissed`. Both answers are final for that scope. */
export type RetrospectiveStatus =
  | "suggested"
  | "dismissed"
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type RetrospectiveScope = "issue" | "workspace";

export type RetrospectiveTrigger = "suggestion" | "manual" | "schedule";

export interface Retrospective {
  id: string;
  workspace_id: string;
  status: RetrospectiveStatus;
  scope: RetrospectiveScope;
  scope_id: string | null;
  trigger: RetrospectiveTrigger;
  since: string | null;
  /** The issue the scan runs as. Null until it starts, which for a suggestion
   *  may be never. */
  issue_id: string | null;
  task_id: string | null;
  autopilot_id: string | null;
  requested_by: string | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
  lesson_count: number;
  failure_reason: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListRetrospectivesResponse {
  retrospectives: Retrospective[];
}

export interface GetRetrospectiveResponse {
  retrospective: Retrospective;
  lessons: Lesson[];
}

/** The issue page asks this on every load, so "none" is a normal answer and
 *  arrives as null rather than a 404. */
export interface IssueRetrospectiveResponse {
  retrospective: Retrospective | null;
}

export interface CreateRetrospectiveRequest {
  scope: RetrospectiveScope;
  scope_id?: string;
  since_days?: number;
}
