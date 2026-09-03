-- Reading one file of a version is a point lookup by path, and a version must
-- not be able to ship the same path twice.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_marketplace_listing_file_path
    ON marketplace_listing_file (version_id, path);
