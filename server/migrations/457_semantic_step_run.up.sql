CREATE INDEX CONCURRENTLY IF NOT EXISTS semantic_step_run ON semantic_step(workspace_id,run_id,created_at);
