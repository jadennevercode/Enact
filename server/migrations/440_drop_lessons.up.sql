-- Remove the standalone lessons module.
--
-- Lessons were a review queue of their own: an agent proposed a skill edit as
-- a `lesson` row, a person found it on a dedicated Lessons page, and approving
-- it published a new skill version. The retrospective that produced those
-- proposals was offered as a suggestion the person had to accept, and running
-- it filed a top-level issue.
--
-- Both halves are replaced by one thing the product already has: an issue.
-- Finishing an issue in a workspace that has configured a Retrospect Agent
-- files a retrospect sub-issue under it (migrations 441-443), and that
-- sub-issue is where the review happens — the proposal is a comment, the
-- approval is a reply, and the sub-issue's own status carries the state that
-- `lesson.status` and `retrospective.status` used to. Nothing needs a second
-- inbox, a second review page, or a second set of statuses to learn.
--
-- The data does not survive. The product is not live; a lesson's value was the
-- skill edit it published, and those edits are already in `skill` and
-- `skill_version` where they will stay.

-- Skill versions outlive lessons. `skill_version` is the history of every
-- skill write, from imports, refreshes, rollbacks and seeding as well as
-- lesson publications, and it is load-bearing for the skill detail page and
-- for rollback. Only the pointer back to the lesson goes.
--
-- The 'lesson' source value is rewritten to 'retrospect' rather than dropped:
-- those rows are real history — a retrospect did produce them, through the
-- lesson flow that used to carry it — and blanking them would leave the
-- version list saying "manual" about edits no person made.
UPDATE skill_version SET source = 'retrospect' WHERE source = 'lesson';

ALTER TABLE skill_version DROP CONSTRAINT IF EXISTS skill_version_source_check;
ALTER TABLE skill_version ADD CONSTRAINT skill_version_source_check
    CHECK (source IN ('backfill', 'manual', 'import', 'refresh', 'retrospect', 'rollback', 'seed'));

ALTER TABLE skill_version DROP COLUMN IF EXISTS lesson_id;

-- lesson_event before lesson: it is the child, and the application resolves
-- that relationship itself (no foreign keys, per the repo rule), so nothing
-- else will clean it up.
DROP TABLE IF EXISTS lesson_event;
DROP TABLE IF EXISTS lesson;
DROP TABLE IF EXISTS retrospective;

-- The workspace's switch for offering retrospectives, and the provisioning
-- marker for the Lesson Learner bundle.
--
-- Neither is replaced by a new column. The Retrospect Agent is not seeded into
-- every workspace, so there is no version to reconcile at boot; and whether a
-- workspace retrospects is answered by whether it has a live Retrospect Agent,
-- so a separate boolean would be a second source of truth for the same fact.
ALTER TABLE workspace DROP COLUMN IF EXISTS retrospective_suggestions_enabled;
ALTER TABLE workspace DROP COLUMN IF EXISTS lessons_defaults_version;
