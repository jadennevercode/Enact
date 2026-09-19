CREATE TABLE agent_context_turn (
 task_id uuid NOT NULL, workspace_id uuid NOT NULL, agent_id uuid NOT NULL,
 scope_type text NOT NULL, scope_id uuid NOT NULL, source_revision text NOT NULL,
 envelope jsonb NOT NULL, processed boolean NOT NULL DEFAULT false,
 final_delivery boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_final_delivery (
 task_id uuid NOT NULL, workspace_id uuid NOT NULL, issue_id uuid NOT NULL,
 parent_key text NOT NULL, revision bigint NOT NULL, comment_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
