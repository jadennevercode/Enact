package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

func TestSemanticDraftPoliciesUseSavedDraftAndNeverCreateExecutionEvidence(t *testing.T) {
	runtimeID := dbfx.Runtime(t, "draft Policy runtime")
	agentID := dbfx.Agent(t, "draft Policy reviewer", runtimeID)
	squadID := dbfx.Squad(t, "draft Policy family", agentID)
	issueID := dbfx.Issue(t, "draft Policy construction")
	childID := dbfx.Issue(t, "review draft Policies", testutil.Cols{"parent_issue_id": issueID})
	taskID := dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": childID, "status": "running", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	ontologyID := dbfx.Insert(t, "semantic_ontology", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"name":         "draft Policy fixture",
		"bundle":       []byte(`{"draft_marker":"saved","native_artifact":{"manifest":{"artifact_digest":"artifact-saved"}}}`),
		"created_by":   testUserID,
	})
	dbfx.Insert(t, "semantic_construction", testutil.Cols{"id": uuid.NewString(), "workspace_id": testWorkspaceID, "ontology_id": ontologyID, "issue_id": issueID, "squad_id": squadID, "created_by": testUserID})

	var policyCalls atomic.Int32
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input map[string]any
		if json.NewDecoder(r.Body).Decode(&input) != nil {
			t.Error("invalid semantic service request")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if r.URL.Path == "/v1/compile" {
			bundle, _ := input["bundle"].(map[string]any)
			if bundle["draft_marker"] != "saved" {
				t.Error("caller substituted the saved ontology draft")
			}
			writeJSON(w, 200, map[string]any{"artifact": map[string]any{
				"compiled_marker": "saved",
				"manifest":        map[string]any{"artifact_digest": "artifact-saved"},
				"definition":      map[string]any{"actions": []any{map[string]any{"id": "ApprovePlan", "label": "批准方案"}}},
			}})
			return
		}
		if r.URL.Path != "/v1/native/policies" {
			t.Errorf("unexpected semantic service route %s", r.URL.Path)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		policyCalls.Add(1)
		scope, _ := input["scope"].(map[string]any)
		artifact, _ := input["artifact"].(map[string]any)
		principal, _ := input["principal"].(map[string]any)
		if scope["workspace_id"] != testWorkspaceID || scope["ontology_id"] != ontologyID || scope["release_id"] != "draft:"+ontologyID || scope["run_id"] != nil {
			t.Error("draft Policy fixture trusted caller scope")
		}
		if artifact["compiled_marker"] != "saved" || principal["user_id"] != testUserID || principal["workspace_role"] == "forged" {
			t.Error("draft Policy fixture trusted caller artifact or principal")
		}
		parameters, _ := input["parameters"].(map[string]any)
		data, _ := input["data"].(map[string]any)
		facts, _ := data["facts"].(map[string]any)
		decision := "allow"
		if facts["authority"] != true {
			decision = "unknown"
		} else if facts["case_id"] != parameters["case_id"] || facts["plan_id"] != parameters["plan_id"] {
			decision = "deny"
		}
		writeJSON(w, 200, map[string]any{
			"decision":       decision,
			"action_intents": []any{map[string]any{"intent_id": "must-not-escape", "binding_id": "write"}},
		})
	}))
	defer service.Close()
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)

	counts := func() [3]int {
		var result [3]int
		for i, table := range []string{"semantic_step", "semantic_approval", "semantic_receipt"} {
			if err := testHandler.DB.QueryRow(t.Context(), "SELECT count(*) FROM "+table+" WHERE workspace_id=$1", testWorkspaceID).Scan(&result[i]); err != nil {
				t.Fatal(err)
			}
		}
		return result
	}
	before := counts()
	request := func(facts map[string]any) map[string]any {
		return map[string]any{
			"action_id":       "ApprovePlan",
			"parameters":      map[string]any{"case_id": "CASE-1", "plan_id": "PLAN-1"},
			"facts":           facts,
			"source_step_ids": []string{"fixture-case", "fixture-plan", "fixture-authority"},
			"scope":           map[string]any{"workspace_id": "foreign", "run_id": "forged"},
			"artifact":        map[string]any{"compiled_marker": "forged"},
			"principal":       map[string]any{"user_id": "forged", "workspace_role": "forged"},
		}
	}
	assertDecision := func(req *http.Request, decision string, wantPassed *bool) {
		t.Helper()
		var result struct {
			Draft             bool           `json:"draft"`
			Fixture           bool           `json:"fixture"`
			ExecutionEvidence bool           `json:"execution_evidence"`
			Policy            map[string]any `json:"policy"`
			TestResult        struct {
				ID               string `json:"id"`
				ArtifactDigest   string `json:"artifact_digest"`
				ActionID         string `json:"action_id"`
				ActionLabel      string `json:"action_label"`
				CaseName         string `json:"case_name"`
				ActualDecision   string `json:"actual_decision"`
				Passed           *bool  `json:"passed"`
				Engine           string `json:"engine"`
				Fixture          bool   `json:"fixture"`
				CreatedByActorID string `json:"created_by_actor_id"`
			} `json:"test_result"`
		}
		testutil.Call(t, testHandler.semanticDraftPolicies, req).Want(200).JSON(&result)
		if !result.Draft || !result.Fixture || result.ExecutionEvidence || result.Policy["decision"] != decision {
			t.Fatalf("unexpected draft Policy response: %+v", result)
		}
		if _, exists := result.Policy["action_intents"]; exists {
			t.Fatal("draft Policy fixture returned an executable intent")
		}
		if result.TestResult.ID == "" || result.TestResult.ArtifactDigest != "artifact-saved" || result.TestResult.ActionID != "ApprovePlan" || result.TestResult.ActionLabel != "批准方案" || result.TestResult.CaseName == "" || result.TestResult.ActualDecision != decision || result.TestResult.Engine != "Semantica native/policies" || !result.TestResult.Fixture {
			t.Fatalf("draft Policy measurement was not persisted faithfully: %+v", result.TestResult)
		}
		if result.TestResult.CreatedByActorID != "" {
			t.Fatal("test result exposed internal actor metadata")
		}
		if (wantPassed == nil) != (result.TestResult.Passed == nil) || wantPassed != nil && *wantPassed != *result.TestResult.Passed {
			t.Fatalf("unexpected pass state: got=%v want=%v", result.TestResult.Passed, wantPassed)
		}
	}
	trueValue, falseValue := true, false
	allow := request(map[string]any{"authority": true, "case_id": "CASE-1", "plan_id": "PLAN-1"})
	allow["expected_decision"] = "allow"
	assertDecision(semanticRequest("POST", ontologyID, allow), "allow", &trueValue)
	wrongCase := request(map[string]any{"authority": true, "case_id": "CASE-2", "plan_id": "PLAN-1"})
	wrongCase["case_name"] = "其他案例的数据不能批准本方案"
	wrongCase["expected_decision"] = "unknown"
	assertDecision(semanticRequest("POST", ontologyID, wrongCase), "deny", &falseValue)
	wrongPlan := request(map[string]any{"authority": true, "case_id": "CASE-1", "plan_id": "PLAN-2"})
	wrongPlan["expected_decision"] = "deny"
	assertDecision(semanticRequest("POST", ontologyID, wrongPlan), "deny", &trueValue)
	assertDecision(semanticRequest("POST", ontologyID, request(map[string]any{"case_id": "CASE-1", "plan_id": "PLAN-1"})), "unknown", nil)
	agentBody := request(map[string]any{"authority": true, "case_id": "CASE-1", "plan_id": "PLAN-1"})
	agentBody["expected_decision"] = "allow"
	agentRequest := testutil.WithHeaders(semanticRequest("POST", ontologyID, agentBody), "X-Actor-Source", "task_token", "X-Agent-ID", agentID, "X-Task-ID", taskID)
	assertDecision(agentRequest, "allow", &trueValue)

	outsideTask := dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": dbfx.Issue(t, "unrelated Policy task"), "status": "running", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	outsideRequest := testutil.WithHeaders(semanticRequest("POST", ontologyID, request(map[string]any{})), "X-Actor-Source", "task_token", "X-Agent-ID", agentID, "X-Task-ID", outsideTask)
	testutil.Call(t, testHandler.semanticDraftPolicies, outsideRequest).Want(403)
	testutil.Call(t, testHandler.semanticDraftPolicies, semanticRequest("POST", uuid.NewString(), request(map[string]any{}))).Want(404)
	if policyCalls.Load() != 5 {
		t.Fatalf("rejected draft Policy request reached the evaluator: %d calls", policyCalls.Load())
	}
	if after := counts(); after != before {
		t.Fatalf("draft Policy fixtures created execution records: before=%v after=%v", before, after)
	}
	var listed struct {
		CurrentArtifactDigest string           `json:"current_artifact_digest"`
		TestResults           []map[string]any `json:"test_results"`
	}
	testutil.Call(t, testHandler.semanticDraftPolicyTests, semanticRequest("GET", ontologyID, nil)).Want(200).JSON(&listed)
	if listed.CurrentArtifactDigest != "artifact-saved" || len(listed.TestResults) != 5 || listed.TestResults[0]["created_by_actor_id"] != nil {
		t.Fatalf("stored Policy test results were not available safely: %+v", listed.TestResults)
	}
}

func TestSemanticDraftPoliciesRejectInvalidFixtureContract(t *testing.T) {
	id := uuid.NewString()
	for _, body := range []any{
		map[string]any{"parameters": map[string]any{}},
		map[string]any{"action_id": "ApprovePlan"},
		map[string]any{"action_id": "ApprovePlan", "parameters": map[string]any{}, "source_step_ids": nil},
		map[string]any{"action_id": "ApprovePlan", "parameters": map[string]any{}, "source_step_ids": []string{"same", "same"}},
		map[string]any{"action_id": "ApprovePlan", "parameters": map[string]any{}, "case_name": string(make([]rune, 201))},
	} {
		testutil.Call(t, testHandler.semanticDraftPolicies, semanticRequest("POST", id, body)).Want(400)
	}
}
