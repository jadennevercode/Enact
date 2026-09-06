package main

import (
	"context"
	"strings"
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

	// Both bundles' own numbers: ten sdlc-* skills with nine roles, eleven
	// ontologizer:* skills with five, and one family each. A skill added to a
	// bundle without a listing shows up here as a mismatch rather than as a
	// quiet omission.
	counts := catalogListingCounts(t)
	for kind, want := range map[string]int{"skill": 21, "agent": 14, "squad": 2} {
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
	if reachable != 37 {
		t.Errorf("%d catalog listings are public, published and versioned; want 37", reachable)
	}
}

// The Ontologizer bundle reaches a workspace only as a Marketplace install, so
// the properties that make that install usable are asserted here rather than
// left to the provisioner: it is published by the catalog (which is what earns
// the official badge), and it says what the installing host needs before the
// copy will run.
func TestCatalogPublishesOntologizerWithItsPrerequisites(t *testing.T) {
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

	var withoutPrerequisites int
	if err := testPool.QueryRow(ctx, `
		SELECT count(*) FROM marketplace_listing l
		JOIN marketplace_listing_version v ON v.id = l.latest_version_id
		JOIN workspace w ON w.id = l.workspace_id
		WHERE w.slug = $1
		  AND 'ontology' = ANY(l.tags)
		  AND jsonb_array_length(COALESCE(v.manifest->'prerequisites', '[]'::jsonb)) = 0
	`, service.CatalogWorkspaceSlug).Scan(&withoutPrerequisites); err != nil {
		t.Fatalf("count ontology listings without prerequisites: %v", err)
	}
	if withoutPrerequisites != 0 {
		t.Errorf("%d Ontologizer listings ship no prerequisites; every one of them needs the checkout", withoutPrerequisites)
	}

	var tagged int
	if err := testPool.QueryRow(ctx, `
		SELECT count(*) FROM marketplace_listing l
		JOIN workspace w ON w.id = l.workspace_id
		WHERE w.slug = $1 AND 'ontology' = ANY(l.tags)
	`, service.CatalogWorkspaceSlug).Scan(&tagged); err != nil {
		t.Fatalf("count ontology listings: %v", err)
	}
	if tagged != 17 {
		t.Errorf("%d listings carry the ontology tag, want 17 (11 skills, 5 agents, 1 family)", tagged)
	}
}

// Recommendation weights featured above official, and a family is a bundle's
// entry point. Without this the first thing a new workspace is offered is six
// arbitrary components of something it has not been shown yet.
func TestCatalogFeaturesOnlyTheAgentFamilies(t *testing.T) {
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

	rows, err := testPool.Query(ctx, `
		SELECT l.kind, l.slug FROM marketplace_listing l
		JOIN workspace w ON w.id = l.workspace_id
		WHERE w.slug = $1 AND l.featured
		ORDER BY l.slug
	`, service.CatalogWorkspaceSlug)
	if err != nil {
		t.Fatalf("list featured listings: %v", err)
	}
	defer rows.Close()
	featured := 0
	for rows.Next() {
		var kind, slug string
		if err := rows.Scan(&kind, &slug); err != nil {
			t.Fatalf("scan featured listing: %v", err)
		}
		if kind != "squad" {
			t.Errorf("listing %s (%s) is featured; only Agent Families should be", slug, kind)
		}
		featured++
	}
	if featured != 2 {
		t.Errorf("%d catalog listings are featured, want the 2 Agent Families", featured)
	}
}

// Every published agent has to carry a prompt. A system agent keeps its prompt
// in the server binary and its row holds only workspace notes, so a manifest
// that copied the row verbatim would install nine agents that do nothing —
// which is what the SDLC family did before publishedAgentInstructions.
func TestCatalogAgentListingsCarryTheirInstructions(t *testing.T) {
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

	rows, err := testPool.Query(ctx, `
		SELECT l.slug, COALESCE(v.manifest->'agent'->>'instructions', '')
		FROM marketplace_listing l
		JOIN marketplace_listing_version v ON v.id = l.latest_version_id
		JOIN workspace w ON w.id = l.workspace_id
		WHERE w.slug = $1 AND l.kind = 'agent'
		ORDER BY l.slug
	`, service.CatalogWorkspaceSlug)
	if err != nil {
		t.Fatalf("read agent manifests: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var slug, instructions string
		if err := rows.Scan(&slug, &instructions); err != nil {
			t.Fatalf("scan agent manifest: %v", err)
		}
		if strings.TrimSpace(instructions) == "" {
			t.Errorf("agent listing %s publishes an empty prompt; installing it would create an agent that does nothing", slug)
		}
	}

	// The family members carry their own templates, and they are the copy an
	// installer of the family actually gets.
	var emptyMembers int
	if err := testPool.QueryRow(ctx, `
		SELECT count(*) FROM marketplace_listing l
		JOIN marketplace_listing_version v ON v.id = l.latest_version_id
		JOIN workspace w ON w.id = l.workspace_id,
		     jsonb_array_elements(v.manifest->'squad'->'agents') member
		WHERE w.slug = $1
		  AND l.kind = 'squad'
		  AND COALESCE(btrim(member->'agent'->>'instructions'), '') = ''
	`, service.CatalogWorkspaceSlug).Scan(&emptyMembers); err != nil {
		t.Fatalf("count family members without instructions: %v", err)
	}
	if emptyMembers != 0 {
		t.Errorf("%d published family members have an empty prompt", emptyMembers)
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
