package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

// Cross-workspace runtime profiles (migration 416). These tests pin the two
// rules that make sharing a definition safe:
//
//  1. Access is the publication row, not runtime_profile.workspace_id. A
//     workspace that was never published to must not see the profile, and a
//     daemon in it must not be able to register it.
//  2. Blast radius decides authority. Withdrawing from one workspace is that
//     workspace's business; changing or deleting a definition several teams
//     depend on is the owner's.
//
// The pre-publication behaviour is load-bearing too: a workspace that is the
// sole user of a profile must keep the admin powers it has always had, or this
// feature is a permission regression dressed as a feature.

// secondWorkspaceFixture creates a workspace the test user also administers, so
// a profile can be published into two places and the cross-workspace rules
// actually have somewhere to apply.
func secondWorkspaceFixture(t *testing.T, ctx context.Context, slug string) string {
	t.Helper()
	var wsID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO workspace (name, slug, issue_prefix)
		VALUES ($1, $2, 'PUB2')
		RETURNING id
	`, "Profile publication "+slug, slug).Scan(&wsID); err != nil {
		t.Fatalf("insert second workspace: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO member (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
	`, wsID, testUserID); err != nil {
		t.Fatalf("insert second workspace member: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		testPool.Exec(bg, `DELETE FROM runtime_profile_workspace WHERE workspace_id = $1`, wsID)
		testPool.Exec(bg, `DELETE FROM member WHERE workspace_id = $1`, wsID)
		testPool.Exec(bg, `DELETE FROM workspace WHERE id = $1`, wsID)
	})
	return wsID
}

func publishProfileInto(t *testing.T, ctx context.Context, profileID, workspaceID string) {
	t.Helper()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO runtime_profile_workspace (profile_id, workspace_id, published_by)
		VALUES ($1, $2, $3)
		ON CONFLICT (profile_id, workspace_id) DO UPDATE SET enabled = true
	`, profileID, workspaceID, testUserID); err != nil {
		t.Fatalf("publish profile into workspace: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(),
			`DELETE FROM runtime_profile_workspace WHERE profile_id = $1 AND workspace_id = $2`,
			profileID, workspaceID)
	})
}

// TestGetRuntimeProfile_UnpublishedWorkspaceGets404 is the isolation guard.
// Before publication existed, workspace_id on the profile was the access check;
// now the join is, and a profile that reaches workspace A must be as invisible
// from workspace B as a profile that does not exist. Anything softer than 404
// would let a member of B probe for the existence of A's definitions.
func TestGetRuntimeProfile_UnpublishedWorkspaceGets404(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	profileID := insertRuntimeProfileFixture(t, ctx, "Isolation Profile", "codex", "isolation-codex")
	otherWS := secondWorkspaceFixture(t, ctx, "profile-isolation-ws")

	w := httptest.NewRecorder()
	req := newRequest("GET", "/api/workspaces/"+otherWS+"/runtime-profiles/"+profileID, nil)
	req = withURLParams(req, "id", otherWS, "profileId", profileID)
	testHandler.GetRuntimeProfile(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for a profile not published into this workspace, got %d: %s",
			w.Code, w.Body.String())
	}
}

// TestListRuntimeProfiles_ShowsOnlyPublished pins the list read to the same
// rule as the point read. A workspace's list is what its members choose
// runtimes from, so a leak here is a leak into the agent-creation UI.
func TestListRuntimeProfiles_ShowsOnlyPublished(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	profileID := insertRuntimeProfileFixture(t, ctx, "List Scope Profile", "codex", "list-scope-codex")
	otherWS := secondWorkspaceFixture(t, ctx, "profile-list-scope-ws")

	listIn := func(wsID string) []string {
		t.Helper()
		w := httptest.NewRecorder()
		req := newRequest("GET", "/api/workspaces/"+wsID+"/runtime-profiles", nil)
		req = withURLParams(req, "id", wsID)
		testHandler.ListRuntimeProfiles(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("list runtime profiles in %s: %d: %s", wsID, w.Code, w.Body.String())
		}
		var body struct {
			RuntimeProfiles []RuntimeProfileResponse `json:"runtime_profiles"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode list body: %v", err)
		}
		ids := make([]string, 0, len(body.RuntimeProfiles))
		for _, p := range body.RuntimeProfiles {
			ids = append(ids, p.ID)
		}
		return ids
	}

	if !containsProfileID(listIn(testWorkspaceID), profileID) {
		t.Fatal("profile missing from the workspace it was created in")
	}
	if containsProfileID(listIn(otherWS), profileID) {
		t.Fatal("unpublished profile leaked into another workspace's list")
	}

	publishProfileInto(t, ctx, profileID, otherWS)
	if !containsProfileID(listIn(otherWS), profileID) {
		t.Fatal("published profile did not appear in the second workspace's list")
	}
}

// TestDeleteRuntimeProfile_WithdrawsWithoutDeletingSharedDefinition is the
// central safety property of the whole feature. An admin of one workspace must
// be able to stop using a shared profile without destroying it for the other
// teams that depend on it — otherwise sharing a definition would hand every
// consuming workspace a delete button on everyone else's runtimes.
func TestDeleteRuntimeProfile_WithdrawsWithoutDeletingSharedDefinition(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	profileID := insertRuntimeProfileFixture(t, ctx, "Shared Withdraw Profile", "codex", "withdraw-codex")
	otherWS := secondWorkspaceFixture(t, ctx, "profile-withdraw-ws")
	publishProfileInto(t, ctx, profileID, otherWS)

	w := httptest.NewRecorder()
	req := newRequest("DELETE", "/api/workspaces/"+otherWS+"/runtime-profiles/"+profileID, nil)
	req = withURLParams(req, "id", otherWS, "profileId", profileID)
	testHandler.DeleteRuntimeProfile(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204 withdrawing a shared profile, got %d: %s", w.Code, w.Body.String())
	}

	var definitionRows int
	testPool.QueryRow(ctx, `SELECT count(*) FROM runtime_profile WHERE id = $1`, profileID).Scan(&definitionRows)
	if definitionRows != 1 {
		t.Fatalf("withdrawing from one workspace destroyed the shared definition: %d rows left", definitionRows)
	}

	var remaining []string
	rows, err := testPool.Query(ctx,
		`SELECT workspace_id::text FROM runtime_profile_workspace WHERE profile_id = $1`, profileID)
	if err != nil {
		t.Fatalf("read publications: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var wsID string
		if err := rows.Scan(&wsID); err != nil {
			t.Fatalf("scan publication: %v", err)
		}
		remaining = append(remaining, wsID)
	}
	if len(remaining) != 1 || remaining[0] != testWorkspaceID {
		t.Fatalf("expected only the origin workspace to still publish it, got %v", remaining)
	}
}

// TestDeleteRuntimeProfile_LastWorkspaceDeletesDefinition pins the other half
// of that behaviour. The single-workspace case is still the common one, and it
// must keep behaving exactly as it did before profiles could be shared: delete
// it where you use it and it is gone, with no orphaned definition left behind
// that nothing can reach.
func TestDeleteRuntimeProfile_LastWorkspaceDeletesDefinition(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	profileID := insertRuntimeProfileFixture(t, ctx, "Sole Workspace Profile", "codex", "sole-codex")

	w := httptest.NewRecorder()
	req := newRequest("DELETE", "/api/workspaces/"+testWorkspaceID+"/runtime-profiles/"+profileID, nil)
	req = withURLParams(req, "id", testWorkspaceID, "profileId", profileID)
	testHandler.DeleteRuntimeProfile(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	var definitionRows, publicationRows int
	testPool.QueryRow(ctx, `SELECT count(*) FROM runtime_profile WHERE id = $1`, profileID).Scan(&definitionRows)
	testPool.QueryRow(ctx, `SELECT count(*) FROM runtime_profile_workspace WHERE profile_id = $1`, profileID).Scan(&publicationRows)
	if definitionRows != 0 {
		t.Fatalf("definition survived deletion from its only workspace: %d rows", definitionRows)
	}
	if publicationRows != 0 {
		t.Fatalf("publication row survived definition deletion: %d rows", publicationRows)
	}
}

// TestProfileEditAuthority states the rule in one place, in the terms it is
// actually decided by. The table is the specification: an owner always may; an
// admin may while nobody else depends on the definition; a plain member never
// may; and a non-owner admin loses the power precisely at the moment a second
// workspace starts depending on the profile.
func TestProfileEditAuthority(t *testing.T) {
	owner := parseUUID("11111111-1111-4111-8111-111111111111")
	other := parseUUID("22222222-2222-4222-8222-222222222222")

	cases := []struct {
		name             string
		actor            string
		role             string
		publicationCount int64
		want             bool
	}{
		{"owner may edit their own, however far it spread", "owner", "member", 5, true},
		{"owner may edit at one publication", "owner", "member", 1, true},
		{"admin may edit a profile only their workspace uses", "other", "admin", 1, true},
		{"workspace owner may edit a profile only their workspace uses", "other", "owner", 1, true},
		{"admin may not edit once a second workspace depends on it", "other", "admin", 2, false},
		{"member may never edit someone else's definition", "other", "member", 1, false},
		{"member may not edit a shared definition either", "other", "member", 3, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			actor := other
			if tc.actor == "owner" {
				actor = owner
			}
			if got := profileEditAuthority(actor, owner, tc.role, tc.publicationCount); got != tc.want {
				t.Fatalf("profileEditAuthority(role=%s, publications=%d) = %v, want %v",
					tc.role, tc.publicationCount, got, tc.want)
			}
		})
	}
}

// TestProfileEditAuthority_OwnerlessProfile covers the legacy row: a profile
// created before owner_id existed whose created_by was NULL. Nobody can claim
// ownership of it, so authority has to fall back to the workspace admin rule
// rather than locking the row so that no one can ever edit it.
func TestProfileEditAuthority_OwnerlessProfile(t *testing.T) {
	var ownerless pgtype.UUID // zero value: NULL owner_id
	actor := parseUUID("33333333-3333-4333-8333-333333333333")

	if profileEditAuthority(actor, ownerless, "member", 1) {
		t.Fatal("a plain member must not inherit authority over an ownerless profile")
	}
	if !profileEditAuthority(actor, ownerless, "admin", 1) {
		t.Fatal("an admin of the only workspace using an ownerless profile must still be able to edit it")
	}
	if profileEditAuthority(actor, ownerless, "admin", 2) {
		t.Fatal("an ownerless profile shared with a second workspace must not be editable by one workspace's admin")
	}
}

func containsProfileID(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}
