CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS squad_system_identity_unique
    ON squad (workspace_id, system_key)
    WHERE system_key IS NOT NULL;
