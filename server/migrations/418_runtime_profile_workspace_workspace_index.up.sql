-- The hot read: list the profiles published into one workspace. Serves both
-- the settings list and the daemon's per-workspace registration fetch.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_runtime_profile_workspace_workspace
    ON runtime_profile_workspace (workspace_id);
