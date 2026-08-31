DO $$
DECLARE
    legacy_user_column TEXT := 'multi' || 'ca_user_id';
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'lark_user_binding'
          AND column_name = legacy_user_column
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'lark_user_binding'
          AND column_name = 'enact_user_id'
    ) THEN
        EXECUTE format(
            'ALTER TABLE lark_user_binding RENAME COLUMN %I TO enact_user_id',
            legacy_user_column
        );
    END IF;
END $$;
