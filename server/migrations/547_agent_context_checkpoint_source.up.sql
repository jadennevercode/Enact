CREATE UNIQUE INDEX CONCURRENTLY agent_context_checkpoint_source_idx ON agent_context_checkpoint (source_task_id, revision);
