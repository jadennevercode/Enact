package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

func TestSemanticAgentCatalogPinsEnabledReleaseAndCannotCrossOntology(t *testing.T) {
	_, releaseID, _ := semanticFixture(t, "https://quality.example.test", "confirm")
	var ontologyID string
	dbfx.QueryRow(t, "SELECT ontology_id::text FROM semantic_release WHERE id=$1", releaseID).Scan(&ontologyID)
	runtime := dbfx.Runtime(t, "catalog runtime")
	agent := dbfx.Agent(t, "catalog consumer", runtime)
	task := dbfx.Task(t, agent, testutil.Cols{"runtime_id": runtime, "issue_id": dbfx.Issue(t, "catalog investigation"), "originator_user_id": testUserID, "accountable_user_id": testUserID})
	dbfx.Cleanup(t, "DELETE FROM semantic_agent_ontology WHERE agent_id=$1", agent)
	request := func(body any) *http.Request {
		return testutil.WithURLParams(newRequest("PUT", "/api/semantic/agents/ontologies", body), "agentID", agent)
	}
	runRequest := func() *http.Request {
		return testutil.WithHeaders(semanticRequest("POST", "", map[string]any{"release_id": releaseID, "question": "哪些批次受到影响？"}), "X-Actor-Source", "task_token", "X-Agent-ID", agent, "X-Task-ID", task)
	}
	testutil.Call(t, testHandler.semanticCreateRun, runRequest()).Want(403)
	assignment := map[string]any{"ontology_id": ontologyID, "release_id": releaseID, "enabled": true}
	testutil.Call(t, testHandler.semanticAssignAgentOntologies, request(map[string]any{"assignments": []any{assignment}})).Want(200)
	var run map[string]any
	testutil.Call(t, testHandler.semanticCreateRun, runRequest()).Want(201).JSON(&run)
	dbfx.Cleanup(t, "DELETE FROM semantic_run WHERE id=$1", run["id"])
	instructions := testHandler.semanticAgentInstructions(t.Context(), testWorkspaceID, agent)
	if !strings.Contains(instructions, releaseID) || !strings.Contains(instructions, "enact-ontology-operating") {
		t.Fatal("claimed task lost its real release catalog")
	}
	assignment["ontology_id"] = uuid.NewString()
	testutil.Call(t, testHandler.semanticAssignAgentOntologies, request(map[string]any{"assignments": []any{assignment}})).Want(409)
	assignment["ontology_id"] = ontologyID
	assignment["enabled"] = false
	testutil.Call(t, testHandler.semanticAssignAgentOntologies, request(map[string]any{"assignments": []any{assignment}})).Want(200)
	testutil.Call(t, testHandler.semanticCreateRun, runRequest()).Want(403)
	testutil.Call(t, testHandler.semanticAssignAgentOntologies, testutil.WithHeaders(request(map[string]any{"assignments": []any{}}), "X-Actor-Source", "task_token", "X-Agent-ID", agent, "X-Task-ID", task)).Want(403)
}

func TestSemanticBusinessPolicyUsesStoredEvidenceAndRechecksBeforeDispatch(t *testing.T) {
	writes := 0
	system := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/freeze" {
			writes++
			writeJSON(w, 200, map[string]any{"id": "op-1"})
		} else {
			writeJSON(w, 200, map[string]any{"status": "succeeded"})
		}
	}))
	defer system.Close()
	connectionID, releaseID, runID := semanticFixture(t, system.URL, "allow")
	bindings := semantic.Bindings{Data: []semantic.Binding{{ID: "case", ConnectionID: connectionID, EntityID: "batch", Path: "/case"}}, Actions: []semantic.Binding{{ID: "freeze", ActionID: "freeze_stock", ConnectionID: connectionID, Method: "POST", Path: "/freeze", Authorization: semantic.Authorization{Mode: "allow"}, Readback: &semantic.Readback{Path: "/operations/{response.id}", Expected: map[string]any{"status": "succeeded"}}}}}
	dbfx.Exec(t, "UPDATE semantic_release SET artifact=$2,binding_config=$3 WHERE id=$1", releaseID, []byte(`{"definition":{"schema_version":2,"entities":[{"id":"batch"}],"actions":[{"id":"freeze_stock"}]}}`), semanticMarshal(bindings))
	evidence := dbfx.Insert(t, "semantic_step", testutil.Cols{"workspace_id": testWorkspaceID, "run_id": runID, "kind": "data_query", "status": "succeeded", "input": []byte(`{"binding_id":"case","parameters":{"target":"B1"}}`), "output": []byte(`{"id":"B1","state":"available"}`), "finished_at": time.Now()})
	decision := "needs_approval"
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/native/policies" {
			t.Errorf("unexpected call %s", r.URL.Path)
			w.WriteHeader(500)
			return
		}
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		principal, _ := payload["principal"].(map[string]any)
		if principal["user_id"] != testUserID || principal["workspace_role"] == "invented" {
			t.Error("caller-supplied principal reached Policy")
		}
		data, _ := payload["data"].(map[string]any)
		facts, _ := data["facts"].(map[string]any)
		values, _ := facts["bindings"].(map[string]any)
		value, _ := values["case"].(map[string]any)
		if value["state"] != "available" {
			t.Error("Policy evidence did not come from the saved query")
		}
		writeJSON(w, 200, map[string]any{"action_id": "freeze_stock", "decision": decision, "reason": "fixture policy", "policies": []any{}, "authorization_granted": false})
	}))
	defer service.Close()
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)
	input := map[string]any{"action_id": "freeze_stock", "parameters": map[string]any{"target": "B1"}, "source_step_ids": []string{evidence}, "principal": map[string]any{"workspace_role": "invented"}, "facts": map[string]any{"state": "forged"}}
	var policy map[string]any
	testutil.Call(t, testHandler.semanticEvaluatePolicies, semanticRequest("POST", runID, input)).Want(200).JSON(&policy)
	output := policy["output"].(map[string]any)
	intent := output["action_intents"].([]any)[0].(map[string]any)
	var approval map[string]any
	prepare := map[string]any{"binding_id": "freeze", "parameters": map[string]any{"target": "B1"}, "evaluation_step_id": policy["step_id"], "intent_id": intent["intent_id"]}
	testutil.Call(t, testHandler.semanticPrepareAction, semanticRequest("POST", runID, prepare)).Want(201).JSON(&approval)
	if approval["status"] != "pending" {
		t.Fatal("business action bypassed human review through allow binding")
	}
	id := approval["id"].(string)
	testutil.Call(t, testHandler.semanticDecide, semanticRequest("POST", id, map[string]any{"approve": true})).Want(200)
	execute := func() *http.Request {
		return testutil.WithHeaders(semanticRequest("POST", id, nil), "Idempotency-Key", uuid.NewString())
	}
	decision = "deny"
	testutil.Call(t, testHandler.semanticExecute, execute()).Want(409)
	if writes != 0 {
		t.Fatal("denied policy dispatched an action")
	}
	decision = "allow"
	dbfx.Exec(t, "UPDATE semantic_step SET finished_at=now()-interval '10 minutes' WHERE id=$1", evidence)
	testutil.Call(t, testHandler.semanticExecute, execute()).Want(409)
	// A fresh query is a new observation, never a timestamp edit of old evidence.
	freshEvidence := dbfx.Insert(t, "semantic_step", testutil.Cols{"workspace_id": testWorkspaceID, "run_id": runID, "kind": "data_query", "status": "succeeded", "input": []byte(`{"binding_id":"case","parameters":{"target":"B1"}}`), "output": []byte(`{"id":"B1","state":"available"}`), "finished_at": time.Now()})
	input["source_step_ids"] = []string{freshEvidence}
	testutil.Call(t, testHandler.semanticEvaluatePolicies, semanticRequest("POST", runID, input)).Want(200).JSON(&policy)
	output = policy["output"].(map[string]any)
	intent = output["action_intents"].([]any)[0].(map[string]any)
	prepare["evaluation_step_id"], prepare["intent_id"] = policy["step_id"], intent["intent_id"]
	var refreshed map[string]any
	testutil.Call(t, testHandler.semanticPrepareAction, semanticRequest("POST", runID, prepare)).Want(201).JSON(&refreshed)
	if refreshed["id"] == id || refreshed["supersedes_approval_id"] != id || refreshed["status"] != "pending" || refreshed["approved_by"] != nil {
		t.Fatal("fresh evidence inherited an old approval or lost its review history")
	}
	var priorStatus string
	var priorApprover, supersededBy *string
	dbfx.QueryRow(t, "SELECT status,approved_by::text,superseded_by::text FROM semantic_approval WHERE id=$1", id).Scan(&priorStatus, &priorApprover, &supersededBy)
	if priorStatus != "approved" || priorApprover == nil || *priorApprover != testUserID || supersededBy == nil || *supersededBy != refreshed["id"] {
		t.Fatal("refresh overwrote the original human decision")
	}
	testutil.Call(t, testHandler.semanticExecute, execute()).Want(409)
	testutil.Call(t, testHandler.semanticDecide, semanticRequest("POST", id, map[string]any{"approve": true})).Want(409)
	id = refreshed["id"].(string)
	testutil.Call(t, testHandler.semanticExecute, execute()).Want(409)
	testutil.Call(t, testHandler.semanticDecide, semanticRequest("POST", id, map[string]any{"approve": true})).Want(200)
	testutil.Call(t, testHandler.semanticExecute, execute()).Want(200)
	if writes != 1 {
		t.Fatal("reviewed action did not dispatch exactly once")
	}
}

func TestSemanticBusinessReportRequiresEvidenceAndEscapesHTML(t *testing.T) {
	_, release, run := semanticFixture(t, "https://quality.example.test", "confirm")
	dbfx.Exec(t, "UPDATE semantic_release SET artifact=$2 WHERE id=$1", release, []byte(`{"definition":{"schema_version":2,"entities":[{"id":"batch"}]}}`))
	evidence := dbfx.Insert(t, "semantic_step", testutil.Cols{"workspace_id": testWorkspaceID, "run_id": run, "kind": "data_query", "status": "succeeded", "input": []byte(`{"binding_id":"case"}`), "output": []byte(`{"batch":"B1"}`), "finished_at": time.Now()})
	finding := map[string]any{"label": "影响范围", "detail": "<script>alert(1)</script>", "classification": "fact", "object_ids": []string{"batch"}}
	report := map[string]any{"summary": "核查受影响批次", "findings": []any{finding}, "next_steps": []string{"核对库存"}, "limitations": []string{"跨工厂审批责任待确认"}}
	testutil.Call(t, testHandler.semanticSaveReport, semanticRequest("POST", run, report)).Want(400)
	finding["evidence_step_ids"] = []string{uuid.NewString()}
	testutil.Call(t, testHandler.semanticSaveReport, semanticRequest("POST", run, report)).Want(400)
	finding["evidence_step_ids"] = []string{evidence}
	report["findings"] = []any{
		finding,
		map[string]any{"label": "影响判断", "detail": "现有数据支持批次影响判断", "classification": "inference", "evidence_step_ids": []string{evidence}, "object_ids": []string{"batch"}},
		map[string]any{"label": "建议措施", "detail": "建议复核库存", "classification": "recommendation", "object_ids": []string{"batch"}},
		map[string]any{"label": "待确认事项", "detail": "跨工厂批准责任未知", "classification": "unknown", "object_ids": []string{"batch"}},
	}
	testutil.Call(t, testHandler.semanticSaveReport, semanticRequest("POST", run, report)).Want(200)
	req := semanticRequest("GET", run, nil)
	req.URL.RawQuery = "format=html"
	html := testutil.Call(t, testHandler.semanticGetBusinessReport, req).Want(200)
	if strings.Contains(html.Body.String(), "<script>") || !strings.Contains(html.Body.String(), "&lt;script&gt;") || !strings.Contains(html.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatal("report HTML is not escaped and sandboxed")
	}
	for _, label := range []string{"已查询事实", "有依据的推断", "处置建议", "仍需确认"} {
		if !strings.Contains(html.Body.String(), "<span class=\"kind\">"+label+"</span>") {
			t.Fatalf("report HTML omitted localized classification badge %q", label)
		}
	}
	for _, enum := range []string{"fact", "inference", "recommendation", "proposal", "unknown"} {
		if strings.Contains(html.Body.String(), "<span class=\"kind\">"+enum+"</span>") {
			t.Fatalf("report HTML exposed machine classification badge %q", enum)
		}
	}
	req = semanticRequest("GET", run, nil)
	req.URL.RawQuery = "format=jsonl"
	log := testutil.Call(t, testHandler.semanticGetBusinessReport, req).Want(200)
	if !strings.Contains(log.Body.String(), evidence) || !strings.Contains(log.Body.String(), release) ||
		!strings.Contains(log.Body.String(), "\"classification\":\"fact\"") ||
		!strings.Contains(log.Body.String(), "\"classification\":\"recommendation\"") {
		t.Fatal("machine report lost evidence, version identity, or classification enums")
	}
}
