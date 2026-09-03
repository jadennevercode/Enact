-- Resolve a finished Learner run back to the retrospective that launched it.
-- Read on every task terminal transition, so it is a lookup and not a scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_retrospective_task
    ON retrospective (task_id)
    WHERE task_id IS NOT NULL;
