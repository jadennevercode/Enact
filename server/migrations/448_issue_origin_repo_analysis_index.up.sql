-- At most one repository-analysis issue per resource. A resource can be
-- edited, and every edit re-enters the code that considers filing one; this
-- index is why an edit cannot produce a second analysis of the same tree.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_issue_origin_repo_analysis
    ON issue (workspace_id, origin_id)
    WHERE origin_type = 'repo_analysis' AND origin_id IS NOT NULL;
