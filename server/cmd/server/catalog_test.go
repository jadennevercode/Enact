package main

import (
	"context"
	"testing"

	"github.com/enact-ai/enact/server/internal/analytics"
	"github.com/enact-ai/enact/server/internal/events"
	"github.com/enact-ai/enact/server/internal/realtime"
	"github.com/enact-ai/enact/server/internal/service"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
)

// The catalog is the one place the product publishes to its own Marketplace, so
// what is asserted here is the shape of what lands and that a second boot adds
// nothing. Both matter: a listing that failed to publish leaves a bundle
// unreachable, and a version republished on every boot would fill the version
// history of every listing with identical entries.

// dropCatalog removes the catalog workspace and everything it published, so a
// test can assert on a first seed. Marketplace rows carry no foreign key, so
// they are swept explicitly; skills, agents and families go with the workspace.
func dropCatalog(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `
		DELETE FROM marketplace_listing_file WHERE version_id IN (
			SELECT v.id FROM marketplace_listing_version v
			JOIN marketplace_listing l ON l.id = v.listing_id
			JOIN workspace w ON w.id = l.workspace_id
			WHERE w.slug = $1)
	`, service.CatalogWorkspaceSlug); err != nil {
		t.Fatalf("sweep catalog files: %v", err)
	}
	for _, statement := range []string{
		`DELETE FROM marketplace_listing_version WHERE listing_id IN (
			SELECT l.id FROM marketplace_listing l JOIN workspace w ON w.id = l.workspace_id WHERE w.slug = $1)`,
		`DELETE FROM marketplace_install WHERE listing_id IN (
			SELECT l.id FROM marketplace_listing l JOIN workspace w ON w.id = l.workspace_id WHERE w.slug = $1)`,
		`DELETE FROM marketplace_listing WHERE workspace_id IN (SELECT id FROM workspace WHERE slug = $1)`,
		`DELETE FROM workspace WHERE slug = $1`,
	} {
		if _, err := testPool.Exec(ctx, statement, service.CatalogWorkspaceSlug); err != nil {
			t.Fatalf("sweep catalog: %v", err)
		}
	}
}

func catalogListingCounts(t *testing.T) map[string]int {
	t.Helper()
	rows, err := testPool.Query(context.Background(), `
		SELECT l.kind, count(*)
		FROM marketplace_listing l
		JOIN workspace w ON w.id = l.workspace_id
		WHERE w.slug = $1
		GROUP BY l.kind
	`, service.CatalogWorkspaceSlug)
	if err != nil {
		t.Fatalf("count catalog listings: %v", err)
	}
	defer rows.Close()

	counts := map[string]int{}
	for rows.Next() {
		var kind string
		var count int
		if err := rows.Scan(&kind, &count); err != nil {
			t.Fatalf("scan listing counts: %v", err)
		}
		counts[kind] = count
	}
	return counts
}

func TestCatalogPublishesEveryBundledSkillAgentAndFamily(t *testing.T) {
	if testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	queries := db.New(testPool)

	hub := realtime.NewHub()
	go hub.Run()
	_, h := NewRouterWithOptions(testPool, hub, events.New(), analytics.NoopClient{}, nil, RouterOptions{})

	dropCatalog(t)
	t.Cleanup(func() { dropCatalog(t) })

	if err := ensureMarketplaceCatalog(ctx, testPool, h, queries); err != nil {
		t.Fatalf("seed catalog: %v", err)
	}

	// The SDLC bundle's own numbers: ten sdlc-* skills, nine roles, one family.
	// A skill added to the bundle without a listing shows up here as a mismatch
	// rather than as a quiet omission.
	counts := catalogListingCounts(t)
	for kind, want := range map[string]int{"skill": 10, "agent": 9, "squad": 1} {
		if counts[kind] != want {
			t.Errorf("catalog published %d %s listings, want %d", counts[kind], kind, want)
		}
	}

	// Everything the catalog publishes has to be reachable from another
	// workspace, which means public and published.
	var reachable int
	if err := testPool.QueryRow(ctx, `
		SELECT count(*) FROM marketplace_listing l
		JOIN workspace w ON w.id = l.workspace_id
		WHERE w.slug = $1
		  AND l.visibility = 'public'
		  AND l.status = 'published'
		  AND l.latest_version_id IS NOT NULL
	`, service.CatalogWorkspaceSlug).Scan(&reachable); err != nil {
		t.Fatalf("count reachable listings: %v", err)
	}
	if reachable != 20 {
		t.Errorf("%d catalog listings are public, published and versioned; want 20", reachable)
	}
}

func TestCatalogSeedingASecondTimeAddsNoVersions(t *testing.T) {
	if testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	queries := db.New(testPool)

	hub := realtime.NewHub()
	go hub.Run()
	_, h := NewRouterWithOptions(testPool, hub, events.New(), analytics.NoopClient{}, nil, RouterOptions{})

	dropCatalog(t)
	t.Cleanup(func() { dropCatalog(t) })

	if err := ensureMarketplaceCatalog(ctx, testPool, h, queries); err != nil {
		t.Fatalf("seed catalog: %v", err)
	}
	versions := func() int {
		var n int
		if err := testPool.QueryRow(ctx, `
			SELECT count(*) FROM marketplace_listing_version v
			JOIN marketplace_listing l ON l.id = v.listing_id
			JOIN workspace w ON w.id = l.workspace_id
			WHERE w.slug = $1
		`, service.CatalogWorkspaceSlug).Scan(&n); err != nil {
			t.Fatalf("count versions: %v", err)
		}
		return n
	}
	first := versions()

	if err := ensureMarketplaceCatalog(ctx, testPool, h, queries); err != nil {
		t.Fatalf("re-seed catalog: %v", err)
	}
	if second := versions(); second != first {
		t.Errorf("a second boot added %d versions; want the catalog to stay at %d until CatalogVersion moves",
			second-first, first)
	}
}
