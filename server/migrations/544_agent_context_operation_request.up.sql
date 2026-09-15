CREATE UNIQUE INDEX CONCURRENTLY agent_context_operation_request_idx ON agent_context_operation (workspace_id, actor_id, idempotency_key);
