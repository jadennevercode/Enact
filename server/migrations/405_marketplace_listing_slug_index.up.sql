-- A slug identifies a listing to its publisher, so it must not collide within
-- a workspace for the same kind. Scoped rather than global on purpose: see the
-- land-grab note in 404. Concurrent build per the repo migration rule, in its
-- own single-statement file because Postgres rejects CONCURRENTLY inside a
-- transaction or a multi-command string.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_marketplace_listing_slug
    ON marketplace_listing (workspace_id, kind, slug);
