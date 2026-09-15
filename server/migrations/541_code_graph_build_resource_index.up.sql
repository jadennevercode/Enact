-- Newest-first lookup of a resource's builds: status reads, report reads and
-- the keep-newest-N prune all walk this order.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_code_graph_build_resource
    ON code_graph_build (workspace_id, resource_id, created_at DESC);
