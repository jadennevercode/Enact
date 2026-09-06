-- Machines: the computer running a daemon, owned by a user and independent of
-- any workspace. See migration 412. `agent_runtime` rows are this machine's
-- projections into the workspaces it is registered in; anything that is true of
-- the host rather than of a team belongs here.
--
-- Relational integrity (owner_id, agent_runtime.machine_id) is enforced in the
-- application layer — there are no DB FKs.

-- name: UpsertMachine :one
-- Daemon registration writes the machine once per register call, before any of
-- its per-workspace runtime rows. The arbiter is the unique index on daemon_id
-- (migration 413), which is the daemon's persistent machine UUID.
--
-- custom_name is deliberately absent from the update set: it is the user's
-- rename and the daemon must never clobber it, exactly as the runtime upserts
-- keep custom_name out of their DO UPDATE. owner_id is COALESCEd so a daemon
-- token (mdt_) registration, which cannot resolve a member, preserves the owner
-- established by an earlier PAT/JWT registration.
INSERT INTO machine (
    daemon_id,
    owner_id,
    device_name,
    metadata,
    status,
    last_seen_at
) VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (daemon_id)
DO UPDATE SET
    owner_id = COALESCE(EXCLUDED.owner_id, machine.owner_id),
    device_name = EXCLUDED.device_name,
    metadata = EXCLUDED.metadata,
    status = EXCLUDED.status,
    last_seen_at = now(),
    updated_at = now()
RETURNING *;

-- name: GetMachine :one
SELECT * FROM machine
WHERE id = $1;

-- name: GetMachineByDaemonID :one
SELECT * FROM machine
WHERE daemon_id = $1;

-- name: ListMachinesByOwner :many
-- The cross-workspace "my machines" read. Not workspace-scoped on purpose:
-- this is the view that shows one host once instead of once per workspace.
SELECT * FROM machine
WHERE owner_id = $1
ORDER BY created_at ASC;

-- name: ListMachinesByIDs :many
-- Batch load for the workspace-scoped runtime list, which resolves each
-- runtime row's machine in one round trip rather than per row.
SELECT * FROM machine
WHERE id = ANY(@ids::uuid[]);

-- name: UpdateMachineCustomName :one
-- Sets or clears the machine's user-facing name. One write now reaches every
-- workspace the machine is projected into, which is what the per-workspace
-- UpdateAgentRuntimeCustomNameByDaemon fan-out was approximating. Gated at the
-- handler to the machine owner.
UPDATE machine
SET custom_name = @custom_name, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: TouchMachineLastSeen :execrows
-- Hot heartbeat path. Mirrors TouchAgentRuntimeLastSeen: the status='online'
-- predicate is load-bearing because the stale-runtime sweeper can flip the row
-- between a caller's read and this write, and updated_at is deliberately not
-- touched so the row stays HOT-eligible.
UPDATE machine
SET last_seen_at = now()
WHERE id = $1 AND status = 'online';

-- name: MarkMachineOnline :one
-- The offline→online transition, and the first heartbeat after registration.
-- Writes updated_at because a status flip is a real state change.
UPDATE machine
SET status = 'online', last_seen_at = now(), updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetMachineOffline :exec
UPDATE machine
SET status = 'offline', updated_at = now()
WHERE id = $1;

-- name: SyncMachineStatusFromRuntimes :exec
-- Reconciles a machine's liveness from its projections. The stale-runtime
-- sweeper and the deregister path flip individual agent_runtime rows; a
-- machine is online exactly while at least one of its projections is, so this
-- recomputes rather than guessing. A machine with no projections left keeps
-- its row and goes offline — the host still exists, it is just registered
-- nowhere.
UPDATE machine m
SET status = CASE
        WHEN EXISTS (
            SELECT 1 FROM agent_runtime ar
            WHERE ar.machine_id = m.id AND ar.status = 'online'
        ) THEN 'online'
        ELSE 'offline'
    END,
    last_seen_at = GREATEST(
        m.last_seen_at,
        (SELECT max(ar.last_seen_at) FROM agent_runtime ar WHERE ar.machine_id = m.id)
    ),
    updated_at = now()
WHERE m.id = $1;

-- name: ListMachineWorkspaceProjections :many
-- Every workspace this machine is registered in, with the runtime rows that
-- carry the registration. Powers the machine detail view: one host, the list
-- of teams it serves, and the per-workspace visibility that governs each.
--
-- Restricted to workspaces the reading user is a member of, so a machine
-- detail view can never disclose the existence of a workspace the reader does
-- not belong to — even to the machine's own owner.
SELECT
    ar.id AS runtime_id,
    ar.workspace_id,
    w.name AS workspace_name,
    w.slug AS workspace_slug,
    ar.provider,
    ar.profile_id,
    ar.visibility,
    ar.status,
    ar.last_seen_at
FROM agent_runtime ar
JOIN workspace w ON w.id = ar.workspace_id
JOIN member m ON m.workspace_id = ar.workspace_id AND m.user_id = @user_id
WHERE ar.machine_id = @machine_id
ORDER BY w.name ASC, ar.provider ASC;

-- name: CountMachineWorkspaceProjections :one
-- How many workspaces this machine is registered in, unfiltered by reader.
-- Used for the "removing this machine affects N workspaces" confirmation, where
-- the count matters but the workspace identities must not be disclosed.
SELECT count(*) FROM agent_runtime
WHERE machine_id = $1;

-- name: ListAgentRuntimeIDsByMachine :many
-- The machine's projections, locked in a deterministic order. The machine-wide
-- teardown walks these so each workspace's runtime row goes through the same
-- agent/squad/autopilot unbind the single-runtime delete performs.
SELECT id FROM agent_runtime
WHERE machine_id = $1
ORDER BY id
FOR UPDATE;

-- name: DeleteMachine :exec
DELETE FROM machine
WHERE id = $1;

-- name: BackfillAgentRuntimeMachine :execrows
-- Links any runtime row that predates the machine table, or that was written
-- by a server old enough not to set machine_id, to its machine. Idempotent and
-- cheap; the registration path calls it for the daemon it just registered so a
-- rolling deploy converges without waiting on a backfill job.
UPDATE agent_runtime ar
SET machine_id = @machine_id
WHERE ar.daemon_id = @daemon_id
  AND ar.machine_id IS DISTINCT FROM @machine_id;
