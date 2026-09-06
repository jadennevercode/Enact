package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/enact-ai/enact/server/internal/service"
	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/enact-ai/enact/server/internal/workspacesetup"
)

// Filing the analysis is gated four ways, and every gate exists because the
// alternative is worse than doing nothing: a brief attached to no profile, an
// issue assigned to nobody, or a second reading of a tree already read. These
// tests are the gates.

// repoAnalysisWorkspace builds a workspace with a profile and, optionally, a
// Mika bound to a runtime — the two things the filer requires.
func repoAnalysisWorkspace(t *testing.T, slug string, withMika bool) string {
	t.Helper()
	workspaceID := dbfx.Workspace(t, "Repo Analysis Probe", slug)
	dbfx.Member(t, workspaceID, testUserID, "owner")
	setProfile(t, workspaceID, map[string]any{"summary": "A control tower."})

	if withMika {
		runtimeID := dbfx.Runtime(t, "probe-runtime-"+slug, testutil.Cols{
			"workspace_id": workspaceID,
		})
		dbfx.Agent(t, "Mika", runtimeID, testutil.Cols{
			"workspace_id": workspaceID,
			"system_key":   service.MikaSystemKey,
			"kind":         "user",
		})
	}
	return workspaceID
}

// addGitHubResource attaches a repository through the real handler, which is
// what the filer hangs off.
func addGitHubResource(t *testing.T, workspaceID, url string) {
	t.Helper()
	req := newRequest(http.MethodPost, "/api/resources", map[string]any{
		"resource_type": "github_repo",
		"resource_ref":  map[string]any{"url": url},
	})
	req.Header.Set("X-Workspace-ID", workspaceID)
	testutil.Call(t, testHandler.CreateWorkspaceResource, req).Want(http.StatusCreated)
	dbfx.Cleanup(t, `DELETE FROM workspace_resource WHERE workspace_id = $1`, workspaceID)
	dbfx.Cleanup(t, `DELETE FROM issue WHERE workspace_id = $1`, workspaceID)
}

func countRepoAnalysisIssues(t *testing.T, workspaceID string) int {
	t.Helper()
	var count int
	dbfx.QueryRow(t, `
		SELECT count(*) FROM issue WHERE workspace_id = $1 AND origin_type = $2
	`, workspaceID, workspacesetup.RepoAnalysisOriginType).Scan(&count)
	return count
}

func TestConnectingARepositoryFilesAnAnalysisAssignedToMika(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workspaceID := repoAnalysisWorkspace(t, "repo-analysis-files", true)
	addGitHubResource(t, workspaceID, "https://github.com/example/one")

	var assigneeType, status, title string
	var assigneeID string
	dbfx.QueryRow(t, `
		SELECT assignee_type, assignee_id::text, status, title FROM issue
		WHERE workspace_id = $1 AND origin_type = $2
	`, workspaceID, workspacesetup.RepoAnalysisOriginType).
		Scan(&assigneeType, &assigneeID, &status, &title)

	if assigneeType != "agent" {
		t.Errorf("analysis assignee_type = %q, want agent", assigneeType)
	}
	// `todo`, not `backlog`: an agent-assigned todo issue starts its agent,
	// and an analysis that never runs is worse than none.
	if status != "todo" {
		t.Errorf("analysis status = %q, want todo", status)
	}
	if title == "" {
		t.Error("analysis issue has no title")
	}
}

// A brief attached to a workspace that has not said what it is is a report
// nobody asked for, and the checklist puts the profile step first for this
// reason.
func TestNoAnalysisIsFiledWithoutAProfile(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workspaceID := repoAnalysisWorkspace(t, "repo-analysis-no-profile", true)
	setProfile(t, workspaceID, map[string]any{})

	addGitHubResource(t, workspaceID, "https://github.com/example/two")

	if got := countRepoAnalysisIssues(t, workspaceID); got != 0 {
		t.Fatalf("filed %d analyses for a workspace with no profile, want 0", got)
	}
}

// Without a Mika there is nobody to assign it to, and a workspace with no
// runtime cannot read a repository at all.
func TestNoAnalysisIsFiledWithoutMika(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workspaceID := repoAnalysisWorkspace(t, "repo-analysis-no-mika", false)
	addGitHubResource(t, workspaceID, "https://github.com/example/three")

	if got := countRepoAnalysisIssues(t, workspaceID); got != 0 {
		t.Fatalf("filed %d analyses for a workspace with no Mika, want 0", got)
	}
}

// A resource whose tree is already described in the profile has nothing left
// to read, which is what stops a second repository from re-analysing the first.
func TestNoAnalysisIsFiledForAResourceAlreadyCovered(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workspaceID := repoAnalysisWorkspace(t, "repo-analysis-covered", true)
	addGitHubResource(t, workspaceID, "https://github.com/example/four")

	var resourceID string
	dbfx.QueryRow(t, `SELECT id::text FROM workspace_resource WHERE workspace_id = $1`, workspaceID).
		Scan(&resourceID)
	dbfx.Exec(t, `DELETE FROM issue WHERE workspace_id = $1 AND origin_type = $2`,
		workspaceID, workspacesetup.RepoAnalysisOriginType)
	setProfile(t, workspaceID, map[string]any{
		"summary":            "A control tower.",
		"repo_brief":         "Go module at ./server.",
		"repo_brief_sources": []string{resourceID},
	})

	// Re-running the filer for the same resource must produce nothing. Reached
	// through a second resource create, which is what actually re-enters it.
	req := newRequest(http.MethodPost, "/api/resources", map[string]any{
		"resource_type": "github_repo",
		"resource_ref":  map[string]any{"url": "https://github.com/example/four"},
	})
	req.Header.Set("X-Workspace-ID", workspaceID)
	testutil.Call(t, testHandler.CreateWorkspaceResource, req).
		WantOneOf(http.StatusCreated, http.StatusConflict)

	if got := countRepoAnalysisIssues(t, workspaceID); got != 0 {
		t.Fatalf("filed %d analyses for an already-covered resource, want 0", got)
	}
}

// The brief has to stand alone: a fresh run claims this issue with no memory
// of the request, so anything it needs has to be in the description.
func TestTheAnalysisBriefNamesTheResourceAndTheSkill(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workspaceID := repoAnalysisWorkspace(t, "repo-analysis-brief", true)
	addGitHubResource(t, workspaceID, "https://github.com/example/five")

	var description, resourceID string
	dbfx.QueryRow(t, `SELECT id::text FROM workspace_resource WHERE workspace_id = $1`, workspaceID).
		Scan(&resourceID)
	dbfx.QueryRow(t, `
		SELECT description FROM issue WHERE workspace_id = $1 AND origin_type = $2
	`, workspaceID, workspacesetup.RepoAnalysisOriginType).Scan(&description)

	for _, want := range []string{
		resourceID,                // which resource to check out and to record
		"enact repo checkout",     // the only way a run can read the tree
		"enact-workspace-profile", // how the write is done
		"repo_brief",
		"repo_brief_sources",
	} {
		if !strings.Contains(description, want) {
			t.Errorf("the analysis brief does not mention %q:\n%s", want, description)
		}
	}
}
