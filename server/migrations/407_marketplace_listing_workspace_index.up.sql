-- The other half of every browse: a workspace's own listings, whatever their
-- visibility or status. Serves both the publisher's management list and the
-- workspace-internal library that browsing unions with the public rows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marketplace_listing_workspace
    ON marketplace_listing (workspace_id, kind, updated_at DESC);
