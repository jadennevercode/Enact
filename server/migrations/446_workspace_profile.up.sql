-- The workspace's project profile: what this team is building, in what, and
-- what kind of work they usually bring here.
--
-- It is a JSONB column rather than a table because every field is optional,
-- the shape is read whole or not at all, and nothing joins on any part of it.
-- The application owns the shape (handler/workspace_profile.go); Postgres only
-- guarantees it is an object, so a read never has to defend against a bare
-- string or an array arriving where a map is expected.
--
-- Two consumers depend on it:
--
--   - the task brief, which renders it as "## Project profile" so every run
--     starts knowing what the project is, the same way workspace.context
--     already reaches a run;
--   - the Marketplace recommender, which scores listings against `stack` and
--     `typical_work`.
--
-- No index. The recommender's daily pass reads every workspace that has one,
-- which is a sequential scan of a table with one row per workspace — a
-- cardinality where an index buys nothing and costs a write on every update.
ALTER TABLE workspace
    ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE workspace
    ADD CONSTRAINT workspace_profile_is_object
    CHECK (jsonb_typeof(profile) = 'object') NOT VALID;
