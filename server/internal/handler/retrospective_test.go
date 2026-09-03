package handler

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/enact-ai/enact/server/internal/service"
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

// The whole feature hangs off provisioning: without a Lesson Learner bound to a
// runtime, every retrospective refuses and no lesson is ever filed. This walks
// the real chain — provision, start, and check what the Learner was actually
// asked to do.
func TestProvisionedLearnerCanRunARetrospective(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	tx, err := testPool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)
	if err := service.EnsureLessonsDefaultsInTx(
		ctx, testHandler.Queries.WithTx(tx),
		parseUUID(testWorkspaceID), parseUUID(testUserID), parseUUID(handlerTestRuntimeID(t)),
	); err != nil {
		t.Fatalf("provision lesson defaults: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		testPool.Exec(bg, `DELETE FROM retrospective WHERE workspace_id = $1`, testWorkspaceID)
		testPool.Exec(bg, `DELETE FROM agent_skill WHERE skill_id IN
			(SELECT id FROM skill WHERE workspace_id = $1 AND name = 'enact-lessons')`, testWorkspaceID)
		testPool.Exec(bg, `DELETE FROM skill_version WHERE skill_id IN
			(SELECT id FROM skill WHERE workspace_id = $1 AND name = 'enact-lessons')`, testWorkspaceID)
		testPool.Exec(bg, `DELETE FROM skill WHERE workspace_id = $1 AND name = 'enact-lessons'`, testWorkspaceID)
		testPool.Exec(bg, `DELETE FROM agent_invocation_target WHERE agent_id IN
			(SELECT id FROM agent WHERE workspace_id = $1 AND system_key = $2)`, testWorkspaceID, LessonLearnerSystemKey)
		testPool.Exec(bg, `DELETE FROM agent WHERE workspace_id = $1 AND system_key = $2`, testWorkspaceID, LessonLearnerSystemKey)
		testPool.Exec(bg, `UPDATE workspace SET lessons_defaults_version = 0 WHERE id = $1`, testWorkspaceID)
	})

	// The skill is snapshotted like any other, so a lesson can be written
	// against the Learner's own skill from day one.
	versionCount := dbfx.Count(t, `
		SELECT count(*) FROM skill_version sv
		JOIN skill s ON s.id = sv.skill_id
		WHERE s.workspace_id = $1 AND s.name = 'enact-lessons'`, testWorkspaceID)
	if versionCount != 1 {
		t.Fatalf("provisioned skill versions = %d, want 1", versionCount)
	}

	var learnerID string
	dbfx.QueryRow(t,
		`SELECT id FROM agent WHERE workspace_id = $1 AND system_key = $2`,
		testWorkspaceID, LessonLearnerSystemKey,
	).Scan(&learnerID)

	mounted := dbfx.Count(t, `
		SELECT count(*) FROM agent_skill ask
		JOIN skill s ON s.id = ask.skill_id
		WHERE ask.agent_id = $1 AND s.name = 'enact-lessons'`, learnerID)
	if mounted != 1 {
		t.Fatalf("learner mounts the lessons skill %d times, want 1", mounted)
	}

	var created map[string]any
	testutil.Call(t, testHandler.CreateRetrospective,
		newRequest(http.MethodPost, "/api/retrospectives",
			map[string]any{"scope": "workspace", "since_days": 7})).
		Want(http.StatusCreated).JSON(&created)

	retro, _ := created["retrospective"].(map[string]any)
	if got, _ := retro["status"].(string); got != "queued" {
		t.Fatalf("status = %q, want queued", got)
	}
	issueID, _ := retro["issue_id"].(string)
	if issueID == "" {
		t.Fatal("a started retrospective has no issue; the Learner has nothing to claim")
	}

	// The scan runs as an ordinary assigned issue — that is the whole dispatch
	// mechanism, and the assignee is what makes the Learner pick it up.
	var assigneeType, assigneeID, description string
	dbfx.QueryRow(t,
		`SELECT assignee_type, assignee_id, description FROM issue WHERE id = $1`, issueID,
	).Scan(&assigneeType, &assigneeID, &description)
	if assigneeType != "agent" || assigneeID != learnerID {
		t.Fatalf("issue assignee = (%s, %s), want the Lesson Learner", assigneeType, assigneeID)
	}

	// The brief has to carry the standard, not just the scope: a Learner told
	// only "review this" files anecdotes.
	retroID, _ := retro["id"].(string)
	for _, phrase := range []string{"more than once", "where it does not apply", retroID} {
		if !strings.Contains(description, phrase) {
			t.Errorf("retrospective brief is missing %q", phrase)
		}
	}

	// One scan at a time: a second would read the same window and file the
	// same lessons twice.
	testutil.Call(t, testHandler.CreateRetrospective,
		newRequest(http.MethodPost, "/api/retrospectives", map[string]any{"scope": "workspace"})).
		Want(http.StatusConflict)
}
