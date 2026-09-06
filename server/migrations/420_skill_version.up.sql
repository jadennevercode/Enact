-- Skill version history (lessons, phase 1).
--
-- Until now a skill had exactly one state: whatever the last write left in
-- `skill.content` and `skill_file`. `UpdateSkill` COALESCEs new values over the
-- old ones in place, the import refresh path deletes the whole file set and
-- re-inserts it, and neither leaves anything behind. That is survivable while a
-- human is the only author and the edit is one they just made on purpose.
--
-- It stops being survivable the moment a skill can be changed by an approved
-- proposal. Three things become impossible without history:
--
--   * Approving a specific thing. A reviewer signs off on the skill as it reads
--     now plus a stated change. If the skill moved between the proposal and the
--     approval, the approval is for text nobody looked at. The proposal has to
--     name a version, and that version has to exist as a row.
--   * Undoing. "This lesson made things worse" has no answer if the previous
--     content is gone.
--   * Attribution. A skill that quietly grows rules nobody can trace back to a
--     decision is exactly the failure the approval gate exists to prevent.
--
-- So every write to a skill's content now also appends an immutable snapshot
-- here, whatever produced it — a human edit, an import, a refresh from source,
-- a published lesson, a rollback. The snapshot is whole rather than a diff:
-- skills are small, and a diff chain that has to be replayed to answer "what
-- did the reviewer see" is a worse trade than the storage.
--
-- `content_hash` lets a no-op write skip the snapshot. It is computed in Go
-- (pkg/skillbundle.ContentHash) over name, description, content and the sorted
-- file set. The backfill below deliberately leaves it empty rather than trying
-- to reproduce that construction in SQL: an empty hash reads as "unknown", the
-- comparison fails closed, and the first real edit after this migration writes
-- a version it might have been able to skip. That is the harmless direction.
--
-- No foreign keys, per the repo rule: skill deletion removes versions
-- explicitly in the same transaction.

CREATE TABLE IF NOT EXISTS skill_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID NOT NULL,
    -- Denormalised from the skill so version reads are workspace-guarded
    -- without a join, the way every other tenant-scoped read in the schema is.
    workspace_id UUID NOT NULL,
    -- Monotonic per skill, starting at 1. The unique index is built
    -- concurrently in migration 421.
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- The complete supporting file set at this version, as
    -- [{"path": ..., "content": ...}] ordered by path. Whole, not a diff.
    files JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- sha256 over the canonical (name, description, content, files) tuple.
    -- Empty means "not computed" — see the header note on the backfill.
    content_hash TEXT NOT NULL DEFAULT '',
    -- What produced this version. 'backfill' exists only for the rows this
    -- migration writes and is never produced at runtime.
    source TEXT NOT NULL DEFAULT 'manual' CHECK (
        source IN ('backfill', 'manual', 'import', 'refresh', 'lesson', 'rollback', 'seed')
    ),
    -- The lesson whose publication produced this version, when source is
    -- 'lesson' or 'rollback'. Plain UUID; the lesson table arrives in 422.
    lesson_id UUID,
    created_by UUID,
    -- One line for the version list. Written by whatever produced the version.
    summary TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE skill_version IS
    'Immutable snapshot of a skill''s content. Appended on every content write; the arbiter of what an approver actually approved.';

-- The skill's current snapshot. Redundant with MAX(version) but read on every
-- proposal to answer "has the skill moved since this was written", which is a
-- point lookup rather than an aggregate.
ALTER TABLE skill ADD COLUMN IF NOT EXISTS current_version_id UUID;

COMMENT ON COLUMN skill.current_version_id IS
    'The skill_version row matching the skill''s current content. A proposal written against an older version cannot be approved.';

-- Backfill: one v1 snapshot per existing skill, carrying the skill's own
-- created_at so the history does not claim every skill was authored on deploy
-- day.
INSERT INTO skill_version (
    skill_id, workspace_id, version, name, description, content, config, files,
    content_hash, source, created_by, summary, created_at
)
SELECT
    s.id,
    s.workspace_id,
    1,
    s.name,
    s.description,
    s.content,
    s.config,
    COALESCE(
        (
            SELECT jsonb_agg(
                jsonb_build_object('path', sf.path, 'content', sf.content)
                ORDER BY sf.path
            )
            FROM skill_file sf
            WHERE sf.skill_id = s.id
        ),
        '[]'::jsonb
    ),
    '',
    'backfill',
    s.created_by,
    'Snapshot taken when skill version history was introduced.',
    s.created_at
FROM skill s
WHERE NOT EXISTS (
    SELECT 1 FROM skill_version sv WHERE sv.skill_id = s.id
);

UPDATE skill s
SET current_version_id = sv.id
FROM skill_version sv
WHERE sv.skill_id = s.id
  AND sv.version = 1
  AND s.current_version_id IS NULL;
