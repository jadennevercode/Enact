-- A workspace cannot hold two roles with the same key; this is also the lookup
-- the CLI filter and the AI-SDLC resolver use.
CREATE UNIQUE INDEX CONCURRENTLY idx_team_role_workspace_key
    ON team_role (workspace_id, key);
