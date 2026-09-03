-- "Profiles I own" — the owner's cross-workspace management view, and the
-- source list the daemon fetches for its operator.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_runtime_profile_owner
    ON runtime_profile (owner_id);
