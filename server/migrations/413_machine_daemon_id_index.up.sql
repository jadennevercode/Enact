-- One machine per daemon identity. `daemon_id` is the persistent UUID the
-- daemon keeps at ~/.enact/daemon.id, so this is the deployment-wide identity
-- of a physical host and the arbiter the registration upsert conflicts on.
-- Concurrent build per the repo migration rule, in its own single-statement
-- file because Postgres rejects CONCURRENTLY inside a transaction or a
-- multi-command string.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_machine_daemon_id
    ON machine (daemon_id);
