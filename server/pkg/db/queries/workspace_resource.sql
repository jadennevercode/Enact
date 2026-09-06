-- Workspace resources: the repos and local directories a workspace's agents
-- work in. Replaces project_resource, which carried the same rows under the
-- project that no longer exists.

-- name: ListWorkspaceResources :many
SELECT * FROM workspace_resource
WHERE workspace_id = $1
ORDER BY position ASC, created_at ASC;

-- name: GetWorkspaceResource :one
SELECT * FROM workspace_resource
WHERE id = $1;

-- name: GetWorkspaceResourceInWorkspace :one
SELECT * FROM workspace_resource
WHERE id = $1 AND workspace_id = $2;

-- name: CreateWorkspaceResource :one
INSERT INTO workspace_resource (
    workspace_id, resource_type, resource_ref, label, position, created_by
) VALUES (
    $1, $2, $3, $4, $5, $6
) RETURNING *;

-- name: UpdateWorkspaceResource :one
UPDATE workspace_resource
SET resource_ref = $2,
    label        = $3,
    position     = $4
WHERE id = $1
RETURNING *;

-- name: DeleteWorkspaceResource :exec
DELETE FROM workspace_resource WHERE id = $1;

-- name: CountWorkspaceResources :one
SELECT count(*) FROM workspace_resource WHERE workspace_id = $1;
