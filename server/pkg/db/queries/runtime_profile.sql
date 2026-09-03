-- Custom Runtime profiles (ENA-3284). Owner-held definitions of a custom
-- runtime, published into one or more workspaces; see migrations 120 and 416.
-- Relational integrity (owner, workspace, created_by) is enforced in the
-- application layer — there are no DB FKs.
--
-- Scoping rule for everything below: `runtime_profile.workspace_id` is the
-- ORIGIN workspace and is NOT an access check. Whether a workspace may see or
-- register a profile is decided by a row in `runtime_profile_workspace`.

-- name: CreateRuntimeProfile :one
INSERT INTO runtime_profile (
    workspace_id,
    display_name,
    protocol_family,
    command_name,
    description,
    fixed_args,
    visibility,
    created_by,
    owner_id,
    enabled
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: GetRuntimeProfile :one
SELECT * FROM runtime_profile
WHERE id = $1;

-- name: GetRuntimeProfileForWorkspace :one
-- Workspace-facing read. The publication join IS the access check: a profile
-- id from a workspace this profile was never published into returns no row, so
-- callers keep answering 404 exactly as they did when workspace_id was the
-- check.
SELECT rp.*, rpw.enabled AS workspace_enabled
FROM runtime_profile rp
JOIN runtime_profile_workspace rpw
  ON rpw.profile_id = rp.id AND rpw.workspace_id = @workspace_id
WHERE rp.id = @id;

-- name: LockRuntimeProfileForRegistration :one
-- Serializes daemon registration with profile deletion. Registration holds a
-- KEY SHARE lock until its runtime row is committed; profile deletion takes an
-- UPDATE lock, then locks the profile's runtime rows. Whichever starts first
-- wins, so deletion cannot miss a runtime inserted from a stale profile read.
--
-- The publication join keeps the pre-publication guarantee intact: a daemon
-- may only register a profile in a workspace the profile actually reaches.
-- Only the profile row is locked — locking the publication row too would make
-- an unrelated publish/unpublish in another workspace block registration here.
SELECT rp.*, rpw.enabled AS workspace_enabled
FROM runtime_profile rp
JOIN runtime_profile_workspace rpw
  ON rpw.profile_id = rp.id AND rpw.workspace_id = @workspace_id
WHERE rp.id = @id
FOR KEY SHARE OF rp;

-- name: LockRuntimeProfileForDelete :one
-- See LockRuntimeProfileForRegistration. The stronger lock prevents a daemon
-- from registering another instance between the delete plan and commit.
-- Deleting the definition is the owner's act and reaches every workspace it
-- was published into, so this is keyed on the profile alone.
SELECT * FROM runtime_profile
WHERE id = @id
FOR UPDATE;

-- name: ListRuntimeProfilesForWorkspace :many
-- Everything published into one workspace, whatever workspace it originated
-- in. `workspace_enabled` is that workspace's own switch; `enabled` on the
-- profile is the owner's global one. A caller deciding whether a profile is
-- live must require both.
SELECT rp.*, rpw.enabled AS workspace_enabled, rpw.published_by
FROM runtime_profile rp
JOIN runtime_profile_workspace rpw
  ON rpw.profile_id = rp.id AND rpw.workspace_id = @workspace_id
ORDER BY rp.created_at ASC;

-- name: ListRuntimeProfilesByOwner :many
-- The owner's cross-workspace management view: every definition they hold,
-- with the number of workspaces each currently reaches.
SELECT rp.*, (
    SELECT count(*) FROM runtime_profile_workspace rpw
    WHERE rpw.profile_id = rp.id
) AS workspace_count
FROM runtime_profile rp
WHERE rp.owner_id = @owner_id
ORDER BY rp.created_at ASC;

-- name: ListEnabledRuntimeProfilesForDaemon :many
-- What a daemon should try to register in one workspace.
--
-- A runtime profile describes how to launch a command that exists on ONE
-- person's machine, resolved on that person's PATH. It is therefore a fact
-- about them, not about a team, and it follows its owner into every workspace
-- they belong to — whatever role they hold there. Configuring a wrapper once
-- must not mean re-typing it on joining the next workspace.
--
-- Two ways a profile is live here, and the second is the one that makes it
-- personal:
--   * published into this workspace, so EVERY member's daemon registers it —
--     the team-standard case an admin sets up;
--   * owned by the operator of this daemon, wherever they are.
--
-- A workspace that has explicitly turned a published profile off keeps it off
-- even for its owner: that switch is the workspace saying this command should
-- not run on its work, which is a legitimate thing for it to decide about its
-- own workspace. The owner's global `enabled` retires it everywhere.
--
-- @owner_id is the daemon operator, resolved from the machine. NULL when it
-- cannot be resolved, which collapses this to the published-only behaviour
-- rather than leaking anyone's profiles.
SELECT rp.*
FROM runtime_profile rp
LEFT JOIN runtime_profile_workspace rpw
  ON rpw.profile_id = rp.id AND rpw.workspace_id = @workspace_id
WHERE rp.enabled = true
  AND (rpw.profile_id IS NULL OR rpw.enabled = true)
  AND (
      rpw.profile_id IS NOT NULL
      OR (@owner_id::uuid IS NOT NULL AND rp.owner_id = @owner_id)
  )
ORDER BY rp.created_at ASC;

-- name: ListRuntimeProfilesVisibleInWorkspace :many
-- The user-facing counterpart of ListEnabledRuntimeProfilesForDaemon: what
-- THIS reader can see and use in this workspace. Same union — published here,
-- or theirs — so the list matches what their daemon will actually register.
-- Disabled rows are included; the UI shows them as off rather than hiding them.
SELECT rp.*, COALESCE(rpw.enabled, true) AS workspace_enabled, rpw.published_by,
       (rpw.profile_id IS NOT NULL) AS published_here
FROM runtime_profile rp
LEFT JOIN runtime_profile_workspace rpw
  ON rpw.profile_id = rp.id AND rpw.workspace_id = @workspace_id
WHERE rpw.profile_id IS NOT NULL
   OR (@owner_id::uuid IS NOT NULL AND rp.owner_id = @owner_id)
ORDER BY rp.created_at ASC;

-- name: GetRuntimeProfileVisibleInWorkspace :one
-- Access check for a single profile. Mirrors the list: published here, or the
-- reader's own. A profile that is neither is indistinguishable from one that
-- does not exist.
SELECT rp.*, COALESCE(rpw.enabled, true) AS workspace_enabled,
       (rpw.profile_id IS NOT NULL) AS published_here
FROM runtime_profile rp
LEFT JOIN runtime_profile_workspace rpw
  ON rpw.profile_id = rp.id AND rpw.workspace_id = @workspace_id
WHERE rp.id = @id
  AND (
      rpw.profile_id IS NOT NULL
      OR (@owner_id::uuid IS NOT NULL AND rp.owner_id = @owner_id)
  );

-- name: ListEnabledRuntimeProfilesForWorkspace :many
-- Daemon-facing list: only profiles that are live in this workspace are
-- candidates for a daemon to resolve on PATH and register. Live means enabled
-- on BOTH switches — the owner has not retired the definition globally, and
-- this workspace has not opted out. Ordered for stable output, which the
-- daemon's profile-set signature relies on being deterministic.
SELECT rp.*
FROM runtime_profile rp
JOIN runtime_profile_workspace rpw
  ON rpw.profile_id = rp.id AND rpw.workspace_id = @workspace_id
WHERE rp.enabled = true AND rpw.enabled = true
ORDER BY rp.created_at ASC;

-- name: UpdateRuntimeProfile :one
-- Partial update via COALESCE: NULL args leave the column unchanged. The
-- protocol_family is intentionally NOT updatable — changing the underlying
-- backend of an existing profile would silently repoint every agent bound to
-- it onto a different protocol; callers create a new profile instead.
UPDATE runtime_profile
SET display_name = COALESCE(sqlc.narg('display_name'), display_name),
    command_name = COALESCE(sqlc.narg('command_name'), command_name),
    description  = COALESCE(sqlc.narg('description'), description),
    fixed_args   = COALESCE(sqlc.narg('fixed_args'), fixed_args),
    visibility   = COALESCE(sqlc.narg('visibility'), visibility),
    enabled      = COALESCE(sqlc.narg('enabled'), enabled),
    updated_at   = now()
-- Owner-scoped compare-and-set. The handler has already decided the actor may
-- edit (see profileEditAuthority); passing the owner it authorized against
-- makes a concurrent ownership change fail the update instead of silently
-- applying it under new ownership. IS NOT DISTINCT FROM so a legacy row with a
-- NULL owner still matches when the handler passes NULL.
WHERE id = @id AND owner_id IS NOT DISTINCT FROM @owner_id
RETURNING *;

-- name: DeleteRuntimeProfile :exec
-- Deletes the definition itself. Owner-gated at the handler; the publication
-- rows and every workspace's runtime instances are removed in the same
-- transaction by the queries below.
DELETE FROM runtime_profile
WHERE id = $1;

-- name: PublishRuntimeProfileToWorkspace :one
-- Makes a profile available in a workspace. Idempotent: re-publishing an
-- existing link re-enables it and records who did it, rather than erroring, so
-- a publish after an opt-out is the obvious undo.
INSERT INTO runtime_profile_workspace (profile_id, workspace_id, published_by, enabled)
VALUES (@profile_id, @workspace_id, @published_by, true)
ON CONFLICT (profile_id, workspace_id)
DO UPDATE SET
    enabled = true,
    published_by = COALESCE(EXCLUDED.published_by, runtime_profile_workspace.published_by),
    updated_at = now()
RETURNING *;

-- name: UnpublishRuntimeProfileFromWorkspace :execrows
-- Withdraws a profile from ONE workspace. The definition and every other
-- workspace's use of it are untouched. The caller tears down that workspace's
-- runtime instances first, in the same transaction.
DELETE FROM runtime_profile_workspace
WHERE profile_id = @profile_id AND workspace_id = @workspace_id;

-- name: SetRuntimeProfileWorkspaceEnabled :one
-- The consuming workspace's own on/off switch. Distinct from unpublishing:
-- disabling keeps the link so the workspace can turn it back on without the
-- owner re-publishing.
UPDATE runtime_profile_workspace
SET enabled = @enabled, updated_at = now()
WHERE profile_id = @profile_id AND workspace_id = @workspace_id
RETURNING *;

-- name: DeleteRuntimeProfilePublications :many
-- Removes every publication of a profile. Part of the owner's delete
-- transaction. Returns the workspaces so the caller can broadcast a
-- profile-set change to each one's daemons.
DELETE FROM runtime_profile_workspace
WHERE profile_id = $1
RETURNING workspace_id;

-- name: CountRuntimeProfilePublications :one
-- How far the definition has spread. The edit-authority rule reads this and
-- nothing else about the other workspaces, so it must not join `workspace` —
-- a count is not a disclosure, a name would be.
SELECT count(*) FROM runtime_profile_workspace
WHERE profile_id = $1;

-- name: ListRuntimeProfileWorkspaceIDs :many
-- The workspaces a definition currently reaches, ids only. Used to fan a
-- profile-set change out to every affected workspace's daemons after an edit.
SELECT workspace_id FROM runtime_profile_workspace
WHERE profile_id = $1;

-- name: ListRuntimeProfilePublications :many
-- Where a profile is currently published, for the owner's management view.
SELECT rpw.*, w.name AS workspace_name, w.slug AS workspace_slug
FROM runtime_profile_workspace rpw
JOIN workspace w ON w.id = rpw.workspace_id
WHERE rpw.profile_id = $1
ORDER BY w.name ASC;

-- name: DeleteAgentRuntimesByProfile :many
-- Application-layer cascade: migration 120 dropped the DB ON DELETE CASCADE, so
-- the profile-delete path must remove the profile's registered runtime
-- instances itself. Returns the deleted rows so the caller can broadcast /
-- audit. Runs inside the same transaction as DeleteRuntimeProfile.
--
-- Workspace-scoped variant: this is the unpublish path, which must only touch
-- the withdrawing workspace.
DELETE FROM agent_runtime
WHERE profile_id = $1 AND workspace_id = $2
RETURNING id, workspace_id, owner_id, daemon_id, provider;

-- name: CountAgentsByProfile :one
-- Counts active (non-archived) agents bound to any runtime instance of this
-- profile. The unpublish path uses this to refuse withdrawal (409) while
-- agents still depend on it, mirroring the runtime-delete guard.
SELECT count(*) FROM agent a
JOIN agent_runtime ar ON ar.id = a.runtime_id
WHERE ar.profile_id = $1 AND ar.workspace_id = $2 AND a.archived_at IS NULL;

-- name: ListAgentRuntimeIDsByProfile :many
-- Enumerates the runtime instance rows registered against a profile. The
-- profile-delete cascade walks these so it can run the same archived-agent /
-- archived-squad / autopilot teardown the runtime-delete path uses before
-- removing each runtime row — agent.runtime_id is ON DELETE RESTRICT, so a
-- bare delete would 500 whenever an archived agent still references the row.
SELECT id FROM agent_runtime
WHERE profile_id = $1 AND workspace_id = $2
ORDER BY id
FOR UPDATE;
