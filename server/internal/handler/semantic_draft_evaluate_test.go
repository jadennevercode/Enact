package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

func TestSemanticDraftEvaluatePreservesSyntheticObservationsWithoutExecutionAuthority(t *testing.T) {
	_, _, runID := semanticFixture(t, "https://quality.example.test", "confirm")
	ontologyID := dbfx.Insert(t, "semantic_ontology", testutil.Cols{"workspace_id": testWorkspaceID, "name": "rule fixture draft", "bundle": []byte(`{"native_artifact":{"manifest":{"source_kind":"semantica-native"}}}`), "created_by": testUserID})
	first, second := uuid.NewString(), "fixture-case-B"
	facts := map[string]any{"binding_observations": map[string]any{"case": []any{
		map[string]any{"step_id": first, "parameters": map[string]any{"case_id": "CASE-A"}, "output": map[string]any{"id": "CASE-A", "affectedPlants": []string{"AT01"}}},
		map[string]any{"step_id": second, "parameters": map[string]any{"case_id": "CASE-B"}, "output": map[string]any{"id": "CASE-B", "affectedPlants": []string{"CN03"}}},
	}}}
	var evaluated atomic.Int32
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input map[string]any
		if json.NewDecoder(r.Body).Decode(&input) != nil {
			t.Error("invalid native request")
			w.WriteHeader(400)
			return
		}
		if r.URL.Path == "/v1/compile" {
			writeJSON(w, 200, map[string]any{"artifact": map[string]any{"manifest": map[string]any{"source_kind": "semantica-native"}}})
			return
		}
		if r.URL.Path != "/v1/evaluate" {
			t.Error("fixture did not use the native evaluate endpoint")
		}
		scope, _ := input["scope"].(map[string]any)
		if scope["workspace_id"] != testWorkspaceID || scope["release_id"] != "draft:"+ontologyID || scope["run_id"] != nil {
			t.Error("draft fixture gained a runtime scope")
		}
		ids, _ := input["source_step_ids"].([]any)
		data, _ := input["data"].(map[string]any)
		if len(ids) != 2 || ids[0] != first || ids[1] != second || semantic.Digest(data["facts"]) != semantic.Digest(facts) {
			t.Error("fixture evidence IDs or independent result shapes were changed")
			w.WriteHeader(422)
			return
		}
		evaluated.Add(1)
		writeJSON(w, 200, map[string]any{"valid": true, "action_intents": []any{map[string]any{"intent_id": "fixture-intent", "binding_id": "freeze", "parameters": map[string]any{}}}})
	}))
	defer service.Close()
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)
	var beforeSteps, beforeApprovals int
	if err := testHandler.DB.QueryRow(t.Context(), `SELECT count(*) FROM semantic_step WHERE workspace_id=$1`, testWorkspaceID).Scan(&beforeSteps); err != nil {
		t.Fatal(err)
	}
	if err := testHandler.DB.QueryRow(t.Context(), `SELECT count(*) FROM semantic_approval WHERE workspace_id=$1`, testWorkspaceID).Scan(&beforeApprovals); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	testutil.Call(t, testHandler.semanticDraftEvaluate, semanticRequest("POST", ontologyID, map[string]any{"facts": facts, "source_step_ids": []string{first, second}})).Want(200).JSON(&result)
	if result["valid"] != true || result["step_id"] != nil || evaluated.Load() != 1 {
		t.Fatal("draft evaluation did not remain an unpersisted fixture result")
	}
	// A fixture ID cannot authorize a real run action, even if it is a UUID.
	testutil.Call(t, testHandler.semanticPrepareAction, semanticRequest("POST", runID, map[string]any{"binding_id": "freeze", "parameters": map[string]any{}, "evaluation_step_id": first, "intent_id": "fixture-intent"})).Want(400)
	var afterSteps, afterApprovals int
	if err := testHandler.DB.QueryRow(t.Context(), `SELECT count(*) FROM semantic_step WHERE workspace_id=$1`, testWorkspaceID).Scan(&afterSteps); err != nil || afterSteps != beforeSteps {
		t.Fatal("draft fixture created an execution step")
	}
	if err := testHandler.DB.QueryRow(t.Context(), `SELECT count(*) FROM semantic_approval WHERE workspace_id=$1`, testWorkspaceID).Scan(&afterApprovals); err != nil || afterApprovals != beforeApprovals {
		t.Fatal("draft fixture granted action approval")
	}
}

func TestSemanticDraftEvaluateRejectsInvalidFixtureIDsAndOtherOperations(t *testing.T) {
	tooMany := make([]string, 101)
	for i := range tooMany {
		tooMany[i] = "fixture-" + strconv.Itoa(i)
	}
	id := uuid.NewString()
	for _, ids := range []any{nil, "fixture", []any{4}, []string{""}, []string{"  "}, []string{"same", "same"}, tooMany} {
		testutil.Call(t, testHandler.semanticDraftEvaluate, semanticRequest("POST", id, map[string]any{"facts": map[string]any{}, "source_step_ids": ids})).Want(400)
	}
	for _, operation := range []http.HandlerFunc{testHandler.semanticDraftQuery, testHandler.semanticDraftGraph, testHandler.semanticPreviewOntology} {
		testutil.Call(t, operation, semanticRequest("POST", id, map[string]any{"source_step_ids": []string{"fixture"}})).Want(400)
	}
}
