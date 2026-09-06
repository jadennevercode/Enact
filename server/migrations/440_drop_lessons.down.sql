-- Rebuilds the lessons schema empty.
--
-- NOT reversible: every lesson, lesson event and retrospective is deleted by
-- the up migration, and each skill version forgets which lesson published it.
-- This restores the shape so an older server binary can start; it does not
-- restore the data. The skill edits those lessons published are unaffected —
-- they live in `skill` and `skill_version` and were never carried by these
-- tables.
--
-- Indexes are recreated non-concurrently here on purpose: a down migration
-- runs against a database being rolled back, not a live one, and the tables it
-- builds are empty.

CREATE TABLE IF NOT EXISTS lesson (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'in_review', 'published', 'rejected', 'deprecated')),
    target_kind TEXT NOT NULL DEFAULT 'skill' CHECK (target_kind IN ('skill')),
    target_skill_id UUID,
    base_version_id UUID,
    new_asset BOOLEAN NOT NULL DEFAULT FALSE,
    proposed_skill_name TEXT,
    observation TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    applies_when TEXT NOT NULL,
    counterexample TEXT NOT NULL,
    proposed_name TEXT,
    proposed_description TEXT,
    proposed_content TEXT,
    proposed_files JSONB,
    change_summary TEXT NOT NULL,
    retrospective_id UUID,
    source_task_id UUID,
    source_issue_id UUID,
    proposed_by_type TEXT CHECK (proposed_by_type IN ('member', 'agent')),
    proposed_by_id UUID,
    decided_by UUID,
    decided_at TIMESTAMPTZ,
    decision_reason TEXT,
    published_version_id UUID,
    published_at TIMESTAMPTZ,
    deprecated_at TIMESTAMPTZ,
    deprecated_by UUID,
    deprecation_reason TEXT,
    reverted_version_id UUID,
    parent_lesson_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lesson_workspace_number
    ON lesson (workspace_id, number DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_workspace_status
    ON lesson (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_target_skill
    ON lesson (target_skill_id, created_at DESC) WHERE target_skill_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lesson_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN (
        'proposed', 'submitted', 'approved', 'rejected',
        'published', 'deprecated', 'amended', 'reopened'
    )),
    actor_type TEXT CHECK (actor_type IN ('member', 'agent', 'system')),
    actor_id UUID,
    note TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lesson_event_lesson
    ON lesson_event (lesson_id, created_at);

CREATE TABLE IF NOT EXISTS retrospective (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'suggested'
        CHECK (status IN ('suggested', 'dismissed', 'queued', 'running', 'completed', 'failed')),
    scope TEXT NOT NULL CHECK (scope IN ('issue', 'project', 'workspace')),
    scope_id UUID,
    trigger TEXT NOT NULL CHECK (trigger IN ('suggestion', 'manual', 'schedule')),
    since TIMESTAMPTZ,
    issue_id UUID,
    task_id UUID,
    autopilot_id UUID,
    requested_by UUID,
    dismissed_at TIMESTAMPTZ,
    dismissed_by UUID,
    lesson_count INTEGER NOT NULL DEFAULT 0,
    failure_reason TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retrospective_workspace_status
    ON retrospective (workspace_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_retrospective_issue_scope
    ON retrospective (workspace_id, scope_id)
    WHERE scope = 'issue' AND scope_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_retrospective_task
    ON retrospective (task_id) WHERE task_id IS NOT NULL;

ALTER TABLE skill_version ADD COLUMN IF NOT EXISTS lesson_id UUID;

ALTER TABLE skill_version DROP CONSTRAINT IF EXISTS skill_version_source_check;
ALTER TABLE skill_version ADD CONSTRAINT skill_version_source_check
    CHECK (source IN ('backfill', 'manual', 'import', 'refresh', 'lesson', 'rollback', 'seed'));

UPDATE skill_version SET source = 'lesson' WHERE source = 'retrospect';

ALTER TABLE workspace
    ADD COLUMN IF NOT EXISTS retrospective_suggestions_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE workspace
    ADD COLUMN IF NOT EXISTS lessons_defaults_version INTEGER NOT NULL DEFAULT 0;
