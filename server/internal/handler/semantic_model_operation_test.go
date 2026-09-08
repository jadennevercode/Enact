package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

func TestModelOperationTaskScopeIdempotencyLeaseAndSchema(t *testing.T) {
	runtimeID := dbfx.Runtime(t, "model-operation runtime", testutil.Cols{"provider": "codex"})
	agentID := dbfx.Agent(t, "model-operation worker", runtimeID)
	issueID := dbfx.Issue(t, "model-operation issue")
	taskID := dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": issueID, "status": "running", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	id := uuid.NewString()
	dbfx.Cleanup(t, `DELETE FROM semantic_model_operation WHERE task_id=$1`, taskID)
	input := map[string]any{"operation_id": id, "prompt": "extract count", "response_schema": map[string]any{"type": "object", "properties": map[string]any{"count": map[string]any{"type": "integer"}}, "required": []string{"count"}}, "timeout_seconds": 60}
	taskReq := func(method, id string, input any) *http.Request {
		return testutil.WithHeaders(semanticRequest(method, id, input), "X-Actor-Source", "task_token", "X-Agent-ID", agentID, "X-Task-ID", taskID)
	}
	testutil.Call(t, testHandler.semanticCreateModelOperation, semanticRequest("POST", "", input)).Want(403)
	var created map[string]any
	testutil.Call(t, testHandler.semanticCreateModelOperation, taskReq("POST", "", input)).Want(202).JSON(&created)
	if created["principal_id"] != testUserID || created["runtime_id"] != runtimeID {
		t.Fatal("operation attribution was not derived from the parent task")
	}
	testutil.Call(t, testHandler.semanticCreateModelOperation, taskReq("POST", "", input)).Want(200)
	input["prompt"] = "different"
	testutil.Call(t, testHandler.semanticCreateModelOperation, taskReq("POST", "", input)).Want(409)
	runtimeReq := func(id string, input any) *http.Request {
		return testutil.WithURLParams(newRequest("POST", "/api/daemon/model-operations", input), "runtimeID", runtimeID, "id", id)
	}
	testutil.Call(t, testHandler.semanticClaimModelOperation, testutil.WithHeaders(runtimeReq("", nil), "X-Actor-Source", "task_token", "X-Agent-ID", agentID, "X-Task-ID", taskID)).Want(403)
	var claim struct {
		Operation map[string]any `json:"operation"`
	}
	testutil.Call(t, testHandler.semanticClaimModelOperation, runtimeReq("", nil)).Want(200).JSON(&claim)
	if claim.Operation["id"] != id {
		t.Fatalf("claim=%v", claim)
	}
	lease := claim.Operation["lease_token"]
	testutil.Call(t, testHandler.semanticReportModelOperation, runtimeReq(id, map[string]any{"lease_token": uuid.NewString(), "status": "completed", "result": map[string]any{"count": 1}})).Want(404)
	var completed map[string]any
	testutil.Call(t, testHandler.semanticReportModelOperation, runtimeReq(id, map[string]any{"lease_token": lease, "status": "completed", "result": map[string]any{"count": "invalid"}})).Want(200).JSON(&completed)
	if completed["status"] != "failed" {
		t.Fatal("invalid model output marked successful")
	}
	otherTask := dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": issueID, "status": "running", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	testutil.Call(t, testHandler.semanticGetModelOperation, testutil.WithHeaders(taskReq("GET", id, nil), "X-Task-ID", otherTask)).Want(404)
	var read json.RawMessage
	testutil.Call(t, testHandler.semanticGetModelOperation, taskReq("GET", id, nil)).Want(200).JSON(&read)
}
