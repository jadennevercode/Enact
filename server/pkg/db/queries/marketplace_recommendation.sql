-- name: UpsertMarketplaceRecommendationDecision :one
-- Records that this workspace turned a recommendation down, at the version it
-- was looking at. Re-dismissing after a new version moves the stored version
-- forward, which is what makes a second no stick until the version after that.
INSERT INTO marketplace_recommendation_decision (
    workspace_id, listing_id, version_id, decision, decided_by
) VALUES ($1, $2, $3, 'dismissed', $4)
ON CONFLICT (workspace_id, listing_id) DO UPDATE SET
    version_id = EXCLUDED.version_id,
    decision   = EXCLUDED.decision,
    decided_by = EXCLUDED.decided_by,
    decided_at = now()
RETURNING *;

-- name: ListMarketplaceRecommendationDecisions :many
SELECT * FROM marketplace_recommendation_decision
WHERE workspace_id = $1;

-- name: CountMarketplaceRecommendationDecisions :one
-- Whether this workspace has turned anything down. The setup checklist reads
-- it as "a member has looked at the recommendations", which an install also
-- satisfies — either is a decision, and the step asks for one rather than for
-- an install.
SELECT count(*) FROM marketplace_recommendation_decision
WHERE workspace_id = $1;

-- name: DeleteMarketplaceRecommendationDecision :exec
-- Undo a dismissal, putting the listing back in the ranking immediately.
DELETE FROM marketplace_recommendation_decision
WHERE workspace_id = $1 AND listing_id = $2;

-- name: DeleteMarketplaceRecommendationDecisionsByWorkspace :exec
-- Workspace teardown. These rows carry no foreign key, so nothing sweeps them
-- implicitly when the workspace goes.
DELETE FROM marketplace_recommendation_decision
WHERE workspace_id = $1;
