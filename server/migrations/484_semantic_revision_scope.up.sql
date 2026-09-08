CREATE INDEX CONCURRENTLY IF NOT EXISTS semantic_ontology_revision_scope ON semantic_ontology_revision(workspace_id,ontology_id,created_at DESC);
