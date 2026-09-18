-- Dropping the constraint drops the index it took over, leaving 567's down
-- direction a no-op via IF EXISTS.
ALTER TABLE team_role DROP CONSTRAINT IF EXISTS team_role_pkey;
