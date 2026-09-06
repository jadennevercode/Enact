package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
)

// An Agent Family listing is a bundle: every agent member as a template of its
// own, and the squad that binds them. These tests check the two things that
// distinguish it from an agent listing — what does not travel (people), and
// that an install lands every member, their skills and the membership in one
// piece.

// consumerRuntime creates a runtime the fixture user owns inside consumer, so
// a template can be bound there.
func consumerRuntime(t *testing.T, consumer, name string) string {
	t.Helper()
	return dbfx.Insert(t, "agent_runtime", testutil.Cols{
		"workspace_id": consumer,
		"daemon_id":    nil,
		"name":         name,
		"runtime_mode": "cloud",
		"provider":     "handler_test_runtime",
		"status":       "online",
		"device_info":  "",
		"metadata":     testutil.Raw("'{}'::jsonb"),
		"last_seen_at": testutil.Raw("now()"),
		"visibility":   "private",
		"owner_id":     testUserID,
	})
}

// cleanupMarketplaceListing sweeps the rows a publish leaves behind.
func cleanupMarketplaceListing(t *testing.T, listingID string) {
	t.Helper()
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing_file WHERE version_id IN
			(SELECT id FROM marketplace_listing_version WHERE listing_id = $1)`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing_version WHERE listing_id = $1`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_install WHERE listing_id = $1`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing WHERE id = $1`, listingID)
	})
}

// cleanupConsumerEntities sweeps everything an install can create inside a
// consumer workspace.
func cleanupConsumerEntities(t *testing.T, consumer string) {
	t.Helper()
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM squad_member WHERE squad_id IN (SELECT id FROM squad WHERE workspace_id = $1)`, consumer)
		testPool.Exec(context.Background(), `DELETE FROM squad WHERE workspace_id = $1`, consumer)
		testPool.Exec(context.Background(), `DELETE FROM agent_skill WHERE agent_id IN (SELECT id FROM agent WHERE workspace_id = $1)`, consumer)
		testPool.Exec(context.Background(), `DELETE FROM agent_mcp_server WHERE agent_id IN (SELECT id FROM agent WHERE workspace_id = $1)`, consumer)
		testPool.Exec(context.Background(), `DELETE FROM workspace_mcp_server WHERE workspace_id = $1`, consumer)
		testPool.Exec(context.Background(), `DELETE FROM skill_file WHERE skill_id IN (SELECT id FROM skill WHERE workspace_id = $1)`, consumer)
		testPool.Exec(context.Background(), `DELETE FROM skill WHERE workspace_id = $1`, consumer)
		testPool.Exec(context.Background(), `DELETE FROM agent WHERE workspace_id = $1`, consumer)
	})
}

// publishFixtureSquad builds a family of two agents — a leader and a reviewer
// carrying one skill — plus a human member, and publishes it.
func publishFixtureSquad(t *testing.T, slug string) (listingID string, manifest marketplaceManifest) {
	t.Helper()
	runtimeID := handlerTestRuntimeID(t)
	leaderID := dbfx.Agent(t, "mp-family-lead-"+slug, runtimeID, testutil.Cols{
		"instructions": "You coordinate the review.",
		"description":  "the lead",
	})
	reviewerID := dbfx.Agent(t, "mp-family-reviewer-"+slug, runtimeID, testutil.Cols{
		"instructions": "You review code carefully.",
		"description":  "the reviewer",
	})
	skillID := dbfx.Insert(t, "skill", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"name":         "mp-family-skill-" + slug,
		"description":  "carried by the reviewer",
		"content":      "# review checklist",
		"config":       testutil.Raw("'{}'::jsonb"),
		"created_by":   testUserID,
	})
	dbfx.InsertNoID(t, "agent_skill", testutil.Cols{"agent_id": reviewerID, "skill_id": skillID},
		"agent_id = $1 AND skill_id = $2", reviewerID, skillID)

	squadID := dbfx.Squad(t, "Review Family "+slug, leaderID, testutil.Cols{
		"description":  "reviews pull requests",
		"instructions": "Route every review through the reviewer first.",
	})
	dbfx.SquadMember(t, squadID, "agent", leaderID, testutil.Cols{"role": "leader"})
	dbfx.SquadMember(t, squadID, "agent", reviewerID, testutil.Cols{"role": "reviewer"})
	dbfx.SquadMember(t, squadID, "member", testUserID, testutil.Cols{"role": "sponsor"})

	var published PublishMarketplaceListingResponse
	testutil.Call(t, testHandler.PublishMarketplaceListing, newRequest(
		http.MethodPost, "/api/marketplace/listings", PublishMarketplaceListingRequest{
			Kind: marketplaceKindSquad, SourceID: squadID, Slug: slug,
			Visibility: marketplaceVisibilityPublic, Version: "1.0.0",
		},
	)).Want(http.StatusCreated).JSON(&published)
	cleanupMarketplaceListing(t, published.Listing.ID)

	if err := json.Unmarshal(published.Version.Manifest, &manifest); err != nil {
		t.Fatalf("manifest did not decode: %v: %s", err, published.Version.Manifest)
	}
	return published.Listing.ID, manifest
}

func TestPublishingAnAgentFamilyCarriesItsAgentsAndNotItsPeople(t *testing.T) {
	_, manifest := publishFixtureSquad(t, "mp-family-publish")

	if manifest.Kind != marketplaceKindSquad || manifest.Squad == nil {
		t.Fatalf("manifest = %+v, want a squad", manifest)
	}
	family := manifest.Squad
	if family.Instructions != "Route every review through the reviewer first." {
		t.Errorf("the family lost its instructions: %q", family.Instructions)
	}
	// Two agents travel; the human member does not — they name a person in
	// the publishing workspace.
	if len(family.Agents) != 2 {
		t.Fatalf("family carries %d agents, want 2: %+v", len(family.Agents), family.Agents)
	}
	if family.LeaderDir != family.Agents[0].Dir {
		t.Errorf("leader_dir = %q, want the first member %q", family.LeaderDir, family.Agents[0].Dir)
	}
	if family.Agents[0].Role != "leader" || family.Agents[1].Role != "reviewer" {
		t.Errorf("roles = %q, %q", family.Agents[0].Role, family.Agents[1].Role)
	}
	if !strings.HasPrefix(family.Agents[1].Dir, squadAgentDirPrefix) {
		t.Errorf("member dir %q is not namespaced under %q", family.Agents[1].Dir, squadAgentDirPrefix)
	}
	// The reviewer's skill is rooted inside the reviewer's own directory, so
	// two members' skills cannot collide.
	reviewer := family.Agents[1].Agent
	if len(reviewer.Skills) != 1 {
		t.Fatalf("reviewer carries %d skills, want 1", len(reviewer.Skills))
	}
	if !strings.HasPrefix(reviewer.Skills[0].Dir, family.Agents[1].Dir+"/"+agentSkillDirPrefix) {
		t.Errorf("skill dir %q is not under the member dir %q", reviewer.Skills[0].Dir, family.Agents[1].Dir)
	}
}

func TestInstallingAnAgentFamilyLandsEveryMemberAndTheirSkillsAtOnce(t *testing.T) {
	listingID, manifest := publishFixtureSquad(t, "mp-family-install")
	consumer := otherWorkspace(t, "mp-consumer-family")
	cleanupConsumerEntities(t, consumer)
	runtimeID := consumerRuntime(t, consumer, "family-runtime")

	var result MarketplaceInstallResult
	testutil.Call(t, testHandler.InstallMarketplaceListing, testutil.WithURLParams(
		marketplaceRequest(http.MethodPost, "/api/marketplace/listings/"+listingID+"/install", consumer,
			MarketplaceInstallRequest{RuntimeID: runtimeID}),
		"id", listingID,
	)).Want(http.StatusCreated).JSON(&result)
	if result.EntityKind != marketplaceKindSquad || result.Squad == nil {
		t.Fatalf("install result = %+v, want a squad", result)
	}
	squadID := result.Squad.ID
	if result.Squad.Instructions != manifest.Squad.Instructions {
		t.Errorf("installed instructions = %q, want %q", result.Squad.Instructions, manifest.Squad.Instructions)
	}

	// Every member became an agent in the consumer, bound as a member with
	// the role it was published under, and the leader is one of them.
	if got := dbfx.Count(t, `SELECT count(*) FROM squad_member WHERE squad_id = $1 AND member_type = 'agent'`, squadID); got != 2 {
		t.Errorf("installed family has %d agent members, want 2", got)
	}
	if got := dbfx.Count(t, `SELECT count(*) FROM squad_member WHERE squad_id = $1 AND member_type = 'member'`, squadID); got != 0 {
		t.Errorf("installed family has %d human members, want none", got)
	}
	if got := dbfx.Count(t, `SELECT count(*) FROM agent WHERE workspace_id = $1`, consumer); got != 2 {
		t.Errorf("consumer holds %d agents, want the 2 the family carried", got)
	}
	var leaderWorkspace string
	dbfx.QueryRow(t, `SELECT a.workspace_id::text FROM squad s JOIN agent a ON a.id = s.leader_id WHERE s.id = $1`, squadID).Scan(&leaderWorkspace)
	if leaderWorkspace != consumer {
		t.Errorf("the installed family's leader lives in %s, want the consumer %s", leaderWorkspace, consumer)
	}
	var leaderRole string
	dbfx.QueryRow(t, `SELECT sm.role FROM squad_member sm JOIN squad s ON s.id = sm.squad_id
		WHERE sm.squad_id = $1 AND sm.member_id = s.leader_id`, squadID).Scan(&leaderRole)
	if leaderRole != "leader" {
		t.Errorf("leader role = %q, want leader", leaderRole)
	}

	// The reviewer's skill landed and is attached to the reviewer, not to the
	// leader.
	if got := dbfx.Count(t, `SELECT count(*) FROM skill WHERE workspace_id = $1`, consumer); got != 1 {
		t.Errorf("consumer holds %d skills, want the 1 the reviewer carried", got)
	}
	var reviewerSkillCount int
	dbfx.QueryRow(t, `SELECT count(*) FROM agent_skill ask JOIN agent a ON a.id = ask.agent_id
		WHERE a.workspace_id = $1 AND a.instructions = 'You review code carefully.'`, consumer).Scan(&reviewerSkillCount)
	if reviewerSkillCount != 1 {
		t.Errorf("reviewer has %d skills, want 1", reviewerSkillCount)
	}

	// One provenance record names the squad, and the directory now reports
	// the listing as installed for this workspace.
	var entityKind string
	dbfx.QueryRow(t, `SELECT entity_kind FROM marketplace_install WHERE listing_id = $1 AND workspace_id = $2`, listingID, consumer).Scan(&entityKind)
	if entityKind != marketplaceKindSquad {
		t.Errorf("install record entity_kind = %q, want squad", entityKind)
	}
	var catalog MarketplaceCatalogResponse
	testutil.Call(t, testHandler.ListMarketplaceListings,
		marketplaceRequest(http.MethodGet, "/api/marketplace/listings?kind=squad&installed=true", consumer, nil),
	).Want(http.StatusOK).JSON(&catalog)
	found := false
	for _, listing := range catalog.Listings {
		if listing.ID == listingID {
			found = true
			if !listing.Installed {
				t.Errorf("listing %+v is in the installed set but not marked installed", listing)
			}
		}
	}
	if !found {
		t.Errorf("the installed family is missing from installed=true: %+v", catalog.Listings)
	}
}

func TestInstallingAnAgentFamilyNeedsARuntimeAndRefusesHalfAnInstall(t *testing.T) {
	listingID, _ := publishFixtureSquad(t, "mp-family-runtime")
	consumer := otherWorkspace(t, "mp-consumer-family-runtime")
	cleanupConsumerEntities(t, consumer)

	// A family names no machine; without one there is nothing to bind to.
	testutil.Call(t, testHandler.InstallMarketplaceListing, testutil.WithURLParams(
		marketplaceRequest(http.MethodPost, "/api/marketplace/listings/"+listingID+"/install", consumer,
			MarketplaceInstallRequest{}),
		"id", listingID,
	)).Want(http.StatusBadRequest)

	// And a refused install leaves nothing behind: no agent, no squad, no
	// skill, no provenance.
	if got := dbfx.Count(t, `SELECT count(*) FROM agent WHERE workspace_id = $1`, consumer); got != 0 {
		t.Errorf("a refused install left %d agents behind", got)
	}
	if got := dbfx.Count(t, `SELECT count(*) FROM squad WHERE workspace_id = $1`, consumer); got != 0 {
		t.Errorf("a refused install left %d squads behind", got)
	}
	if got := dbfx.Count(t, `SELECT count(*) FROM marketplace_install WHERE listing_id = $1 AND workspace_id = $2`, listingID, consumer); got != 0 {
		t.Errorf("a refused install recorded %d installs", got)
	}
}

func TestBrowseInstalledFilterSeparatesWhatTheWorkspaceHolds(t *testing.T) {
	listingID, _ := publishFixtureSkill(t, "mp-installed-filter", "mp-installed-filter", marketplaceVisibilityPublic)
	consumer := otherWorkspace(t, "mp-consumer-installed-filter")
	cleanupConsumerEntities(t, consumer)

	browse := func(query string) MarketplaceCatalogResponse {
		var catalog MarketplaceCatalogResponse
		testutil.Call(t, testHandler.ListMarketplaceListings,
			marketplaceRequest(http.MethodGet, "/api/marketplace/listings?"+query, consumer, nil),
		).Want(http.StatusOK).JSON(&catalog)
		return catalog
	}
	contains := func(catalog MarketplaceCatalogResponse) (bool, MarketplaceListingResponse) {
		for _, listing := range catalog.Listings {
			if listing.ID == listingID {
				return true, listing
			}
		}
		return false, MarketplaceListingResponse{}
	}

	// Before installing: the listing is in the not-installed set, absent from
	// the installed one, and the facet counts it on the not-installed side.
	before := browse("installed=false")
	if found, listing := contains(before); !found || listing.Installed {
		t.Errorf("before install: found=%v installed=%v, want found and not installed", found, listing.Installed)
	}
	if found, _ := contains(browse("installed=true")); found {
		t.Error("before install: the listing appears in installed=true")
	}
	if before.Facets.Installed[marketplaceInstalledFilterNotInstalled] == 0 {
		t.Errorf("facets = %+v, want a non-zero not_installed count", before.Facets.Installed)
	}

	testutil.Call(t, testHandler.InstallMarketplaceListing, testutil.WithURLParams(
		marketplaceRequest(http.MethodPost, "/api/marketplace/listings/"+listingID+"/install", consumer,
			MarketplaceInstallRequest{}),
		"id", listingID,
	)).Want(http.StatusCreated)

	after := browse("installed=true")
	if found, listing := contains(after); !found || !listing.Installed {
		t.Errorf("after install: found=%v installed=%v, want found and installed", found, listing.Installed)
	}
	if found, _ := contains(browse("installed=false")); found {
		t.Error("after install: the listing still appears in installed=false")
	}
	if after.Facets.Installed[marketplaceInstalledFilterInstalled] == 0 {
		t.Errorf("facets = %+v, want a non-zero installed count", after.Facets.Installed)
	}
	// Facets describe the visible set, not the filtered one: the count of the
	// other side survives choosing this one.
	if after.Facets.Installed[marketplaceInstalledFilterInstalled]+after.Facets.Installed[marketplaceInstalledFilterNotInstalled] != after.Total {
		t.Errorf("installed facets %+v do not sum to the visible total %d", after.Facets.Installed, after.Total)
	}
}
