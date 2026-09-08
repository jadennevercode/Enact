CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS semantic_release_version ON semantic_release(workspace_id, ontology_id, version);
