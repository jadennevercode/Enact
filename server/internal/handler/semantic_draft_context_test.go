package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

func TestSemanticDraftContextUsesSavedModelWithoutCreatingRunEvidence(t *testing.T) {
	ontologyID := dbfx.Insert(t, "semantic_ontology", testutil.Cols{"workspace_id": testWorkspaceID, "name": "business language review", "bundle": []byte(`{"draft_marker":"saved"}`), "created_by": testUserID})
	contexts := 0
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input map[string]any
		if json.NewDecoder(r.Body).Decode(&input) != nil {
			t.Error("invalid native payload")
			w.WriteHeader(400)
			return
		}
		scope, _ := input["scope"].(map[string]any)
		if scope["workspace_id"] != testWorkspaceID || scope["ontology_id"] != ontologyID || scope["release_id"] != "draft:"+ontologyID || scope["run_id"] != nil {
			t.Error("draft context trusted caller scope")
		}
		if r.URL.Path == "/v1/compile" {
			bundle, _ := input["bundle"].(map[string]any)
			if bundle["draft_marker"] != "saved" {
				t.Error("caller substituted the saved draft")
			}
			writeJSON(w, 200, map[string]any{"artifact": map[string]any{"compiled_marker": "saved"}})
			return
		}
		if r.URL.Path != "/v1/native/context" {
			t.Error("incorrect native context route")
			w.WriteHeader(500)
			return
		}
		contexts++
		artifact, _ := input["artifact"].(map[string]any)
		ids, ok := input["entity_ids"].([]any)
		if artifact["compiled_marker"] != "saved" || input["question"] != "查一下库存" || !ok || len(ids) != 0 || input["hops"] != float64(2) || input["data"] != nil {
			t.Error("draft context lost the question or forwarded runtime facts")
		}
		writeJSON(w, 200, map[string]any{"status": "resolved", "matches": []any{map[string]any{"id": "InventoryPosition", "matched_terms": []string{"库存"}}}})
	}))
	defer service.Close()
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)
	var before, after int
	dbfx.QueryRow(t, "SELECT count(*) FROM semantic_step WHERE workspace_id=$1", testWorkspaceID).Scan(&before)
	var result map[string]any
	body := map[string]any{"question": "查一下库存", "scope": map[string]any{"workspace_id": "foreign", "run_id": "forged"}, "artifact": map[string]any{"compiled_marker": "forged"}, "data": map[string]any{"facts": map[string]any{"approved": true}}}
	testutil.Call(t, testHandler.semanticDraftContext, semanticRequest("POST", ontologyID, body)).Want(200).JSON(&result)
	if result["status"] != "resolved" || result["step_id"] != nil || contexts != 1 {
		t.Fatal("context preview did not return a read-only retrieval result")
	}
	dbfx.QueryRow(t, "SELECT count(*) FROM semantic_step WHERE workspace_id=$1", testWorkspaceID).Scan(&after)
	if before != after {
		t.Fatal("authoring preview created operational evidence")
	}
	testutil.Call(t, testHandler.semanticDraftContext, semanticRequest("POST", uuid.NewString(), body)).Want(404)
	testutil.Call(t, testHandler.semanticDraftContext, semanticRequest("POST", ontologyID, map[string]any{"question": "查一下库存", "hops": 6})).Want(400)
	if contexts != 1 {
		t.Fatal("invalid preview reached native retrieval")
	}
}
