package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

func TestSemanticApplicationAttachesSameIssueRunAndFiltersItsEvidence(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"id":"case-1"}`)) }))
	defer upstream.Close()
	_, release, runID := semanticFixture(t, upstream.URL, "confirm")
	app := applicationFixture(t, release)
	dbfx.Cleanup(t, "DELETE FROM semantic_run_presentation WHERE application_id=$1", app.ID)
	var saved semanticApplicationBuild
	testutil.Call(t, testHandler.createSemanticApplicationBuild, applicationRequest("POST", app.ID, applicationBuildFixture(t, release))).Want(201).JSON(&saved)
	invoke := func(operation string, input any) *http.Request {
		return applicationRequest("POST", app.ID, map[string]any{"build_id": saved.ID, "operation": operation, "input": input})
	}
	visible := dbfx.Insert(t, "semantic_step", testutil.Cols{"workspace_id": testWorkspaceID, "run_id": runID, "kind": "data_query", "status": "succeeded", "input": []byte(`{"binding_id":"case"}`), "output": []byte(`{"id":"visible-case"}`)})
	hidden := dbfx.Insert(t, "semantic_step", testutil.Cols{"workspace_id": testWorkspaceID, "run_id": runID, "kind": "data_query", "status": "succeeded", "input": []byte(`{"binding_id":"private-hr"}`), "output": []byte(`{"salary":"private"}`)})
	var attached map[string]any
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("run.attach", map[string]any{"run_id": runID})).Want(200).JSON(&attached)
	if attached["run_id"] != runID {
		t.Fatal("Site did not attach the existing Issue run")
	}
	// Retrying a handoff never duplicates or replaces the underlying run.
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("run.attach", map[string]any{"run_id": runID})).Want(200)
	var result map[string]any
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("run.get", map[string]any{"run_id": runID})).Want(200).JSON(&result)
	steps := result["steps"].([]any)
	if result["id"] != runID || len(steps) != 1 || steps[0].(map[string]any)["id"] != visible {
		t.Fatal("Site exposed evidence outside its manifest or lost the Issue identity")
	}
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("evaluate", map[string]any{"run_id": runID, "source_step_ids": []string{hidden}})).Want(403)
	var original map[string]any
	testutil.Call(t, testHandler.semanticGetRun, semanticRequest("GET", runID, nil)).Want(200).JSON(&original)
	if original["application_id"] != nil || len(original["steps"].([]any)) != 2 {
		t.Fatal("presentation mutated the original Issue investigation")
	}
	other := dbfx.User(t, "Other investigator", uuid.NewString()+"@example.com")
	dbfx.Member(t, testWorkspaceID, other, "admin")
	testutil.Call(t, testHandler.invokeSemanticApplication, testutil.WithHeaders(invoke("run.attach", map[string]any{"run_id": runID}), "X-User-ID", other)).Want(404)
}

func TestSemanticApplicationPresentationRejectsHiddenActionEvidenceByID(t *testing.T) {
	_, release, runID := semanticFixture(t, "https://quality.example.test", "confirm")
	app := applicationFixture(t, release)
	dbfx.Cleanup(t, "DELETE FROM semantic_run_presentation WHERE application_id=$1", app.ID)
	var saved semanticApplicationBuild
	testutil.Call(t, testHandler.createSemanticApplicationBuild, applicationRequest("POST", app.ID, applicationBuildFixture(t, release))).Want(201).JSON(&saved)
	invoke := func(operation string, input any) *http.Request {
		return applicationRequest("POST", app.ID, map[string]any{"build_id": saved.ID, "operation": operation, "input": input})
	}
	visibleQuery := dbfx.Insert(t, "semantic_step", testutil.Cols{"workspace_id": testWorkspaceID, "run_id": runID, "kind": "data_query", "status": "succeeded", "input": []byte(`{"binding_id":"case"}`), "output": []byte(`{"id":"visible-case"}`)})
	hiddenQuery := dbfx.Insert(t, "semantic_step", testutil.Cols{"workspace_id": testWorkspaceID, "run_id": runID, "kind": "data_query", "status": "succeeded", "input": []byte(`{"binding_id":"private-hr"}`), "output": []byte(`{"salary":"private"}`)})
	intent := []byte(`{"action_intents":[{"intent_id":"intent-1","binding_id":"freeze","parameters":{}}]}`)
	evaluation := func(source string) string {
		return dbfx.Insert(t, "semantic_step", testutil.Cols{"workspace_id": testWorkspaceID, "run_id": runID, "kind": "rule_evaluation", "status": "succeeded", "input": semanticMarshal(map[string]any{"source_step_ids": []string{source}}), "output": intent})
	}
	visibleEvaluation, hiddenEvaluation := evaluation(visibleQuery), evaluation(hiddenQuery)
	hiddenApproval := dbfx.Insert(t, "semantic_approval", testutil.Cols{"workspace_id": testWorkspaceID, "run_id": runID, "binding_id": "freeze", "parameters": []byte(`{}`), "digest": "hidden-evidence", "status": "pending", "requested_by": testUserID, "expires_at": time.Now().Add(time.Hour), "evaluation_step_id": hiddenEvaluation, "intent_id": "intent-1"})
	hiddenReceipt := dbfx.Insert(t, "semantic_receipt", testutil.Cols{"workspace_id": testWorkspaceID, "run_id": runID, "approval_id": hiddenApproval, "binding_id": "freeze", "idempotency_key": uuid.NewString(), "request_digest": "hidden-evidence", "status": "unknown", "response": []byte(`{"private":"result"}`), "executed_by": testUserID})
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("run.attach", map[string]any{"run_id": runID})).Want(200)
	var projected map[string]any
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("run.get", map[string]any{"run_id": runID})).Want(200).JSON(&projected)
	if len(projected["approvals"].([]any)) != 0 || len(projected["receipts"].([]any)) != 0 {
		t.Fatal("restricted Site exposed actions based on hidden query evidence")
	}
	for _, operation := range []string{"approval.get", "approval.decide", "action.execute"} {
		testutil.Call(t, testHandler.invokeSemanticApplication, invoke(operation, map[string]any{"approval_id": hiddenApproval, "approve": true})).Want(404)
	}
	for _, operation := range []string{"receipt.get", "receipt.reconcile"} {
		testutil.Call(t, testHandler.invokeSemanticApplication, invoke(operation, map[string]any{"receipt_id": hiddenReceipt})).Want(404)
	}
	prepare := func(evaluationID string) map[string]any {
		return map[string]any{"run_id": runID, "binding_id": "freeze", "parameters": map[string]any{}, "evaluation_step_id": evaluationID, "intent_id": "intent-1"}
	}
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("action.prepare", prepare(hiddenEvaluation))).Want(404)
	var allowed map[string]any
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("action.prepare", prepare(visibleEvaluation))).Want(201).JSON(&allowed)
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("approval.get", map[string]any{"approval_id": allowed["id"]})).Want(200)
	// Presenting a run cannot remove the owner's evidence or grant extra access.
	var original map[string]any
	testutil.Call(t, testHandler.semanticGetRun, semanticRequest("GET", runID, nil)).Want(200).JSON(&original)
	if len(original["approvals"].([]any)) != 2 || len(original["receipts"].([]any)) != 1 {
		t.Fatal("Site projection mutated the original Issue evidence")
	}
}
