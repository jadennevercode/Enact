ALTER TABLE squad
    DROP COLUMN IF EXISTS system_key;

ALTER TABLE workspace
    DROP COLUMN IF EXISTS sdlc_defaults_version;
