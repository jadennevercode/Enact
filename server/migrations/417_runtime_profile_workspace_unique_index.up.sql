-- A profile is published into a workspace at most once. Also the arbiter the
-- publish upsert conflicts on. Concurrent build per the repo migration rule,
-- in its own single-statement file.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_runtime_profile_workspace_unique
    ON runtime_profile_workspace (profile_id, workspace_id);
