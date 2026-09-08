CREATE INDEX CONCURRENTLY IF NOT EXISTS semantic_construction_ontology_idx ON semantic_construction (workspace_id, ontology_id, created_at DESC);
