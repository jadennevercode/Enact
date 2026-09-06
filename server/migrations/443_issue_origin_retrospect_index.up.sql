-- At most one retrospect sub-issue per finished issue. This is the index that
-- makes "retrospect once" true: the sub-issue insert is guarded by it, so an
-- issue reopened and finished again is not retrospected twice.
--
-- Partial, because the other origins are repeatable by design — an autopilot
-- files an issue on every run, and quick-create on every invocation.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_issue_origin_retrospect
    ON issue (workspace_id, origin_id)
    WHERE origin_type = 'retrospect' AND origin_id IS NOT NULL;
