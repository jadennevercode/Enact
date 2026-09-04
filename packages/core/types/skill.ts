// Skill version history.
//
// Every change to a skill writes a new version row, so a skill that moved under
// someone can be read back and put where it was. The snapshot is complete: the
// body and every attached file as they stood, not a diff against a neighbour.

/** What produced a version. `backfill` exists only on rows written when version
 *  history was introduced and is never produced at runtime. */
export type SkillVersionSource =
  | "backfill"
  | "manual"
  | "import"
  | "refresh"
  | "retrospect"
  | "rollback"
  | "seed";

/** One file as it stood in a version. Unlike the live `SkillFile`, a snapshot
 *  carries no identity of its own — it is the text at a path at a moment. */
export interface SkillVersionFile {
  path: string;
  content: string;
}

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
  created_by: string | null;
  summary: string;
  created_at: string;
  is_current: boolean;
}

export interface SkillVersionDetail extends SkillVersion {
  content: string;
  files: SkillVersionFile[];
}

export interface ListSkillVersionsResponse {
  versions: SkillVersion[];
}
