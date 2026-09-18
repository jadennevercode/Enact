-- Display names must stay unambiguous among ACTIVE roles; archived rows are
-- excluded so an archived name can be reused.
CREATE UNIQUE INDEX CONCURRENTLY idx_team_role_workspace_name_active
    ON team_role (workspace_id, lower(name))
    WHERE archived_at IS NULL;
