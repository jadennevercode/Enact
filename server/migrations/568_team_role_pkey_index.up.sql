-- Backing index for team_role's primary key, attached in 569 via
-- PRIMARY KEY USING INDEX. Own single-statement migration so CONCURRENTLY runs
-- outside an implicit transaction (repo convention).
CREATE UNIQUE INDEX CONCURRENTLY team_role_pkey_uidx
    ON team_role (id);
