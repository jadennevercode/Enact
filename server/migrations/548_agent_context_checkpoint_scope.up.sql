CREATE INDEX CONCURRENTLY agent_context_checkpoint_scope_idx ON agent_context_checkpoint (workspace_id, scope_type, scope_id, created_at DESC);
