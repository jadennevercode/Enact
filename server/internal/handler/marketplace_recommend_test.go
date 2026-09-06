package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
)

// Cleanups here take context.Background(), not t.Context(). A test's context
// is already cancelled by the time its Cleanup functions run, so a delete
// issued with it is a silent no-op and the rows survive the run — which then
// breaks the next run of any test that asserts on what the directory holds.

// The scoring itself is a pure function, tested exhaustively in
// internal/recommend. What only a database can answer is eligibility: which
// listings reach the ranker at all, and how a dismissal expires.

// publishTaggedSkill publishes a skill listing with the given tags and
// description, so a test can control exactly what the ranker sees.
func publishTaggedSkill(t *testing.T, slug, description string, tags []string) string {
	t.Helper()
	skillID := dbfx.Insert(t, "skill", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"name":         slug,
		"description":  description,
		"content":      "# " + slug + "\n\nthe body",
		"config":       testutil.Raw("'{}'::jsonb"),
		"created_by":   testUserID,
	})

	var resp PublishMarketplaceListingResponse
	testutil.Call(t, testHandler.PublishMarketplaceListing, newRequest(
		http.MethodPost, "/api/marketplace/listings", PublishMarketplaceListingRequest{
			Kind:       marketplaceKindSkill,
			SourceID:   skillID,
			Slug:       slug,
			Visibility: marketplaceVisibilityPublic,
			Version:    "1.0.0",
			Tags:       tags,
		},
	)).Want(http.StatusCreated).JSON(&resp)

	listingID := resp.Listing.ID
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM marketplace_recommendation_decision WHERE listing_id = $1`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing_file WHERE version_id IN
			(SELECT id FROM marketplace_listing_version WHERE listing_id = $1)`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing_version WHERE listing_id = $1`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_install WHERE listing_id = $1`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing WHERE id = $1`, listingID)
	})
	return listingID
}

// setProfile writes a profile onto a workspace directly. The endpoint is
// tested in workspace_setup_test.go; here it is setup, not the subject.
func setProfile(t *testing.T, workspaceID string, profile map[string]any) {
	t.Helper()
	encoded, err := json.Marshal(profile)
	if err != nil {
		t.Fatalf("encode profile: %v", err)
	}
	dbfx.Exec(t, `UPDATE workspace SET profile = $1 WHERE id = $2`, string(encoded), workspaceID)
}

func readRecommendations(t *testing.T, workspaceID string) MarketplaceRecommendationsResponse {
	t.Helper()
	var resp MarketplaceRecommendationsResponse
	testutil.Call(t, testHandler.ListMarketplaceRecommendations,
		marketplaceRequest(http.MethodGet, "/api/marketplace/recommendations", workspaceID, nil),
	).Want(http.StatusOK).JSON(&resp)
	return resp
}

func recommendationFor(resp MarketplaceRecommendationsResponse, listingID string) (MarketplaceRecommendationResponse, bool) {
	for _, rec := range resp.Recommendations {
		if rec.Listing.ID == listingID {
			return rec, true
		}
	}
	return MarketplaceRecommendationResponse{}, false
}

// The headline behaviour: what a workspace says about itself decides what it
// is offered, and the answer carries the evidence.
func TestRecommendationsRankAgainstTheWorkspaceProfile(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	matching := publishTaggedSkill(t, "mp-rec-go", "A review checklist.", []string{"go"})
	unrelated := publishTaggedSkill(t, "mp-rec-figma", "Design handoff notes.", []string{"figma"})

	consumer := otherWorkspace(t, "mp-rec-consumer")
	setProfile(t, consumer, map[string]any{"stack": []string{"go"}})

	resp := readRecommendations(t, consumer)
	if resp.ProfileEmpty {
		t.Fatal("a workspace with a stack reported an empty profile")
	}

	rec, ok := recommendationFor(resp, matching)
	if !ok {
		t.Fatalf("the matching listing was not recommended; got %d recommendations", len(resp.Recommendations))
	}
	if !rec.Matched {
		t.Error("a tag match on the workspace's stack should be marked matched")
	}
	if len(rec.Reasons) == 0 {
		t.Error("a recommendation arrived with no evidence")
	}
	var sawStack bool
	for _, reason := range rec.Reasons {
		if reason.Kind == "stack" && reason.Term == "go" {
			sawStack = true
		}
	}
	if !sawStack {
		t.Errorf("no stack reason naming go: %+v", rec.Reasons)
	}

	if other, ok := recommendationFor(resp, unrelated); ok && other.Matched {
		t.Error("an unrelated listing was reported as matching the profile")
	}
}

// The requirement the whole design follows from: the directory changes, and a
// listing published after a workspace was set up has to reach it.
func TestANewlyPublishedListingReachesAnExistingWorkspace(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	consumer := otherWorkspace(t, "mp-rec-new-listing")
	setProfile(t, consumer, map[string]any{"stack": []string{"rust"}})

	// Asserted on this listing rather than on the whole ranking: the directory
	// is shared across tests, and "nothing else matched" is not the claim.
	before := readRecommendations(t, consumer)
	published := publishTaggedSkill(t, "mp-rec-rust", "Rust review checklist.", []string{"rust"})
	if _, ok := recommendationFor(before, published); ok {
		t.Fatal("the listing was recommended before it was published")
	}

	after := readRecommendations(t, consumer)
	rec, ok := recommendationFor(after, published)
	if !ok || !rec.Matched {
		t.Fatal("a listing published after the workspace existed did not reach it")
	}
}

// A dismissal is "not this one", not "never". The stored version is what makes
// that true, and this is the test that would catch it being reduced to a
// boolean.
func TestDismissalHidesTheVersionAndANewVersionComesBack(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	skillID := dbfx.Insert(t, "skill", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"name":         "mp-rec-dismiss",
		"description":  "A Go review checklist.",
		"content":      "# checklist",
		"config":       testutil.Raw("'{}'::jsonb"),
		"created_by":   testUserID,
	})
	publish := func(version string) string {
		t.Helper()
		var resp PublishMarketplaceListingResponse
		testutil.Call(t, testHandler.PublishMarketplaceListing, newRequest(
			http.MethodPost, "/api/marketplace/listings", PublishMarketplaceListingRequest{
				Kind:       marketplaceKindSkill,
				SourceID:   skillID,
				Slug:       "mp-rec-dismiss",
				Visibility: marketplaceVisibilityPublic,
				Version:    version,
				Tags:       []string{"go"},
			},
		)).Want(http.StatusCreated).JSON(&resp)
		return resp.Listing.ID
	}
	listingID := publish("1.0.0")
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM marketplace_recommendation_decision WHERE listing_id = $1`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing_file WHERE version_id IN
			(SELECT id FROM marketplace_listing_version WHERE listing_id = $1)`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing_version WHERE listing_id = $1`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing WHERE id = $1`, listingID)
	})

	consumer := otherWorkspace(t, "mp-rec-dismiss-consumer")
	setProfile(t, consumer, map[string]any{"stack": []string{"go"}})

	if _, ok := recommendationFor(readRecommendations(t, consumer), listingID); !ok {
		t.Fatal("the listing was not recommended before being dismissed")
	}

	dismiss := marketplaceRequest(http.MethodPost,
		"/api/marketplace/recommendations/"+listingID+"/dismiss", consumer, nil)
	testutil.Call(t, testHandler.DismissMarketplaceRecommendation,
		withURLParam(dismiss, "id", listingID)).Want(http.StatusNoContent)

	if _, ok := recommendationFor(readRecommendations(t, consumer), listingID); ok {
		t.Fatal("a dismissed listing came back at the same version")
	}

	publish("2.0.0")
	if _, ok := recommendationFor(readRecommendations(t, consumer), listingID); !ok {
		t.Fatal("a new version of a dismissed listing did not come back")
	}
}

func TestRestoringADismissalPutsItBackImmediately(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	listingID := publishTaggedSkill(t, "mp-rec-restore", "A Go review checklist.", []string{"go"})
	consumer := otherWorkspace(t, "mp-rec-restore-consumer")
	setProfile(t, consumer, map[string]any{"stack": []string{"go"}})

	dismiss := marketplaceRequest(http.MethodPost,
		"/api/marketplace/recommendations/"+listingID+"/dismiss", consumer, nil)
	testutil.Call(t, testHandler.DismissMarketplaceRecommendation,
		withURLParam(dismiss, "id", listingID)).Want(http.StatusNoContent)

	restore := marketplaceRequest(http.MethodDelete,
		"/api/marketplace/recommendations/"+listingID+"/dismiss", consumer, nil)
	testutil.Call(t, testHandler.RestoreMarketplaceRecommendation,
		withURLParam(restore, "id", listingID)).Want(http.StatusNoContent)

	if _, ok := recommendationFor(readRecommendations(t, consumer), listingID); !ok {
		t.Fatal("restoring a dismissal did not put the listing back")
	}
}

// Recommending something the workspace already has is noise, and the update
// prompt on the installed entity is a different surface.
func TestAnInstalledListingIsNotRecommended(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	listingID := publishTaggedSkill(t, "mp-rec-installed", "A Go review checklist.", []string{"go"})
	consumer := otherWorkspace(t, "mp-rec-installed-consumer")
	setProfile(t, consumer, map[string]any{"stack": []string{"go"}})

	if _, ok := recommendationFor(readRecommendations(t, consumer), listingID); !ok {
		t.Fatal("the listing was not recommended before being installed")
	}

	install := marketplaceRequest(http.MethodPost,
		"/api/marketplace/listings/"+listingID+"/install", consumer,
		MarketplaceInstallRequest{Name: "installed copy"})
	testutil.Call(t, testHandler.InstallMarketplaceListing,
		withURLParam(install, "id", listingID)).Want(http.StatusCreated)

	if _, ok := recommendationFor(readRecommendations(t, consumer), listingID); ok {
		t.Fatal("an installed listing is still being recommended")
	}
}

// A workspace that has not said what it is still deserves to see the
// directory, and the response has to say the ranking was not about them.
func TestAnEmptyProfileIsReportedRatherThanSilentlyEmpty(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	publishTaggedSkill(t, "mp-rec-empty-profile", "Anything at all.", []string{"misc"})
	consumer := otherWorkspace(t, "mp-rec-empty-consumer")

	resp := readRecommendations(t, consumer)
	if !resp.ProfileEmpty {
		t.Fatal("a workspace with no profile did not report one")
	}
	for _, rec := range resp.Recommendations {
		if rec.Matched {
			t.Errorf("%q claims to match a profile that does not exist", rec.Listing.Name)
		}
	}
}

// Dismissing an id a workspace cannot see would let it probe for the existence
// of another workspace's private listings.
func TestDismissingAnInvisibleListingIsANotFound(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	listingID := publishTaggedSkill(t, "mp-rec-private", "Internal only.", []string{"go"})
	dbfx.Exec(t, `UPDATE marketplace_listing SET visibility = 'workspace' WHERE id = $1`, listingID)

	consumer := otherWorkspace(t, "mp-rec-private-consumer")
	dismiss := marketplaceRequest(http.MethodPost,
		"/api/marketplace/recommendations/"+listingID+"/dismiss", consumer, nil)
	testutil.Call(t, testHandler.DismissMarketplaceRecommendation,
		withURLParam(dismiss, "id", listingID)).Want(http.StatusNotFound)
}

func TestRecommendationLimitIsBoundedAndValidated(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	consumer := otherWorkspace(t, "mp-rec-limit")
	req := marketplaceRequest(http.MethodGet,
		"/api/marketplace/recommendations?limit=0", consumer, nil)
	testutil.Call(t, testHandler.ListMarketplaceRecommendations, req).Want(http.StatusBadRequest)

	req = marketplaceRequest(http.MethodGet,
		"/api/marketplace/recommendations?limit=nonsense", consumer, nil)
	testutil.Call(t, testHandler.ListMarketplaceRecommendations, req).Want(http.StatusBadRequest)

	var resp MarketplaceRecommendationsResponse
	req = marketplaceRequest(http.MethodGet,
		"/api/marketplace/recommendations?limit=9999", consumer, nil)
	testutil.Call(t, testHandler.ListMarketplaceRecommendations, req).
		Want(http.StatusOK).JSON(&resp)
	if len(resp.Recommendations) > maxRecommendationLimit {
		t.Fatalf("limit=9999 returned %d recommendations, want at most %d",
			len(resp.Recommendations), maxRecommendationLimit)
	}
}
