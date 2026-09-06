-- One place to say which code a workspace's agents work on.
--
-- Two surfaces named repositories at workspace level after the project was
-- removed: `workspace.repos`, a JSONB list edited in Settings -> Repositories,
-- and `workspace_resource` rows of type github_repo, edited in Settings ->
-- Resources. That overlap is new. Before the collapse the two sat at different
-- levels — the workspace list was the default and a project could override it
-- — so the precedence in the claim handler read as inheritance.
--
-- At one level it reads as a trap instead, because the claim handler does not
-- merge them: any github_repo resource replaces the whole `workspace.repos`
-- list. A team with three repositories configured who adds a single repository
-- under Resources would silently drop the other two out of every agent run.
--
-- So the resource table wins and the column goes. Resources is the richer of
-- the two: typed, ordered, and already the only home for local directories and
-- their execution mode.
--
-- `description` has no field in the github_repo ref (see githubRepoRef in
-- workspace_resource.go: url, default_branch_hint, ref) and lands in `label`,
-- the resource's own human-readable name. The claim handler reads it back out
-- into RepoData.Description, so the agent brief renders these repositories
-- exactly as it did before.

INSERT INTO workspace_resource (
    workspace_id, resource_type, resource_ref, label, position, created_at
)
SELECT
    w.id,
    'github_repo',
    -- Must match what `validateGithubRepoRef` marshals, or the same repository
    -- added through both surfaces would land as two rows: `omitempty` drops an
    -- empty ref, so the key is absent rather than empty-string. jsonb compares
    -- independently of key order, so building it here is safe.
    jsonb_build_object('url', btrim(r->>'url'))
      || CASE WHEN COALESCE(btrim(r->>'ref'), '') <> ''
              THEN jsonb_build_object('ref', btrim(r->>'ref'))
              ELSE '{}'::jsonb END,
    NULLIF(btrim(COALESCE(r->>'description', '')), ''),
    -- Append after whatever Resources already holds, preserving the order the
    -- workspace list had.
    (SELECT COALESCE(MAX(wr.position) + 1, 0)
       FROM workspace_resource wr
      WHERE wr.workspace_id = w.id)::int + (t.ord - 1)::int,
    now()
FROM workspace w
CROSS JOIN LATERAL jsonb_array_elements(w.repos) WITH ORDINALITY AS t(r, ord)
WHERE jsonb_typeof(w.repos) = 'array'
  AND COALESCE(btrim(r->>'url'), '') <> ''
-- A repository already attached through Resources keeps its row, its label and
-- its position; the workspace-list copy is dropped rather than duplicated.
ON CONFLICT (workspace_id, resource_type, resource_ref) DO NOTHING;

ALTER TABLE workspace DROP COLUMN IF EXISTS repos;
