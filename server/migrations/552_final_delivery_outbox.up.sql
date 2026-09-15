CREATE TABLE agent_delivery_outbox (
 comment_id uuid NOT NULL, workspace_id uuid NOT NULL, issue_id uuid NOT NULL,
 comment_revision bigint NOT NULL, target_id uuid NOT NULL, route jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
