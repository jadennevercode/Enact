package handler

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

func semanticFixture(t *testing.T, endpoint, mode string) (string, string, string) {
	t.Helper()
	t.Setenv("ENACT_SEMANTIC_ALLOWED_ORIGINS", endpoint)
	t.Setenv("ENACT_SEMANTIC_SECRET_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	box, err := semanticBox()
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := box.Seal(semanticMarshal(semantic.Secret{UserCredentials: map[string]semantic.Credential{testUserID: {Headers: map[string]string{"Authorization": "Bearer real-caller"}, Roles: []string{"QualityEngineer", "PlantManager"}}}}))
	if err != nil {
		t.Fatal(err)
	}
	connection := dbfx.Insert(t, "semantic_connection", testutil.Cols{"workspace_id": testWorkspaceID, "name": "fixture connection", "kind": "rest", "endpoint": endpoint, "secret": encrypted, "created_by": testUserID})
	ontology := dbfx.Insert(t, "semantic_ontology", testutil.Cols{"workspace_id": testWorkspaceID, "name": "quality fixture", "bundle": []byte(`{"domain":{"id":"qt"}}`), "created_by": testUserID})
	bindings := semantic.Bindings{Data: []semantic.Binding{{ID: "case", ConnectionID: connection, Path: "/case"}}, Actions: []semantic.Binding{{ID: "freeze", ConnectionID: connection, Method: "POST", Path: "/freeze", Authorization: semantic.Authorization{Mode: mode, Roles: []string{"PlantManager"}}, Readback: &semantic.Readback{Path: "/operations/{response.id}", Expected: map[string]any{"status": "succeeded"}}}}}
	release := dbfx.Insert(t, "semantic_release", testutil.Cols{"workspace_id": testWorkspaceID, "ontology_id": ontology, "version": uuid.NewString(), "digest": "test", "artifact": []byte(`{}`), "binding_config": semanticMarshal(bindings), "validation": []byte(`{"valid":true,"conforms":true}`), "published_by": testUserID})
	run := dbfx.Insert(t, "semantic_run", testutil.Cols{"workspace_id": testWorkspaceID, "release_id": release, "requested_by": testUserID, "actor_type": "member"})
	dbfx.Cleanup(t, "DELETE FROM semantic_step WHERE run_id=$1", run)
	dbfx.Cleanup(t, "DELETE FROM semantic_approval WHERE run_id=$1", run)
	dbfx.Cleanup(t, "DELETE FROM semantic_receipt WHERE run_id=$1", run)
	return connection, release, run
}
func semanticRequest(method, id string, input any) *http.Request {
	return testutil.WithURLParams(newRequest(method, "/api/semantic", input), "id", id)
}

func TestSemanticActionReceiptPersistsAndRetriesOnce(t *testing.T) {
	var writes atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer real-caller" {
			t.Error("not using caller credential")
		}
		switch r.URL.Path {
		case "/freeze":
			writes.Add(1)
			if r.Header.Get("Idempotency-Key") == "" {
				t.Error("missing idempotency key")
			}
			_, _ = w.Write([]byte(`{"id":"op-1"}`))
		case "/operations/op-1":
			_, _ = w.Write([]byte(`{"status":"succeeded"}`))
		case "/case":
			_, _ = w.Write([]byte(`{"id":"case-1","status":"open"}`))
		}
	}))
	defer upstream.Close()
	_, _, run := semanticFixture(t, upstream.URL, "confirm")
	var approval map[string]any
	testutil.Call(t, testHandler.semanticPrepareAction, semanticRequest("POST", run, map[string]any{"binding_id": "freeze", "parameters": map[string]any{}})).Want(201).JSON(&approval)
	id := approval["id"].(string)
	testutil.Call(t, testHandler.semanticExecute, testutil.WithHeaders(semanticRequest("POST", id, nil), "Idempotency-Key", "first")).Want(409)
	testutil.Call(t, testHandler.semanticDecide, semanticRequest("POST", id, map[string]any{"approve": true})).Want(200)
	var receipt map[string]any
	testutil.Call(t, testHandler.semanticExecute, testutil.WithHeaders(semanticRequest("POST", id, nil), "Idempotency-Key", "first")).Want(200).JSON(&receipt)
	if receipt["status"] != "succeeded" || writes.Load() != 1 {
		t.Fatalf("receipt=%v writes=%d", receipt, writes.Load())
	}
	clone := *testHandler
	var again map[string]any
	testutil.Call(t, clone.semanticExecute, testutil.WithHeaders(semanticRequest("POST", id, nil), "Idempotency-Key", "second")).Want(200).JSON(&again)
	if again["id"] != receipt["id"] || writes.Load() != 1 {
		t.Fatal("retry dispatched a second system write")
	}
}

func TestSemanticPendingActionRequiresReadbackReconciliation(t *testing.T) {
	complete := false
	var writes atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/freeze" {
			writes.Add(1)
			w.WriteHeader(202)
			_, _ = w.Write([]byte(`{"id":"op-2"}`))
			return
		}
		status := "pending"
		if complete {
			status = "succeeded"
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"status": status})
	}))
	defer upstream.Close()
	_, _, run := semanticFixture(t, upstream.URL, "allow")
	var approval map[string]any
	testutil.Call(t, testHandler.semanticPrepareAction, semanticRequest("POST", run, map[string]any{"binding_id": "freeze", "parameters": map[string]any{}})).Want(201).JSON(&approval)
	var receipt map[string]any
	testutil.Call(t, testHandler.semanticExecute, testutil.WithHeaders(semanticRequest("POST", approval["id"].(string), nil), "Idempotency-Key", "pending")).Want(200).JSON(&receipt)
	if receipt["status"] != "unknown" {
		t.Fatal("HTTP 202 was reported complete")
	}
	complete = true
	testutil.Call(t, testHandler.semanticReconcile, semanticRequest("POST", receipt["id"].(string), nil)).Want(200).JSON(&receipt)
	if receipt["status"] != "succeeded" || writes.Load() != 1 {
		t.Fatal("reconcile did not verify the target independently")
	}
}

func TestSemanticRunSubjectIsolationAndEncryptedCredentials(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"status":"restricted"}`)) }))
	defer upstream.Close()
	_, _, run := semanticFixture(t, upstream.URL, "confirm")
	bob := dbfx.User(t, "semantic other", uuid.NewString()+"@example.com")
	dbfx.Member(t, testWorkspaceID, bob, "member")
	for _, operation := range []http.HandlerFunc{testHandler.semanticGetRun, testHandler.semanticQuery, testHandler.semanticEvaluate, testHandler.semanticPrepareAction} {
		testutil.Call(t, operation, testutil.WithHeaders(semanticRequest("POST", run, map[string]any{"binding_id": "case"}), "X-User-ID", bob)).Want(404)
	}
	var connections []map[string]any
	response := testutil.Call(t, testHandler.semanticConnections, newRequest("GET", "/api/semantic/connections", nil)).Want(200).JSON(&connections)
	_ = response
	raw, _ := json.Marshal(connections)
	if strings.Contains(string(raw), "real-caller") || strings.Contains(string(raw), "user_credentials") {
		t.Fatal("connection secret was exposed")
	}
}

func TestSemanticValidationGateFailsClosed(t *testing.T) {
	for _, raw := range []string{`{}`, `{"valid":true}`, `{"valid":true,"conforms":false}`, `{"valid":true,"conforms":true,"unsupported":[{"severity":"error"}]}`} {
		if semanticValidationPassed(json.RawMessage(raw)) {
			t.Fatalf("gate accepted %s", raw)
		}
	}
	if !semanticValidationPassed(json.RawMessage(`{"valid":true,"conforms":true}`)) {
		t.Fatal("valid conformance rejected")
	}
}
