CREATE INDEX CONCURRENTLY IF NOT EXISTS semantic_model_operation_runtime_idx ON semantic_model_operation (runtime_id, status, created_at);
