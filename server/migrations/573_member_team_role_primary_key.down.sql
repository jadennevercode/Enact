-- Dropping the constraint drops the index it took over, leaving 572's down
-- direction a no-op via IF EXISTS.
ALTER TABLE member_team_role DROP CONSTRAINT IF EXISTS member_team_role_pkey;
