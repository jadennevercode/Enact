-- Per-agent resource selection. See migration 444: a row means this agent
-- opted into this workspace resource. Only knowledge_repo resources are bound
-- here today.

-- name: ListAgentResources :many
SELECT wr.* FROM workspace_resource wr
JOIN agent_resource ar ON ar.resource_id = wr.id
WHERE ar.agent_id = $1
ORDER BY wr.position ASC, wr.created_at ASC;

-- name: ListAgentResourcesOfType :many
SELECT wr.* FROM workspace_resource wr
JOIN agent_resource ar ON ar.resource_id = wr.id
WHERE ar.agent_id = $1 AND wr.resource_type = $2
ORDER BY wr.position ASC, wr.created_at ASC;

-- name: AddAgentResource :exec
INSERT INTO agent_resource (agent_id, resource_id, created_by)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: RemoveAgentResource :exec
DELETE FROM agent_resource WHERE agent_id = $1 AND resource_id = $2;

-- name: RemoveAllAgentResources :exec
DELETE FROM agent_resource WHERE agent_id = $1;

-- name: RemoveAgentResourceBindings :exec
DELETE FROM agent_resource WHERE resource_id = $1;

-- name: ListAgentIDsForResource :many
SELECT agent_id FROM agent_resource WHERE resource_id = $1;
