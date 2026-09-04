-- Retrospect sub-issues must go before the constraint can narrow again, or the
-- ADD CONSTRAINT fails on its own data. They are a derived artifact — the work
-- they reviewed is untouched — but any comments a person left on one go with
-- them, so this is not a clean reversal.
DELETE FROM issue WHERE origin_type = 'retrospect';

-- Back to the set migration 366 established, and back to NOT VALID: PostgreSQL
-- cannot mark a validated constraint NOT VALID, so this recreates the state
-- migration 442's validation left rather than a stricter one.
ALTER TABLE issue DROP CONSTRAINT IF EXISTS issue_origin_type_check;
ALTER TABLE issue ADD CONSTRAINT issue_origin_type_check
    CHECK (origin_type IN ('autopilot', 'quick_create', 'lark_chat', 'slack_chat', 'agent_create', 'dingtalk_chat', 'wecom_chat', 'telegram_chat'))
    NOT VALID;
