-- Workspace team role catalog and who holds each role.
--
-- A team role is a functional role (business owner, architect, QA...), never a
-- permission. See migration 566 for the model.

-- name: ListTeamRoles :many
SELECT * FROM team_role
WHERE workspace_id = sqlc.arg('workspace_id')::uuid
  AND (sqlc.arg('include_archived')::bool OR archived_at IS NULL)
ORDER BY position, key;

-- name: GetTeamRoleByID :one
SELECT * FROM team_role
WHERE id = sqlc.arg('id')::uuid
  AND workspace_id = sqlc.arg('workspace_id')::uuid;

-- name: CountActiveTeamRoles :one
SELECT COUNT(*)::bigint FROM team_role
WHERE workspace_id = sqlc.arg('workspace_id')::uuid
  AND archived_at IS NULL;

-- name: CreateTeamRole :one
-- New roles go to the end of the list.
INSERT INTO team_role (workspace_id, key, name, description, color, position)
VALUES (
    sqlc.arg('workspace_id')::uuid,
    sqlc.arg('key')::text,
    sqlc.arg('name')::text,
    sqlc.arg('description')::text,
    sqlc.arg('color')::text,
    COALESCE(
        (SELECT MAX(position) + 1 FROM team_role
         WHERE workspace_id = sqlc.arg('workspace_id')::uuid),
        0
    )
)
RETURNING *;

-- name: CreateTeamRoleIfAbsent :execrows
-- Preset import. Idempotent: a role whose key or active name already exists is
-- left exactly as the workspace has it, so re-importing never overwrites a
-- rename or a recolor.
INSERT INTO team_role (workspace_id, key, name, description, color, position)
VALUES (
    sqlc.arg('workspace_id')::uuid,
    sqlc.arg('key')::text,
    sqlc.arg('name')::text,
    sqlc.arg('description')::text,
    sqlc.arg('color')::text,
    COALESCE(
        (SELECT MAX(position) + 1 FROM team_role
         WHERE workspace_id = sqlc.arg('workspace_id')::uuid),
        0
    )
)
ON CONFLICT DO NOTHING;

-- name: UpdateTeamRole :one
-- key is absent on purpose: it is immutable after create.
UPDATE team_role SET
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    color = COALESCE(sqlc.narg('color'), color),
    updated_at = now()
WHERE id = sqlc.arg('id')::uuid
  AND workspace_id = sqlc.arg('workspace_id')::uuid
  AND archived_at IS NULL
RETURNING *;

-- name: ArchiveTeamRole :one
-- Retires the role from future assignment. Assignments are kept.
UPDATE team_role SET
    archived_at = now(),
    updated_at = now()
WHERE id = sqlc.arg('id')::uuid
  AND workspace_id = sqlc.arg('workspace_id')::uuid
  AND archived_at IS NULL
RETURNING *;

-- name: RestoreTeamRole :one
-- Restored roles move to the end of the active list. The partial unique name
-- index rejects a restore whose name an active role has since taken.
UPDATE team_role SET
    archived_at = NULL,
    position = COALESCE(
        (SELECT MAX(t.position) + 1 FROM team_role t
         WHERE t.workspace_id = sqlc.arg('workspace_id')::uuid
           AND t.archived_at IS NULL),
        0
    ),
    updated_at = now()
WHERE id = sqlc.arg('id')::uuid
  AND workspace_id = sqlc.arg('workspace_id')::uuid
  AND archived_at IS NOT NULL
RETURNING *;

-- name: ListActiveTeamRoleIDs :many
SELECT id FROM team_role
WHERE workspace_id = sqlc.arg('workspace_id')::uuid
  AND archived_at IS NULL;

-- name: ReorderTeamRoles :execrows
-- Atomic reorder of every active role in one statement, so a failure leaves the
-- whole order untouched. Archived rows are frozen and excluded.
UPDATE team_role r
SET position = v.ordinality::int,
    updated_at = now()
FROM unnest(sqlc.arg('ids')::uuid[]) WITH ORDINALITY AS v(id, ordinality)
WHERE r.id = v.id
  AND r.workspace_id = sqlc.arg('workspace_id')::uuid
  AND r.archived_at IS NULL;

-- name: DeleteTeamRolesForWorkspace :exec
-- No foreign keys by repository rule, so workspace teardown cleans up here.
DELETE FROM team_role WHERE workspace_id = sqlc.arg('workspace_id')::uuid;

-- name: ListMemberTeamRoleRefs :many
-- Every member's roles in one round trip; the handler groups by actor_id.
-- Archived roles are included and flagged so a client can decide whether to
-- show them (the roster hides them, the member detail page shows them dimmed).
SELECT
    mtr.actor_id,
    tr.id,
    tr.key,
    tr.name,
    tr.color,
    (tr.archived_at IS NOT NULL)::bool AS archived
FROM member_team_role mtr
JOIN team_role tr
  ON tr.id = mtr.team_role_id
 AND tr.workspace_id = mtr.workspace_id
WHERE mtr.workspace_id = sqlc.arg('workspace_id')::uuid
  AND mtr.actor_type = 'member'
ORDER BY tr.position, tr.key;

-- name: ListTeamRoleRefsForMember :many
-- One member's roles, for the single-member payloads (member:added/updated).
SELECT
    tr.id,
    tr.key,
    tr.name,
    tr.color,
    (tr.archived_at IS NOT NULL)::bool AS archived
FROM member_team_role mtr
JOIN team_role tr
  ON tr.id = mtr.team_role_id
 AND tr.workspace_id = mtr.workspace_id
WHERE mtr.workspace_id = sqlc.arg('workspace_id')::uuid
  AND mtr.actor_type = 'member'
  AND mtr.actor_id = sqlc.arg('user_id')::uuid
ORDER BY tr.position, tr.key;

-- name: DeleteActiveTeamRoleAssignmentsForMember :exec
-- The replace half of "set this person's roles". Only assignments to ACTIVE
-- roles are cleared: an archived role cannot be offered in the picker, so a
-- save from the picker must not silently drop it either.
DELETE FROM member_team_role mtr
USING team_role tr
WHERE mtr.workspace_id = sqlc.arg('workspace_id')::uuid
  AND mtr.actor_type = 'member'
  AND mtr.actor_id = sqlc.arg('user_id')::uuid
  AND tr.id = mtr.team_role_id
  AND tr.workspace_id = mtr.workspace_id
  AND tr.archived_at IS NULL;

-- name: InsertMemberTeamRoles :execrows
INSERT INTO member_team_role (workspace_id, team_role_id, actor_type, actor_id)
SELECT sqlc.arg('workspace_id')::uuid, v.id, 'member', sqlc.arg('user_id')::uuid
FROM unnest(sqlc.arg('team_role_ids')::uuid[]) AS v(id)
ON CONFLICT DO NOTHING;

-- name: DeleteTeamRoleAssignmentsForMember :exec
-- Member removal / leave. Runs in the same transaction as the member-row
-- delete so a re-invited user does not silently reclaim their old roles.
DELETE FROM member_team_role
WHERE workspace_id = sqlc.arg('workspace_id')::uuid
  AND actor_type = 'member'
  AND actor_id = sqlc.arg('user_id')::uuid;

-- name: DeleteMemberTeamRolesForWorkspace :exec
DELETE FROM member_team_role WHERE workspace_id = sqlc.arg('workspace_id')::uuid;
