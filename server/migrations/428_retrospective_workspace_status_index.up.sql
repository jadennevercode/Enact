-- The retrospectives list, and the "is anything running" check the manual
-- trigger makes before starting another one.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_retrospective_workspace_status
    ON retrospective (workspace_id, status, created_at DESC);
