package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/enact-ai/enact/server/internal/workspacesetup"
)

// The checklist's shape and copy live in internal/workspacesetup, and its
// per-step matrix is tested there. These tests cover what only a database can
// answer: that creating a workspace files it, that reading it twice does not
// file it twice, and that a step closes when the thing it asks for is true.

// createWorkspaceForSetup creates a workspace through the handler and returns
// its id, so every test here starts from the real create path rather than from
// a hand-inserted row that could skip the seeding under test.
func createWorkspaceForSetup(t *testing.T, slug, language string) string {
	t.Helper()
	dbfx.Exec(t, `DELETE FROM workspace WHERE slug = $1`, slug)
	dbfx.Cleanup(t, `DELETE FROM workspace WHERE slug = $1`, slug)

	body := map[string]any{"name": "Setup Probe", "slug": slug}
	if language != "" {
		body["language"] = language
	}
	var created WorkspaceResponse
	testutil.Call(t, testHandler.CreateWorkspace, newRequest("POST", "/api/workspaces", body)).
		Want(http.StatusCreated).
		JSON(&created)
	return created.ID
}

func readSetup(t *testing.T, workspaceID string) WorkspaceSetupResponse {
	t.Helper()
	req := newRequest("GET", "/api/workspaces/"+workspaceID+"/setup", nil)
	req.Header.Set("X-Workspace-ID", workspaceID)
	var resp WorkspaceSetupResponse
	testutil.Call(t, testHandler.GetWorkspaceSetup, withURLParam(req, "id", workspaceID)).
		Want(http.StatusOK).
		JSON(&resp)
	return resp
}

func TestCreateWorkspaceFilesTheSetupChecklistAndWelcome(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workspaceID := createWorkspaceForSetup(t, "handler-tests-setup-seed", "en")

	var issueCount int
	dbfx.QueryRow(t, `
		SELECT count(*) FROM issue
		WHERE workspace_id = $1 AND origin_type = 'workspace_setup'
	`, workspaceID).Scan(&issueCount)
	// One parent plus one issue per step.
	if want := 1 + len(workspacesetup.Steps); issueCount != want {
		t.Fatalf("filed %d setup issues, want %d", issueCount, want)
	}

	// The parent is what the welcome item points at, so a member opening the
	// notification lands on the explanation rather than on a bare title.
	var inboxType, inboxSeverity, inboxTitle string
	var inboxIssue *string
	dbfx.QueryRow(t, `
		SELECT type, severity, title, issue_id::text FROM inbox_item
		WHERE workspace_id = $1 AND type = $2
	`, workspaceID, workspacesetup.InboxTypeWelcome).Scan(&inboxType, &inboxSeverity, &inboxTitle, &inboxIssue)
	if inboxSeverity != "action_required" {
		t.Errorf("welcome severity = %q, want action_required", inboxSeverity)
	}
	if inboxTitle == "" {
		t.Error("welcome item has no title")
	}
	if inboxIssue == nil {
		t.Fatal("welcome item does not point at the setup issue")
	}

	var parentID, parentStatus string
	var parentOrigin string
	dbfx.QueryRow(t, `
		SELECT id::text, status, origin_id::text FROM issue
		WHERE workspace_id = $1 AND origin_type = 'workspace_setup' AND parent_issue_id IS NULL
	`, workspaceID).Scan(&parentID, &parentStatus, &parentOrigin)
	if parentID != *inboxIssue {
		t.Errorf("welcome points at %s, but the parent setup issue is %s", *inboxIssue, parentID)
	}
	// The parent's origin_id is the workspace's own id — the value migration
	// 447's unique index makes once-only.
	if parentOrigin != workspaceID {
		t.Errorf("parent origin_id = %s, want the workspace id %s", parentOrigin, workspaceID)
	}
	if parentStatus != setupStepStatus {
		t.Errorf("parent opened in %q, want %q", parentStatus, setupStepStatus)
	}

	// Nothing here may be assigned to an agent: the checklist is a person's
	// list, and an agent assignee would start a run in a workspace that has
	// not chosen a runtime.
	var agentAssigned int
	dbfx.QueryRow(t, `
		SELECT count(*) FROM issue
		WHERE workspace_id = $1 AND origin_type = 'workspace_setup' AND assignee_type = 'agent'
	`, workspaceID).Scan(&agentAssigned)
	if agentAssigned != 0 {
		t.Errorf("%d setup issues are assigned to an agent; the checklist must start no runs", agentAssigned)
	}
}

// The language a member creates their workspace in is the language they are
// met in. Without it the server has no signal at all: the locale lives in a
// cookie the API never sees.
func TestCreateWorkspaceHonorsTheRequestedLanguage(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workspaceID := createWorkspaceForSetup(t, "handler-tests-setup-zh", "zh-Hans")

	var title string
	dbfx.QueryRow(t, `
		SELECT title FROM inbox_item WHERE workspace_id = $1 AND type = $2
	`, workspaceID, workspacesetup.InboxTypeWelcome).Scan(&title)
	if want := workspacesetup.For("zh").InboxTitle; title != want {
		t.Fatalf("welcome title = %q, want the Chinese copy %q", title, want)
	}
}

func TestCreateWorkspaceFallsBackToEnglishForAnUnknownLanguage(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workspaceID := createWorkspaceForSetup(t, "handler-tests-setup-xx", "kl")

	var title string
	dbfx.QueryRow(t, `
		SELECT title FROM inbox_item WHERE workspace_id = $1 AND type = $2
	`, workspaceID, workspacesetup.InboxTypeWelcome).Scan(&title)
	if want := workspacesetup.For("en").InboxTitle; title != want {
		t.Fatalf("welcome title = %q, want the English fallback %q", title, want)
	}
}

// Reading the checklist files what is missing, which is what backfills a
// workspace created before the feature. Reading it again must not file a
// second copy — the pre-check plus migration 447's unique index is what makes
// that true, and this is the test that would catch either being dropped.
func TestReadingTheSetupChecklistIsIdempotent(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workspaceID := createWorkspaceForSetup(t, "handler-tests-setup-idem", "en")

	// Simulate a workspace that predates the checklist.
	dbfx.Exec(t, `DELETE FROM issue WHERE workspace_id = $1 AND origin_type = 'workspace_setup'`, workspaceID)

	first := readSetup(t, workspaceID)
	if len(first.Steps) != len(workspacesetup.Steps) {
		t.Fatalf("backfill produced %d steps, want %d", len(first.Steps), len(workspacesetup.Steps))
	}
	if first.ParentIssueID == "" {
		t.Fatal("backfill did not file the parent issue")
	}

	second := readSetup(t, workspaceID)
	if second.ParentIssueID != first.ParentIssueID {
		t.Errorf("a second read filed a new parent: %s then %s", first.ParentIssueID, second.ParentIssueID)
	}
	for i := range first.Steps {
		if first.Steps[i].IssueID != second.Steps[i].IssueID {
			t.Errorf("step %q was re-filed: %s then %s",
				first.Steps[i].Key, first.Steps[i].IssueID, second.Steps[i].IssueID)
		}
	}

	var count int
	dbfx.QueryRow(t, `
		SELECT count(*) FROM issue WHERE workspace_id = $1 AND origin_type = 'workspace_setup'
	`, workspaceID).Scan(&count)
	if want := 1 + len(workspacesetup.Steps); count != want {
		t.Fatalf("two reads left %d setup issues, want %d", count, want)
	}
}

// The profile step is the one a member can satisfy entirely through the API,
// so it is the one that proves the derive-and-close loop end to end.
func TestFillingTheProfileClosesItsStep(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workspaceID := createWorkspaceForSetup(t, "handler-tests-setup-profile", "en")

	before := readSetup(t, workspaceID)
	if stepByKey(t, before, string(workspacesetup.StepProfile)).Done {
		t.Fatal("the profile step is done before anything was written")
	}

	req := newRequest("PUT", "/api/workspaces/"+workspaceID+"/profile", map[string]any{
		"summary":      "A logistics control tower.",
		"stack":        []string{"Go", "TypeScript"},
		"typical_work": []string{"ship_code"},
	})
	req.Header.Set("X-Workspace-ID", workspaceID)
	var saved WorkspaceProfileResponse
	testutil.Call(t, testHandler.UpdateWorkspaceProfile, withURLParam(req, "id", workspaceID)).
		Want(http.StatusOK).
		JSON(&saved)
	if saved.Empty {
		t.Fatal("a profile with a summary came back marked empty")
	}
	if len(saved.Stack) != 2 || saved.Stack[0] != "go" {
		t.Fatalf("stack was not normalized: %v", saved.Stack)
	}

	after := readSetup(t, workspaceID)
	step := stepByKey(t, after, string(workspacesetup.StepProfile))
	if !step.Done {
		t.Fatal("the profile step is still open after the profile was written")
	}

	// Derived is not enough: the issue itself has to close, because the issue
	// is what the member sees in their list.
	var status string
	dbfx.QueryRow(t, `SELECT status FROM issue WHERE id = $1`, step.IssueID).Scan(&status)
	if status != setupDoneStatus {
		t.Fatalf("step issue status = %q, want %q", status, setupDoneStatus)
	}
}

// A vocabulary value the recommender has no rule for would score through its
// gloss, but a value that is not in the vocabulary at all would score against
// nothing and silently narrow the ranking. The boundary refuses it.
func TestUpdateWorkspaceProfileRejectsAnUnknownTypicalWork(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workspaceID := createWorkspaceForSetup(t, "handler-tests-setup-vocab", "en")

	req := newRequest("PUT", "/api/workspaces/"+workspaceID+"/profile", map[string]any{
		"typical_work": []string{"juggling"},
	})
	req.Header.Set("X-Workspace-ID", workspaceID)
	testutil.Call(t, testHandler.UpdateWorkspaceProfile, withURLParam(req, "id", workspaceID)).
		Want(http.StatusBadRequest)
}

// A member editing their summary must not discard what the repository
// analysis wrote. The endpoint replaces everything else; these two fields are
// carried forward when the request omits them.
func TestUpdateWorkspaceProfilePreservesAnOmittedRepoBrief(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workspaceID := createWorkspaceForSetup(t, "handler-tests-setup-brief", "en")

	write := func(body map[string]any) WorkspaceProfileResponse {
		t.Helper()
		req := newRequest("PUT", "/api/workspaces/"+workspaceID+"/profile", body)
		req.Header.Set("X-Workspace-ID", workspaceID)
		var out WorkspaceProfileResponse
		testutil.Call(t, testHandler.UpdateWorkspaceProfile, withURLParam(req, "id", workspaceID)).
			Want(http.StatusOK).
			JSON(&out)
		return out
	}

	write(map[string]any{
		"summary":            "A control tower.",
		"repo_brief":         "Go module at ./server.",
		"repo_brief_sources": []string{"resource-1"},
	})
	after := write(map[string]any{"summary": "A control tower, rewritten."})

	if after.RepoBrief != "Go module at ./server." {
		t.Fatalf("repo_brief was lost by an unrelated edit: %q", after.RepoBrief)
	}
	if len(after.RepoBriefSources) != 1 || after.RepoBriefSources[0] != "resource-1" {
		t.Fatalf("repo_brief_sources was lost by an unrelated edit: %v", after.RepoBriefSources)
	}

	// An explicit empty value still clears it: carry-forward is for an absent
	// key, not for a member who deliberately emptied the field.
	cleared := write(map[string]any{"summary": "x", "repo_brief": ""})
	if cleared.RepoBrief != "" {
		t.Fatalf("an explicit empty repo_brief did not clear it: %q", cleared.RepoBrief)
	}
}

func stepByKey(t *testing.T, resp WorkspaceSetupResponse, key string) WorkspaceSetupStepResponse {
	t.Helper()
	for _, step := range resp.Steps {
		if step.Key == key {
			return step
		}
	}
	encoded, _ := json.Marshal(resp.Steps)
	t.Fatalf("no step %q in the checklist: %s", key, encoded)
	return WorkspaceSetupStepResponse{}
}
