CREATE INDEX CONCURRENTLY IF NOT EXISTS semantic_review_packet_construction_idx ON semantic_review_packet (workspace_id, construction_id, gate, sequence DESC);
