ALTER TABLE agent_context_operation ADD COLUMN started_at timestamptz,
 ADD COLUMN finished_at timestamptz, ADD COLUMN duration_ms bigint;
