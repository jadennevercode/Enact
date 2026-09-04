-- One row per (workspace, type, ref). Concurrent and in its own migration, per
-- the repo rule; migration 432's backfill already folded the duplicates the
-- project-to-workspace key change could produce.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_workspace_resource_key
    ON workspace_resource (workspace_id, resource_type, resource_ref);
