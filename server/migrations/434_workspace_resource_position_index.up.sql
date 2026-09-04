-- Serves the only read the list view makes: a workspace's resources in order.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_resource_workspace
    ON workspace_resource (workspace_id, position);
