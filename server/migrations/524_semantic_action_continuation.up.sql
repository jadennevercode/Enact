ALTER TABLE semantic_approval ADD COLUMN IF NOT EXISTS continuation JSONB NOT NULL DEFAULT '{}'::jsonb;
