-- LP numbers are unique within a workspace. The index is also what the
-- application reads to allocate the next number, and what the "open LP-12"
-- lookup resolves against. Concurrent build in its own single-statement file.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_lesson_workspace_number
    ON lesson (workspace_id, number DESC);
