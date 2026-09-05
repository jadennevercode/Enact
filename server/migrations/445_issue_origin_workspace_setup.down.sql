-- Narrow the CHECK back to the set migration 441 allowed. Rows stamped with
-- the two values this migration added would violate it, so they are cleared
-- first: the stamp is provenance, and losing it degrades the setup checklist
-- to "nothing filed yet" rather than corrupting an issue.
UPDATE issue SET origin_type = NULL, origin_id = NULL
WHERE origin_type IN ('workspace_setup', 'repo_analysis');

ALTER TABLE issue DROP CONSTRAINT IF EXISTS issue_origin_type_check;
ALTER TABLE issue ADD CONSTRAINT issue_origin_type_check
    CHECK (origin_type IN ('autopilot', 'quick_create', 'lark_chat', 'slack_chat', 'agent_create', 'dingtalk_chat', 'wecom_chat', 'telegram_chat', 'retrospect'))
    NOT VALID;
