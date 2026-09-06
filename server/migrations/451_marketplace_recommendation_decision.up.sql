-- What a workspace has decided about a recommendation.
--
-- The recommender computes its ranking fresh on every request, against
-- whatever the directory holds at that moment. That is the point: a listing
-- published tomorrow has to be able to reach a workspace that was set up
-- today. But a recommendation a member has already turned down must not come
-- back on the next page load, and "already turned down" is the one piece of
-- that loop which cannot be derived from anything else.
--
-- Installs are NOT recorded here. `marketplace_install` already says what a
-- workspace took, and duplicating it would create two sources for one fact.
-- This table holds the other answer only, which is why `decision` has a single
-- allowed value: it is a column rather than a boolean so that a later "remind
-- me after the next release" has somewhere to go without a migration that
-- rewrites rows.
--
-- version_id is the version the member judged. It is what makes a dismissal
-- expire rather than be forever: the recommender suppresses a listing only
-- while the dismissed version is still the latest one, so publishing a new
-- version puts it back in front of a workspace that said no to the old one.
-- A dismissal recorded against a listing with no version yet stores NULL and
-- suppresses until any version appears.
--
-- No foreign keys, per the repository's rule. A listing that is taken down
-- leaves its decisions behind; they are read through a join that filters
-- listings anyway, so an orphan is invisible rather than wrong.
CREATE TABLE IF NOT EXISTS marketplace_recommendation_decision (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    listing_id UUID NOT NULL,
    version_id UUID,
    decision TEXT NOT NULL DEFAULT 'dismissed' CHECK (decision IN ('dismissed')),
    decided_by UUID,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
