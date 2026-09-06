-- Product-facing brand renames are intentionally irreversible. Replacing
-- Enact on rollback would also corrupt copy that already used the product name
-- before this migration.
SELECT 1;
