package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

func TestSemanticNativeDiagnosticsUseOnlyStaticCatalog(t *testing.T) {
	const secret = "hostile-secret-token-do-not-echo"
	for _, tc := range []struct{ message, code, stage string }{
		{"Native pipeline failed: [Entity property '" + secret + "' needs an explicit ontology property term]", "native_undeclared_entity_property", "export"},
		{"Datatype property '" + secret + "' has an invalid lexical value", "native_invalid_property_value", "export"},
		{"Extraction quote does not match its source offsets " + secret, "native_extraction_source_mismatch", "semantic_extract"},
		{"Source hash does not match immutable source content " + secret, "native_source_snapshot_mismatch", "parse"},
		{"Native rules fail the reviewed rule/intent contract " + secret, "native_rule_contract", "reasoning"},
		{"Enact model operation is still running; resume using its operation ID " + secret, "native_model_operation_pending", "semantic_extract"},
		{"Replay requires exactly one authorized completed operation matching the native prompt and schema " + secret, "native_replay_mismatch", "semantic_extract"},
		{"Bearer " + secret + " https://user:password@example.test", "native_build_failed", "pipeline"},
	} {
		err := errors.New("semantic service rejected the request: " + string(semanticMarshal(map[string]any{"error": map[string]any{"code": "invalid_semantic_request", "message": tc.message}})))
		got := semanticClassifyNativeFailure(err)
		if got.Code != tc.code || got.Stage != tc.stage || got != semanticNativeDiagnostics[got.Code] {
			t.Fatalf("incorrect static diagnostic for %s: %+v", tc.code, got)
		}
		if strings.Contains(string(semanticMarshal(got)), secret) || strings.Contains(got.Message, "https://user") {
			t.Fatal("downstream data escaped the diagnostic allowlist")
		}
	}
	for _, raw := range []string{secret, `semantic service rejected the request: {"error":"` + secret + `"}`, `semantic service rejected the request: {"diagnostic":{"code":"native_undeclared_entity_property","message":"` + secret + `"}}`, strings.Repeat("x", 65<<10)} {
		if got := semanticClassifyNativeFailure(errors.New(raw)); got.Code != "native_build_failed" || strings.Contains(got.Message, secret) {
			t.Fatal("unrecognized or oversized response did not remain private")
		}
	}
	if !strings.Contains(semanticNativeDiagnostics["native_undeclared_entity_property"].Message, "ontology.properties") {
		t.Fatal("undeclared property diagnostic omitted the schema repair")
	}
}

func TestSemanticNativeFailurePersistsOnlyMatchingFamilyFinding(t *testing.T) {
	const hostile = "Bearer callback-token-and-source-text-must-stay-private"
	connectionID, _, _ := semanticFixture(t, "https://quality.example.test", "confirm")
	ontologyID := dbfx.Insert(t, "semantic_ontology", testutil.Cols{"workspace_id": testWorkspaceID, "name": "diagnostic draft", "bundle": []byte(`{"source_guidance":{"keep":true}}`), "created_by": testUserID})
	snapshotID := dbfx.Insert(t, "semantic_source_snapshot", testutil.Cols{"workspace_id": testWorkspaceID, "connection_id": connectionID, "principal_id": testUserID, "credential_revision": "v1", "source_digest": "v1", "documents": []byte(`[{"id":"doc-1","content":"Business evidence"}]`)})
	runtimeID := dbfx.Runtime(t, "diagnostic runtime", testutil.Cols{"provider": "codex"})
	agentID := dbfx.Agent(t, "diagnostic engineer", runtimeID)
	squadID := dbfx.Squad(t, "diagnostic family", agentID)
	issueID := dbfx.Issue(t, "diagnostic construction")
	childID := dbfx.Issue(t, "diagnostic child", testutil.Cols{"parent_issue_id": issueID})
	taskID := dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": childID, "status": "running", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	constructionID := dbfx.Insert(t, "semantic_construction", testutil.Cols{"id": uuid.NewString(), "workspace_id": testWorkspaceID, "ontology_id": ontologyID, "issue_id": issueID, "squad_id": squadID, "created_by": testUserID})
	dbfx.Cleanup(t, `DELETE FROM semantic_construction_event WHERE construction_id=$1`, constructionID)
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/native/pipeline" {
			t.Error("unexpected downstream operation")
		}
		writeJSON(w, 422, map[string]any{"error": map[string]any{"code": "invalid_semantic_request", "message": "Native pipeline failed: [Entity property '" + hostile + "' needs an explicit ontology property term]"}})
	}))
	defer service.Close()
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)
	request := func(task string) *http.Request {
		return testutil.WithHeaders(semanticRequest("POST", ontologyID, map[string]any{"source_snapshot_ids": []string{snapshotID}}), "X-Actor-Source", "task_token", "X-Agent-ID", agentID, "X-Task-ID", task)
	}
	var response map[string]any
	testutil.Call(t, testHandler.semanticNativeOntology, request(taskID)).Want(422).JSON(&response)
	diagnostic, _ := response["diagnostic"].(map[string]any)
	if response["finding_recorded"] != true || diagnostic["code"] != "native_undeclared_entity_property" || strings.Contains(string(semanticMarshal(response)), hostile) {
		t.Fatal("native failure did not return a safe actionable finding")
	}
	var event json.RawMessage
	if err := testHandler.DB.QueryRow(t.Context(), `SELECT to_jsonb(e) FROM semantic_construction_event e WHERE construction_id=$1`, constructionID).Scan(&event); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(event), hostile) || !strings.Contains(string(event), taskID) || !strings.Contains(string(event), "native_undeclared_entity_property") {
		t.Fatal("construction finding leaked downstream text or lost actual task attribution")
	}
	outsideIssue := dbfx.Issue(t, "unrelated diagnostic issue")
	outsideTask := dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": outsideIssue, "status": "running", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	testutil.Call(t, testHandler.semanticNativeOntology, request(outsideTask)).Want(422).JSON(&response)
	if response["finding_recorded"] != false {
		t.Fatal("unrelated task wrote into the Family construction")
	}
	var findings, revisions int
	if err := testHandler.DB.QueryRow(t.Context(), `SELECT count(*) FROM semantic_construction_event WHERE construction_id=$1`, constructionID).Scan(&findings); err != nil || findings != 1 {
		t.Fatal("native failure event scope was not preserved")
	}
	if err := testHandler.DB.QueryRow(t.Context(), `SELECT count(*) FROM semantic_ontology_revision WHERE ontology_id=$1`, ontologyID).Scan(&revisions); err != nil || revisions != 0 {
		t.Fatal("failed native build created a false artifact revision")
	}
	var bundle json.RawMessage
	if err := testHandler.DB.QueryRow(t.Context(), `SELECT bundle FROM semantic_ontology WHERE id=$1`, ontologyID).Scan(&bundle); err != nil || !strings.Contains(string(bundle), `"keep": true`) || strings.Contains(string(bundle), "native_artifact") {
		t.Fatal("failed native build changed the editable ontology")
	}
}
