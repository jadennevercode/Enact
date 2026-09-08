CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS semantic_model_operation_active_task_idx ON semantic_model_operation (task_id) WHERE status IN ('pending','running');
