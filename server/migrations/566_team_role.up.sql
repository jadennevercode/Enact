-- Workspace team role catalog.
--
-- A team role is a FUNCTIONAL role a person plays on the team (business owner,
-- architect, developer, QA, ops) — the kind of judgement they are asked for.
-- It is NOT a permission: member.role (owner/admin/member) remains the only
-- thing that gates access, and nothing here widens or narrows it. The product
-- calls member.role "permission" and this concept "role"; the code keeps the
-- `team_role` prefix so the two can never be confused in a grep.
--
-- Consumers: review routing. The AI-SDLC suite maps each phase to the team
-- roles that review it, and resolves who holds a role from this catalog.
--
-- No foreign keys (workspace_id is an application-layer relation, per the
-- project's database rules); cleanup is handled by the application.
--
-- id is NOT declared inline as PRIMARY KEY: the backing unique index is built
-- CONCURRENTLY in its own single-statement migration (567) and attached with
-- PRIMARY KEY USING INDEX (568), following migrations 332-334.
CREATE TABLE team_role (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,

    -- Stable machine handle. Immutable after create: it is what the CLI filter,
    -- the AI-SDLC phase_review config and agent instructions reference, so a
    -- rename must never strand them.
    key TEXT NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9_]{0,31}$'),

    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
    description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 256),
    color TEXT NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
    position DOUBLE PRECISION NOT NULL DEFAULT 0,

    -- Archiving retires a role from future assignment. Existing assignments
    -- are kept so history and restore stay lossless.
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
