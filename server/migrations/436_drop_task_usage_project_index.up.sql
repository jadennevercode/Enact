-- Migration 435 stopped writing task_usage_hourly.project_id, so the partial
-- index that served the dashboard's per-project breakdown now covers nothing
-- (its predicate is `project_id IS NOT NULL`) and can never be used again.
DROP INDEX CONCURRENTLY IF EXISTS idx_task_usage_hourly_workspace_project_time;
