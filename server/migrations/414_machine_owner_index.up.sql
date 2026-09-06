-- "My machines" is the primary cross-workspace read: the runtimes page lists
-- the machines a user owns without going through any workspace.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_machine_owner
    ON machine (owner_id);
