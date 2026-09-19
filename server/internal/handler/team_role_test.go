package handler

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/events"
	"github.com/enact-ai/enact/server/internal/testutil"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/protocol"
)

// Team role catalog and assignment tests.
//
// The rule these protect, stated once: a team role says what KIND of judgement
// someone is trusted to give. It never grants access — member.role does that —
// and it never disappears silently, because an assignment is what routes a
// review to a person.

// makeTeamRole inserts a role straight into the catalog and removes it after
// the test, so catalog state cannot leak between tests in the shared workspace.
func makeTeamRole(t *testing.T, key, name string) db.TeamRole {
	t.Helper()
	role, err := testHandler.Queries.CreateTeamRole(context.Background(), db.CreateTeamRoleParams{
		WorkspaceID: parseUUID(testWorkspaceID),
		Key:         key,
		Name:        name,
		Description: "",
		Color:       "#123456",
	})
	if err != nil {
		t.Fatalf("create team role %q: %v", key, err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM member_team_role WHERE team_role_id = $1`, role.ID)
		testPool.Exec(context.Background(), `DELETE FROM team_role WHERE id = $1`, role.ID)
	})
	return role
}

// makeSecondMember adds another person to the test workspace.
func makeSecondMember(t *testing.T, name, email string) (userID, memberID string) {
	t.Helper()
	userID = dbfx.User(t, name, email)
	memberID = dbfx.Member(t, testWorkspaceID, userID, "member")
	return userID, memberID
}

func setMemberTeamRoles(t *testing.T, memberID string, roleIDs []string) *testutil.Response {
	t.Helper()
	return testutil.Call(t, testHandler.SetMemberTeamRoles, testutil.WithURLParams(
		newRequest(http.MethodPut, "/api/workspaces/"+testWorkspaceID+"/members/"+memberID+"/team-roles",
			map[string]any{"team_role_ids": roleIDs}),
		"id", testWorkspaceID, "memberId", memberID))
}

func memberTeamRoleCount(t *testing.T, userID string) int {
	t.Helper()
	return dbfx.Count(t,
		`SELECT count(*) FROM member_team_role WHERE workspace_id = $1 AND actor_type = 'member' AND actor_id = $2`,
		testWorkspaceID, userID)
}

func TestCreateTeamRoleDerivesKeyAndRejectsDuplicates(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	var created TeamRoleResponse
	testutil.Call(t, testHandler.CreateTeamRole,
		newRequest(http.MethodPost, "/api/team-roles", map[string]any{
			"name": "Security Review", "color": "#3b82f6",
		})).Want(http.StatusCreated).JSON(&created)
	dbfx.Cleanup(t, `DELETE FROM team_role WHERE id = $1`, parseUUID(created.ID))

	if created.Key != "security_review" {
		t.Errorf("key = %q, want it derived from the name as security_review", created.Key)
	}

	// Same name again: the partial unique index on active names is what stops a
	// picker from showing two entries a human cannot tell apart.
	testutil.Call(t, testHandler.CreateTeamRole,
		newRequest(http.MethodPost, "/api/team-roles", map[string]any{
			"name": "Security Review", "color": "#3b82f6",
		})).Want(http.StatusConflict)
}

// A Chinese name yields no ASCII slug. The key is a machine handle, so the
// admin gets a generated one instead of a form error demanding they invent it.
func TestCreateTeamRoleGeneratesKeyForNonLatinName(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	var created TeamRoleResponse
	testutil.Call(t, testHandler.CreateTeamRole,
		newRequest(http.MethodPost, "/api/team-roles", map[string]any{
			"name": "业务负责人", "color": "#8b5cf6",
		})).Want(http.StatusCreated).JSON(&created)
	dbfx.Cleanup(t, `DELETE FROM team_role WHERE id = $1`, parseUUID(created.ID))

	if created.Key == "" {
		t.Fatal("key must never be empty; it is what routing config references")
	}
	if !teamRoleKeyPattern.MatchString(created.Key) {
		t.Errorf("generated key %q does not satisfy the storage pattern", created.Key)
	}
}

func TestPlainMemberCannotEditTheCatalog(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	userID, _ := makeSecondMember(t, "Role Reader", "role-reader@example.com")

	testutil.Call(t, testHandler.CreateTeamRole,
		newRequestAs(userID, http.MethodPost, "/api/team-roles", map[string]any{
			"name": "Member Made This", "color": "#123456",
		})).Want(http.StatusForbidden)

	// Reading is open to every member: each client renders roles on the roster.
	testutil.Call(t, testHandler.ListTeamRoles,
		newRequestAs(userID, http.MethodGet, "/api/team-roles", nil)).Want(http.StatusOK)
}

func TestSetMemberTeamRolesReplacesTheSet(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	qa := makeTeamRole(t, "qa_set", "QA Set")
	ops := makeTeamRole(t, "ops_set", "Ops Set")
	userID, memberID := makeSecondMember(t, "Role Holder", "role-holder@example.com")

	var resp MemberWithUserResponse
	setMemberTeamRoles(t, memberID, []string{uuidToString(qa.ID), uuidToString(ops.ID)}).
		Want(http.StatusOK).JSON(&resp)
	if len(resp.TeamRoles) != 2 {
		t.Fatalf("response carries %d roles, want 2", len(resp.TeamRoles))
	}

	// A second save with one id is a REPLACE, not an add.
	setMemberTeamRoles(t, memberID, []string{uuidToString(ops.ID)}).Want(http.StatusOK).JSON(&resp)
	if len(resp.TeamRoles) != 1 || resp.TeamRoles[0].Key != "ops_set" {
		t.Fatalf("after replacing, member holds %+v, want only ops_set", resp.TeamRoles)
	}

	// The empty set is a legitimate save: it means "this person reviews nothing".
	setMemberTeamRoles(t, memberID, []string{}).Want(http.StatusOK)
	if n := memberTeamRoleCount(t, userID); n != 0 {
		t.Errorf("member holds %d roles after clearing, want 0", n)
	}
}

func TestSetMemberTeamRolesRejectsForeignAndArchivedRoles(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	_, memberID := makeSecondMember(t, "Role Target", "role-target@example.com")

	// Another workspace's role id must not cross the boundary.
	otherWorkspaceID := dbfx.Workspace(t, "Other Roles WS", "other-roles-ws")
	otherRoleID := dbfx.Insert(t, "team_role", testutil.Cols{
		"workspace_id": otherWorkspaceID,
		"key":          "foreign_role",
		"name":         "Foreign Role",
		"description":  "",
		"color":        "#123456",
	})
	setMemberTeamRoles(t, memberID, []string{otherRoleID}).Want(http.StatusBadRequest)

	// An archived role cannot be handed out: it is retired from assignment.
	archived := makeTeamRole(t, "archived_role", "Archived Role")
	testutil.Call(t, testHandler.ArchiveTeamRole, withURLParam(
		newRequest(http.MethodDelete, "/api/team-roles/"+uuidToString(archived.ID), nil),
		"id", uuidToString(archived.ID))).Want(http.StatusOK)
	setMemberTeamRoles(t, memberID, []string{uuidToString(archived.ID)}).Want(http.StatusBadRequest)

	// The same id twice is a client bug, not a set with one member.
	live := makeTeamRole(t, "live_role", "Live Role")
	setMemberTeamRoles(t, memberID, []string{uuidToString(live.ID), uuidToString(live.ID)}).
		Want(http.StatusBadRequest)
}

// Archiving a role someone holds keeps the assignment. The picker cannot offer
// an archived role, so a later save from that picker must not drop it either —
// otherwise restoring the role would silently lose who held it.
func TestArchivedRoleKeepsItsHoldersAcrossASave(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	keep := makeTeamRole(t, "keep_role", "Keep Role")
	other := makeTeamRole(t, "other_role", "Other Role")
	userID, memberID := makeSecondMember(t, "Archive Holder", "archive-holder@example.com")

	setMemberTeamRoles(t, memberID, []string{uuidToString(keep.ID)}).Want(http.StatusOK)
	testutil.Call(t, testHandler.ArchiveTeamRole, withURLParam(
		newRequest(http.MethodDelete, "/api/team-roles/"+uuidToString(keep.ID), nil),
		"id", uuidToString(keep.ID))).Want(http.StatusOK)

	// A save from the picker carries only ACTIVE ids.
	setMemberTeamRoles(t, memberID, []string{uuidToString(other.ID)}).Want(http.StatusOK)

	if n := memberTeamRoleCount(t, userID); n != 2 {
		t.Fatalf("member holds %d assignments, want 2 (the archived one must survive)", n)
	}

	var restored TeamRoleResponse
	testutil.Call(t, testHandler.RestoreTeamRole, withURLParam(
		newRequest(http.MethodPost, "/api/team-roles/"+uuidToString(keep.ID)+"/restore", nil),
		"id", uuidToString(keep.ID))).Want(http.StatusOK).JSON(&restored)
	if restored.ArchivedAt != nil {
		t.Errorf("restored role still carries archived_at = %v", *restored.ArchivedAt)
	}
}

func TestReorderTeamRolesDemandsEveryActiveRole(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	first := makeTeamRole(t, "reorder_one", "Reorder One")
	makeTeamRole(t, "reorder_two", "Reorder Two")

	// A partial order would assign positions from the array index and collide
	// with the roles left out, so it is refused rather than half-applied.
	testutil.Call(t, testHandler.ReorderTeamRoles,
		newRequest(http.MethodPatch, "/api/team-roles/reorder", map[string]any{
			"ids": []string{uuidToString(first.ID)},
		})).Want(http.StatusConflict)

	active, err := testHandler.Queries.ListActiveTeamRoleIDs(context.Background(), parseUUID(testWorkspaceID))
	if err != nil {
		t.Fatalf("list active roles: %v", err)
	}
	ids := make([]string, len(active))
	for i, id := range active {
		ids[i] = uuidToString(id)
	}
	// Reversed, so the assertion cannot pass on the order the rows already had.
	for i, j := 0, len(ids)-1; i < j; i, j = i+1, j-1 {
		ids[i], ids[j] = ids[j], ids[i]
	}
	var listed struct {
		TeamRoles []TeamRoleResponse `json:"team_roles"`
	}
	testutil.Call(t, testHandler.ReorderTeamRoles,
		newRequest(http.MethodPatch, "/api/team-roles/reorder", map[string]any{"ids": ids})).
		Want(http.StatusOK).JSON(&listed)

	position := map[string]float64{}
	for _, role := range listed.TeamRoles {
		position[role.ID] = role.Position
	}
	for i := 1; i < len(ids); i++ {
		if position[ids[i-1]] >= position[ids[i]] {
			t.Fatalf("role %s did not move ahead of %s", ids[i-1], ids[i])
		}
	}
}

// The member list is the routing lookup: it carries each person's roles, and
// ?team_role= narrows it to the people who can review a given kind of work.
func TestMemberListCarriesTeamRolesAndFiltersByKey(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	qa := makeTeamRole(t, "qa_filter", "QA Filter")
	holderID, holderMemberID := makeSecondMember(t, "QA Person", "qa-person@example.com")
	makeSecondMember(t, "Not QA Person", "not-qa-person@example.com")
	setMemberTeamRoles(t, holderMemberID, []string{uuidToString(qa.ID)}).Want(http.StatusOK)

	var all []MemberWithUserResponse
	testutil.Call(t, testHandler.ListMembersWithUser, withURLParam(
		newRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/members", nil),
		"id", testWorkspaceID)).Want(http.StatusOK).JSON(&all)

	for _, m := range all {
		if m.TeamRoles == nil {
			t.Fatalf("member %s carries a nil role list; clients iterate it without a guard", m.UserID)
		}
	}

	var filtered []MemberWithUserResponse
	testutil.Call(t, testHandler.ListMembersWithUser, withURLParam(
		newRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/members?team_role=qa_filter", nil),
		"id", testWorkspaceID)).Want(http.StatusOK).JSON(&filtered)

	if len(filtered) != 1 || filtered[0].UserID != holderID {
		t.Fatalf("filter returned %d members, want only the QA holder", len(filtered))
	}

	// An archived role routes nobody, even though the assignment survives.
	testutil.Call(t, testHandler.ArchiveTeamRole, withURLParam(
		newRequest(http.MethodDelete, "/api/team-roles/"+uuidToString(qa.ID), nil),
		"id", uuidToString(qa.ID))).Want(http.StatusOK)

	var afterArchive []MemberWithUserResponse
	testutil.Call(t, testHandler.ListMembersWithUser, withURLParam(
		newRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/members?team_role=qa_filter", nil),
		"id", testWorkspaceID)).Want(http.StatusOK).JSON(&afterArchive)
	if len(afterArchive) != 0 {
		t.Fatalf("archived role still routed %d members", len(afterArchive))
	}
}

// Removing someone takes their roles with them, in the same transaction. A
// re-invited user must not silently regain the right to sign off work.
func TestRemovingAMemberDropsTheirTeamRoles(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	role := makeTeamRole(t, "leaver_role", "Leaver Role")
	userID, memberID := makeSecondMember(t, "Leaver", "leaver@example.com")
	setMemberTeamRoles(t, memberID, []string{uuidToString(role.ID)}).Want(http.StatusOK)

	testutil.Call(t, testHandler.DeleteMember, testutil.WithURLParams(
		newRequest(http.MethodDelete, "/api/workspaces/"+testWorkspaceID+"/members/"+memberID, nil),
		"id", testWorkspaceID, "memberId", memberID)).Want(http.StatusNoContent)

	if n := memberTeamRoleCount(t, userID); n != 0 {
		t.Errorf("%d role assignments outlived the membership", n)
	}
}

// Importing the AI-SDLC preset is idempotent, and re-importing never overwrites
// a workspace's own rename of a preset role.
func TestImportTeamRolePresetIsIdempotent(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(),
			`DELETE FROM team_role WHERE workspace_id = $1 AND key = ANY($2)`,
			testWorkspaceID, []string{"business_owner", "architect", "developer", "qa", "ops"})
	})

	var first struct {
		TeamRoles []TeamRoleResponse `json:"team_roles"`
	}
	testutil.Call(t, testHandler.ImportTeamRolePreset,
		newRequest(http.MethodPost, "/api/team-roles/presets", map[string]any{
			"preset": "aisdlc", "locale": "zh-Hans",
		})).Want(http.StatusOK).JSON(&first)

	byKey := map[string]TeamRoleResponse{}
	for _, role := range first.TeamRoles {
		byKey[role.Key] = role
	}
	for _, key := range []string{"business_owner", "architect", "developer", "qa", "ops"} {
		if _, ok := byKey[key]; !ok {
			t.Fatalf("preset did not create %q; the AI-SDLC suite resolves reviewers by these keys", key)
		}
	}
	if byKey["business_owner"].Name != "业务负责人" {
		t.Errorf("zh-Hans import named business_owner %q", byKey["business_owner"].Name)
	}

	// A workspace renames one, then imports again.
	testutil.Call(t, testHandler.UpdateTeamRole, withURLParam(
		newRequest(http.MethodPatch, "/api/team-roles/"+byKey["qa"].ID, map[string]any{"name": "质量保障"}),
		"id", byKey["qa"].ID)).Want(http.StatusOK)

	var second struct {
		TeamRoles []TeamRoleResponse `json:"team_roles"`
	}
	testutil.Call(t, testHandler.ImportTeamRolePreset,
		newRequest(http.MethodPost, "/api/team-roles/presets", map[string]any{
			"preset": "aisdlc", "locale": "zh-Hans",
		})).Want(http.StatusOK).JSON(&second)

	count := map[string]int{}
	var qaName string
	for _, role := range second.TeamRoles {
		count[role.Key]++
		if role.Key == "qa" {
			qaName = role.Name
		}
	}
	if count["qa"] != 1 {
		t.Errorf("re-import produced %d qa roles, want 1", count["qa"])
	}
	if qaName != "质量保障" {
		t.Errorf("re-import overwrote the workspace's rename: qa is now %q", qaName)
	}
}

// Catalog writes announce themselves so other tabs re-read; assignment writes
// ride member:updated, because a person's roles travel on the member payload.
func TestTeamRoleWritesAnnounceThemselves(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	catalog := make(chan events.Event, 8)
	testHandler.Bus.Subscribe(protocol.EventTeamRoleChanged, func(e events.Event) {
		select {
		case catalog <- e:
		default:
		}
	})
	members := make(chan events.Event, 8)
	testHandler.Bus.Subscribe(protocol.EventMemberUpdated, func(e events.Event) {
		select {
		case members <- e:
		default:
		}
	})

	expect := func(t *testing.T, ch chan events.Event, what string) events.Event {
		t.Helper()
		select {
		case e := <-ch:
			if e.WorkspaceID != testWorkspaceID {
				t.Errorf("%s event workspace_id = %q, want %q — an event without one never reaches a client",
					what, e.WorkspaceID, testWorkspaceID)
			}
			return e
		case <-time.After(3 * time.Second):
			t.Fatalf("no %s event; other tabs keep showing the old roles", what)
			return events.Event{}
		}
	}

	var created TeamRoleResponse
	testutil.Call(t, testHandler.CreateTeamRole,
		newRequest(http.MethodPost, "/api/team-roles", map[string]any{
			"name": "Realtime Role", "color": "#123456",
		})).Want(http.StatusCreated).JSON(&created)
	dbfx.Cleanup(t, `DELETE FROM team_role WHERE id = $1`, parseUUID(created.ID))
	if e := expect(t, catalog, "team_role:changed"); e.Payload.(map[string]any)["action"] != "created" {
		t.Errorf("action = %v, want created", e.Payload.(map[string]any)["action"])
	}

	_, memberID := makeSecondMember(t, "Realtime Holder", "realtime-holder@example.com")
	setMemberTeamRoles(t, memberID, []string{created.ID}).Want(http.StatusOK)
	e := expect(t, members, "member:updated")
	payload, ok := e.Payload.(map[string]any)
	if !ok {
		t.Fatalf("member event payload shape: %T", e.Payload)
	}
	if _, ok := payload["member"]; !ok {
		t.Fatal("member:updated carried no member payload, so no client can patch the roster")
	}
}
