-- One assignment per (actor, role). Its (workspace_id, actor_type, actor_id)
-- prefix also serves the per-person lookup and the member-removal cleanup.
CREATE UNIQUE INDEX CONCURRENTLY idx_member_team_role_unique
    ON member_team_role (workspace_id, actor_type, actor_id, team_role_id);
