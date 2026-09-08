CREATE INDEX CONCURRENTLY IF NOT EXISTS semantic_source_snapshot_scope ON semantic_source_snapshot(workspace_id,connection_id,principal_id,created_at DESC);
