-- Run read-only against a selected workspace. Set the psql variable ws_id first.
-- The window snapshots are independent of the existing task_usage billing ledger.
SELECT t.task_id, t.agent_id, t.scope_type, t.scope_id,
       q.runtime_id, q.status, t.source_revision, t.processed, t.final_delivery,
       octet_length(t.envelope::text) AS source_manifest_bytes,
       COALESCE(octet_length(t.delivered_envelope::text),0) AS delivered_envelope_bytes,
       t.envelope->>'complete' AS source_complete,
       t.envelope->>'gap' AS source_gap,
       extract(epoch FROM (q.started_at-q.created_at)) AS queue_to_start_seconds,
       extract(epoch FROM (q.completed_at-q.started_at)) AS run_seconds,
       t.first_snapshot, t.last_snapshot, t.peak_tokens
FROM agent_context_turn t JOIN agent_task_queue q ON q.id=t.task_id
WHERE t.workspace_id=:'ws_id'::uuid ORDER BY t.created_at DESC;

-- Maintenance accounting never enters the business completion/leader route.
SELECT o.id, o.session_id, s.agent_id, s.runtime_id, s.provider, s.capabilities,
       o.status, o.reason, o.created_at, o.updated_at, o.started_at, o.finished_at,
       extract(epoch FROM (o.started_at-o.created_at)) AS maintenance_wait_seconds,
       o.duration_ms AS native_maintenance_ms,
       o.before_snapshot, o.after_snapshot, o.usage
FROM agent_context_operation o JOIN agent_context_session s ON s.id=o.session_id
WHERE o.workspace_id=:'ws_id'::uuid ORDER BY o.created_at DESC;

SELECT status, count(*) AS target_count
FROM agent_delivery_outbox WHERE workspace_id=:'ws_id'::uuid GROUP BY status;
