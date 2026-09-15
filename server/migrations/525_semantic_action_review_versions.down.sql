ALTER TABLE semantic_approval
 DROP COLUMN IF EXISTS superseded_by,
 DROP COLUMN IF EXISTS supersedes_approval_id;
