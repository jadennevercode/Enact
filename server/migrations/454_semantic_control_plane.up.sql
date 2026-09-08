CREATE TABLE IF NOT EXISTS semantic_connection (
 id UUID NOT NULL DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL,
 name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('rest','postgres','mcp')),
 endpoint TEXT NOT NULL, secret BYTEA, config JSONB NOT NULL DEFAULT '{}',
 created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS semantic_ontology (
 id UUID NOT NULL DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL,
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', bundle JSONB NOT NULL,
 created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS semantic_release (
 id UUID NOT NULL DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL, ontology_id UUID NOT NULL,
 version TEXT NOT NULL, digest TEXT NOT NULL, artifact JSONB NOT NULL, validation JSONB NOT NULL,
 binding_config JSONB NOT NULL DEFAULT '{}', published_by UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS semantic_run (
 id UUID NOT NULL DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL, release_id UUID NOT NULL,
 requested_by UUID NOT NULL, actor_type TEXT NOT NULL, question TEXT NOT NULL DEFAULT '', issue_id UUID,
 status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS semantic_step (
 id UUID NOT NULL DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL, run_id UUID NOT NULL,
 kind TEXT NOT NULL, status TEXT NOT NULL, input JSONB NOT NULL DEFAULT '{}', output JSONB,
 error TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS semantic_approval (
 id UUID NOT NULL DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL, run_id UUID NOT NULL,
 binding_id TEXT NOT NULL, parameters JSONB NOT NULL, digest TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','executed')),
 requested_by UUID NOT NULL, approved_by UUID, reason TEXT NOT NULL DEFAULT '',
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS semantic_receipt (
 id UUID NOT NULL DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL, run_id UUID NOT NULL,
 approval_id UUID NOT NULL, binding_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_digest TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('executing','succeeded','failed','unknown')),
 response JSONB, readback JSONB, error TEXT NOT NULL DEFAULT '', executed_by UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
