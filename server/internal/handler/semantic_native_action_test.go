package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/enact-ai/enact/server/internal/testutil"
)

func TestSemanticNativeOpenAPIActionRequiresConfirmationAndVerifiesReadback(t *testing.T) {
	var writes, reads atomic.Int32
	var mu sync.Mutex
	var plan map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer real-caller" {
			t.Error("OpenAPI action did not use the requesting user's credential")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/containment-plans":
			if r.Header.Get("Idempotency-Key") == "" {
				t.Error("OpenAPI write omitted its durable idempotency key")
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			actions, _ := body["actions"].([]any)
			if body["caseId"] != "CASE-1" || len(actions) != 1 {
				t.Error("OpenAPI write lost its bound business parameters")
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			action, _ := actions[0].(map[string]any)
			if action["targetId"] != "STOCK-1" || action["expectedTargetVersion"] != float64(3) {
				t.Error("OpenAPI write lost its nested target and version")
			}
			mu.Lock()
			defer mu.Unlock()
			plan = map[string]any{"id": "PLAN-1", "state": "DRAFT", "caseId": body["caseId"], "actions": actions}
			writes.Add(1)
			writeJSON(w, http.StatusCreated, plan)
		case r.Method == http.MethodGet && r.URL.Path == "/containment-plans/PLAN-1":
			mu.Lock()
			defer mu.Unlock()
			if plan == nil {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			reads.Add(1)
			writeJSON(w, http.StatusOK, plan)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()
	connectionID, releaseID, runID := semanticFixture(t, upstream.URL, "confirm")
	dbfx.Exec(t, `UPDATE semantic_connection SET kind='openapi' WHERE id=$1`, connectionID)
	bodyParameters := []string{"caseId", "actions"}
	binding := semantic.Binding{
		ID: "plan.create", Kind: "action", ConnectionID: connectionID,
		Path: "/containment-plans", Method: "POST", BodyParameters: &bodyParameters,
		RequiredParameters: bodyParameters, AllowedRoles: []string{"QualityEngineer"},
		CatalogEntryID: "createPlan", CatalogDigest: "catalog-v1",
		Authorization: semantic.Authorization{Mode: "confirm"},
		Readback:      &semantic.Readback{Path: "/containment-plans/{response.id}", Expected: map[string]any{"id": "{response.id}", "state": "DRAFT"}},
	}
	artifact := map[string]any{"manifest": map[string]any{"source_kind": "semantica-native"}, "bindings": []semantic.Binding{binding}}
	dbfx.Exec(t, `UPDATE semantic_release SET artifact=$2,binding_config=$3 WHERE id=$1`, releaseID, semanticMarshal(artifact), semanticMarshal(semantic.Bindings{Actions: []semantic.Binding{binding}}))
	parameters := map[string]any{"caseId": "CASE-1", "actions": []any{map[string]any{"targetId": "STOCK-1", "expectedTargetVersion": 3}}}
	var approval map[string]any
	testutil.Call(t, testHandler.semanticPrepareAction, semanticRequest("POST", runID, map[string]any{"binding_id": binding.ID, "parameters": parameters})).Want(http.StatusCreated).JSON(&approval)
	approvalID := approval["id"].(string)
	if approval["status"] != "pending" || writes.Load() != 0 {
		t.Fatal("preparing an OpenAPI action bypassed human confirmation")
	}
	execute := testutil.WithHeaders(semanticRequest("POST", approvalID, nil), "Idempotency-Key", "openapi-plan-1")
	testutil.Call(t, testHandler.semanticExecute, execute).Want(http.StatusConflict)
	testutil.Call(t, testHandler.semanticDecide, semanticRequest("POST", approvalID, map[string]any{"approve": true, "reason": "Create the reviewed draft plan"})).Want(http.StatusOK)
	var receipt map[string]any
	testutil.Call(t, testHandler.semanticExecute, execute).Want(http.StatusOK).JSON(&receipt)
	readback, _ := receipt["readback"].(map[string]any)
	if receipt["status"] != "succeeded" || readback["state"] != "DRAFT" || readback["id"] != "PLAN-1" || writes.Load() != 1 || reads.Load() != 1 {
		t.Fatalf("OpenAPI execution was not independently verified: status=%v writes=%d reads=%d", receipt["status"], writes.Load(), reads.Load())
	}
	var restored map[string]any
	testutil.Call(t, testHandler.semanticGetReceipt, semanticRequest("GET", receipt["id"].(string), nil)).Want(http.StatusOK).JSON(&restored)
	if restored["id"] != receipt["id"] || restored["status"] != "succeeded" {
		t.Fatal("OpenAPI receipt was not durable")
	}
}
