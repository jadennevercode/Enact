-- Lessons: a proposal to change a capability asset, and the record of who
-- decided it (lessons, phase 1).
--
-- Enact already carries a lesson lifecycle, but only as prose. The sdlc-learn
-- skill describes a six-stage loop, an approval gate that only a named human
-- may sign, and a rule that no template, checklist or skill may be edited
-- before that gate passes. All of it is enforced by an agent reading its own
-- instructions, against files in the target repository's .sdlc/ directory.
-- Nothing reaches the product: no row, no endpoint, no reviewer inbox, and no
-- way for anyone who was not in that session to find out a rule was added.
--
-- This table is that loop with the parts a prompt cannot provide. A lesson is
-- a proposal to change one skill, written against one version of it, carrying
-- the evidence it came from and the boundary of where it applies. The server
-- enforces the three properties the prose only asks for:
--
--   * Only a person decides. `decided_by` is a user id and the endpoint refuses
--     agent credentials outright. An agent may propose; it may never sign.
--   * The decision names a version. `base_version_id` is the skill_version the
--     proposal was written against; approval fails if the skill has moved. The
--     reviewer approves text that was actually in front of them.
--   * Nothing changes until it does. Publication writes a new skill_version in
--     the same transaction that flips the status, so an approved-but-unapplied
--     or applied-but-unapproved lesson is not a reachable state.
--
-- Status is five values, not the eight stages of the skill. Observe and
-- Classify happen before a proposal exists at all — they are the agent deciding
-- there is something worth proposing — and Validate is not a stage here but the
-- required fields `applies_when` and `counterexample`, which a proposal cannot
-- omit. What remains is what a reviewer needs to see:
--
--   proposed -> in_review -> published | rejected, and published -> deprecated
--
-- Deliberately NOT modelled: an adoption scope field. The sdlc-learn template
-- carries one because a lesson there can target a file whose readership is
-- ambiguous. Here the target is a skill, and the set of agents a skill reaches
-- is a fact the server can compute from agent_skill at review time. A column
-- restating it would be a second answer to a question that already has one.
--
-- `target_kind` is a one-value CHECK today. Agent instructions and issue
-- templates are the obvious next targets, and a lesson that changes them needs
-- exactly this table; the column is here so adding one is a CHECK change rather
-- than a schema debate.
--
-- No foreign keys, per the repo rule.

CREATE TABLE IF NOT EXISTS lesson (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    -- Human-readable identifier within the workspace, rendered as LP-<number>.
    -- Assigned by the application the way issue.number is; the unique index is
    -- built concurrently in migration 423.
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (
        status IN ('proposed', 'in_review', 'published', 'rejected', 'deprecated')
    ),

    -- --- What it wants to change -------------------------------------------
    target_kind TEXT NOT NULL DEFAULT 'skill' CHECK (target_kind IN ('skill')),
    -- The skill this lesson edits. NULL only while new_asset is true and the
    -- lesson has not been published yet; publication fills it in with the
    -- skill it created.
    target_skill_id UUID,
    -- The skill_version the proposal was written against. Approval requires it
    -- to still be the skill's current version. NULL when new_asset is true.
    base_version_id UUID,
    -- True when the lesson proposes a skill that does not exist yet. The
    -- sdlc-learn spec calls this "promotion to a new asset" and holds it to the
    -- same gate as editing an existing one, because a new rule nobody approved
    -- affects every future run just as much.
    new_asset BOOLEAN NOT NULL DEFAULT FALSE,
    proposed_skill_name TEXT NOT NULL DEFAULT '',

    -- --- Observe: where it came from ---------------------------------------
    observation TEXT NOT NULL DEFAULT '',
    -- References to the runs, issues and comments the observation rests on, as
    -- [{"kind": "task"|"issue"|"comment", "id": ..., "note": ...}]. References,
    -- not copies: the evidence stays where it happened.
    evidence JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- --- Validate: where it stops ------------------------------------------
    -- Both required by the API. A rule whose author cannot say when it does not
    -- apply has not been thought through, and the cost of finding that out
    -- later is paid by every run the rule touches.
    applies_when TEXT NOT NULL DEFAULT '',
    counterexample TEXT NOT NULL DEFAULT '',

    -- --- The change itself --------------------------------------------------
    -- The full proposed state of the skill, in the same shape skill_version
    -- stores. NULL means "unchanged from the base version" for that part.
    proposed_name TEXT,
    proposed_description TEXT,
    proposed_content TEXT,
    proposed_files JSONB,
    change_summary TEXT NOT NULL DEFAULT '',

    -- --- Provenance ---------------------------------------------------------
    -- The retrospective that produced it, when one did. Plain UUID; the
    -- retrospective table arrives in 427.
    retrospective_id UUID,
    source_task_id UUID,
    source_issue_id UUID,
    proposed_by_type TEXT NOT NULL DEFAULT 'agent' CHECK (proposed_by_type IN ('member', 'agent')),
    proposed_by_id UUID,

    -- --- Decision -----------------------------------------------------------
    -- A member user id, always. The approve and reject endpoints reject agent
    -- and daemon credentials before reaching this column; it is the record of a
    -- person, and a NULL here on a published lesson would mean the gate failed.
    decided_by UUID,
    decided_at TIMESTAMPTZ,
    decision_reason TEXT NOT NULL DEFAULT '',

    -- --- Publication --------------------------------------------------------
    published_version_id UUID,
    published_at TIMESTAMPTZ,
    -- Set when the lesson is withdrawn after publication. The row is never
    -- deleted: a rule that was tried and reversed is different from one that
    -- was never proposed, and the next person to have the same idea needs to
    -- be able to find out which.
    deprecated_at TIMESTAMPTZ,
    deprecated_by UUID,
    deprecation_reason TEXT NOT NULL DEFAULT '',
    -- The version the skill was returned to when this lesson was deprecated.
    reverted_version_id UUID,

    -- --- Lineage ------------------------------------------------------------
    -- An amendment points at the lesson it refines. Narrowing a boundary or
    -- fixing wording amends; reversing the conclusion is a new lesson.
    parent_lesson_id UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE lesson IS
    'A proposal to change a skill, written against one version of it. Only a named person may approve; publication writes a skill_version in the same transaction.';

COMMENT ON COLUMN lesson.decided_by IS
    'The person who approved or rejected. Never an agent — the endpoints refuse agent credentials.';

COMMENT ON COLUMN lesson.base_version_id IS
    'The skill_version this proposal was written against. Approval fails if the skill has moved on, so a reviewer only ever signs text they saw.';

-- The audit trail. Separate from the lesson row because the row holds the
-- current answer and this holds how it got there, and the two have opposite
-- update patterns: the row is rewritten, these are only ever appended.
CREATE TABLE IF NOT EXISTS lesson_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (
        kind IN ('proposed', 'submitted', 'approved', 'rejected', 'published', 'deprecated', 'amended', 'reopened')
    ),
    actor_type TEXT NOT NULL DEFAULT 'member' CHECK (actor_type IN ('member', 'agent', 'system')),
    actor_id UUID,
    note TEXT NOT NULL DEFAULT '',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE lesson_event IS
    'Append-only history of one lesson''s state changes. The lesson row says where it stands; this says how it got there.';
