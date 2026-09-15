-- name: UsesFinalDelivery :one
SELECT EXISTS(SELECT 1 FROM agent_context_turn WHERE task_id=$1 AND final_delivery);

-- name: MarkContextProcessed :exec
UPDATE agent_context_turn SET processed=true WHERE task_id=$1
AND EXISTS(SELECT 1 FROM agent_context_checkpoint WHERE source_task_id=$1);

-- name: GetFinalDelivery :one
SELECT c.* FROM agent_final_delivery d JOIN comment c ON c.id=d.comment_id
WHERE d.task_id=$1 AND d.parent_key=$2 AND d.revision=$3;

-- name: CreateFinalDelivery :exec
INSERT INTO agent_final_delivery(task_id,workspace_id,issue_id,parent_key,revision,comment_id)
VALUES($1,$2,$3,$4,$5,$6);

-- name: CancelQueuedContextForTask :exec
UPDATE agent_context_operation o SET status='cancelled',reason='work stopped',finished_at=now(),updated_at=now()
FROM agent_context_session s WHERE s.id=o.session_id AND s.task_id=$1 AND o.status='queued';

-- name: DeleteContextScope :exec
WITH outbox AS (DELETE FROM agent_delivery_outbox o WHERE o.workspace_id=sqlc.arg(workspace_id) AND o.issue_id=sqlc.arg(scope_id) AND sqlc.arg(scope_type)::text='issue'),
requests AS (DELETE FROM agent_context_request r USING agent_context_session s WHERE r.session_id=s.id AND s.workspace_id=sqlc.arg(workspace_id) AND s.scope_type=sqlc.arg(scope_type) AND s.scope_id=sqlc.arg(scope_id)),
operations AS (DELETE FROM agent_context_operation o USING agent_context_session s
 WHERE o.session_id=s.id AND s.workspace_id=sqlc.arg(workspace_id) AND s.scope_type=sqlc.arg(scope_type) AND s.scope_id=sqlc.arg(scope_id)),
checkpoints AS (DELETE FROM agent_context_checkpoint c WHERE c.workspace_id=sqlc.arg(workspace_id) AND c.scope_type=sqlc.arg(scope_type) AND c.scope_id=sqlc.arg(scope_id)),
turns AS (DELETE FROM agent_context_turn t WHERE t.workspace_id=sqlc.arg(workspace_id) AND t.scope_type=sqlc.arg(scope_type) AND t.scope_id=sqlc.arg(scope_id)),
deliveries AS (DELETE FROM agent_final_delivery d WHERE d.workspace_id=sqlc.arg(workspace_id) AND d.issue_id=sqlc.arg(scope_id) AND sqlc.arg(scope_type)::text='issue')
DELETE FROM agent_context_session s WHERE s.workspace_id=sqlc.arg(workspace_id) AND s.scope_type=sqlc.arg(scope_type) AND s.scope_id=sqlc.arg(scope_id);

-- name: DeleteWorkspaceContext :exec
WITH outbox AS (DELETE FROM agent_delivery_outbox o WHERE o.workspace_id=$1),
requests AS (DELETE FROM agent_context_request r WHERE r.workspace_id=$1),
operations AS (DELETE FROM agent_context_operation o WHERE o.workspace_id=$1),
checkpoints AS (DELETE FROM agent_context_checkpoint c WHERE c.workspace_id=$1),
turns AS (DELETE FROM agent_context_turn t WHERE t.workspace_id=$1),
deliveries AS (DELETE FROM agent_final_delivery d WHERE d.workspace_id=$1)
DELETE FROM agent_context_session s WHERE s.workspace_id=$1;

-- name: AddDeliveryOutbox :exec
INSERT INTO agent_delivery_outbox(comment_id,workspace_id,issue_id,comment_revision,target_id,route)
VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(comment_id,comment_revision,target_id) DO NOTHING;

-- name: IsFinalDeliveryComment :one
SELECT EXISTS(SELECT 1 FROM agent_final_delivery d JOIN comment c ON c.id=d.comment_id WHERE d.comment_id=$1 AND c.revision=1);

-- name: HasFinalDeliveryForThread :one
SELECT EXISTS(SELECT 1 FROM agent_final_delivery WHERE task_id=$1 AND parent_key=$2);

-- name: FinalDeliveryRecorded :one
SELECT EXISTS(SELECT 1 FROM agent_final_delivery WHERE task_id=$1 AND parent_key=$2 AND revision=$3);
