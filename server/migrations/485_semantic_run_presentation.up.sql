CREATE TABLE IF NOT EXISTS semantic_run_presentation (
 workspace_id UUID NOT NULL, run_id UUID NOT NULL, application_id UUID NOT NULL,
 application_build_id UUID NOT NULL, principal_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
