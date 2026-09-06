-- At most one setup issue per (workspace, step). This is what makes "file the
-- setup checklist once" true rather than merely likely: a workspace that
-- predates this feature is backfilled the first time its setup is read, and
-- two clients can reach that read at the same moment.
--
-- The step identity rides in origin_id: the parent uses the workspace's own
-- id, and each step a UUID derived from the workspace id and the step key
-- (see workspacesetup.StepOriginID). Deriving it rather than adding a second
-- column keeps the uniqueness in one index the insert conflicts on, and keeps
-- the step key readable from the row without a join.
--
-- Partial, because every other origin is repeatable by design — an autopilot
-- files an issue on every run.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_issue_origin_workspace_setup
    ON issue (workspace_id, origin_id)
    WHERE origin_type = 'workspace_setup' AND origin_id IS NOT NULL;
