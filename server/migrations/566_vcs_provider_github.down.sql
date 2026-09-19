-- Narrowing back rejects any GitHub connection rows a deployment created while
-- the wider constraint was in force, so remove them first. A connection is
-- recoverable by reconnecting; a pull request row is a mirror of provider
-- state and is refetched by the next webhook.
DELETE FROM vcs_pull_request WHERE provider = 'github';
DELETE FROM vcs_connection WHERE provider = 'github';

ALTER TABLE vcs_pull_request
    DROP CONSTRAINT IF EXISTS vcs_pull_request_provider_check;
ALTER TABLE vcs_pull_request
    ADD CONSTRAINT vcs_pull_request_provider_check
    CHECK (provider IN ('forgejo', 'gitea', 'gitlab'));

ALTER TABLE vcs_connection
    DROP CONSTRAINT IF EXISTS vcs_connection_provider_check;
ALTER TABLE vcs_connection
    ADD CONSTRAINT vcs_connection_provider_check
    CHECK (provider IN ('forgejo', 'gitea', 'gitlab'));
