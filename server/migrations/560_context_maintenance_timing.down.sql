ALTER TABLE agent_context_operation DROP COLUMN IF EXISTS duration_ms,
 DROP COLUMN IF EXISTS finished_at, DROP COLUMN IF EXISTS started_at;
