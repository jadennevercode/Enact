CREATE TABLE IF NOT EXISTS semantic_construction (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    ontology_id uuid NOT NULL,
    issue_id uuid NOT NULL,
    squad_id uuid NOT NULL,
    created_by uuid NOT NULL,
    source_snapshot_ids jsonb NOT NULL DEFAULT '[]',
    competency_questions jsonb NOT NULL DEFAULT '[]',
    status text NOT NULL DEFAULT 'active',
    stage text NOT NULL DEFAULT 'scope',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS semantic_construction_event (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    construction_id uuid NOT NULL,
    task_id uuid,
    actor_type text NOT NULL,
    actor_id uuid NOT NULL,
    stage text NOT NULL,
    kind text NOT NULL,
    message text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);
