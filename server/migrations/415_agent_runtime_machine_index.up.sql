-- Walk a machine's projections: every workspace this host is registered in.
-- Used by the machine-authoritative writes (rename, status, metadata) that
-- must reach each projection, and by the machine detail view.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_runtime_machine
    ON agent_runtime (machine_id);
