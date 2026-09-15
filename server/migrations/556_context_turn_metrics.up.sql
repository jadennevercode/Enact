ALTER TABLE agent_context_turn ADD COLUMN first_snapshot jsonb, ADD COLUMN last_snapshot jsonb, ADD COLUMN peak_tokens bigint NOT NULL DEFAULT 0;
