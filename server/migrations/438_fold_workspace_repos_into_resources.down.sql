-- Restores the column and copies the github_repo resources back into it.
--
-- Not a clean inverse: a repository that was already in Resources before the
-- up migration ran is copied into the column too, because nothing records
-- which surface a row came from. Re-running the up migration folds the
-- duplicate away again, so the round trip converges.
ALTER TABLE workspace ADD COLUMN IF NOT EXISTS repos JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE workspace w
SET repos = COALESCE((
    SELECT jsonb_agg(
               jsonb_strip_nulls(
                   jsonb_build_object(
                       'url', wr.resource_ref->>'url',
                       'ref', NULLIF(wr.resource_ref->>'ref', ''),
                       'description', NULLIF(btrim(COALESCE(wr.label, '')), '')
                   )
               )
               ORDER BY wr.position, wr.created_at
           )
      FROM workspace_resource wr
     WHERE wr.workspace_id = w.id
       AND wr.resource_type = 'github_repo'
), '[]'::jsonb);
