-- The routing lookup: "who in this workspace holds role X".
CREATE INDEX CONCURRENTLY idx_member_team_role_role
    ON member_team_role (workspace_id, team_role_id);
