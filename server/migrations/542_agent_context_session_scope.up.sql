CREATE UNIQUE INDEX CONCURRENTLY agent_context_session_scope_idx ON agent_context_session (workspace_id, agent_id, scope_type, scope_id);
