-- Extend issue.origin_type so the product can stamp the two issues it files
-- on a workspace's behalf during setup:
--
--   'workspace_setup' — the "Set up <workspace>" issue and its steps, filed
--     when the workspace is created. origin_id is the workspace's own id.
--   'repo_analysis'   — the run that reads a newly connected repository and
--     writes what it found into workspace.profile. origin_id is the
--     workspace_resource row that triggered it.
--
-- The stamp does the same three jobs the 'retrospect' stamp does:
--
--   1. Provenance. A member opening the issue can see the product filed it,
--      not a colleague.
--   2. Identification. `GET /api/workspaces/{id}/setup` finds the steps by
--      this value rather than by their titles, which are localized and which
--      an owner is free to rewrite.
--   3. Once-only. Migrations 447 and 448 build partial unique indexes so a
--      retried create, two tabs, or a second resource cannot file a second
--      copy of either.
--
-- Only widens the allowed set, carrying forward every value migration 441
-- listed. NOT VALID so the ACCESS EXCLUSIVE lock is held briefly; migration
-- 446 performs the scan under SHARE UPDATE EXCLUSIVE.
ALTER TABLE issue DROP CONSTRAINT IF EXISTS issue_origin_type_check;
ALTER TABLE issue ADD CONSTRAINT issue_origin_type_check
    CHECK (origin_type IN ('autopilot', 'quick_create', 'lark_chat', 'slack_chat', 'agent_create', 'dingtalk_chat', 'wecom_chat', 'telegram_chat', 'retrospect', 'workspace_setup', 'repo_analysis'))
    NOT VALID;
