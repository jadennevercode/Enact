package handler

// This opt-in contract test uses a real loopback Semantica HTTP process and
// the handler suite's isolated PostgreSQL database. Its member decision is an
// automated fixture record. It is never evidence of business-user acceptance.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/enact-ai/enact/server/internal/testutil"
)

func TestSemanticNativeV2ContractThroughRealHTTPAndEnactDB(t *testing.T) {
	if os.Getenv("ENACT_NATIVE_CONTRACT_E2E") != "1" {
		t.Skip("set ENACT_NATIVE_CONTRACT_E2E=1 for the isolated real-Native contract test")
	}
	serviceURL := strings.TrimRight(os.Getenv("ENACT_SEMANTIC_SERVICE_URL"), "/")
	parsed, err := url.Parse(serviceURL)
	if err != nil || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		t.Fatal("ENACT_SEMANTIC_SERVICE_URL must name an isolated loopback Native service")
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil || port < 18190 || port > 18199 {
		t.Fatal("the isolated Native contract service must use a port from 18190 through 18199")
	}
	if os.Getenv("ENACT_SEMANTIC_SERVICE_KEY") == "" {
		t.Fatal("ENACT_SEMANTIC_SERVICE_KEY is required for the authenticated Native service")
	}

	var sourceWrites atomic.Int32
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/openapi.json":
			writeJSON(w, 200, map[string]any{
				"openapi": "3.0.3", "info": map[string]any{"title": "Synthetic inventory contract", "version": "1"},
				"paths": map[string]any{
					"/stock/{target_id}": map[string]any{"get": map[string]any{
						"operationId": "getStock", "summary": "读取库存", "parameters": []any{map[string]any{"name": "target_id", "in": "path", "required": true, "schema": map[string]any{"type": "string"}}},
						"responses": map[string]any{"200": map[string]any{"description": "库存", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"type": "object"}}}}},
					}},
					"/freeze": map[string]any{"post": map[string]any{
						"operationId": "freezeStockOperation", "summary": "冻结库存", "requestBody": map[string]any{"content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"type": "object"}}}},
						"responses": map[string]any{"200": map[string]any{"description": "操作", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"type": "object"}}}}},
					}},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/stock/stock-1":
			writeJSON(w, 200, map[string]any{"id": "stock-1", "state": "AVAILABLE", "version": 3})
		case r.Method == http.MethodPost && r.URL.Path == "/freeze":
			sourceWrites.Add(1)
			writeJSON(w, 200, map[string]any{"id": "operation-1"})
		default:
			writeError(w, 404, "test fixture route not found")
		}
	}))
	defer source.Close()

	connectionID, releaseID, runID := semanticFixture(t, source.URL, "allow")
	var ontologyID string
	dbfx.QueryRow(t, "SELECT ontology_id::text FROM semantic_release WHERE id=$1", releaseID).Scan(&ontologyID)
	var catalog map[string]any
	testutil.Call(t, testHandler.semanticDiscoverSource, semanticRequest("POST", connectionID, nil)).Want(201).JSON(&catalog)
	catalogDigest, ok := catalog["source_digest"].(string)
	if !ok || catalogDigest == "" {
		t.Fatalf("real Native discovery did not return a catalog digest: %#v", catalog)
	}

	definition := map[string]any{
		"schema_version": 2,
		"id":             "native-contract",
		"label":          "库存处置",
		"description":    "追踪库存批次与工厂，并由政策约束冻结行动",
		"namespace":      "https://example.test/native-contract#",
		"entities": []any{
			map[string]any{"id": "Batch", "label": "库存批次", "description": "具有共同来源的一组库存", "aliases": []string{"来料批号"}},
			map[string]any{"id": "Plant", "label": "工厂", "description": "持有或使用库存的生产地点"},
		},
		"attributes": []any{
			map[string]any{"id": "stockState", "entity_id": "Batch", "label": "库存状态", "description": "库存当前是否可用", "data_type": "string"},
		},
		"relationships": []any{
			map[string]any{"id": "suppliedTo", "label": "供应到", "description": "库存批次被供应到工厂", "source_entity_id": "Batch", "target_entity_id": "Plant", "cardinality": map[string]any{"min": 1, "max": 3}},
		},
		"actions": []any{
			map[string]any{
				"id": "freezeStock", "label": "冻结库存", "description": "阻止指定库存继续使用", "target_entity_ids": []string{"Batch"}, "policy_ids": []string{"availableStockPermission"}, "status": "active",
				"identity_parameters": []string{"target_id"},
				"input_schema":        map[string]any{"type": "object", "properties": map[string]any{"target_id": map[string]any{"type": "string"}}, "required": []string{"target_id"}, "additionalProperties": false},
			},
		},
		"policies": []any{
			map[string]any{
				"id": "availableStockPermission", "label": "可用库存冻结许可", "description": "只有本次读取仍为可用的同一库存才能提交冻结复核", "kind": "permission", "action_ids": []string{"freezeStock"}, "status": "active", "requires_approval": true,
				"condition": map[string]any{"all": []any{
					map[string]any{"eq": []any{map[string]any{"fact": "binding_observations.stock.0.output.id"}, map[string]any{"fact": "parameters.target_id"}}},
					map[string]any{"eq": []any{map[string]any{"fact": "binding_observations.stock.0.output.state"}, "AVAILABLE"}},
				}},
			},
		},
		"data_bindings": []any{
			map[string]any{"id": "stock", "entity_id": "Batch", "connection_id": connectionID, "path": "/stock/{target_id}", "catalog_entry_id": "getStock", "catalog_digest": catalogDigest},
		},
		"action_bindings": []any{
			map[string]any{"id": "freeze", "action_id": "freezeStock", "connection_id": connectionID, "method": "POST", "path": "/freeze", "catalog_entry_id": "freezeStockOperation", "catalog_digest": catalogDigest, "authorization": map[string]any{"mode": "allow"}, "readback": map[string]any{"path": "/stock/{parameters.target_id}", "expected": map[string]any{"state": "FROZEN"}}},
		},
	}
	scope := map[string]any{"workspace_id": testWorkspaceID, "ontology_id": ontologyID, "release_id": releaseID}
	raw, err := semanticService(t.Context(), "native/pipeline", map[string]any{
		"scope":       scope,
		"definition":  definition,
		"sources":     []any{map[string]any{"id": "contract-source", "source_path": "contract-fixture.txt", "content": "来料批号供应到工厂。冻结库存必须使用刚读取的可用库存证据，并由成员复核。"}},
		"extractions": map[string]any{"entities": []any{}, "relationships": []any{}},
	})
	if err != nil {
		t.Fatalf("real Native pipeline failed: %v", err)
	}
	var compiled struct {
		Artifact   map[string]any `json:"artifact"`
		Validation map[string]any `json:"validation"`
	}
	if err = json.Unmarshal(raw, &compiled); err != nil {
		t.Fatal(err)
	}
	owl, _ := compiled.Artifact["ontology_turtle"].(string)
	shapes, _ := compiled.Artifact["shapes_turtle"].(string)
	if !strings.Contains(owl, "owl:Class") || !strings.Contains(owl, "冻结库存") {
		t.Fatal("real Native output did not contain the v2 OWL business projection")
	}
	if !strings.Contains(shapes, "sh:NodeShape") || !strings.Contains(shapes, "sh:minCount 1") {
		t.Fatal("real Native output did not compile the relationship into SHACL")
	}

	bindings := semantic.Bindings{
		Data: []semantic.Binding{{ID: "stock", EntityID: "Batch", ConnectionID: connectionID, Path: "/stock/{target_id}", RequiredParameters: []string{"target_id"}, CatalogEntryID: "getStock", CatalogDigest: catalogDigest}},
		Actions: []semantic.Binding{{
			ID: "freeze", ActionID: "freezeStock", ConnectionID: connectionID, Method: http.MethodPost, Path: "/freeze", RequiredParameters: []string{"target_id"},
			CatalogEntryID: "freezeStockOperation", CatalogDigest: catalogDigest,
			Authorization: semantic.Authorization{Mode: "allow"}, Readback: &semantic.Readback{Path: "/stock/{parameters.target_id}", Expected: map[string]any{"state": "FROZEN"}},
		}},
	}
	dbfx.Exec(t, "UPDATE semantic_release SET artifact=$2,binding_config=$3,validation=$4 WHERE id=$1", releaseID, semanticMarshal(compiled.Artifact), semanticMarshal(bindings), semanticMarshal(compiled.Validation))

	var contextStep map[string]any
	testutil.Call(t, testHandler.semanticBusinessContext, semanticRequest("POST", runID, map[string]any{"question": "来料批号可以怎样冻结库存？", "hops": 2})).Want(200).JSON(&contextStep)
	contextOutput := contextStep["output"].(map[string]any)
	if contextOutput["status"] != "resolved" || len(contextOutput["actions"].([]any)) != 1 || len(contextOutput["policies"].([]any)) != 1 {
		t.Fatalf("real Native context did not resolve the governed action: %#v", contextOutput)
	}

	var evidence map[string]any
	testutil.Call(t, testHandler.semanticQuery, semanticRequest("POST", runID, map[string]any{"binding_id": "stock", "parameters": map[string]any{"target_id": "stock-1"}})).Want(200).JSON(&evidence)
	var policyStep map[string]any
	testutil.Call(t, testHandler.semanticEvaluatePolicies, semanticRequest("POST", runID, map[string]any{
		"action_id": "freezeStock", "parameters": map[string]any{"target_id": "stock-1"}, "source_step_ids": []string{evidence["step_id"].(string)},
	})).Want(200).JSON(&policyStep)
	policyOutput := policyStep["output"].(map[string]any)
	if policyOutput["decision"] != "needs_approval" || policyOutput["authorization_granted"] != false {
		t.Fatalf("real Native Policy did not preserve human review: %#v", policyOutput)
	}
	intents := policyOutput["action_intents"].([]any)
	if len(intents) != 1 {
		t.Fatalf("real Policy produced %d intents, want 1", len(intents))
	}
	intent := intents[0].(map[string]any)

	var approval map[string]any
	testutil.Call(t, testHandler.semanticPrepareAction, semanticRequest("POST", runID, map[string]any{
		"binding_id": "freeze", "parameters": map[string]any{"target_id": "stock-1"}, "evaluation_step_id": policyStep["step_id"], "intent_id": intent["intent_id"],
	})).Want(201).JSON(&approval)
	if approval["status"] != "pending" || approval["approved_by"] != nil {
		t.Fatalf("v2 action bypassed Enact human pending state: %#v", approval)
	}
	if sourceWrites.Load() != 0 {
		t.Fatal("preparation dispatched a source-system write")
	}

	// This is a fixed test-suite member decision, explicitly labeled as such.
	// It proves the member-only server transition and is not user acceptance.
	approvalID := approval["id"].(string)
	testutil.Call(t, testHandler.semanticDecide, semanticRequest("POST", approvalID, map[string]any{
		"approve": true, "reason": "AUTOMATED TEST FIXTURE: approve only this synthetic contract action",
	})).Want(200)
	var status, approvedBy, reason string
	dbfx.QueryRow(t, "SELECT status,approved_by::text,reason FROM semantic_approval WHERE id=$1", approvalID).Scan(&status, &approvedBy, &reason)
	if status != "approved" || approvedBy != testUserID || !strings.HasPrefix(reason, "AUTOMATED TEST FIXTURE:") {
		t.Fatalf("approval lacks the fixed test-member audit record: status=%s approved_by=%s reason=%q", status, approvedBy, reason)
	}
	if sourceWrites.Load() != 0 {
		t.Fatal("the integration test must stop after human review without executing a business action")
	}
	t.Logf("real Native contract: release=%s owl_bytes=%d shacl_bytes=%d context_step=%s evidence_step=%s policy_step=%s approval=%s fixed_test_member=%s", releaseID, len(owl), len(shapes), contextStep["step_id"], evidence["step_id"], policyStep["step_id"], approvalID, testUserID)
}
