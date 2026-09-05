-- Validation is not reversible on its own. Migration 445's down recreates the
-- constraint NOT VALID, which is the state this migration advanced from.
SELECT 1;
