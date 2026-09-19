-- Code graph builds: one row per attempt to build a repository's structure
-- graph in the codegraph container (docs/architecture/code-graph-plan.zh.md).
--
-- The row is both the durable work queue and the build record. `queued`
-- rows are claimed by the server-side worker with SKIP LOCKED and a lease;
-- a process crash leaves `building` with an expired lease, which the next
-- sweep re-claims. `lease_until` doubles as the earliest run time for a
-- queued row, which is how a push burst is debounced into one build.
--
-- `report_md` is the graphify GRAPH_REPORT.md for the build. A monorepo
-- report runs to hundreds of kilobytes, so it is TEXT here and is served on
-- its own route; status payloads never embed it. Graph data itself stays on
-- the container volume and is never stored in Postgres.
--
-- `head_commit` is the newest default-branch commit the server has heard of
-- for this repository (push webhook or poll). A `ready` build whose commit
-- differs from it is stale.
--
-- No foreign keys, per the repo rule. Deleting a resource or a workspace
-- clears its rows explicitly in application code.
CREATE TABLE IF NOT EXISTS code_graph_build (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     UUID NOT NULL,
    resource_id      UUID NOT NULL,
    project_key      TEXT NOT NULL,
    repo_url         TEXT NOT NULL,
    ref              TEXT NOT NULL DEFAULT '',
    commit           TEXT,
    head_commit      TEXT,
    state            TEXT NOT NULL DEFAULT 'queued'
        CHECK (state IN ('queued', 'building', 'ready', 'failed', 'skipped')),
    skipped_reason   TEXT,
    error            TEXT,
    stats            JSONB,
    diff             JSONB,
    report_md        TEXT,
    graphify_version TEXT,
    lease_until      TIMESTAMPTZ,
    attempts         INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ
);

COMMENT ON TABLE code_graph_build IS
    'Code graph build queue and history per workspace resource; graph data lives on the codegraph container volume.';
