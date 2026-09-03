-- The public directory read: every published, publicly visible listing of one
-- kind, newest first. Partial so the index holds only the rows browsing can
-- return — drafts and taken-down listings never appear in it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marketplace_listing_browse
    ON marketplace_listing (kind, updated_at DESC)
    WHERE visibility = 'public' AND status = 'published';
