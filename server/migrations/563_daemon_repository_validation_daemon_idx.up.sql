CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daemon_repository_validation_daemon ON daemon_repository_validation(daemon_id, checked_at DESC);
