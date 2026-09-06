-- Cross-workspace machines (runtime横切, phase 1).
--
-- Today a single physical machine that a user has connected to N workspaces
-- materialises N `agent_runtime` rows per provider, and every machine-level
-- fact is duplicated across them: the device name, the user-facing rename, the
-- CLI version metadata, the online status and the heartbeat timestamp. The
-- duplication is already visible in the schema as workarounds —
-- `UpdateAgentRuntimeCustomNameByDaemon` and `ListDaemonCustomNames` exist
-- purely to fan one rename across every row sharing a `daemon_id`, and the
-- frontend re-groups runtimes into machines client-side on the same key.
--
-- This migration names the thing those workarounds were approximating. A
-- `machine` is the computer plus the daemon running on it, owned by one user
-- and independent of any workspace. `agent_runtime` keeps its role but becomes
-- the projection of a machine into one workspace: which provider, which
-- profile, and — critically — whether that workspace's members may bind agents
-- to it. Assets cross workspaces; authorization does not.
--
-- `daemon_id` is already machine-scoped and stable: since the switch to a
-- persistent UUID it lives at `~/.enact/daemon.id`, shared by every CLI
-- profile on the host (see internal/daemon/identity.go). That makes it the
-- natural key here, and it is why this backfill can collapse existing rows
-- without asking the daemon anything.
--
-- Deliberately NOT moved here:
--   * `daemon_token` stays workspace-scoped. It is an authorization grant, not
--     a machine fact, and the member-revocation flow deletes tokens by
--     (workspace_id, daemon_id). Collapsing it to the machine would let
--     removing someone from one workspace cut their daemon off from every
--     other workspace they still belong to.
--   * `agent_runtime.visibility` stays per workspace. A machine shared with
--     one team must not become shared with another by side effect.
--
-- No foreign keys, per the repo rule: `owner_id` and `agent_runtime.machine_id`
-- are plain UUID columns and the application resolves and cleans up the
-- relationships explicitly.

CREATE TABLE IF NOT EXISTS machine (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The daemon's stable machine identity. Unique across the deployment; the
    -- unique index is built concurrently in migration 413.
    daemon_id TEXT NOT NULL,
    -- The user who runs this daemon. Nullable because a daemon token (mdt_)
    -- can register without resolving a member, exactly as agent_runtime.owner_id
    -- is nullable today.
    owner_id UUID,
    -- The device name the daemon proposes for itself (hostname, or --device-name).
    device_name TEXT NOT NULL DEFAULT '',
    -- User-facing override for device_name. NULL means "use what the daemon
    -- proposed". This is the field the per-workspace `custom_name` columns were
    -- trying to keep in sync.
    custom_name TEXT,
    -- What the daemon last advertised about itself: version, cli_version,
    -- launched_by, capabilities. Same shape agent_runtime.metadata carries.
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE machine IS
    'A computer running an Enact daemon. Owned by a user, independent of any workspace; agent_runtime projects it into each workspace.';

-- The projection link. NULL for cloud runtimes, which have no daemon and no
-- machine: runtime_mode = 'cloud' rows keep daemon_id NULL today and stay
-- machine-less here.
ALTER TABLE agent_runtime ADD COLUMN IF NOT EXISTS machine_id UUID;

COMMENT ON COLUMN agent_runtime.machine_id IS
    'The machine this runtime row projects into its workspace. NULL for cloud runtimes.';

-- Backfill. One machine per distinct daemon_id, assembled from the runtime
-- rows that share it:
--   * owner / device_name / metadata come from the most recently seen row,
--     which is the one whose registration is freshest.
--   * custom_name comes from the most recently updated row that actually has
--     one, so a rename applied in a single workspace survives the collapse
--     rather than being lost to a row that happened to be seen later.
--   * status / last_seen_at aggregate: the machine is online if any workspace
--     still considered it online.
-- Values that drift are self-correcting — the next daemon registration or
-- heartbeat rewrites them from the live process.
WITH freshest AS (
    SELECT DISTINCT ON (ar.daemon_id)
        ar.daemon_id,
        ar.owner_id,
        ar.device_info,
        ar.metadata
    FROM agent_runtime ar
    WHERE ar.daemon_id IS NOT NULL AND ar.daemon_id <> ''
    ORDER BY ar.daemon_id, ar.last_seen_at DESC NULLS LAST, ar.updated_at DESC
),
named AS (
    SELECT DISTINCT ON (ar.daemon_id)
        ar.daemon_id,
        ar.custom_name
    FROM agent_runtime ar
    WHERE ar.daemon_id IS NOT NULL AND ar.daemon_id <> ''
      AND ar.custom_name IS NOT NULL AND btrim(ar.custom_name) <> ''
    ORDER BY ar.daemon_id, ar.updated_at DESC
),
liveness AS (
    SELECT
        ar.daemon_id,
        max(ar.last_seen_at) AS last_seen_at,
        bool_or(ar.status = 'online') AS any_online,
        min(ar.created_at) AS created_at
    FROM agent_runtime ar
    WHERE ar.daemon_id IS NOT NULL AND ar.daemon_id <> ''
    GROUP BY ar.daemon_id
)
INSERT INTO machine (
    daemon_id, owner_id, device_name, custom_name, metadata,
    status, last_seen_at, created_at, updated_at
)
SELECT
    f.daemon_id,
    f.owner_id,
    -- device_info is "<device name> · <cli version>" when the daemon reported a
    -- version; the machine only wants the name half.
    btrim(split_part(COALESCE(f.device_info, ''), ' · ', 1)),
    n.custom_name,
    COALESCE(f.metadata, '{}'::jsonb),
    CASE WHEN l.any_online THEN 'online' ELSE 'offline' END,
    l.last_seen_at,
    COALESCE(l.created_at, now()),
    now()
FROM freshest f
JOIN liveness l ON l.daemon_id = f.daemon_id
LEFT JOIN named n ON n.daemon_id = f.daemon_id;

UPDATE agent_runtime ar
SET machine_id = m.id
FROM machine m
WHERE m.daemon_id = ar.daemon_id
  AND ar.machine_id IS NULL;
