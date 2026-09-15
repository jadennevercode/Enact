CREATE UNIQUE INDEX CONCURRENTLY agent_final_delivery_identity ON agent_final_delivery(task_id,parent_key,revision);
