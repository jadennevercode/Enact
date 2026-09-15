CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS agent_context_request_identity_idx ON agent_context_request(workspace_id,actor_id,idempotency_key);
