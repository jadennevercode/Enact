-- The version history a reader opens on a listing: newest first, per listing.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marketplace_listing_version_listing
    ON marketplace_listing_version (listing_id, created_at DESC);
