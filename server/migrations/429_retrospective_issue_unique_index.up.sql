-- At most one retrospective per issue. This is the index that makes "ask once"
-- true: the suggestion write is an ON CONFLICT DO NOTHING against it, so an
-- issue that bounces in and out of a done status is offered a retrospective the
-- first time and never again, whatever the user answered.
--
-- Partial, because project and workspace retrospectives are repeatable by
-- design — that is the whole point of scheduling one.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_retrospective_issue_scope
    ON retrospective (workspace_id, scope_id)
    WHERE scope = 'issue' AND scope_id IS NOT NULL;
