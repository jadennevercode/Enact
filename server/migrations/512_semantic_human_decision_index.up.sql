CREATE INDEX CONCURRENTLY IF NOT EXISTS semantic_human_decision_construction_idx ON semantic_human_decision (workspace_id, construction_id, gate, created_at DESC);
