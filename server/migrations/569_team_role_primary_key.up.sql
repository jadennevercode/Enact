-- Attach the CONCURRENTLY-built unique index as the table's primary key.
ALTER TABLE team_role
    ADD CONSTRAINT team_role_pkey PRIMARY KEY USING INDEX team_role_pkey_uidx;
