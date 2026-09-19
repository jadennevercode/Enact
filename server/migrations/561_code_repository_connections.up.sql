-- Managed HTTPS credentials and per-daemon repository validation. Secrets use
-- the same ENACT_VCS_SECRET_KEY envelope as the existing VCS access token.
-- Relationships intentionally have no foreign keys; handlers scope and clean
-- rows explicitly.

ALTER TABLE vcs_connection
    ADD COLUMN IF NOT EXISTS git_token_encrypted TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS token_type TEXT NOT NULL DEFAULT 'personal',
    ADD COLUMN IF NOT EXISTS token_scopes TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS clone_host TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS ca_pem_encrypted TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS api_status TEXT NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS webhook_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS git_read_status TEXT NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS git_write_status TEXT NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS change_request_status TEXT NOT NULL DEFAULT 'unknown';

CREATE TABLE IF NOT EXISTS daemon_repository_validation (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    resource_id UUID NOT NULL,
    daemon_id TEXT NOT NULL,
    read_status TEXT NOT NULL DEFAULT 'unknown',
    write_status TEXT NOT NULL DEFAULT 'unknown',
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
