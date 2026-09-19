DROP TABLE IF EXISTS daemon_repository_validation;

ALTER TABLE vcs_connection
    DROP COLUMN IF EXISTS change_request_status,
    DROP COLUMN IF EXISTS git_write_status,
    DROP COLUMN IF EXISTS git_read_status,
    DROP COLUMN IF EXISTS webhook_status,
    DROP COLUMN IF EXISTS api_status,
    DROP COLUMN IF EXISTS last_validated_at,
    DROP COLUMN IF EXISTS ca_pem_encrypted,
    DROP COLUMN IF EXISTS clone_host,
    DROP COLUMN IF EXISTS token_expires_at,
    DROP COLUMN IF EXISTS token_scopes,
    DROP COLUMN IF EXISTS token_type,
    DROP COLUMN IF EXISTS git_token_encrypted;
