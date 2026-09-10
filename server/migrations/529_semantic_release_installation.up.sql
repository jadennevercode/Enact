CREATE TABLE IF NOT EXISTS semantic_release_installation (
    workspace_id uuid NOT NULL,
    ontology_id uuid NOT NULL,
    release_id uuid NOT NULL,
    source_workspace_id uuid NOT NULL,
    source_ontology_id uuid NOT NULL,
    source_release_id uuid NOT NULL,
    source_release_digest text NOT NULL,
    source_governance jsonb NOT NULL,
    connection_mapping jsonb NOT NULL,
    target_catalogs jsonb NOT NULL,
    preview_digest text NOT NULL,
	adoption_rationale text NOT NULL,
    adopted_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
