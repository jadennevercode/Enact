package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/enact-ai/enact/server/internal/events"
	"github.com/enact-ai/enact/server/internal/service"
	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/enact-ai/enact/server/internal/util"
	"github.com/enact-ai/enact/server/pkg/protocol"
	"github.com/jackc/pgx/v5/pgtype"
)

// These exercise service.RetrospectService against a real database, because
// what the filing rules actually gate on — a live agent row, a task row, the
// status catalog, the once-only index — are all database facts. The event-bus
// wiring that calls this in production is one Subscribe in
// cmd/server/retrospect_listeners.go.

func retrospectSvc(t *testing.T) *service.RetrospectService {
	t.Helper()
	return service.NewRetrospectService(testHandler.Queries, testHandler.IssueService)
}

// configureRetrospectAgent gives the workspace a live Retrospect Agent, which
// is the whole opt-in.
func configureRetrospectAgent(t *testing.T) string {
	t.Helper()
	w := createRetrospectAgent(t, map[string]any{
		"runtime_id": handlerTestRuntimeID(t),
		"language":   "en",
	})
	if w.Code != http.StatusCreated && w.Code != http.StatusOK {
		t.Fatalf("configure retrospect agent: got %d: %s", w.Code, w.Body.String())
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(),
			`DELETE FROM agent WHERE workspace_id = $1 AND system_key = $2`,
			testWorkspaceID, service.RetrospectSystemKey)
	})
	return decodeAgent(t, w).ID
}

// recordAgentRun leaves a finished run against issueID, which is what marks the
// issue as work an agent did rather than a note someone closed by hand.
func recordAgentRun(t *testing.T, issueID, agentName string) {
	t.Helper()
	agentID := createHandlerTestAgent(t, agentName, nil)
	dbfx.Task(t, agentID, testutil.Cols{
		"issue_id":   issueID,
		"status":     "completed",
		"runtime_id": handlerTestRuntimeID(t),
		// agent_task_queue_active_requires_runtime (migration 251) reads a task
		// with no completed_at as still active, and an active task must name a
		// runtime.
		"completed_at": testutil.Raw("now()"),
	})
}

// createIssueThroughTheAPI makes an issue the way the product does.
//
// Deliberately not dbfx.Issue: that fixture derives the issue number with
// MAX+1 and never touches workspace.issue_counter, while IssueService.Create —
// which the retrospect filing goes through — allocates from the counter. Mixing
// the two collides on uq_issue_workspace_number.
func createIssueThroughTheAPI(t *testing.T, title, status string) string {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":  title,
		"status": status,
	})
	testHandler.CreateIssue(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create issue: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var issue IssueResponse
	if err := json.NewDecoder(w.Body).Decode(&issue); err != nil {
		t.Fatalf("decode issue: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM issue WHERE id = $1`, issue.ID)
	})
	return issue.ID
}

// finishedAgentWork is an issue in a done status that an agent ran against —
// the shape the filing rules are written for.
func finishedAgentWork(t *testing.T) string {
	t.Helper()
	issueID := createIssueThroughTheAPI(t, "retrospect fixture: shipped work "+uuid.NewString(), "todo")
	dbfx.Exec(t, `UPDATE issue SET status = 'done' WHERE id = $1`, issueID)
	recordAgentRun(t, issueID, "retrospect fixture worker")
	return issueID
}

func fileRetrospect(t *testing.T, issueID, prevStatus string) {
	t.Helper()
	err := retrospectSvc(t).MaybeFileForFinishedIssue(
		context.Background(),
		util.MustParseUUID(testWorkspaceID),
		util.MustParseUUID(issueID),
		prevStatus,
	)
	if err != nil && err != service.ErrNoRetrospectAgent {
		t.Fatalf("file retrospect: %v", err)
	}
}

func countRetrospectsFor(t *testing.T, issueID string) int {
	t.Helper()
	return dbfx.Count(t,
		`SELECT count(*) FROM issue WHERE origin_type = 'retrospect' AND origin_id = $1`,
		issueID)
}

func cleanupRetrospectsFor(t *testing.T, issueID string) {
	t.Helper()
	t.Cleanup(func() {
		testPool.Exec(context.Background(),
			`DELETE FROM issue WHERE origin_type = 'retrospect' AND origin_id = $1`, issueID)
	})
}

func TestFinishingAgentWorkFilesARetrospectSubIssue(t *testing.T) {
	configureRetrospectAgent(t)
	issueID := finishedAgentWork(t)
	cleanupRetrospectsFor(t, issueID)

	fileRetrospect(t, issueID, "in_progress")

	var parent, assigneeType, status string
	var assignee pgtype.UUID
	dbfx.QueryRow(t,
		`SELECT parent_issue_id, assignee_type, assignee_id, status
		   FROM issue WHERE origin_type = 'retrospect' AND origin_id = $1`,
		issueID,
	).Scan(&parent, &assigneeType, &assignee, &status)

	if parent != issueID {
		t.Errorf("parent_issue_id = %s, want the finished issue %s — it must be a sub-issue, not a top-level one", parent, issueID)
	}
	if assigneeType != "agent" {
		t.Errorf("assignee_type = %q, want \"agent\"", assigneeType)
	}
	if status != "todo" {
		t.Errorf("status = %q, want \"todo\" so the assignment starts a run", status)
	}
}

// The subscriber listener reads the "issue" map out of the issue:created
// payload and returns early without it, which would leave the retrospect with
// nobody subscribed — and nobody to answer the proposal it posts. A minimal
// {"issue_id": ...} payload is what IssueService.Create emits when the caller
// supplies no payload builder, so this is the regression guard on supplying one.
func TestTheRetrospectIsAnnouncedWithEnoughForSubscribersToBeWired(t *testing.T) {
	configureRetrospectAgent(t)
	issueID := finishedAgentWork(t)
	cleanupRetrospectsFor(t, issueID)

	var payloads []map[string]any
	testHandler.Bus.Subscribe(protocol.EventIssueCreated, func(e events.Event) {
		if p, ok := e.Payload.(map[string]any); ok {
			payloads = append(payloads, p)
		}
	})

	fileRetrospect(t, issueID, "in_progress")

	if len(payloads) != 1 {
		t.Fatalf("got %d issue:created events, want exactly 1 for the filed retrospect", len(payloads))
	}
	announced, ok := payloads[0]["issue"].(map[string]any)
	if !ok {
		t.Fatalf("issue:created carried no \"issue\" object, so no subscriber is wired: %v", payloads[0])
	}
	if origin, _ := announced["origin_type"].(*string); origin == nil || *origin != service.OriginRetrospect {
		t.Errorf("announced issue origin_type = %v, want %q so a client can mark it without a refetch", origin, service.OriginRetrospect)
	}
	// The three fields the subscriber listener reads to decide who is watching.
	for _, field := range []string{"id", "creator_type", "creator_id"} {
		if _, ok := announced[field]; !ok {
			t.Errorf("announced issue is missing %q, which the subscriber listener needs", field)
		}
	}
}

// The opt-in. A workspace that has not configured the agent must get nothing,
// because this is the only switch the feature has.
func TestNoRetrospectAgentMeansNoSubIssue(t *testing.T) {
	issueID := finishedAgentWork(t)
	cleanupRetrospectsFor(t, issueID)

	fileRetrospect(t, issueID, "in_progress")

	if got := countRetrospectsFor(t, issueID); got != 0 {
		t.Errorf("filed %d retrospects in a workspace with no Retrospect Agent, want 0", got)
	}
}

// Archiving the agent is how a workspace turns the loop off.
func TestArchivingTheAgentStopsTheLoop(t *testing.T) {
	agentID := configureRetrospectAgent(t)
	if _, err := testPool.Exec(context.Background(),
		`UPDATE agent SET archived_at = now() WHERE id = $1`, agentID); err != nil {
		t.Fatalf("archive agent: %v", err)
	}
	issueID := finishedAgentWork(t)
	cleanupRetrospectsFor(t, issueID)

	fileRetrospect(t, issueID, "in_progress")

	if got := countRetrospectsFor(t, issueID); got != 0 {
		t.Errorf("filed %d retrospects with the agent archived, want 0", got)
	}
}

// An issue reopened and finished again must not collect a second review. The
// guarantee is the partial unique index; this proves the path in front of it
// treats the rejection as success rather than as an error.
func TestAnIssueIsRetrospectedOnlyOnce(t *testing.T) {
	configureRetrospectAgent(t)
	issueID := finishedAgentWork(t)
	cleanupRetrospectsFor(t, issueID)

	fileRetrospect(t, issueID, "in_progress")
	fileRetrospect(t, issueID, "in_progress")

	if got := countRetrospectsFor(t, issueID); got != 1 {
		t.Errorf("filed %d retrospects for one issue, want exactly 1", got)
	}
}

// Without this the loop is infinite: the sub-issue is itself an issue that
// reaches done.
func TestARetrospectIsNotItselfRetrospected(t *testing.T) {
	configureRetrospectAgent(t)
	parentID := finishedAgentWork(t)
	cleanupRetrospectsFor(t, parentID)

	fileRetrospect(t, parentID, "in_progress")

	var retroID string
	dbfx.QueryRow(t,
		`SELECT id FROM issue WHERE origin_type = 'retrospect' AND origin_id = $1`,
		parentID,
	).Scan(&retroID)

	// Finish the retrospect the way its agent would, with a run against it.
	recordAgentRun(t, retroID, "retrospect fixture reviewer")
	dbfx.Exec(t, `UPDATE issue SET status = 'done' WHERE id = $1`, retroID)
	cleanupRetrospectsFor(t, retroID)

	fileRetrospect(t, retroID, "in_progress")

	if got := countRetrospectsFor(t, retroID); got != 0 {
		t.Errorf("filed %d retrospects on a retrospect, want 0", got)
	}
}

// Work no agent touched has no run transcript to read, so a review of it would
// be a guess presented as a finding.
func TestWorkNoAgentTouchedIsNotRetrospected(t *testing.T) {
	configureRetrospectAgent(t)
	issueID := createIssueThroughTheAPI(t, "retrospect fixture: hand-closed note "+uuid.NewString(), "done")
	cleanupRetrospectsFor(t, issueID)

	fileRetrospect(t, issueID, "in_progress")

	if got := countRetrospectsFor(t, issueID); got != 0 {
		t.Errorf("filed %d retrospects for work no agent ran, want 0", got)
	}
}

// The trigger is the transition, not the state. An already-done issue touched
// again — a priority edit, a re-save — must not file a second review.
func TestAnAlreadyDoneIssueIsNotRetrospectedAgain(t *testing.T) {
	configureRetrospectAgent(t)
	issueID := finishedAgentWork(t)
	cleanupRetrospectsFor(t, issueID)

	fileRetrospect(t, issueID, "done")

	if got := countRetrospectsFor(t, issueID); got != 0 {
		t.Errorf("filed %d retrospects for an issue that was already done, want 0", got)
	}
}

// Cancelled is a terminal status but not a done one. Abandoned work has no
// outcome to learn from.
func TestCancelledWorkIsNotRetrospected(t *testing.T) {
	configureRetrospectAgent(t)
	issueID := createIssueThroughTheAPI(t, "retrospect fixture: abandoned "+uuid.NewString(), "cancelled")
	recordAgentRun(t, issueID, "retrospect fixture abandoner")
	cleanupRetrospectsFor(t, issueID)

	fileRetrospect(t, issueID, "in_progress")

	if got := countRetrospectsFor(t, issueID); got != 0 {
		t.Errorf("filed %d retrospects for cancelled work, want 0", got)
	}
}
