-- Code graph build queue and history. See migration 540.

-- name: EnqueueCodeGraphBuild :one
-- Queues one build for a resource unless one is already queued or building.
-- The NOT EXISTS guard is the debounce: a push burst, a flag flip and a poll
-- all collapse onto the single pending row. lease_until is the earliest run
-- time for a queued row. Returns no row when a pending build already exists.
INSERT INTO code_graph_build (workspace_id, resource_id, project_key, repo_url, ref, head_commit, state, lease_until)
SELECT $1, $2, $3, $4, $5, sqlc.narg('head_commit'), 'queued', sqlc.narg('available_at')::timestamptz
WHERE NOT EXISTS (
    SELECT 1 FROM code_graph_build
    WHERE workspace_id = $1 AND resource_id = $2 AND state IN ('queued', 'building')
)
RETURNING *;

-- name: ClaimQueuedCodeGraphBuild :one
-- Claims one due build: a queued row whose earliest run time has passed, or a
-- building row whose lease expired (the worker that held it is gone). SKIP
-- LOCKED spreads work across replicas.
WITH candidate AS (
    SELECT id
    FROM code_graph_build
    WHERE (state = 'queued' AND (lease_until IS NULL OR lease_until <= now()))
       OR (state = 'building' AND lease_until IS NOT NULL AND lease_until <= now())
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE code_graph_build AS b
SET state = 'building',
    lease_until = now() + sqlc.arg('lease')::interval,
    attempts = attempts + 1
FROM candidate
WHERE b.id = candidate.id
RETURNING b.*;

-- name: CompleteCodeGraphBuild :one
-- Records the container's verdict on a claimed build. Only a row still in
-- `building` accepts it, so a worker that outlived its lease cannot overwrite
-- the outcome a later claimant recorded.
UPDATE code_graph_build
SET state = $2,
    commit = sqlc.narg('commit'),
    -- The container resolves an unpinned repository to its default branch, so
    -- the branch that was actually built is only known once it answers.
    ref = COALESCE(sqlc.narg('ref'), ref),
    skipped_reason = sqlc.narg('skipped_reason'),
    error = sqlc.narg('error'),
    stats = sqlc.narg('stats'),
    diff = sqlc.narg('diff'),
    report_md = sqlc.narg('report_md'),
    graphify_version = sqlc.narg('graphify_version'),
    lease_until = NULL,
    finished_at = now()
WHERE id = $1 AND state = 'building'
RETURNING *;

-- name: RetryCodeGraphBuild :one
-- Puts a claimed build back in the queue to run no earlier than available_at.
UPDATE code_graph_build
SET state = 'queued',
    lease_until = $2,
    error = sqlc.narg('error')
WHERE id = $1 AND state = 'building'
RETURNING *;

-- name: GetCodeGraphBuildInWorkspace :one
SELECT * FROM code_graph_build WHERE id = $1 AND workspace_id = $2;

-- name: GetLatestCodeGraphBuild :one
SELECT * FROM code_graph_build
WHERE workspace_id = $1 AND resource_id = $2
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- name: GetLatestReadyCodeGraphBuild :one
SELECT * FROM code_graph_build
WHERE workspace_id = $1 AND resource_id = $2 AND state = 'ready'
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- name: ListLatestCodeGraphBuildsByWorkspace :many
-- The newest row per resource, for the bulk status endpoint.
SELECT DISTINCT ON (resource_id) *
FROM code_graph_build
WHERE workspace_id = $1
ORDER BY resource_id, created_at DESC, id DESC;

-- name: ListLatestReadyCodeGraphBuildsByWorkspace :many
SELECT DISTINCT ON (resource_id) *
FROM code_graph_build
WHERE workspace_id = $1 AND state = 'ready'
ORDER BY resource_id, created_at DESC, id DESC;

-- name: HasPendingCodeGraphBuild :one
SELECT EXISTS (
    SELECT 1 FROM code_graph_build
    WHERE workspace_id = $1 AND resource_id = $2 AND state IN ('queued', 'building')
);

-- name: SetCodeGraphHeadCommit :exec
-- Records the newest default-branch commit the server has heard of on the
-- resource's newest row; status reads compare it with the latest ready build.
UPDATE code_graph_build
SET head_commit = $3
WHERE id = (
    SELECT newest.id FROM code_graph_build AS newest
    WHERE newest.workspace_id = $1 AND newest.resource_id = $2
    ORDER BY newest.created_at DESC, newest.id DESC
    LIMIT 1
);

-- name: PruneCodeGraphBuilds :exec
-- Keeps the newest N rows of a resource; pending rows are never pruned.
DELETE FROM code_graph_build
WHERE id IN (
    SELECT old.id FROM code_graph_build AS old
    WHERE old.workspace_id = $1 AND old.resource_id = $2 AND old.state NOT IN ('queued', 'building')
    ORDER BY old.created_at DESC, old.id DESC
    OFFSET $3
);

-- name: DeleteCodeGraphBuildsByResource :exec
DELETE FROM code_graph_build WHERE workspace_id = $1 AND resource_id = $2;

-- name: DeleteCodeGraphBuildsByWorkspace :exec
DELETE FROM code_graph_build WHERE workspace_id = $1;

-- name: ListCodeGraphEnabledResources :many
-- Every repository resource that opted into a code graph, across workspaces,
-- for the poll sweep.
SELECT * FROM workspace_resource
WHERE resource_type = 'github_repo'
  AND (resource_ref->>'code_graph')::boolean IS TRUE
ORDER BY workspace_id, created_at;

-- name: ListCodeGraphEnabledResourcesByWorkspace :many
SELECT * FROM workspace_resource
WHERE workspace_id = $1
  AND resource_type = 'github_repo'
  AND (resource_ref->>'code_graph')::boolean IS TRUE
ORDER BY position ASC, created_at ASC;
