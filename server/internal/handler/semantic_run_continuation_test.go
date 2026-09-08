package handler

import (
	"net/http"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
)

func TestSemanticRunContinuesOnTheAssignedIssueAfterConfirmation(t *testing.T) {
	_, releaseID, _ := semanticFixture(t, "https://quality.example.test", "confirm")
	runtimeID := dbfx.Runtime(t, "quality consumer runtime")
	agentID := dbfx.Agent(t, "quality consumer", runtimeID)
	issueID := dbfx.Issue(t, "quality investigation")
	otherIssueID := dbfx.Issue(t, "other investigation")
	newTask := func(issue string) string {
		return dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": issue, "status": "running", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	}
	firstTask, resumedTask, outsideTask := newTask(issueID), newTask(issueID), newTask(otherIssueID)
	request := func(method, id, task string, input any) *http.Request {
		return testutil.WithHeaders(semanticRequest(method, id, input), "X-Actor-Source", "task_token", "X-Agent-ID", agentID, "X-Task-ID", task)
	}
	var run map[string]any
	testutil.Call(t, testHandler.semanticCreateRun, request("POST", "", firstTask, map[string]any{"release_id": releaseID, "issue_id": issueID, "question": "哪些库存受到影响？"})).Want(201).JSON(&run)
	runID := run["id"].(string)
	dbfx.Cleanup(t, "DELETE FROM semantic_run WHERE id=$1", runID)
	if run["delegated_at"] == nil {
		t.Fatal("the user's Issue investigation cannot survive a task handoff")
	}
	testutil.Call(t, testHandler.semanticGetRun, request("GET", runID, resumedTask, nil)).Want(200)
	testutil.Call(t, testHandler.semanticGetRun, request("GET", runID, outsideTask, nil)).Want(404)
	testutil.Call(t, testHandler.semanticCreateRun, request("POST", "", firstTask, map[string]any{"release_id": releaseID, "issue_id": otherIssueID, "question": "spoof Issue scope"})).Want(403)
}
