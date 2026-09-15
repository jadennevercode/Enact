-- The worker's claim scan: due queued rows and building rows whose lease
-- expired.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_code_graph_build_queue
    ON code_graph_build (state, lease_until);
