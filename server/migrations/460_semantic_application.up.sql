CREATE TABLE semantic_application (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    ontology_release_id uuid NOT NULL,
    published_build_id uuid,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE semantic_application_build (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    application_id uuid NOT NULL,
    source_revision text NOT NULL,
    digest text NOT NULL,
    manifest jsonb NOT NULL,
    files jsonb NOT NULL,
    report jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE semantic_application_deployment (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    application_id uuid NOT NULL,
    build_id uuid NOT NULL,
    published_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
