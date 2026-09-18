-- Attach the CONCURRENTLY-built unique index as the table's primary key.
ALTER TABLE member_team_role
    ADD CONSTRAINT member_team_role_pkey PRIMARY KEY USING INDEX member_team_role_pkey_uidx;
