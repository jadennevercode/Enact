CREATE INDEX CONCURRENTLY IF NOT EXISTS semantic_construction_event_idx ON semantic_construction_event (workspace_id, construction_id, created_at);
