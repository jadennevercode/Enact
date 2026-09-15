CREATE TABLE agent_context_session (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('issue', 'chat')),
    scope_id UUID NOT NULL,
    runtime_id UUID NOT NULL,
    provider TEXT NOT NULL,
    native_id TEXT NOT NULL DEFAULT '',
    generation BIGINT NOT NULL DEFAULT 1,
    epoch BIGINT NOT NULL DEFAULT 0,
    event_seq BIGINT NOT NULL DEFAULT 0,
    task_id UUID,
    capabilities JSONB NOT NULL DEFAULT '{}',
    snapshot JSONB,
    peak_tokens BIGINT NOT NULL DEFAULT 0,
    lease_token UUID,
    lease_kind TEXT,
    lease_owner UUID,
    lease_expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_context_operation (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    generation BIGINT NOT NULL,
    actor_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    reason TEXT NOT NULL DEFAULT '',
    before_snapshot JSONB,
    after_snapshot JSONB,
    usage JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_context_checkpoint (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('issue', 'chat')),
    scope_id UUID NOT NULL,
    source_task_id UUID NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    source_revision TEXT NOT NULL,
    body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
