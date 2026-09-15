CREATE UNIQUE INDEX CONCURRENTLY agent_context_operation_active_idx ON agent_context_operation (session_id) WHERE status IN ('queued', 'running', 'reconciliation_required');
