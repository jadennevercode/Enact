-- Rebuilds the project schema empty.
--
-- NOT reversible: the projects, their resources, the saved views and the pins
-- are deleted by the up migration, and every issue, chat session and autopilot
-- loses which project it belonged to. This restores the shape so an older
-- server binary can start; it does not restore the data. The resources are the
-- one exception worth knowing about — migration 432 copied them to
-- workspace_resource, so they survive there and could be copied back by hand
-- if a project mapping were reconstructed from a backup.

CREATE TABLE IF NOT EXISTS project (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'in_progress', 'paused', 'completed', 'cancelled')),
    lead_type TEXT CHECK (lead_type IN ('member', 'agent')),
    lead_id UUID,
    priority TEXT NOT NULL DEFAULT 'none'
        CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
    start_date DATE,
    due_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_workspace ON project(workspace_id);

CREATE TABLE IF NOT EXISTS project_resource (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    workspace_id  UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,
    resource_ref  JSONB NOT NULL,
    label         TEXT,
    position      INT  NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    UUID,
    UNIQUE (project_id, resource_type, resource_ref)
);
CREATE INDEX IF NOT EXISTS idx_project_resource_project ON project_resource(project_id, position);
CREATE INDEX IF NOT EXISTS idx_project_resource_workspace ON project_resource(workspace_id);

ALTER TABLE issue        ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES project(id) ON DELETE SET NULL;
ALTER TABLE chat_session ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE autopilot    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES project(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_issue_project ON issue(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_session_project
    ON chat_session(project_id) WHERE project_id IS NOT NULL;

ALTER TABLE pinned_item DROP CONSTRAINT IF EXISTS pinned_item_item_type_check;
ALTER TABLE pinned_item ADD CONSTRAINT pinned_item_item_type_check
    CHECK (item_type IN ('issue', 'project', 'view'));

ALTER TABLE issue_view_preference
    DROP CONSTRAINT IF EXISTS issue_view_preference_scope_type_check;
ALTER TABLE issue_view_preference
    ADD CONSTRAINT issue_view_preference_scope_type_check
        CHECK (scope_type IN ('workspace', 'my', 'project'));

ALTER TABLE issue_view
    DROP CONSTRAINT IF EXISTS issue_view_scope_type_check,
    DROP CONSTRAINT IF EXISTS issue_view_scope_id_absent,
    DROP CONSTRAINT IF EXISTS issue_view_scope_variant_pairing;

ALTER TABLE issue_view
    ADD CONSTRAINT issue_view_scope_type_check
        CHECK (scope_type IN ('workspace', 'my', 'project')),
    ADD CONSTRAINT issue_view_check CHECK (
        (scope_type = 'project' AND scope_id IS NOT NULL)
        OR (scope_type IN ('workspace', 'my') AND scope_id IS NULL)
    ),
    ADD CONSTRAINT issue_view_scope_variant_pairing CHECK (
        (scope_type = 'my' AND scope_variant IN ('assigned', 'created', 'involved', 'any'))
        OR (scope_type = 'workspace' AND (scope_variant IS NULL OR scope_variant IN ('members', 'agents')))
        OR (scope_type = 'project' AND (scope_variant IS NULL OR scope_variant IN ('members', 'agents')))
    );
