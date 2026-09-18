-- Who holds which team role. Many-to-many: one person can be both developer
-- and QA, which is the normal case on a small team rather than a compromise.
--
-- actor_type/actor_id mirrors issue.assignee_type/assignee_id so agents can be
-- given team roles later without a migration. v1 only ever writes 'member'.
--
-- actor_id for 'member' is the USER id, not the membership-row id: user_id is
-- the actor identity everywhere else in the product (mention://member/<user_id>,
-- issue assignee_id, activity actor_id).
--
-- workspace_id is denormalized so every read filters by it (repo rule) and so
-- workspace teardown is a single DELETE. No foreign keys; team_role archive
-- keeps these rows, member removal and workspace deletion delete them in the
-- application transaction.
CREATE TABLE member_team_role (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    team_role_id UUID NOT NULL,
    actor_type TEXT NOT NULL DEFAULT 'member' CHECK (actor_type IN ('member', 'agent')),
    actor_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
