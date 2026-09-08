ALTER TABLE semantic_connection DROP CONSTRAINT IF EXISTS semantic_connection_kind_check;
ALTER TABLE semantic_connection ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS semantic_catalog_revision (
 id UUID NOT NULL DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL,
 connection_id UUID NOT NULL, principal_id UUID NOT NULL, credential_revision TEXT NOT NULL,
 source_digest TEXT NOT NULL, source_revision TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL, entries JSONB NOT NULL DEFAULT '[]', warnings JSONB NOT NULL DEFAULT '[]',
 metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS semantic_source_snapshot (
 id UUID NOT NULL DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL,
 connection_id UUID NOT NULL, principal_id UUID NOT NULL, credential_revision TEXT NOT NULL,
 source_digest TEXT NOT NULL, source_revision TEXT NOT NULL DEFAULT '',
 documents JSONB NOT NULL DEFAULT '[]', metadata JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS semantic_ontology_revision (
 id UUID NOT NULL DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL,
 ontology_id UUID NOT NULL, digest TEXT NOT NULL, artifact JSONB NOT NULL,
 stages JSONB NOT NULL DEFAULT '[]', findings JSONB NOT NULL DEFAULT '[]',
 source_snapshot_ids JSONB NOT NULL DEFAULT '[]', review_required BOOLEAN NOT NULL DEFAULT true,
 created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
