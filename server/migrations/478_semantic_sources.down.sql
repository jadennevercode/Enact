DROP TABLE IF EXISTS semantic_ontology_revision;
DROP TABLE IF EXISTS semantic_source_snapshot;
DROP TABLE IF EXISTS semantic_catalog_revision;
ALTER TABLE semantic_connection DROP COLUMN IF EXISTS capabilities;
