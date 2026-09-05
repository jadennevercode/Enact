-- The Marketplace learns a fourth stored kind: an Agent Family (a squad in
-- code), published as a bundle of its agent members with the skills and MCP
-- servers each of them carries. Installing one materializes every member
-- agent and the squad that binds them, in one transaction, so the listing is
-- the unit of provenance and `marketplace_install.entity_id` names the squad.
--
-- Both constraints were created inline by migration 404 and therefore carry
-- PostgreSQL's default names. Rebuilding a CHECK constraint takes an
-- ACCESS EXCLUSIVE lock for the duration of the scan; both tables hold a few
-- hundred rows per deployment, so the scan is momentary.
ALTER TABLE marketplace_listing DROP CONSTRAINT IF EXISTS marketplace_listing_kind_check;
ALTER TABLE marketplace_listing ADD CONSTRAINT marketplace_listing_kind_check
    CHECK (kind IN ('skill', 'agent', 'mcp', 'squad'));

ALTER TABLE marketplace_install DROP CONSTRAINT IF EXISTS marketplace_install_entity_kind_check;
ALTER TABLE marketplace_install ADD CONSTRAINT marketplace_install_entity_kind_check
    CHECK (entity_kind IN ('skill', 'agent', 'mcp', 'squad'));
