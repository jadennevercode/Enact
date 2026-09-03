-- "Has this workspace already installed this listing, and at which version?"
-- — asked once per card while browsing, so it must not be a sequential scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marketplace_install_workspace
    ON marketplace_install (workspace_id, listing_id, created_at DESC);
