ALTER TABLE semantic_approval
 ADD COLUMN IF NOT EXISTS supersedes_approval_id UUID,
 ADD COLUMN IF NOT EXISTS superseded_by UUID;
