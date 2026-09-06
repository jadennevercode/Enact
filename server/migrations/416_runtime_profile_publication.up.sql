-- Cross-workspace runtime profiles (runtime横切, phase 2).
--
-- A runtime profile is a definition of a custom runtime: which protocol family
-- it speaks, which command to resolve on PATH, which fixed args every agent on
-- it inherits. That is a description of a tool, not a fact about a team, and a
-- platform engineer who standardises one in-house Codex wrapper should define
-- it once rather than re-typing it in every workspace they support.
--
-- So the profile gains an owner and a publication list:
--
--   * `owner_id` — the person accountable for the definition. Backfilled from
--     `created_by`. The owner is the only one who may edit the definition
--     itself, because editing it changes behaviour in every workspace it
--     reaches.
--   * `runtime_profile_workspace` — where the definition is currently
--     published. A workspace only sees, and a daemon only registers, profiles
--     published into it.
--
-- `runtime_profile.workspace_id` is retained and keeps its value, but its
-- meaning narrows to the ORIGIN workspace: where the profile was first
-- created. It is no longer the access check. Every read that asks "may this
-- workspace use this profile" must go through runtime_profile_workspace.
--
-- Two enable switches, deliberately:
--   * `runtime_profile.enabled` is the owner's global switch. Off means the
--     definition is retired everywhere at once.
--   * `runtime_profile_workspace.enabled` is the consuming workspace's switch.
--     Off means this team has opted out without touching anyone else.
-- A daemon registers a profile in a workspace only when BOTH are true, which
-- keeps a workspace admin's existing power to disable a runtime for their team
-- while giving the owner a way to withdraw a broken definition globally.
--
-- No foreign keys, per the repo rule.

ALTER TABLE runtime_profile ADD COLUMN IF NOT EXISTS owner_id UUID;

COMMENT ON COLUMN runtime_profile.owner_id IS
    'The user who owns this definition and may edit it. Backfilled from created_by.';

UPDATE runtime_profile
SET owner_id = created_by
WHERE owner_id IS NULL;

COMMENT ON COLUMN runtime_profile.workspace_id IS
    'Origin workspace: where this profile was created. NOT the access check — see runtime_profile_workspace.';

COMMENT ON COLUMN runtime_profile.enabled IS
    'Owner-level global switch. A workspace also has its own switch on runtime_profile_workspace.enabled; both must be true to register.';

CREATE TABLE IF NOT EXISTS runtime_profile_workspace (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    -- Who published it here. A profile reaching a workspace is a decision made
    -- in that workspace, so this is the accountable person for the workspace
    -- side of the link, distinct from the profile's owner.
    published_by UUID,
    -- The consuming workspace's own on/off switch. See the header note.
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE runtime_profile_workspace IS
    'Publication of a runtime profile into a workspace. Authoritative for whether a workspace may use the profile.';

-- Backfill: every existing profile is published exactly where it already was,
-- carrying its current enabled state into the workspace-level switch so no
-- team's runtimes change availability on deploy.
INSERT INTO runtime_profile_workspace (
    profile_id, workspace_id, published_by, enabled, created_at, updated_at
)
SELECT rp.id, rp.workspace_id, rp.created_by, rp.enabled, rp.created_at, now()
FROM runtime_profile rp
WHERE NOT EXISTS (
    SELECT 1 FROM runtime_profile_workspace rpw
    WHERE rpw.profile_id = rp.id AND rpw.workspace_id = rp.workspace_id
);
