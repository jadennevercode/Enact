-- Remove the project.
--
-- A project grouped issues under a shared goal and carried the resources the
-- agents working those issues should see. In practice one workspace was
-- already the unit teams thought in — members, agents, skills, statuses,
-- labels and the issue prefix all live there, and `issue.project_id` was
-- nullable, so "no project" was a first-class state the product had to keep
-- explaining. The grouping layer earned its keep only through the resources,
-- and those moved to the workspace in migration 432.
--
-- Everything below is a dependent that cannot outlive the parent. Ordered so
-- that rows referencing a project are gone before the tables are.
--
-- Migration 435 must have run first: it took `issue.project_id` out of the
-- usage rollup's triggers and functions, which would otherwise break the
-- moment the column disappears.

-- Saved views scoped to a project. Their scope is gone, and a view whose
-- scope_id no longer resolves would render as an empty list with no
-- explanation, so they are deleted rather than repointed at the workspace:
-- a project view's filters were written against one slice of the work and
-- silently widening them to the whole workspace would show people a list
-- they never asked for.
DELETE FROM issue_view WHERE scope_type = 'project';
DELETE FROM issue_view_preference WHERE scope_type = 'project';

-- scope_id existed only to carry the project id. Both surviving scopes
-- (workspace, my) have always required it to be NULL.
ALTER TABLE issue_view
    DROP CONSTRAINT IF EXISTS issue_view_scope_type_check,
    DROP CONSTRAINT IF EXISTS issue_view_check,
    DROP CONSTRAINT IF EXISTS issue_view_scope_variant_pairing;

ALTER TABLE issue_view
    ADD CONSTRAINT issue_view_scope_type_check
        CHECK (scope_type IN ('workspace', 'my')),
    ADD CONSTRAINT issue_view_scope_id_absent
        CHECK (scope_id IS NULL),
    ADD CONSTRAINT issue_view_scope_variant_pairing CHECK (
        (scope_type = 'my' AND scope_variant IN ('assigned', 'created', 'involved', 'any'))
        OR (scope_type = 'workspace' AND (scope_variant IS NULL OR scope_variant IN ('members', 'agents')))
    );

-- The preference table keeps scope_id: it is part of the primary key and is
-- backfilled with the workspace id or the user id depending on scope, so it
-- never depended on a project existing.
ALTER TABLE issue_view_preference
    DROP CONSTRAINT IF EXISTS issue_view_preference_scope_type_check;

ALTER TABLE issue_view_preference
    ADD CONSTRAINT issue_view_preference_scope_type_check
        CHECK (scope_type IN ('workspace', 'my'));

-- Sidebar pins pointing at a project.
DELETE FROM pinned_item WHERE item_type = 'project';

ALTER TABLE pinned_item DROP CONSTRAINT IF EXISTS pinned_item_item_type_check;
ALTER TABLE pinned_item ADD CONSTRAINT pinned_item_item_type_check
    CHECK (item_type IN ('issue', 'view'));

-- Soft and hard references from the rest of the schema. Dropping a column
-- takes its indexes with it, so idx_issue_project, idx_chat_session_project
-- and the autopilot index need no separate statement.
ALTER TABLE issue        DROP COLUMN IF EXISTS project_id;
ALTER TABLE chat_session DROP COLUMN IF EXISTS project_id;
ALTER TABLE autopilot    DROP COLUMN IF EXISTS project_id;

-- The project's own tables. project_resource first: migration 432 copied it
-- to workspace_resource, and it is the only child.
DROP TABLE IF EXISTS project_resource;
DROP TABLE IF EXISTS project;
