-- The lessons list: one workspace, filtered by status, newest first. Also
-- serves the reviewer's "what is waiting on me" count.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lesson_workspace_status
    ON lesson (workspace_id, status, created_at DESC);
