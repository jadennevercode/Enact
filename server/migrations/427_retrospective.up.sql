-- Retrospectives: one scan by the Lesson Learner over a scope of finished work
-- (lessons, phase 1).
--
-- A lesson has to come from somewhere. The obvious design is to give every
-- agent the ability to file one at the end of whatever it was doing, and it is
-- the wrong one twice over. It puts a second job in the context of an agent
-- hired to do a first, and it spreads the judgement of "is this worth making a
-- rule" across every agent in the workspace, where it is made once per run by
-- whoever happens to be running, with only that run in view. The signal that
-- actually justifies a rule is the opposite shape: the same clarification asked
-- twice, the same gate failing twice, rework that keeps landing in one place.
-- None of that is visible from inside a single run.
--
-- So proposing is one agent's job. A retrospective is one invocation of it over
-- a named scope, and this table is what makes that invocation a thing the
-- product can show, schedule, decline and count, rather than a chat someone had
-- once.
--
-- Three triggers, one row shape:
--
--   * 'suggestion' — an issue reached a done status after agents worked on it.
--     The server writes a row in `suggested` and asks, in the issue and in the
--     inbox. Answering is the whole interaction: start it, or dismiss it. The
--     unique index in migration 429 is what makes "asked once" true; without
--     it, every status touch would re-ask.
--   * 'manual' — someone pressed the button, on an issue, a project, or the
--     workspace.
--   * 'schedule' — an autopilot fired. Scope is the workspace or a project and
--     the window is `since`.
--
-- `suggested` is deliberately a status and not a separate table. A suggestion
-- that gets accepted becomes the run it suggested; keeping it as one row means
-- the answer to "did we ever look at this issue" is one lookup and does not
-- depend on joining a proposal to its acceptance.
--
-- No foreign keys, per the repo rule.

CREATE TABLE IF NOT EXISTS retrospective (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'suggested' CHECK (
        status IN ('suggested', 'dismissed', 'queued', 'running', 'completed', 'failed')
    ),
    scope TEXT NOT NULL CHECK (scope IN ('issue', 'project', 'workspace')),
    -- The issue or project being reviewed. NULL for workspace scope.
    scope_id UUID,
    trigger TEXT NOT NULL CHECK (trigger IN ('suggestion', 'manual', 'schedule')),
    -- Lower bound of the window for project and workspace scope. NULL for issue
    -- scope, where the issue's own history is the window.
    since TIMESTAMPTZ,

    -- Where the scan happens. Starting a retrospective files an issue assigned
    -- to the Lesson Learner and lets the ordinary assignee-triggered task flow
    -- run it, rather than adding a second way to dispatch an agent. That buys
    -- the transcript, the comment thread, the permission and attribution rules
    -- and the execution log for free, and it makes the scan a piece of work the
    -- team can see rather than a background job they cannot.
    issue_id UUID,
    -- The Learner run the issue produced. NULL until the retrospective starts,
    -- which for a suggestion may be never.
    task_id UUID,
    -- Set when a scheduled autopilot produced it.
    autopilot_id UUID,
    -- Who asked. NULL for suggestion and schedule, which nobody asked for.
    requested_by UUID,

    dismissed_at TIMESTAMPTZ,
    dismissed_by UUID,

    -- How many lessons the run filed. Denormalised because the list renders it
    -- for every row and the honest query is a count over a table the list does
    -- not otherwise touch.
    lesson_count INTEGER NOT NULL DEFAULT 0,
    failure_reason TEXT NOT NULL DEFAULT '',

    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE retrospective IS
    'One scan by the Lesson Learner over finished work. Suggested after an issue is done, started by hand, or fired on a schedule.';

COMMENT ON COLUMN retrospective.status IS
    'suggested means asked but not answered. Accepting moves it to queued; declining to dismissed. Both answers are final for that scope.';

-- Per-workspace switch for the "shall we run a retrospective" prompt. On by
-- default: the prompt is the only part of this feature that reaches someone who
-- did not go looking for it, and a workspace that finds it noisy needs a way to
-- stop it that is not "stop using the feature".
ALTER TABLE workspace
    ADD COLUMN IF NOT EXISTS retrospective_suggestions_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN workspace.retrospective_suggestions_enabled IS
    'Whether finishing an issue that agents worked on offers a retrospective. Does not affect manual or scheduled ones.';
