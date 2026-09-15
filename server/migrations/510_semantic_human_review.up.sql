ALTER TABLE semantic_construction
    ADD COLUMN IF NOT EXISTS authoring_revision bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS interview_state jsonb NOT NULL DEFAULT '{"status":"collecting","round":0,"questions":[]}',
    ADD COLUMN IF NOT EXISTS candidate_cards jsonb NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS semantic_review_packet (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    construction_id uuid NOT NULL,
    gate text NOT NULL,
    sequence bigint NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    artifact_digest text NOT NULL,
    review_subject_digest text NOT NULL,
    packet jsonb NOT NULL,
    created_by_task_id uuid NOT NULL,
    created_by_actor_id uuid NOT NULL,
    stale_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS semantic_human_decision (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    construction_id uuid NOT NULL,
    review_packet_id uuid,
    gate text NOT NULL,
    decision text NOT NULL,
    rationale text NOT NULL,
    artifact_digest text NOT NULL,
    review_subject_digest text NOT NULL,
    decided_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
