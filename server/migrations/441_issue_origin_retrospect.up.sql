-- Extend issue.origin_type to allow the retrospect loop to stamp the
-- sub-issues it files with origin_type='retrospect' + origin_id=<the finished
-- issue's id>.
--
-- The stamp does three jobs at once, which is why it is worth a CHECK change
-- rather than a column of its own:
--
--   1. Provenance. A person opening the sub-issue can see it was filed by the
--      system in response to a specific piece of work, not typed by a
--      colleague.
--   2. Recursion guard. Finishing a retrospect sub-issue must not file a
--      retrospect on the retrospect. The listener reads origin_type and stops.
--   3. Once-only. Migration 443 builds a partial unique index on
--      (workspace_id, origin_id) where origin_type = 'retrospect', so an issue
--      that bounces in and out of a done status is retrospected the first time
--      and never again. That is the same "the index is the guarantee, the
--      pre-check is the optimisation" shape the retrospective suggestion used.
--
-- origin_id points at issue(id) here, where 'autopilot' points at autopilot(id),
-- 'quick_create' at agent_task_queue(id), and every *_chat origin at
-- chat_session(id). The column has always been a bare UUID whose meaning depends
-- on origin_type; nothing reads it polymorphically.
--
-- This only widens the allowed set, carrying forward every value migration 366
-- listed. Recreate the CHECK as NOT VALID so the ACCESS EXCLUSIVE lock is held
-- briefly; migration 442 performs the table scan under SHARE UPDATE EXCLUSIVE
-- without blocking normal reads and writes.
ALTER TABLE issue DROP CONSTRAINT IF EXISTS issue_origin_type_check;
ALTER TABLE issue ADD CONSTRAINT issue_origin_type_check
    CHECK (origin_type IN ('autopilot', 'quick_create', 'lark_chat', 'slack_chat', 'agent_create', 'dingtalk_chat', 'wecom_chat', 'telegram_chat', 'retrospect'))
    NOT VALID;
