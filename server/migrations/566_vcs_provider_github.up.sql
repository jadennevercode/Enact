-- Admit 'github' as a token-based provider. The CHECK listed the three
-- providers that existed when self-hosted Git shipped; GitHub reached Enact
-- only through the App integration and its own tables, so it was never a
-- vcs_connection value. A workspace can now connect GitHub.com or an
-- Enterprise Server with a token instead, which stores an ordinary connection
-- row and mirrors pull requests through the same normalized path.
--
-- The constraints are dropped and recreated rather than widened in place;
-- PostgreSQL has no ALTER CONSTRAINT for a CHECK. IF EXISTS on the drop keeps
-- this replayable against a database whose constraint was already replaced.

ALTER TABLE vcs_connection
    DROP CONSTRAINT IF EXISTS vcs_connection_provider_check;
ALTER TABLE vcs_connection
    ADD CONSTRAINT vcs_connection_provider_check
    CHECK (provider IN ('forgejo', 'gitea', 'gitlab', 'github'));

ALTER TABLE vcs_pull_request
    DROP CONSTRAINT IF EXISTS vcs_pull_request_provider_check;
ALTER TABLE vcs_pull_request
    ADD CONSTRAINT vcs_pull_request_provider_check
    CHECK (provider IN ('forgejo', 'gitea', 'gitlab', 'github'));
