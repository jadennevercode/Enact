package handler

import (
	"net/http"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
)

// The retrospective suggestion is the one part of this feature that arrives
// uninvited, so what it must not do matters more than what it does: it must not
// ask about work no agent touched, must not ask twice, and must not survive the
// workspace turning it off.

// finishIssue moves an issue into a done status through the update endpoint,
// which is where the suggestion hook lives.
func finishIssue(t *testing.T, issueID string) *testutil.Response {
	t.Helper()
	req := withURLParam(newRequest(http.MethodPut, "/api/issues/"+issueID,
		map[string]any{"status": "done"}), "id", issueID)
	return testutil.Call(t, testHandler.UpdateIssue, req).Want(http.StatusOK)
}

func cleanupRetrospectives(t *testing.T, issueID string) {
	t.Helper()
	t.Cleanup(func() {
		dbfx.Exec(t, `DELETE FROM retrospective WHERE scope_id = $1`, issueID)
		dbfx.Exec(t, `DELETE FROM inbox_item WHERE issue_id = $1`, issueID)
	})
}

func TestFinishingAgentWorkOffersARetrospective(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	agentID := createHandlerTestAgent(t, "Retro suggestion agent", nil)
	issueID := dbfx.Issue(t, "Work an agent did")
	cleanupRetrospectives(t, issueID)
	dbfx.Task(t, agentID, testutil.Cols{
		"issue_id":   issueID,
		"status":     "completed",
		"runtime_id": handlerTestRuntimeID(t),
	})

	finishIssue(t, issueID)

	var status, scope, trigger string
	dbfx.QueryRow(t,
		`SELECT status, scope, trigger FROM retrospective WHERE scope_id = $1`, issueID,
	).Scan(&status, &scope, &trigger)
	if status != "suggested" || scope != "issue" || trigger != "suggestion" {
		t.Fatalf("retrospective = (%s, %s, %s), want (suggested, issue, suggestion)", status, scope, trigger)
	}

	// Asked, not demanded. Declining is the common answer, and severity is what
	// tells the inbox whether this is a chore or a note.
	var severity string
	dbfx.QueryRow(t,
		`SELECT severity FROM inbox_item WHERE issue_id = $1 AND type = 'retrospective_suggested'`, issueID,
	).Scan(&severity)
	if severity != "info" {
		t.Fatalf("inbox severity = %q, want info", severity)
	}
}

func TestFinishingWorkAsksOnlyOnce(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	agentID := createHandlerTestAgent(t, "Retro once agent", nil)
	issueID := dbfx.Issue(t, "Work that gets reopened")
	cleanupRetrospectives(t, issueID)
	dbfx.Task(t, agentID, testutil.Cols{
		"issue_id":   issueID,
		"status":     "completed",
		"runtime_id": handlerTestRuntimeID(t),
	})

	finishIssue(t, issueID)

	// Reopened and closed again. An issue that bounces must not re-ask, whatever
	// the answer was the first time — including when it was dismissed.
	req := withURLParam(newRequest(http.MethodPut, "/api/issues/"+issueID,
		map[string]any{"status": "in_progress"}), "id", issueID)
	testutil.Call(t, testHandler.UpdateIssue, req).Want(http.StatusOK)
	dbfx.Exec(t, `UPDATE retrospective SET status = 'dismissed', dismissed_at = now() WHERE scope_id = $1`, issueID)
	finishIssue(t, issueID)

	if got := dbfx.Count(t, `SELECT count(*) FROM retrospective WHERE scope_id = $1`, issueID); got != 1 {
		t.Fatalf("retrospective count = %d, want 1", got)
	}
	var status string
	dbfx.QueryRow(t, `SELECT status FROM retrospective WHERE scope_id = $1`, issueID).Scan(&status)
	if status != "dismissed" {
		t.Fatalf("status = %q; the second close reopened an answered question", status)
	}
}

func TestFinishingWorkNoAgentTouchedOffersNothing(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	issueID := dbfx.Issue(t, "Work a person did alone")
	cleanupRetrospectives(t, issueID)

	finishIssue(t, issueID)

	if got := dbfx.Count(t, `SELECT count(*) FROM retrospective WHERE scope_id = $1`, issueID); got != 0 {
		t.Fatalf("retrospective count = %d, want 0: there is nothing to learn about how agents work", got)
	}
}

func TestWorkspaceCanTurnSuggestionsOff(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	agentID := createHandlerTestAgent(t, "Retro disabled agent", nil)
	issueID := dbfx.Issue(t, "Work in a workspace that opted out")
	cleanupRetrospectives(t, issueID)
	dbfx.Task(t, agentID, testutil.Cols{
		"issue_id":   issueID,
		"status":     "completed",
		"runtime_id": handlerTestRuntimeID(t),
	})

	dbfx.Exec(t, `UPDATE workspace SET retrospective_suggestions_enabled = false WHERE id = $1`, testWorkspaceID)
	t.Cleanup(func() {
		dbfx.Exec(t, `UPDATE workspace SET retrospective_suggestions_enabled = true WHERE id = $1`, testWorkspaceID)
	})

	finishIssue(t, issueID)

	if got := dbfx.Count(t, `SELECT count(*) FROM retrospective WHERE scope_id = $1`, issueID); got != 0 {
		t.Fatalf("retrospective count = %d, want 0 with suggestions off", got)
	}
}

func TestStartRetrospectiveWithoutALearnerSaysSo(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	// The handler test workspace has no seeded Lesson Learner, which is the
	// state every workspace is in before the bundle is provisioned. Failing
	// with a reason beats queueing work nothing will ever claim.
	resp := testutil.Call(t, testHandler.CreateRetrospective,
		newRequest(http.MethodPost, "/api/retrospectives", map[string]any{"scope": "workspace"})).
		Want(http.StatusFailedDependency)
	if resp.Text() == "" {
		t.Fatal("refusal did not say why")
	}
}
