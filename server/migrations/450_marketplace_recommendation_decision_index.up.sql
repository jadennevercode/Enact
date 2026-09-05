-- One decision per (workspace, listing). It is the arbiter the dismissal
-- upsert conflicts on, so an INVALID leftover from an interrupted build would
-- not merely slow a read down — it would break ON CONFLICT and turn a second
-- dismissal into a duplicate row that the recommender would then have to
-- de-duplicate at read time.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_marketplace_recommendation_decision_unique
    ON marketplace_recommendation_decision (workspace_id, listing_id);
