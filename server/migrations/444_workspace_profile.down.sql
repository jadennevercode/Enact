ALTER TABLE workspace DROP CONSTRAINT IF EXISTS workspace_profile_is_object;
ALTER TABLE workspace DROP COLUMN IF EXISTS profile;
