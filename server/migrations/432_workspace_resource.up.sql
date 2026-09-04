-- Workspace resources: the repos and directories agents work in, lifted off
-- the project and onto the workspace.
--
-- `project_resource` (migration 065) was the only place a workspace could say
-- "this is the code the agents work on" with more precision than the flat
-- `workspace.repos` JSONB: a typed, ordered, polymorphic list that also
-- carried local directories and their execution mode. It hung off the project
-- because the project was the grouping layer. With the project concept gone,
-- one workspace IS the project, so the same list belongs on the workspace.
--
-- The shape is unchanged from 065 — `resource_type` is a free string and
-- `resource_ref` is JSONB, so adding a type still needs no schema change.
-- The only difference is which parent owns the row.
--
-- The uniqueness key moves with it: it was (project_id, resource_type,
-- resource_ref) and becomes (workspace_id, resource_type, resource_ref). Two
-- projects in one workspace could legitimately point at the same repo; after
-- the collapse that is one workspace naming the same repo twice, which the
-- backfill below folds into a single row. The unique index is built
-- concurrently in migration 433, per the repo rule.
--
-- No foreign keys, per the repo rule: `workspace_id` and `created_by` are
-- plain UUID columns and the application resolves and cleans up the
-- relationships explicitly.

CREATE TABLE IF NOT EXISTS workspace_resource (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL,
    -- 'github_repo' | 'local_directory' today; free string by design.
    resource_type TEXT NOT NULL,
    -- Type-specific payload. For github_repo: {url, ref?}. For
    -- local_directory: {daemon_id, path, execution_mode, ...}.
    resource_ref  JSONB NOT NULL,
    -- User-facing override for the name derived from resource_ref.
    label         TEXT,
    -- Manual ordering within the workspace's list.
    position      INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    UUID
);

COMMENT ON TABLE workspace_resource IS
    'Repos and local directories a workspace''s agents work in. Injected into every agent run as context.';

-- Backfill from the project resources this replaces.
--
-- DISTINCT ON collapses the duplicates the key change can create: several
-- projects in one workspace pointing at the same (resource_type,
-- resource_ref) become one workspace row. The survivor is the earliest by
-- position then creation, so a resource a team had ordered first in some
-- project stays first here, and its label and creator come with it.
--
-- Position is re-derived rather than copied: positions were only ever unique
-- within a project, so carrying them over would interleave several projects'
-- orderings into nonsense. row_number() per workspace gives one clean
-- sequence, preserving the relative order the DISTINCT ON picked.
INSERT INTO workspace_resource (
    workspace_id, resource_type, resource_ref, label, position, created_at, created_by
)
SELECT
    d.workspace_id,
    d.resource_type,
    d.resource_ref,
    d.label,
    (row_number() OVER (PARTITION BY d.workspace_id ORDER BY d.position, d.created_at, d.id))::int - 1,
    d.created_at,
    d.created_by
FROM (
    SELECT DISTINCT ON (pr.workspace_id, pr.resource_type, pr.resource_ref)
        pr.id, pr.workspace_id, pr.resource_type, pr.resource_ref,
        pr.label, pr.position, pr.created_at, pr.created_by
    FROM project_resource pr
    ORDER BY pr.workspace_id, pr.resource_type, pr.resource_ref,
             pr.position, pr.created_at, pr.id
) d;
