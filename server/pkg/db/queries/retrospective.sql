-- Retrospectives: one Lesson Learner scan over a scope of finished work.

-- name: CreateRetrospective :one
INSERT INTO retrospective (
    workspace_id, status, scope, scope_id, trigger, since,
    autopilot_id, requested_by
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: SuggestIssueRetrospective :one
-- Written when an issue that agents worked on reaches a done status. The
-- conflict target is the partial unique index from migration 429, so an issue
-- that bounces in and out of done is offered a retrospective once and never
-- again, whatever the answer was. DO NOTHING means the caller gets ErrNoRows
-- for an issue that was already offered one — the expected case, not a failure.
INSERT INTO retrospective (workspace_id, status, scope, scope_id, trigger)
VALUES ($1, 'suggested', 'issue', $2, 'suggestion')
ON CONFLICT (workspace_id, scope_id) WHERE scope = 'issue' AND scope_id IS NOT NULL
DO NOTHING
RETURNING *;

-- name: GetRetrospective :one
SELECT * FROM retrospective WHERE id = $1;

-- name: GetRetrospectiveInWorkspace :one
SELECT * FROM retrospective WHERE id = $1 AND workspace_id = $2;

-- name: GetIssueRetrospective :one
SELECT * FROM retrospective
WHERE workspace_id = $1 AND scope = 'issue' AND scope_id = $2;

-- name: GetRetrospectiveByTask :one
SELECT * FROM retrospective WHERE task_id = $1;

-- name: ListRetrospectivesByWorkspace :many
SELECT * FROM retrospective
WHERE workspace_id = $1
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountActiveRetrospectives :one
-- The manual trigger refuses to start a second scan while one is still in
-- flight: they read the same window and would file the same lessons twice.
SELECT count(*) FROM retrospective
WHERE workspace_id = $1 AND status IN ('queued', 'running');

-- name: StartRetrospective :one
-- Accepting a suggestion, or launching a manual or scheduled scan. Guarded on
-- the statuses a start is legal from so a double click cannot queue two runs.
UPDATE retrospective SET
    status = 'queued',
    issue_id = $2,
    task_id = $3,
    requested_by = COALESCE(sqlc.narg('requested_by'), requested_by),
    started_at = now(),
    updated_at = now()
WHERE id = $1 AND status IN ('suggested', 'queued')
RETURNING *;

-- name: GetRetrospectiveByIssue :one
SELECT * FROM retrospective WHERE issue_id = $1;

-- name: MarkRetrospectiveRunning :one
UPDATE retrospective SET status = 'running', updated_at = now()
WHERE id = $1 AND status = 'queued'
RETURNING *;

-- name: DismissRetrospective :one
UPDATE retrospective SET
    status = 'dismissed',
    dismissed_at = now(),
    dismissed_by = $2,
    updated_at = now()
WHERE id = $1 AND status = 'suggested'
RETURNING *;

-- name: CompleteRetrospective :one
UPDATE retrospective SET
    status = 'completed',
    lesson_count = $2,
    completed_at = now(),
    updated_at = now()
WHERE id = $1 AND status IN ('queued', 'running')
RETURNING *;

-- name: FailRetrospective :one
UPDATE retrospective SET
    status = 'failed',
    failure_reason = $2,
    completed_at = now(),
    updated_at = now()
WHERE id = $1 AND status IN ('queued', 'running')
RETURNING *;

-- name: DeleteRetrospectivesByWorkspace :exec
DELETE FROM retrospective WHERE workspace_id = $1;

-- name: SetRetrospectiveTask :one
-- Links the Learner run back to the retrospective. Separate from
-- StartRetrospective because the task is enqueued after that transaction
-- commits: the daemon can claim a task faster than an open transaction settles,
-- and a claim that cannot read its own issue fails for no good reason.
UPDATE retrospective SET task_id = $2, updated_at = now()
WHERE id = $1
RETURNING *;
