-- A version string is published once per listing. This index is what makes
-- immutability a database rule rather than a convention the service is
-- trusted to keep.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_marketplace_listing_version_unique
    ON marketplace_listing_version (listing_id, version);
