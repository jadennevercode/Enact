-- Rows of kind 'squad' would violate the narrowed constraint, so they are
-- swept first: a downgrade that cannot represent a listing cannot keep it.
DELETE FROM marketplace_install WHERE entity_kind = 'squad';
DELETE FROM marketplace_listing_file WHERE version_id IN (
    SELECT v.id FROM marketplace_listing_version v
    JOIN marketplace_listing l ON l.id = v.listing_id
    WHERE l.kind = 'squad'
);
DELETE FROM marketplace_listing_version WHERE listing_id IN (
    SELECT id FROM marketplace_listing WHERE kind = 'squad'
);
DELETE FROM marketplace_listing WHERE kind = 'squad';

ALTER TABLE marketplace_listing DROP CONSTRAINT IF EXISTS marketplace_listing_kind_check;
ALTER TABLE marketplace_listing ADD CONSTRAINT marketplace_listing_kind_check
    CHECK (kind IN ('skill', 'agent', 'mcp'));

ALTER TABLE marketplace_install DROP CONSTRAINT IF EXISTS marketplace_install_entity_kind_check;
ALTER TABLE marketplace_install ADD CONSTRAINT marketplace_install_entity_kind_check
    CHECK (entity_kind IN ('skill', 'agent', 'mcp'));
