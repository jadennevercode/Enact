ALTER TABLE semantic_release ADD COLUMN IF NOT EXISTS test_data jsonb NOT NULL DEFAULT '{}';
