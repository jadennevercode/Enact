package handler

import (
	"encoding/json"
	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSemanticDelegationUsesOriginatorCredential(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer real-caller" {
			t.Error("runtime owner's credential was used")
		}
		_, _ = w.Write([]byte(`{"status":"authorized"}`))
	}))
	defer upstream.Close()
	_, _, run := semanticFixture(t, upstream.URL, "confirm")
	other := dbfx.User(t, "runtime owner", uuid.NewString()+"@example.com")
	dbfx.Member(t, testWorkspaceID, other, "member")
	issue := dbfx.Issue(t, "delegated semantic work")
	runtime := dbfx.Runtime(t, "semantic runtime", testutil.Cols{"owner_id": other})
	agent := dbfx.Agent(t, "semantic worker", runtime, testutil.Cols{"owner_id": other})
	task := dbfx.Task(t, agent, testutil.Cols{"runtime_id": runtime, "issue_id": issue, "originator_user_id": testUserID, "accountable_user_id": testUserID})
	request := func() *http.Request {
		return testutil.WithHeaders(semanticRequest("POST", run, map[string]any{"binding_id": "case", "parameters": map[string]any{}}), "X-User-ID", other, "X-Actor-Source", "task_token", "X-Agent-ID", agent, "X-Task-ID", task)
	}
	testutil.Call(t, testHandler.semanticQuery, request()).Want(404)
	testutil.Call(t, testHandler.semanticDelegateRun, semanticRequest("POST", run, map[string]any{"issue_id": issue})).Want(200)
	var result map[string]any
	testutil.Call(t, testHandler.semanticQuery, request()).Want(200).JSON(&result)
	otherAgent := dbfx.Agent(t, "other semantic worker", runtime, testutil.Cols{"owner_id": other})
	otherTask := dbfx.Task(t, otherAgent, testutil.Cols{"runtime_id": runtime, "issue_id": issue, "originator_user_id": other, "accountable_user_id": other})
	testutil.Call(t, testHandler.semanticQuery, testutil.WithHeaders(request(), "X-Task-ID", otherTask, "X-Agent-ID", otherAgent)).Want(404)
	testutil.Call(t, testHandler.semanticDecide, testutil.WithHeaders(semanticRequest("POST", uuid.NewString(), map[string]any{"approve": true}), "X-Actor-Source", "task_token", "X-Agent-ID", agent, "X-Task-ID", task)).Want(403)
}

func TestSemanticFailedQueryResumesSameDurableStep(t *testing.T) {
	failed := true
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if failed {
			w.WriteHeader(503)
			return
		}
		_, _ = w.Write([]byte(`{"status":"fresh"}`))
	}))
	defer upstream.Close()
	_, _, run := semanticFixture(t, upstream.URL, "confirm")
	var first map[string]any
	testutil.Call(t, testHandler.semanticQuery, semanticRequest("POST", run, map[string]any{"binding_id": "case"})).Want(422).JSON(&first)
	failed = false
	request := testutil.WithURLParams(semanticRequest("POST", run, nil), "id", run, "stepID", first["step_id"].(string))
	var resumed map[string]any
	testutil.Call(t, testHandler.semanticResumeStep, request).Want(200).JSON(&resumed)
	if resumed["step_id"] != first["step_id"] {
		t.Fatal("resume replaced the durable step identity")
	}
	testutil.Call(t, testHandler.semanticResumeStep, request).Want(409)
	var attempt int
	if err := testHandler.DB.QueryRow(request.Context(), "SELECT attempt FROM semantic_step WHERE id=$1", first["step_id"]).Scan(&attempt); err != nil || attempt != 2 {
		t.Fatalf("attempt=%d err=%v", attempt, err)
	}
}

func TestSemanticRetirementAndDisabledConnectionBlockNewWork(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{}`)) }))
	defer upstream.Close()
	connection, release, run := semanticFixture(t, upstream.URL, "confirm")
	testutil.Call(t, testHandler.semanticDisableConnection, semanticRequest("POST", connection, nil)).Want(200)
	testutil.Call(t, testHandler.semanticQuery, semanticRequest("POST", run, map[string]any{"binding_id": "case"})).Want(422)
	testutil.Call(t, testHandler.semanticRetireRelease, semanticRequest("POST", release, map[string]any{"reason": "superseded"})).Want(200)
	testutil.Call(t, testHandler.semanticCreateRun, newRequest("POST", "/api/semantic/runs", map[string]any{"release_id": release})).Want(404)
	testutil.Call(t, testHandler.semanticGetRun, semanticRequest("GET", run, nil)).Want(200)
}

func TestSemanticPreviewRetainsDraftBindingsAndScope(t *testing.T) {
	var scoped string
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input map[string]any
		_ = json.NewDecoder(r.Body).Decode(&input)
		scoped = input["scope"].(map[string]any)["workspace_id"].(string)
		if r.URL.Path == "/v1/compile" {
			_, _ = w.Write([]byte(`{"artifact":{"ontology_turtle":"@prefix x: <urn:x:> ."}}`))
		} else {
			_, _ = w.Write([]byte(`{"valid":true,"conforms":true}`))
		}
	}))
	defer service.Close()
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)
	var ontology map[string]any
	testutil.Call(t, testHandler.semanticCreateOntology, newRequest("POST", "/api/semantic/ontologies", map[string]any{"name": "draft", "bundle": map[string]any{"bundle": map[string]any{"id": "candidate"}}, "binding_config": map[string]any{"data_bindings": []any{}}, "test_data": map[string]any{"content": "<urn:x> a <urn:Thing> .", "format": "turtle"}})).Want(201).JSON(&ontology)
	id := ontology["id"].(string)
	dbfx.Cleanup(t, "DELETE FROM semantic_ontology WHERE id=$1", id)
	var preview map[string]any
	testutil.Call(t, testHandler.semanticPreviewOntology, semanticRequest("POST", id, map[string]any{"scope": map[string]any{"workspace_id": "attacker"}})).Want(200).JSON(&preview)
	if preview["incomplete"] != false || scoped != testWorkspaceID {
		t.Fatal("draft validation lost saved data or trusted caller scope")
	}
	testutil.Call(t, testHandler.semanticPreviewOntology, semanticRequest("POST", id, map[string]any{"test_data": map[string]any{"content": "", "format": "turtle"}})).Want(200).JSON(&preview)
	if preview["incomplete"] != true {
		t.Fatal("empty test snapshot was not reported incomplete")
	}
	update := map[string]any{"name": "updated draft", "bundle": ontology["bundle"], "expected_updated_at": ontology["updated_at"]}
	var saved map[string]any
	testutil.Call(t, testHandler.semanticUpdateOntology, semanticRequest("PUT", id, update)).Want(200).JSON(&saved)
	if saved["test_data"].(map[string]any)["content"] == nil {
		t.Fatal("partial update lost persisted test data")
	}
	testutil.Call(t, testHandler.semanticUpdateOntology, semanticRequest("PUT", id, update)).Want(409)
}
