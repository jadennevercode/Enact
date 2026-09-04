CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_usage_hourly_workspace_project_time
    ON task_usage_hourly (workspace_id, project_id, bucket_hour DESC)
    WHERE project_id IS NOT NULL;
