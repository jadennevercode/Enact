package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

func TestSemanticCatalogUsesNativeDiscoveryAndPrincipalScope(t *testing.T) {
	connection, _, _ := semanticFixture(t, "https://quality.example.test", "confirm")
	dbfx.Cleanup(t, "DELETE FROM semantic_catalog_revision WHERE connection_id=$1", connection)
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/sources/discover" || r.Header.Get("X-Semantic-Service-Key") != "fixture-key" {
			t.Error("discovery bypassed authenticated native service")
		}
		var request map[string]any
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			t.Fatal("invalid discovery request")
		}
		scope, _ := request["scope"].(map[string]any)
		if scope["workspace_id"] != testWorkspaceID || scope["ontology_id"] != connection {
			t.Error("native discovery lost workspace or connection scope")
		}
		credentials, _ := request["credentials"].(map[string]any)
		headers, _ := credentials["headers"].(map[string]any)
		if headers["Authorization"] != "Bearer real-caller" {
			t.Error("native discovery did not use the caller credential")
		}
		_, _ = w.Write([]byte(`{"state":"ready","source_digest":"schema-v1","entries":[{"id":"lots","kind":"table","name":"lots","fields":[{"name":"lot_id","type":"text","primary_key":true}]}],"warnings":[],"native_module":"semantica.ingest.db_ingestor"}`))
	}))
	defer service.Close()
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)
	t.Setenv("ENACT_SEMANTIC_SERVICE_KEY", "fixture-key")
	var created map[string]any
	testutil.Call(t, testHandler.semanticDiscoverSource, semanticRequest("POST", connection, map[string]any{})).Want(201).JSON(&created)
	if created["source_digest"] != "schema-v1" || strings.Contains(string(semanticMarshal(created)), "real-caller") {
		t.Fatal("catalog missing digest or exposed credentials")
	}
	var loaded map[string]any
	testutil.Call(t, testHandler.semanticSourceCatalog, semanticRequest("GET", connection, nil)).Want(200).JSON(&loaded)
	if loaded["id"] != created["id"] {
		t.Fatal("discovery catalog was not persisted")
	}
	other := uuid.NewString()
	dbfx.Exec(t, `UPDATE semantic_catalog_revision SET principal_id=$2 WHERE id=$1`, created["id"], other)
	testutil.Call(t, testHandler.semanticSourceCatalog, semanticRequest("GET", connection, nil)).Want(200).JSON(&loaded)
	if loaded["state"] != "undiscovered" || len(loaded["entries"].([]any)) != 0 {
		t.Fatal("another principal's catalog was exposed")
	}
}

func TestSemanticNativeReadUsesPinnedCatalogAndReturnsActualData(t *testing.T) {
	connection, releaseID, runID := semanticFixture(t, "https://quality.example.test", "confirm")
	binding := semantic.Binding{ID: "case", ConnectionID: connection, Path: "/cases/{id}", Method: "GET", CatalogEntryID: "readCase", CatalogDigest: "catalog-v1", RequiredParameters: []string{"id"}}
	dbfx.Exec(t, `UPDATE semantic_release SET artifact=$2,binding_config=$3 WHERE id=$1`, releaseID, []byte(`{"manifest":{"source_kind":"semantica-native"}}`), semanticMarshal(semantic.Bindings{Data: []semantic.Binding{binding}}))
	reads := 0
	digest := "catalog-v1"
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/sources/discover" {
			writeJSON(w, 200, map[string]any{"state": "ready", "source_digest": digest, "entries": []any{map[string]any{"id": "readCase", "kind": "operation", "name": "readCase", "method": "GET", "path": "/cases/{id}", "capabilities": []string{"data"}}}})
			return
		}
		if r.URL.Path != "/v1/sources/read" {
			t.Error("query bypassed native read endpoint")
		}
		var request map[string]any
		_ = json.NewDecoder(r.Body).Decode(&request)
		if request["scope"].(map[string]any)["run_id"] != runID || request["parameters"].(map[string]any)["id"] != "Q1" {
			t.Error("query lost runtime scope or typed parameters")
		}
		reads++
		_, _ = w.Write([]byte(`{"data":{"id":"Q1","version":3},"metadata":{"native_module":"semantica.ingest.api_ingestor"}}`))
	}))
	defer service.Close()
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)
	var result map[string]any
	testutil.Call(t, testHandler.semanticQuery, semanticRequest("POST", runID, map[string]any{"binding_id": "case", "parameters": map[string]any{"id": "Q1"}})).Want(200).JSON(&result)
	if result["output"].(map[string]any)["version"] != float64(3) || reads != 1 {
		t.Fatal("native query changed actual business data")
	}
	digest = "catalog-v2"
	testutil.Call(t, testHandler.semanticQuery, semanticRequest("POST", runID, map[string]any{"binding_id": "case", "parameters": map[string]any{"id": "Q1"}})).Want(422)
	if reads != 1 {
		t.Fatal("schema drift did not stop the native query")
	}
}

func TestSemanticPreviewCannotExecuteActionOrUnknownCatalogEntry(t *testing.T) {
	connection, _, _ := semanticFixture(t, "https://quality.example.test", "confirm")
	c, _, err := testHandler.semanticConnection(t.Context(), testWorkspaceID, connection)
	if err != nil {
		t.Fatal(err)
	}
	dbfx.Insert(t, "semantic_catalog_revision", testutil.Cols{"workspace_id": testWorkspaceID, "connection_id": connection, "principal_id": testUserID, "credential_revision": c.CredentialRevision, "source_digest": "v1", "state": "ready", "entries": []byte(`[{"id":"freeze","kind":"action"}]`)})
	testutil.Call(t, testHandler.semanticPreviewSource, semanticRequest("POST", connection, map[string]any{"entry_id": "freeze"})).Want(400)
	testutil.Call(t, testHandler.semanticPreviewSource, semanticRequest("POST", connection, map[string]any{"entry_id": "undiscovered"})).Want(404)
}

func TestSemanticNativeConstructionRejectsAnotherPrincipalsSnapshot(t *testing.T) {
	connection, _, _ := semanticFixture(t, "https://quality.example.test", "confirm")
	ontology := dbfx.Insert(t, "semantic_ontology", testutil.Cols{"workspace_id": testWorkspaceID, "name": "native draft", "bundle": []byte(`{}`), "created_by": testUserID})
	snapshot := dbfx.Insert(t, "semantic_source_snapshot", testutil.Cols{"workspace_id": testWorkspaceID, "connection_id": connection, "principal_id": uuid.NewString(), "credential_revision": "v1", "source_digest": "v1", "documents": []byte(`[{"id":"private","content":"private source"}]`)})
	testutil.Call(t, testHandler.semanticNativeOntology, semanticRequest("POST", ontology, map[string]any{"source_snapshot_ids": []string{snapshot}})).Want(404)
}

func TestSemanticNativeRevisionRetainsSourceGuidanceAndPriorModel(t *testing.T) {
	connection, _, _ := semanticFixture(t, "https://quality.example.test", "confirm")
	ontology := dbfx.Insert(t, "semantic_ontology", testutil.Cols{"workspace_id": testWorkspaceID, "name": "native revision", "bundle": []byte(`{"source_guidance":{"unresolved_gap":"GAP-006"},"native_artifact":{"native_ontology":{"name":"Quality"},"native_rules":[{"id":"draft-only"}],"knowledge_graph":{"entities":[]},"competency_questions":[]}}`), "created_by": testUserID})
	snapshot := dbfx.Insert(t, "semantic_source_snapshot", testutil.Cols{"workspace_id": testWorkspaceID, "connection_id": connection, "principal_id": testUserID, "credential_revision": "v1", "source_digest": "v1", "documents": []byte(`[{"id":"doc-1","content":"Business evidence"}]`)})
	dbfx.Cleanup(t, "DELETE FROM semantic_ontology_revision WHERE ontology_id=$1", ontology)
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		_ = json.NewDecoder(r.Body).Decode(&request)
		if request["ontology"].(map[string]any)["name"] != "Quality" || request["rules"].([]any)[0].(map[string]any)["id"] != "draft-only" {
			t.Error("partial revision discarded prior native model or rules")
		}
		_, _ = w.Write([]byte(`{"artifact":{"manifest":{"source_kind":"semantica-native","artifact_digest":"revision-2"}},"stages":[],"findings":[],"review_required":true}`))
	}))
	defer service.Close()
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)
	var result map[string]any
	testutil.Call(t, testHandler.semanticNativeOntology, semanticRequest("POST", ontology, map[string]any{"source_snapshot_ids": []string{snapshot}})).Want(200).JSON(&result)
	bundle := result["ontology"].(map[string]any)["bundle"].(map[string]any)
	if bundle["source_guidance"].(map[string]any)["unresolved_gap"] != "GAP-006" || bundle["native_artifact"].(map[string]any)["manifest"].(map[string]any)["artifact_digest"] != "revision-2" {
		t.Fatal("revision did not preserve unresolved source guidance alongside the new canonical artifact")
	}
}

func TestSemanticNativeRevisionRejectsBindingsChangedDuringGeneration(t *testing.T) {
	connection, _, _ := semanticFixture(t, "https://quality.example.test", "confirm")
	ontology := dbfx.Insert(t, "semantic_ontology", testutil.Cols{"workspace_id": testWorkspaceID, "name": "concurrent binding revision", "bundle": []byte(`{}`), "created_by": testUserID})
	snapshot := dbfx.Insert(t, "semantic_source_snapshot", testutil.Cols{"workspace_id": testWorkspaceID, "connection_id": connection, "principal_id": testUserID, "credential_revision": "v1", "source_digest": "v1", "documents": []byte(`[{"id":"doc-1","content":"Business evidence"}]`)})
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dbfx.Exec(t, `UPDATE semantic_ontology SET binding_config=$2 WHERE id=$1`, ontology, []byte(`{"data_bindings":[{"id":"new-binding"}]}`))
		_, _ = w.Write([]byte(`{"artifact":{"manifest":{"source_kind":"semantica-native"}},"stages":[],"findings":[]}`))
	}))
	defer service.Close()
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)
	testutil.Call(t, testHandler.semanticNativeOntology, semanticRequest("POST", ontology, map[string]any{"source_snapshot_ids": []string{snapshot}})).Want(409)
	var bundle json.RawMessage
	if err := testHandler.DB.QueryRow(t.Context(), "SELECT bundle FROM semantic_ontology WHERE id=$1", ontology).Scan(&bundle); err != nil || string(bundle) != "{}" {
		t.Fatal("an artifact with outdated source bindings was saved")
	}
}

func TestSemanticNativeEvaluationRetainsEachSelectedBindingObservation(t *testing.T) {
	_, _, runID := semanticFixture(t, "https://quality.example.test", "confirm")
	steps := []string{}
	for _, stock := range []string{"STOCK-AT01", "STOCK-CN03"} {
		steps = append(steps, dbfx.Insert(t, "semantic_step", testutil.Cols{"workspace_id": testWorkspaceID, "run_id": runID, "kind": "data_query", "status": "succeeded", "input": semanticMarshal(map[string]any{"binding_id": "stock", "parameters": map[string]any{"stock_id": stock}}), "output": semanticMarshal(map[string]any{"id": stock, "version": 1})}))
	}
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		_ = json.NewDecoder(r.Body).Decode(&request)
		facts := request["data"].(map[string]any)["facts"].(map[string]any)
		observations := facts["binding_observations"].(map[string]any)["stock"].([]any)
		if len(observations) != 2 {
			t.Fatal("one plant's stock query overwrote another plant's evidence")
		}
		for i, value := range observations {
			observation := value.(map[string]any)
			if observation["step_id"] != steps[i] || observation["output"].(map[string]any)["id"] != observation["parameters"].(map[string]any)["stock_id"] {
				t.Error("binding observation was attributed to another query or target")
			}
		}
		_, _ = w.Write([]byte(`{"action_intents":[],"derivations":[]}`))
	}))
	defer service.Close()
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)
	testutil.Call(t, testHandler.semanticEvaluate, semanticRequest("POST", runID, map[string]any{"source_step_ids": steps})).Want(200)
	testutil.Call(t, testHandler.semanticEvaluate, semanticRequest("POST", runID, map[string]any{"source_step_ids": []string{steps[0], steps[0]}})).Want(400)
}

func TestSemanticNativePreviewValidatesEmbeddedKnowledgeWithoutLegacyTestData(t *testing.T) {
	ontology := dbfx.Insert(t, "semantic_ontology", testutil.Cols{"workspace_id": testWorkspaceID, "name": "native preview", "bundle": []byte(`{"native_artifact":{"manifest":{"source_kind":"semantica-native"}}}`), "created_by": testUserID})
	validated := false
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/compile":
			_, _ = w.Write([]byte(`{"artifact":{"manifest":{"source_kind":"semantica-native"},"knowledge_turtle":"embedded source instances"}}`))
		case "/v1/validate":
			validated = true
			_, _ = w.Write([]byte(`{"valid":true,"conforms":true,"coverage":{"targeted_instances":3}}`))
		default:
			t.Errorf("unexpected operation %s", r.URL.Path)
		}
	}))
	defer service.Close()
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)
	var result map[string]any
	testutil.Call(t, testHandler.semanticPreviewOntology, semanticRequest("POST", ontology, map[string]any{})).Want(200).JSON(&result)
	if !validated || result["incomplete"] != false || result["validation"].(map[string]any)["valid"] != true {
		t.Fatal("native preview incorrectly required a legacy RDF test snapshot")
	}
}

func TestSemanticTraceUsesRecordedPremisesAndKeepsAlternativeProofs(t *testing.T) {
	var run map[string]any
	_ = json.Unmarshal([]byte(`{"id":"run","release_id":"release","steps":[{"id":"read","kind":"data_query","status":"succeeded","input":{"binding_id":"lots"},"output":{}},{"id":"proof","kind":"rule_evaluation","status":"succeeded","input":{"source_step_ids":["read"]},"output":{"derivations":[{"rule_id":"r1","premises":["defective(lot)"],"conclusion":"affected(plant)"},{"rule_id":"r2","premises":["recalled(lot)"],"conclusion":"affected(plant)"}]}}],"approvals":[],"receipts":[]}`), &run)
	trace := semanticExecutionTrace(run)
	rules := 0
	for _, node := range trace["nodes"].([]map[string]any) {
		if node["type"] == "rule" {
			rules++
		}
	}
	if rules != 2 {
		t.Fatal("alternative derivations were collapsed")
	}
	encoded := string(semanticMarshal(trace))
	if !strings.Contains(encoded, "defective(lot)") || !strings.Contains(encoded, "recalled(lot)") || !strings.Contains(encoded, "provides evidence") {
		t.Fatal("trace lost recorded premises or source step")
	}
}
