ALTER TABLE semantic_step DROP COLUMN IF EXISTS started_at;
ALTER TABLE semantic_step DROP COLUMN IF EXISTS attempt;
ALTER TABLE semantic_release DROP COLUMN IF EXISTS retirement_reason;
ALTER TABLE semantic_release DROP COLUMN IF EXISTS retired_by;
ALTER TABLE semantic_release DROP COLUMN IF EXISTS retired_at;
ALTER TABLE semantic_connection DROP COLUMN IF EXISTS enabled;
