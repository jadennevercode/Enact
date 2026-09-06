-- name: ListVisibleMarketplaceListings :many
-- Every listing this workspace may see, in one read: the public directory
-- plus everything the workspace published itself.
--
-- The publisher's own arm is deliberately unfiltered by status, so drafts and
-- taken-down listings appear on their management page and nowhere else. The
-- public arm excludes 'draft' and 'removed'; 'deprecated' is returned because
-- a workspace that already installed one still has to be able to open it, and
-- hiding it from browse is a display decision the handler makes.
--
-- Filtering by kind, tag and free text, and the facet counts beside them, are
-- computed in Go over this result. A per-deployment directory is hundreds of
-- rows, not millions; pushing the predicates into SQL here would buy nothing
-- and would still not give exact facets without a second pass.
SELECT * FROM marketplace_listing
WHERE (visibility = 'public' AND status IN ('published', 'deprecated'))
   OR workspace_id = $1
ORDER BY featured DESC, updated_at DESC
LIMIT 500;

-- name: GetMarketplaceListing :one
-- Unscoped by design: the caller has to read the row before it can decide
-- whether this workspace may see it. Every handler applies that gate.
SELECT * FROM marketplace_listing WHERE id = $1;

-- name: GetMarketplaceListingBySlug :one
-- Publishing again under an existing handle must find the same listing and add
-- a version to it, not mint a second identity.
SELECT * FROM marketplace_listing
WHERE workspace_id = $1 AND kind = $2 AND slug = $3;

-- name: ListMarketplaceListingsByWorkspace :many
SELECT * FROM marketplace_listing
WHERE workspace_id = $1
ORDER BY updated_at DESC;

-- name: CreateMarketplaceListing :one
INSERT INTO marketplace_listing (
    kind, slug, name, description, category, tags,
    workspace_id, published_by, visibility, status
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: UpdateMarketplaceListing :one
-- Metadata, visibility and status in one statement. Every argument is
-- optional: the publisher edits a description without restating its status,
-- and a takedown sets status without restating its description.
UPDATE marketplace_listing SET
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    category = COALESCE(sqlc.narg('category'), category),
    tags = COALESCE(sqlc.narg('tags'), tags),
    visibility = COALESCE(sqlc.narg('visibility'), visibility),
    status = COALESCE(sqlc.narg('status'), status),
    featured = COALESCE(sqlc.narg('featured'), featured),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetMarketplaceListingLatestVersion :one
-- Run inside the publish transaction, right after the version row lands, so a
-- listing is never visible pointing at a version that does not exist.
UPDATE marketplace_listing SET
    latest_version_id = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: IncrementMarketplaceInstallCount :exec
-- updated_at is deliberately not bumped: browse orders by it, and install
-- churn must not reshuffle the directory.
UPDATE marketplace_listing SET install_count = install_count + 1 WHERE id = $1;

-- name: DeleteMarketplaceListing :execrows
-- Only ever used on a draft the publisher abandons. A listing that has been
-- published is taken down by setting status = 'removed', so the install
-- records that name it keep naming something that exists.
DELETE FROM marketplace_listing WHERE id = $1 AND workspace_id = $2;

-- name: LockMarketplaceListingForUpdate :one
-- Taken by the publish path before it adds a version, so two concurrent
-- publishes of the same listing serialize and the second sees the first's
-- version row when it checks for a duplicate version string.
SELECT id FROM marketplace_listing WHERE id = $1 FOR UPDATE;

-- name: CreateMarketplaceListingVersion :one
INSERT INTO marketplace_listing_version (
    listing_id, version, manifest, changelog, digest, size_bytes, published_by
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetMarketplaceListingVersion :one
SELECT * FROM marketplace_listing_version WHERE id = $1;

-- name: ListMarketplaceListingVersions :many
SELECT * FROM marketplace_listing_version
WHERE listing_id = $1
ORDER BY created_at DESC;

-- name: DeleteMarketplaceListingVersionsByListing :exec
-- Version rows carry no foreign key, so deleting a draft listing must sweep
-- them in the same transaction.
DELETE FROM marketplace_listing_version WHERE listing_id = $1;

-- name: CreateMarketplaceListingFile :one
INSERT INTO marketplace_listing_file (version_id, path, content, size_bytes, sha256)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListMarketplaceListingFiles :many
SELECT * FROM marketplace_listing_file
WHERE version_id = $1
ORDER BY path ASC;

-- name: DeleteMarketplaceListingFilesByListing :exec
-- The other half of the draft-listing sweep, reached through the version rows
-- because files hang off a version, not the listing.
DELETE FROM marketplace_listing_file
WHERE version_id IN (SELECT id FROM marketplace_listing_version WHERE listing_id = $1);

-- name: CreateMarketplaceInstall :one
INSERT INTO marketplace_install (
    listing_id, version_id, workspace_id, entity_kind, entity_id, installed_by
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListMarketplaceInstallsForWorkspace :many
-- Drives the "installed" badge while browsing and the "a newer version is
-- available" prompt on the installed entity. One row per install, newest
-- first, so the handler folds it to the current version per listing.
SELECT * FROM marketplace_install
WHERE workspace_id = $1
ORDER BY created_at DESC;

-- name: ListMarketplaceInstallsForEntity :many
SELECT * FROM marketplace_install
WHERE workspace_id = $1 AND entity_id = $2
ORDER BY created_at DESC;

-- name: DeleteMarketplaceInstallsByEntity :exec
-- Installed entities are ordinary workspace rows; when one is deleted the
-- provenance record has nothing left to point at.
DELETE FROM marketplace_install WHERE workspace_id = $1 AND entity_id = $2;
