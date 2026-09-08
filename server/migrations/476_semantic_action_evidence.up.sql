ALTER TABLE semantic_approval ADD COLUMN IF NOT EXISTS evaluation_step_id UUID;
ALTER TABLE semantic_approval ADD COLUMN IF NOT EXISTS intent_id TEXT;
