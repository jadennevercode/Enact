package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
)

// These tests exercise the publish → browse → install path across two
// workspaces, which is the whole point of the feature and the only place the
// cross-tenant rules can actually be checked. The redaction rules themselves
// are decided by pure functions and tested in marketplace_sanitize_test.go;
// what is asserted here is that the publish path runs them and that nothing
// reaches a second workspace that should not.

// marketplaceRequest builds an authenticated request scoped to workspaceID.
// newRequest always names the fixture workspace, and half of these tests are
// about what a DIFFERENT workspace can see.
func marketplaceRequest(method, path, workspaceID string, body any) *http.Request {
	req := newRequest(method, path, body)
	req.Header.Set("X-Workspace-ID", workspaceID)
	return req
}

// otherWorkspace creates a second workspace the fixture user owns, so a test
// can install into somewhere that is not the publisher.
func otherWorkspace(t *testing.T, slug string) string {
	t.Helper()
	workspaceID := dbfx.Workspace(t, "Marketplace Consumer", slug)
	dbfx.Member(t, workspaceID, testUserID, "owner")
	return workspaceID
}

// publishFixtureSkill creates a skill in the fixture workspace and publishes it.
func publishFixtureSkill(t *testing.T, name, slug, visibility string) (listingID, skillID string) {
	t.Helper()
	skillID = dbfx.Insert(t, "skill", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"name":         name,
		"description":  "a published skill",
		"content":      "# " + name + "\n\nthe body",
		"config":       testutil.Raw("'{}'::jsonb"),
		"created_by":   testUserID,
	})
	dbfx.Insert(t, "skill_file", testutil.Cols{
		"skill_id": skillID,
		"path":     "references/checklist.md",
		"content":  "- check this",
	})

	var resp PublishMarketplaceListingResponse
	testutil.Call(t, testHandler.PublishMarketplaceListing, newRequest(
		http.MethodPost, "/api/marketplace/listings", PublishMarketplaceListingRequest{
			Kind:       marketplaceKindSkill,
			SourceID:   skillID,
			Slug:       slug,
			Visibility: visibility,
			Version:    "1.0.0",
			Tags:       []string{"Review", "review"},
		},
	)).Want(http.StatusCreated).JSON(&resp)

	listingID = resp.Listing.ID
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing_file WHERE version_id IN
			(SELECT id FROM marketplace_listing_version WHERE listing_id = $1)`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing_version WHERE listing_id = $1`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_install WHERE listing_id = $1`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing WHERE id = $1`, listingID)
	})
	return listingID, skillID
}

func TestPublishSkillThenInstallItIntoAnotherWorkspace(t *testing.T) {
	listingID, _ := publishFixtureSkill(t, "mp-publish-install", "mp-publish-install", marketplaceVisibilityPublic)
	consumer := otherWorkspace(t, "mp-consumer-install")

	// The consumer workspace sees the listing in its browse.
	var catalog MarketplaceCatalogResponse
	testutil.Call(t, testHandler.ListMarketplaceListings,
		marketplaceRequest(http.MethodGet, "/api/marketplace/listings", consumer, nil),
	).Want(http.StatusOK).JSON(&catalog)

	found := false
	for _, listing := range catalog.Listings {
		if listing.ID != listingID {
			continue
		}
		found = true
		if listing.CanManage {
			t.Error("a workspace that did not publish the listing must not be told it can manage it")
		}
		if listing.LatestVersion != "1.0.0" {
			t.Errorf("latest version = %q, want 1.0.0", listing.LatestVersion)
		}
		// normalizeMarketplaceTags is what makes the facet counts count the
		// same thing; a duplicate that differs only in case must have folded.
		if len(listing.Tags) != 1 || listing.Tags[0] != "review" {
			t.Errorf("tags = %v, want [review]", listing.Tags)
		}
	}
	if !found {
		t.Fatalf("the public listing did not reach the consumer's browse: %+v", catalog.Listings)
	}

	var result MarketplaceInstallResult
	testutil.Call(t, testHandler.InstallMarketplaceListing, testutil.WithURLParams(
		marketplaceRequest(http.MethodPost, "/api/marketplace/listings/"+listingID+"/install", consumer,
			MarketplaceInstallRequest{}),
		"id", listingID,
	)).Want(http.StatusCreated).JSON(&result)

	if result.Status != "created" || result.Skill == nil {
		t.Fatalf("install result = %+v, want a created skill", result)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM skill_file WHERE skill_id = $1`, result.Skill.ID)
		testPool.Exec(context.Background(), `DELETE FROM skill WHERE id = $1`, result.Skill.ID)
	})

	// The installed skill is a copy in the consumer's own workspace, not a
	// pointer at the publisher's row.
	if result.Skill.WorkspaceID != consumer {
		t.Errorf("installed skill landed in workspace %s, want %s", result.Skill.WorkspaceID, consumer)
	}
	if !strings.Contains(result.Skill.Content, "the body") {
		t.Errorf("installed skill lost its body: %q", result.Skill.Content)
	}
	if len(result.Skill.Files) != 1 || result.Skill.Files[0].Path != "references/checklist.md" {
		t.Fatalf("installed skill files = %+v, want the one reference file", result.Skill.Files)
	}

	// Provenance is recorded, which is what lets the product offer an update
	// later without pretending to a live link.
	config, _ := json.Marshal(result.Skill.Config)
	if !strings.Contains(string(config), `"marketplace"`) || !strings.Contains(string(config), listingID) {
		t.Errorf("installed skill config carries no marketplace origin: %s", config)
	}

	var installs []MarketplaceInstallResponse
	testutil.Call(t, testHandler.ListMarketplaceInstalls,
		marketplaceRequest(http.MethodGet, "/api/marketplace/installs", consumer, nil),
	).Want(http.StatusOK).JSON(&installs)
	if len(installs) != 1 || installs[0].ListingID != listingID || installs[0].EntityID != result.Skill.ID {
		t.Fatalf("install records = %+v, want one naming the listing and the new skill", installs)
	}
}

func TestWorkspaceVisibleListingNeverReachesAnotherWorkspace(t *testing.T) {
	// The team-library case: published, but scoped to the publishing workspace.
	listingID, _ := publishFixtureSkill(t, "mp-internal-only", "mp-internal-only", marketplaceVisibilityWorkspace)
	consumer := otherWorkspace(t, "mp-consumer-internal")

	var catalog MarketplaceCatalogResponse
	testutil.Call(t, testHandler.ListMarketplaceListings,
		marketplaceRequest(http.MethodGet, "/api/marketplace/listings", consumer, nil),
	).Want(http.StatusOK).JSON(&catalog)
	for _, listing := range catalog.Listings {
		if listing.ID == listingID {
			t.Fatal("a workspace-visibility listing appeared in another workspace's browse")
		}
	}

	// Reading it by id is refused as missing rather than forbidden: a 403 would
	// confirm that a listing with this id exists.
	testutil.Call(t, testHandler.GetMarketplaceListing, testutil.WithURLParams(
		marketplaceRequest(http.MethodGet, "/api/marketplace/listings/"+listingID, consumer, nil),
		"id", listingID,
	)).Want(http.StatusNotFound)

	// And it cannot be installed out from under the visibility gate.
	testutil.Call(t, testHandler.InstallMarketplaceListing, testutil.WithURLParams(
		marketplaceRequest(http.MethodPost, "/api/marketplace/listings/"+listingID+"/install", consumer,
			MarketplaceInstallRequest{}),
		"id", listingID,
	)).Want(http.StatusNotFound)

	// Its own workspace still sees it, which is the point of the visibility.
	var own MarketplaceCatalogResponse
	testutil.Call(t, testHandler.ListMarketplaceListings,
		newRequest(http.MethodGet, "/api/marketplace/listings", nil),
	).Want(http.StatusOK).JSON(&own)
	seen := false
	for _, listing := range own.Listings {
		if listing.ID == listingID {
			seen = true
			if !listing.CanManage {
				t.Error("the publishing workspace's owner should be able to manage its own listing")
			}
		}
	}
	if !seen {
		t.Fatal("the publishing workspace cannot see its own workspace-visibility listing")
	}
}

func TestInstallingASkillWhoseNameIsTakenOffersTheImporterStrategies(t *testing.T) {
	listingID, _ := publishFixtureSkill(t, "mp-name-clash", "mp-name-clash", marketplaceVisibilityPublic)
	consumer := otherWorkspace(t, "mp-consumer-clash")

	// The consumer already has a skill by that name, authored by someone else.
	otherUser := dbfx.User(t, "Marketplace Other", "marketplace-other@enact.ai")
	dbfx.Insert(t, "skill", testutil.Cols{
		"workspace_id": consumer,
		"name":         "mp-name-clash",
		"description":  "the consumer's own",
		"content":      "local content",
		"config":       testutil.Raw("'{}'::jsonb"),
		"created_by":   otherUser,
	})

	install := func(strategy string) *testutil.Response {
		return testutil.Call(t, testHandler.InstallMarketplaceListing, testutil.WithURLParams(
			marketplaceRequest(http.MethodPost, "/api/marketplace/listings/"+listingID+"/install", consumer,
				MarketplaceInstallRequest{OnConflict: strategy}),
			"id", listingID,
		))
	}

	var conflict MarketplaceInstallResult
	install("fail").Want(http.StatusConflict).JSON(&conflict)
	if conflict.Status != "conflict" || conflict.ExistingSkill == nil {
		t.Fatalf("fail strategy = %+v, want a conflict naming the existing skill", conflict)
	}

	var skipped MarketplaceInstallResult
	install("skip").Want(http.StatusOK).JSON(&skipped)
	if skipped.Status != "skipped" {
		t.Fatalf("skip strategy = %+v, want skipped", skipped)
	}

	// Overwrite follows the same creator-only rule as a re-import: a workspace
	// admin must not be able to replace someone else's skill by installing a
	// listing that happens to share its name.
	var refused MarketplaceInstallResult
	install("overwrite").Want(http.StatusForbidden).JSON(&refused)
	if refused.Status != "failed" || !strings.Contains(refused.Reason, "creator") {
		t.Fatalf("overwrite by a non-creator = %+v, want a creator-only refusal", refused)
	}

	var renamed MarketplaceInstallResult
	install("rename").Want(http.StatusCreated).JSON(&renamed)
	if renamed.Skill == nil || renamed.Skill.Name == "mp-name-clash" {
		t.Fatalf("rename strategy = %+v, want a new skill under a different name", renamed)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM skill_file WHERE skill_id = $1`, renamed.Skill.ID)
		testPool.Exec(context.Background(), `DELETE FROM skill WHERE id = $1`, renamed.Skill.ID)
	})
	// The workspace's own skill is untouched.
	var localContent string
	dbfx.QueryRow(t, `SELECT content FROM skill WHERE workspace_id = $1 AND name = 'mp-name-clash'`, consumer).Scan(&localContent)
	if localContent != "local content" {
		t.Errorf("the consumer's own skill was modified: %q", localContent)
	}
}

func TestPublishingAnMcpServerWithholdsItsCredentials(t *testing.T) {
	serverID := dbfx.Insert(t, "workspace_mcp_server", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"name":         "mp-github",
		"config": testutil.Raw(
			`'{"command":"npx","args":["-y","srv"],"env":{"GITHUB_TOKEN":"ghp_abcdefghijklmnopqrstuvwx"}}'::jsonb`),
		"created_by": testUserID,
	})

	var published PublishMarketplaceListingResponse
	testutil.Call(t, testHandler.PublishMarketplaceListing, newRequest(
		http.MethodPost, "/api/marketplace/listings", PublishMarketplaceListingRequest{
			Kind: marketplaceKindMcp, SourceID: serverID, Slug: "mp-github",
			Visibility: marketplaceVisibilityPublic, Version: "1.0.0",
		},
	)).Want(http.StatusCreated).JSON(&published)
	listingID := published.Listing.ID
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing_version WHERE listing_id = $1`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_install WHERE listing_id = $1`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing WHERE id = $1`, listingID)
	})

	// The credential must not be in the stored manifest, which is what every
	// other workspace reads.
	var storedManifest string
	dbfx.QueryRow(t, `SELECT manifest::text FROM marketplace_listing_version WHERE id = $1`,
		published.Version.ID).Scan(&storedManifest)
	if strings.Contains(storedManifest, "ghp_abcdefghijklmnopqrstuvwx") {
		t.Fatalf("the published manifest leaked the token: %s", storedManifest)
	}
	if !strings.Contains(storedManifest, "env.GITHUB_TOKEN") {
		t.Errorf("the manifest does not tell an installer which value to supply: %s", storedManifest)
	}

	// And a second workspace reading it over HTTP gets the same redacted view.
	consumer := otherWorkspace(t, "mp-consumer-mcp")
	detail := testutil.Call(t, testHandler.GetMarketplaceListing, testutil.WithURLParams(
		marketplaceRequest(http.MethodGet, "/api/marketplace/listings/"+listingID, consumer, nil),
		"id", listingID,
	)).Want(http.StatusOK)
	if strings.Contains(detail.Text(), "ghp_abcdefghijklmnopqrstuvwx") {
		t.Fatalf("the listing detail leaked the token: %s", detail.Text())
	}

	// Installing it puts the installer's OWN value in, and the workspace MCP
	// response never echoes config back either way.
	var result MarketplaceInstallResult
	testutil.Call(t, testHandler.InstallMarketplaceListing, testutil.WithURLParams(
		marketplaceRequest(http.MethodPost, "/api/marketplace/listings/"+listingID+"/install", consumer,
			MarketplaceInstallRequest{Secrets: map[string]string{"env.GITHUB_TOKEN": "consumer-token"}}),
		"id", listingID,
	)).Want(http.StatusCreated).JSON(&result)
	if result.McpServer == nil {
		t.Fatalf("install result = %+v, want an MCP server", result)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM workspace_mcp_server WHERE id = $1`, result.McpServer.ID)
	})

	var installedConfig string
	dbfx.QueryRow(t, `SELECT config::text FROM workspace_mcp_server WHERE id = $1`, result.McpServer.ID).Scan(&installedConfig)
	if !strings.Contains(installedConfig, "consumer-token") {
		t.Errorf("the installer's own value was not applied: %s", installedConfig)
	}
	if strings.Contains(installedConfig, "ghp_abcdefghijklmnopqrstuvwx") {
		t.Fatalf("the publisher's token survived into the installed server: %s", installedConfig)
	}
}

func TestPublishingAnAgentTemplateOmitsWhatCannotTravel(t *testing.T) {
	runtimeID := handlerTestRuntimeID(t)
	agentID := dbfx.Agent(t, "mp-template-agent", runtimeID, testutil.Cols{
		"instructions":   "You review code carefully.",
		"description":    "a reviewer",
		"custom_env":     testutil.Raw(`'{"OPENAI_API_KEY":"sk-abcdefghijklmnopqrstu"}'::jsonb`),
		"custom_args":    testutil.Raw(`'["--verbose"]'::jsonb`),
		"runtime_config": testutil.Raw(`'{"gateway":{"token":"gateway-secret-value"}}'::jsonb`),
		"mcp_config": testutil.Raw(
			`'{"mcpServers":{"linear":{"url":"https://mcp.linear.app/session-abc123/sse"}}}'::jsonb`),
	})
	skillID := dbfx.Insert(t, "skill", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"name":         "mp-template-skill",
		"description":  "carried by the template",
		"content":      "# review checklist",
		"config":       testutil.Raw("'{}'::jsonb"),
		"created_by":   testUserID,
	})
	dbfx.InsertNoID(t, "agent_skill", testutil.Cols{"agent_id": agentID, "skill_id": skillID},
		"agent_id = $1 AND skill_id = $2", agentID, skillID)

	var published PublishMarketplaceListingResponse
	testutil.Call(t, testHandler.PublishMarketplaceListing, newRequest(
		http.MethodPost, "/api/marketplace/listings", PublishMarketplaceListingRequest{
			Kind: marketplaceKindAgent, SourceID: agentID, Slug: "mp-template-agent",
			Visibility: marketplaceVisibilityPublic, Version: "1.0.0",
		},
	)).Want(http.StatusCreated).JSON(&published)
	listingID := published.Listing.ID
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing_file WHERE version_id IN
			(SELECT id FROM marketplace_listing_version WHERE listing_id = $1)`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing_version WHERE listing_id = $1`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_install WHERE listing_id = $1`, listingID)
		testPool.Exec(context.Background(), `DELETE FROM marketplace_listing WHERE id = $1`, listingID)
	})

	manifest := string(published.Version.Manifest)
	for _, leaked := range []string{
		"sk-abcdefghijklmnopqrstu", // custom_env has no field in the manifest at all
		"gateway-secret-value",     // nor does runtime_config
		"session-abc123",           // the session URL is a bearer credential
	} {
		if strings.Contains(manifest, leaked) {
			t.Errorf("the agent template leaked %q: %s", leaked, manifest)
		}
	}
	if !strings.Contains(manifest, "You review code carefully.") {
		t.Errorf("the template lost the instructions, which are its substance: %s", manifest)
	}
	// The withheld URL still says which service it talks to.
	if !strings.Contains(manifest, "https://mcp.linear.app") {
		t.Errorf("the manifest gives a reader no idea what the server connects to: %s", manifest)
	}

	// Installing it rebuilds the agent, its skill and its MCP binding.
	consumer := otherWorkspace(t, "mp-consumer-agent")
	consumerRuntime := dbfx.Insert(t, "agent_runtime", testutil.Cols{
		"workspace_id": consumer,
		"daemon_id":    nil,
		"name":         "consumer-runtime",
		"runtime_mode": "cloud",
		"provider":     "handler_test_runtime",
		"status":       "online",
		"device_info":  "",
		"metadata":     testutil.Raw("'{}'::jsonb"),
		"last_seen_at": testutil.Raw("now()"),
		"visibility":   "private",
		"owner_id":     testUserID,
	})

	var result MarketplaceInstallResult
	testutil.Call(t, testHandler.InstallMarketplaceListing, testutil.WithURLParams(
		marketplaceRequest(http.MethodPost, "/api/marketplace/listings/"+listingID+"/install", consumer,
			MarketplaceInstallRequest{
				RuntimeID: consumerRuntime,
				Secrets:   map[string]string{"linear/url": "https://mcp.linear.app/consumer-session/sse"},
			}),
		"id", listingID,
	)).Want(http.StatusCreated).JSON(&result)
	if result.Agent == nil {
		t.Fatalf("install result = %+v, want an agent", result)
	}
	installedAgent := result.Agent.ID
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM agent_skill WHERE agent_id = $1`, installedAgent)
		testPool.Exec(context.Background(), `DELETE FROM agent_mcp_server WHERE agent_id = $1`, installedAgent)
		testPool.Exec(context.Background(), `DELETE FROM workspace_mcp_server WHERE workspace_id = $1`, consumer)
		testPool.Exec(context.Background(), `DELETE FROM skill_file WHERE skill_id IN (SELECT id FROM skill WHERE workspace_id = $1)`, consumer)
		testPool.Exec(context.Background(), `DELETE FROM skill WHERE workspace_id = $1`, consumer)
		testPool.Exec(context.Background(), `DELETE FROM agent WHERE id = $1`, installedAgent)
	})

	if result.Agent.Instructions != "You review code carefully." {
		t.Errorf("installed agent instructions = %q", result.Agent.Instructions)
	}
	// An installed agent is private to whoever installed it: the template's own
	// permission targets named another workspace's members and never travelled.
	if result.Agent.PermissionMode != "private" {
		t.Errorf("installed agent permission_mode = %q, want private", result.Agent.PermissionMode)
	}
	if result.Agent.HasCustomEnv {
		t.Error("the installed agent inherited environment variables from the publisher")
	}

	if got := dbfx.Count(t, `SELECT count(*) FROM agent_skill WHERE agent_id = $1`, installedAgent); got != 1 {
		t.Errorf("installed agent has %d skills, want the one the template carried", got)
	}
	if got := dbfx.Count(t, `SELECT count(*) FROM agent_mcp_server WHERE agent_id = $1`, installedAgent); got != 1 {
		t.Errorf("installed agent has %d MCP bindings, want the one the template expected", got)
	}
	var installedServerConfig string
	dbfx.QueryRow(t, `SELECT config::text FROM workspace_mcp_server WHERE workspace_id = $1`, consumer).Scan(&installedServerConfig)
	if !strings.Contains(installedServerConfig, "consumer-session") {
		t.Errorf("the installer's own session URL was not applied: %s", installedServerConfig)
	}
	if strings.Contains(installedServerConfig, "session-abc123") {
		t.Fatalf("the publisher's session URL survived into the installed server: %s", installedServerConfig)
	}
}

func TestPublishRefusesAnAgentWhoseArgumentsCarryACredential(t *testing.T) {
	// Redacting argv would mean rewriting the process invocation, so the
	// publish fails with something the publisher can act on instead.
	agentID := dbfx.Agent(t, "mp-argv-agent", handlerTestRuntimeID(t), testutil.Cols{
		"instructions": "",
		"custom_env":   testutil.Raw("'{}'::jsonb"),
		"custom_args":  testutil.Raw(`'["--api-key=sk-abcdefghijklmnopqrstu"]'::jsonb`),
	})

	body := testutil.Call(t, testHandler.PublishMarketplaceListing, newRequest(
		http.MethodPost, "/api/marketplace/listings", PublishMarketplaceListingRequest{
			Kind: marketplaceKindAgent, SourceID: agentID, Slug: "mp-argv-agent",
			Visibility: marketplaceVisibilityPublic, Version: "1.0.0",
		},
	)).Want(http.StatusBadRequest).Text()
	if !strings.Contains(body, "custom arguments") {
		t.Fatalf("refusal did not name the offending field: %s", body)
	}
	if dbfx.Count(t, `SELECT count(*) FROM marketplace_listing WHERE slug = 'mp-argv-agent'`) != 0 {
		t.Fatal("a refused publish still created a listing")
	}
}

func TestRepublishingUnderTheSameSlugAddsAVersion(t *testing.T) {
	listingID, skillID := publishFixtureSkill(t, "mp-versioned", "mp-versioned", marketplaceVisibilityPublic)

	republish := func(version string) *testutil.Response {
		return testutil.Call(t, testHandler.PublishMarketplaceListing, newRequest(
			http.MethodPost, "/api/marketplace/listings", PublishMarketplaceListingRequest{
				Kind: marketplaceKindSkill, SourceID: skillID, Slug: "mp-versioned",
				Visibility: marketplaceVisibilityPublic, Version: version,
			},
		))
	}

	// A published version is never overwritten; republishing the same string is
	// a conflict, which is what makes a digest worth showing anyone.
	republish("1.0.0").Want(http.StatusConflict)

	var second PublishMarketplaceListingResponse
	republish("1.1.0").Want(http.StatusCreated).JSON(&second)
	if second.Listing.ID != listingID {
		t.Fatalf("republishing minted a second listing %s, want %s", second.Listing.ID, listingID)
	}

	var versions []MarketplaceVersionResponse
	testutil.Call(t, testHandler.ListMarketplaceListingVersions, testutil.WithURLParams(
		newRequest(http.MethodGet, "/api/marketplace/listings/"+listingID+"/versions", nil),
		"id", listingID,
	)).Want(http.StatusOK).JSON(&versions)
	if len(versions) != 2 {
		t.Fatalf("version history has %d entries, want 2", len(versions))
	}
	if versions[0].Version != "1.1.0" {
		t.Errorf("version history is not newest-first: %+v", versions)
	}
}

func TestTakenDownListingStopsBeingInstallable(t *testing.T) {
	listingID, _ := publishFixtureSkill(t, "mp-takedown", "mp-takedown", marketplaceVisibilityPublic)
	consumer := otherWorkspace(t, "mp-consumer-takedown")

	removed := marketplaceStatusRemoved
	testutil.Call(t, testHandler.UpdateMarketplaceListing, testutil.WithURLParams(
		newRequest(http.MethodPatch, "/api/marketplace/listings/"+listingID,
			UpdateMarketplaceListingRequest{Status: &removed}),
		"id", listingID,
	)).Want(http.StatusOK)

	testutil.Call(t, testHandler.InstallMarketplaceListing, testutil.WithURLParams(
		marketplaceRequest(http.MethodPost, "/api/marketplace/listings/"+listingID+"/install", consumer,
			MarketplaceInstallRequest{}),
		"id", listingID,
	)).Want(http.StatusNotFound)

	// A deprecated listing is different: it drops out of browse but stays
	// installable, because someone already depends on it.
	deprecated := marketplaceStatusDeprecated
	testutil.Call(t, testHandler.UpdateMarketplaceListing, testutil.WithURLParams(
		newRequest(http.MethodPatch, "/api/marketplace/listings/"+listingID,
			UpdateMarketplaceListingRequest{Status: &deprecated}),
		"id", listingID,
	)).Want(http.StatusOK)

	var catalog MarketplaceCatalogResponse
	testutil.Call(t, testHandler.ListMarketplaceListings,
		marketplaceRequest(http.MethodGet, "/api/marketplace/listings", consumer, nil),
	).Want(http.StatusOK).JSON(&catalog)
	for _, listing := range catalog.Listings {
		if listing.ID == listingID {
			t.Error("a deprecated listing is still being advertised in browse")
		}
	}

	var result MarketplaceInstallResult
	testutil.Call(t, testHandler.InstallMarketplaceListing, testutil.WithURLParams(
		marketplaceRequest(http.MethodPost, "/api/marketplace/listings/"+listingID+"/install", consumer,
			MarketplaceInstallRequest{}),
		"id", listingID,
	)).Want(http.StatusCreated).JSON(&result)
	if result.Skill != nil {
		t.Cleanup(func() {
			testPool.Exec(context.Background(), `DELETE FROM skill_file WHERE skill_id = $1`, result.Skill.ID)
			testPool.Exec(context.Background(), `DELETE FROM skill WHERE id = $1`, result.Skill.ID)
		})
	}
}

func TestOnlyAnOwnerOrAdminOfThePublishingWorkspaceCanPublish(t *testing.T) {
	skillID := dbfx.Insert(t, "skill", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"name":         "mp-permission-skill",
		"description":  "",
		"content":      "body",
		"config":       testutil.Raw("'{}'::jsonb"),
		"created_by":   testUserID,
	})
	plainUser := dbfx.User(t, "Marketplace Member", "marketplace-member@enact.ai")
	dbfx.Member(t, testWorkspaceID, plainUser, "member")

	req := newRequest(http.MethodPost, "/api/marketplace/listings", PublishMarketplaceListingRequest{
		Kind: marketplaceKindSkill, SourceID: skillID, Slug: "mp-permission-skill",
		Visibility: marketplaceVisibilityPublic, Version: "1.0.0",
	})
	req.Header.Set("X-User-ID", plainUser)
	testutil.Call(t, testHandler.PublishMarketplaceListing, req).Want(http.StatusForbidden)

	if dbfx.Count(t, `SELECT count(*) FROM marketplace_listing WHERE slug = 'mp-permission-skill'`) != 0 {
		t.Fatal("a member's refused publish still created a listing")
	}
}

func TestAnotherWorkspaceCannotEditOrTakeDownSomeoneElsesListing(t *testing.T) {
	listingID, _ := publishFixtureSkill(t, "mp-foreign-edit", "mp-foreign-edit", marketplaceVisibilityPublic)
	consumer := otherWorkspace(t, "mp-consumer-foreign")

	removed := marketplaceStatusRemoved
	testutil.Call(t, testHandler.UpdateMarketplaceListing, testutil.WithURLParams(
		marketplaceRequest(http.MethodPatch, "/api/marketplace/listings/"+listingID, consumer,
			UpdateMarketplaceListingRequest{Status: &removed}),
		"id", listingID,
	)).Want(http.StatusForbidden)

	var status string
	dbfx.QueryRow(t, `SELECT status FROM marketplace_listing WHERE id = $1`, listingID).Scan(&status)
	if status != marketplaceStatusPublished {
		t.Fatalf("listing status = %q; another workspace changed it", status)
	}
}

func TestBrowseFiltersAndFacetsDescribeTheSameVisibleSet(t *testing.T) {
	skillListing, _ := publishFixtureSkill(t, "mp-facet-skill", "mp-facet-skill", marketplaceVisibilityPublic)

	var catalog MarketplaceCatalogResponse
	testutil.Call(t, testHandler.ListMarketplaceListings,
		newRequest(http.MethodGet, "/api/marketplace/listings?kind=skill&tag=review", nil),
	).Want(http.StatusOK).JSON(&catalog)

	found := false
	for _, listing := range catalog.Listings {
		if listing.ID == skillListing {
			found = true
		}
		if listing.Kind != marketplaceKindSkill {
			t.Errorf("kind filter returned a %s listing", listing.Kind)
		}
	}
	if !found {
		t.Fatalf("the tagged skill listing did not survive its own filters: %+v", catalog.Listings)
	}
	// Facets are counted before the filters are applied, so choosing "skill"
	// must not make the other kinds' counts vanish from the chips.
	if catalog.Facets.Kinds[marketplaceKindSkill] == 0 {
		t.Errorf("facets = %+v, want a non-zero skill count", catalog.Facets)
	}
	if catalog.Total < catalog.Count {
		t.Errorf("total %d is smaller than the filtered count %d", catalog.Total, catalog.Count)
	}
}

func TestGetMarketplaceListingFileReadsOnePublishedFile(t *testing.T) {
	listingID, _ := publishFixtureSkill(t, "mp-file-read", "mp-file-read", marketplaceVisibilityPublic)
	consumer := otherWorkspace(t, "mp-consumer-file")

	var file MarketplaceFileResponse
	testutil.Call(t, testHandler.GetMarketplaceListingFile, testutil.WithURLParams(
		marketplaceRequest(http.MethodGet,
			"/api/marketplace/listings/"+listingID+"/file?path=references/checklist.md", consumer, nil),
		"id", listingID,
	)).Want(http.StatusOK).JSON(&file)
	if file.Content != "- check this" {
		t.Errorf("file content = %q", file.Content)
	}

	testutil.Call(t, testHandler.GetMarketplaceListingFile, testutil.WithURLParams(
		marketplaceRequest(http.MethodGet,
			"/api/marketplace/listings/"+listingID+"/file?path=nope.md", consumer, nil),
		"id", listingID,
	)).Want(http.StatusNotFound)
}

func TestMalformedManifestIsRefusedRatherThanInstalled(t *testing.T) {
	// A version row is data; a manifest that does not describe what its listing
	// claims must not be turned into an entity.
	listingID, _ := publishFixtureSkill(t, "mp-malformed", "mp-malformed", marketplaceVisibilityPublic)
	var versionID string
	dbfx.QueryRow(t, `SELECT latest_version_id FROM marketplace_listing WHERE id = $1`, listingID).Scan(&versionID)
	dbfx.Exec(t, `UPDATE marketplace_listing_version SET manifest = '{"kind":"agent"}'::jsonb WHERE id = $1`, versionID)

	consumer := otherWorkspace(t, "mp-consumer-malformed")
	body := testutil.Call(t, testHandler.InstallMarketplaceListing, testutil.WithURLParams(
		marketplaceRequest(http.MethodPost, "/api/marketplace/listings/"+listingID+"/install", consumer,
			MarketplaceInstallRequest{}),
		"id", listingID,
	)).Want(http.StatusUnprocessableEntity).Text()
	if !strings.Contains(body, "kind") {
		t.Errorf("refusal did not say the manifest disagrees with its listing: %s", body)
	}
}
