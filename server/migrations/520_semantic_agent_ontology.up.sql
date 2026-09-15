CREATE TABLE semantic_agent_ontology (
    workspace_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    ontology_id uuid NOT NULL,
    release_id uuid NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    updated_by uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
