package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

func TestSemanticNativeReplayUsesCompletedScopedResultsAndIgnoresClientPayload(t *testing.T) {
	connection, _, _ := semanticFixture(t, "https://quality.example.test", "confirm")
	runtimeID := dbfx.Runtime(t, "native replay runtime")
	agentID := dbfx.Agent(t, "native replay author", runtimeID)
	issueID := dbfx.Issue(t, "native replay construction")
	taskID := dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": issueID, "status": "running", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	otherTask := dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": issueID, "status": "running", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	operationID := dbfx.Insert(t, "semantic_model_operation", testutil.Cols{"id": uuid.NewString(), "workspace_id": testWorkspaceID, "task_id": taskID, "agent_id": agentID, "principal_id": testUserID, "runtime_id": runtimeID, "provider": "codex", "request_hash": "original-hash", "prompt": "original source extraction prompt", "response_schema": []byte(`{"type":"object"}`), "result": []byte(`{"entities":[{"text":"original evidence"}]}`), "timeout_seconds": 60, "status": "completed", "expires_at": time.Now().Add(time.Hour)})
	ontologyID := dbfx.Insert(t, "semantic_ontology", testutil.Cols{"workspace_id": testWorkspaceID, "name": "replay candidate", "bundle": []byte(`{}`), "created_by": testUserID})
	snapshot := dbfx.Insert(t, "semantic_source_snapshot", testutil.Cols{"workspace_id": testWorkspaceID, "connection_id": connection, "principal_id": testUserID, "credential_revision": "v1", "source_digest": "v1", "documents": []byte(`[{"id":"doc-1","content":"original evidence"}]`)})
	dbfx.Cleanup(t, "DELETE FROM semantic_ontology_revision WHERE ontology_id=$1", ontologyID)
	calls := 0
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request map[string]any
		_ = json.NewDecoder(r.Body).Decode(&request)
		extraction := request["extraction"].(map[string]any)
		operation := extraction["replay_operations"].([]any)[0].(map[string]any)
		if extraction["mode"] != "replay" || operation["id"] != operationID || operation["prompt"] != "original source extraction prompt" || operation["result"].(map[string]any)["entities"].([]any)[0].(map[string]any)["text"] != "original evidence" {
			t.Error("replay used caller-provided model content instead of the completed operation")
		}
		if _, exists := extraction["task_token"]; exists {
			t.Error("offline replay should not receive a model callback credential")
		}
		_, _ = w.Write([]byte(`{"artifact":{"manifest":{"source_kind":"semantica-native"}},"stages":[],"findings":[]}`))
	}))
	defer service.Close()
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)
	input := map[string]any{"source_snapshot_ids": []string{snapshot}, "ontology": map[string]any{}, "extraction": map[string]any{"mode": "replay", "source_ids": []string{"doc-1"}, "model_operation_ids": []string{operationID}, "replay_operations": []any{map[string]any{"result": "forged"}}, "task_token": "forged"}}
	taskRequest := func(task string) *http.Request {
		return testutil.WithHeaders(semanticRequest("POST", ontologyID, input), "X-Actor-Source", "task_token", "X-Agent-ID", agentID, "X-Task-ID", task)
	}
	testutil.Call(t, testHandler.semanticNativeOntology, taskRequest(taskID)).Want(200)
	testutil.Call(t, testHandler.semanticNativeOntology, taskRequest(otherTask)).Want(404)
	// The actual human owner may recover their completed operation after a task handoff.
	testutil.Call(t, testHandler.semanticNativeOntology, semanticRequest("POST", ontologyID, input)).Want(200)
	dbfx.Exec(t, "UPDATE semantic_model_operation SET status='running' WHERE id=$1", operationID)
	testutil.Call(t, testHandler.semanticNativeOntology, taskRequest(taskID)).Want(404)
	dbfx.Exec(t, "UPDATE semantic_model_operation SET status='completed',principal_id=$2 WHERE id=$1", operationID, uuid.NewString())
	testutil.Call(t, testHandler.semanticNativeOntology, semanticRequest("POST", ontologyID, input)).Want(404)
	if calls != 2 {
		t.Fatal("inaccessible or unfinished model results reached native replay")
	}
}
