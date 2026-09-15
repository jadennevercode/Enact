package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/enact-ai/enact/server/internal/semantic"
)

// Authoring executes only the saved workspace draft. Clients cannot substitute
// another tenant's scope or an unreviewed compiled artifact at this boundary.
func (h *Handler) semanticDraftOperation(w http.ResponseWriter, r *http.Request, operation string) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	if operation == "policies" && !h.semanticDraftPolicyScope(w, r, &actor, id) {
		return
	}
	var input struct {
		TestData      json.RawMessage `json:"test_data"`
		Query         string          `json:"query"`
		Question      string          `json:"question"`
		ActionID      string          `json:"action_id"`
		CaseName      string          `json:"case_name"`
		Parameters    map[string]any  `json:"parameters"`
		Expected      *string         `json:"expected_decision"`
		EntityIDs     []string        `json:"entity_ids"`
		Data          json.RawMessage `json:"data"`
		Facts         map[string]any  `json:"facts"`
		SourceStepIDs json.RawMessage `json:"source_step_ids"`
		Projection    string          `json:"projection"`
		Search        string          `json:"search"`
		Focus         *string         `json:"focus"`
		Hops          *int            `json:"hops"`
		Types         []string        `json:"types"`
		Limit         int             `json:"limit"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	var fixtureStepIDs []string
	if len(input.SourceStepIDs) > 0 {
		if operation != "evaluate" && operation != "policies" {
			writeError(w, 400, "source_step_ids are accepted only for draft evaluate or Policy fixtures")
			return
		}
		if json.Unmarshal(input.SourceStepIDs, &fixtureStepIDs) != nil || fixtureStepIDs == nil || len(fixtureStepIDs) > 100 {
			writeError(w, 400, "source_step_ids must be an array of at most 100 distinct nonempty fixture IDs")
			return
		}
		seen := map[string]bool{}
		for _, fixtureID := range fixtureStepIDs {
			if strings.TrimSpace(fixtureID) == "" || seen[fixtureID] {
				writeError(w, 400, "source_step_ids must be an array of at most 100 distinct nonempty fixture IDs")
				return
			}
			seen[fixtureID] = true
		}
	}
	if operation == "policies" && (strings.TrimSpace(input.ActionID) == "" || len(input.ActionID) > 300 || input.Parameters == nil) {
		writeError(w, 400, "action_id and parameters are required for a draft Policy fixture")
		return
	}
	if operation == "policies" && input.Expected != nil && !semanticPolicyDecision(*input.Expected) {
		writeError(w, 400, "expected_decision must be allow, needs_approval, deny or unknown")
		return
	}
	input.CaseName = strings.TrimSpace(input.CaseName)
	if operation == "policies" && utf8.RuneCountInString(input.CaseName) > 200 {
		writeError(w, 400, "case_name must contain at most two hundred characters")
		return
	}
	var bundle, savedTestData json.RawMessage
	if err := h.DB.QueryRow(r.Context(), "SELECT bundle,test_data FROM semantic_ontology WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, id).Scan(&bundle, &savedTestData); err != nil {
		writeError(w, 404, "ontology not found")
		return
	}
	if len(input.TestData) == 0 {
		input.TestData = savedTestData
	}
	scope := map[string]string{"workspace_id": actor.WorkspaceID, "ontology_id": id, "release_id": "draft:" + id}
	compiled, err := semanticService(r.Context(), "compile", map[string]any{"scope": scope, "bundle": bundle})
	if err != nil {
		writeError(w, 422, err.Error())
		return
	}
	var output struct {
		Artifact json.RawMessage `json:"artifact"`
	}
	if json.Unmarshal(compiled, &output) != nil || len(output.Artifact) == 0 {
		writeError(w, 502, "compiler did not return an artifact")
		return
	}
	policyActionLabel, policyArtifactDigest := "", ""
	if operation == "policies" {
		var artifact struct {
			Manifest struct {
				ArtifactDigest string `json:"artifact_digest"`
			} `json:"manifest"`
			Definition struct {
				Actions []struct {
					ID    string `json:"id"`
					Label string `json:"label"`
				} `json:"actions"`
			} `json:"definition"`
		}
		if json.Unmarshal(output.Artifact, &artifact) != nil {
			writeError(w, 502, "compiler returned an invalid Policy artifact")
			return
		}
		for _, action := range artifact.Definition.Actions {
			if action.ID == input.ActionID {
				policyActionLabel = action.Label
				break
			}
		}
		if strings.TrimSpace(policyActionLabel) == "" {
			writeError(w, 400, "action_id must name an Action in the saved draft")
			return
		}
		policyArtifactDigest = strings.TrimSpace(artifact.Manifest.ArtifactDigest)
		if policyArtifactDigest == "" {
			var canonical any
			if json.Unmarshal(output.Artifact, &canonical) != nil {
				writeError(w, 502, "compiler returned an invalid Policy artifact")
				return
			}
			policyArtifactDigest = semantic.Digest(canonical)
		}
	}
	payload := map[string]any{"scope": scope, "artifact": output.Artifact}
	if operation == "preview" {
		var testData struct {
			Content string `json:"content"`
		}
		_ = json.Unmarshal(input.TestData, &testData)
		if !semanticNativeArtifact(output.Artifact) && (len(input.TestData) == 0 || string(input.TestData) == "null" || strings.TrimSpace(testData.Content) == "") {
			writeJSON(w, 200, map[string]any{"artifact": output.Artifact, "validation": map[string]any{"valid": false, "conforms": false, "incomplete": true, "violations": []any{}}, "incomplete": true})
			return
		}
		payload["data"] = input.TestData
		result, err := semanticService(r.Context(), "validate", payload)
		if err != nil {
			writeError(w, 422, err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"artifact": output.Artifact, "validation": result, "incomplete": false})
		return
	}
	switch operation {
	case "context":
		hops := 2
		if input.Hops != nil {
			hops = *input.Hops
		}
		if strings.TrimSpace(input.Question) == "" || len(input.Question) > 10000 || hops < 0 || hops > 5 || len(input.EntityIDs) > 100 {
			writeError(w, 400, "provide a question, zero to five hops, and at most one hundred entity types")
			return
		}
		if input.EntityIDs == nil {
			input.EntityIDs = []string{}
		}
		payload["question"], payload["entity_ids"], payload["hops"] = input.Question, input.EntityIDs, hops
		operation = "native/context"
	case "query":
		if input.Query == "" {
			writeError(w, 400, "query is required")
			return
		}
		payload["query"] = input.Query
		payload["data"] = input.Data
		payload["limit"] = 100
	case "evaluate":
		payload["data"] = map[string]any{"facts": input.Facts}
		if len(input.SourceStepIDs) > 0 {
			// These are explicit test-evidence labels, not persisted run steps.
			payload["source_step_ids"] = fixtureStepIDs
		}
	case "policies":
		if input.Facts == nil {
			input.Facts = map[string]any{}
		}
		payload["action_id"] = input.ActionID
		payload["parameters"] = input.Parameters
		payload["principal"] = map[string]any{"user_id": actor.UserID, "workspace_role": actor.Role}
		payload["data"] = map[string]any{"facts": input.Facts}
		payload["source_step_ids"] = fixtureStepIDs
		operation = "native/policies"
	case "graph":
		if input.Projection != "" {
			payload["projection"] = input.Projection
		}
		if input.Search != "" {
			payload["search"] = input.Search
		}
		if input.Focus != nil {
			payload["focus"] = input.Focus
		}
		if input.Hops != nil {
			payload["hops"] = input.Hops
		}
		if input.Types != nil {
			payload["types"] = input.Types
		}
		if input.Limit > 0 {
			payload["limit"] = input.Limit
		}
	}
	result, err := semanticService(r.Context(), operation, payload)
	if err != nil {
		writeError(w, 422, err.Error())
		return
	}
	if operation == "native/policies" {
		var policy map[string]any
		if json.Unmarshal(result, &policy) != nil {
			writeError(w, 502, "Policy evaluator returned an invalid result")
			return
		}
		delete(policy, "action_intents")
		actual, _ := policy["decision"].(string)
		if !semanticPolicyDecision(actual) {
			writeError(w, 502, "Policy evaluator returned an invalid decision")
			return
		}
		var passed *bool
		if input.Expected != nil {
			value := *input.Expected == actual
			passed = &value
		}
		caseName := input.CaseName
		if caseName == "" {
			caseName = policyActionLabel
		}
		requestDigest := semantic.Digest(map[string]any{
			"artifact_digest": policyArtifactDigest,
			"action_id":       input.ActionID,
			"case_name":       caseName,
			"parameters":      input.Parameters,
			"facts":           input.Facts,
			"source_step_ids": fixtureStepIDs,
			"principal":       map[string]any{"user_id": actor.UserID, "workspace_role": actor.Role},
		})
		var stored json.RawMessage
		err = h.DB.QueryRow(r.Context(), `WITH saved AS (
            INSERT INTO semantic_draft_policy_test_result(
                workspace_id,ontology_id,artifact_digest,action_id,action_label,case_name,
                expected_decision,actual_decision,passed,engine,fixture,
                request_digest,result,created_by_user_id,created_by_actor_type,
                created_by_actor_id,created_by_task_id
            ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'Semantica native/policies',true,$10,$11,$12,$13,$14,$15)
            RETURNING *
        ) SELECT to_jsonb(saved)-'created_by_user_id'-'created_by_actor_type'-'created_by_actor_id'-'created_by_task_id' FROM saved`,
			actor.WorkspaceID, id, policyArtifactDigest, input.ActionID, policyActionLabel, caseName,
			input.Expected, actual, passed, requestDigest, semanticMarshal(policy),
			actor.UserID, actor.ActorType, actor.ActorID, actor.TaskID).Scan(&stored)
		if err != nil {
			writeError(w, 500, "Policy fixture was evaluated but its result could not be persisted; rerun it before review")
			return
		}
		writeJSON(w, 200, map[string]any{
			"draft":              true,
			"fixture":            true,
			"execution_evidence": false,
			"policy":             policy,
			"test_result":        stored,
		})
		return
	}
	writeJSON(w, 200, result)
}
func (h *Handler) semanticPreviewOntology(w http.ResponseWriter, r *http.Request) {
	h.semanticDraftOperation(w, r, "preview")
}
func (h *Handler) semanticDraftQuery(w http.ResponseWriter, r *http.Request) {
	h.semanticDraftOperation(w, r, "query")
}
func (h *Handler) semanticDraftEvaluate(w http.ResponseWriter, r *http.Request) {
	h.semanticDraftOperation(w, r, "evaluate")
}
func (h *Handler) semanticDraftGraph(w http.ResponseWriter, r *http.Request) {
	h.semanticDraftOperation(w, r, "graph")
}

// Preview natural business questions against the actual draft, without creating
// a released investigation, query evidence, or action authorization.
func (h *Handler) semanticDraftContext(w http.ResponseWriter, r *http.Request) {
	h.semanticDraftOperation(w, r, "context")
}

// Draft Policy fixtures run the production Policy interpreter against the
// saved draft. They do not create a semantic step or an executable intent.
func (h *Handler) semanticDraftPolicies(w http.ResponseWriter, r *http.Request) {
	h.semanticDraftOperation(w, r, "policies")
}

func semanticPolicyDecision(value string) bool {
	switch value {
	case "allow", "needs_approval", "deny", "unknown":
		return true
	default:
		return false
	}
}

func (h *Handler) semanticDraftPolicyTests(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok || !h.semanticDraftPolicyScope(w, r, &actor, id) {
		return
	}
	var currentArtifactDigest string
	if err := h.DB.QueryRow(r.Context(), "SELECT COALESCE(bundle#>>'{native_artifact,manifest,artifact_digest}','') FROM semantic_ontology WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, id).Scan(&currentArtifactDigest); err != nil {
		writeError(w, 404, "ontology not found")
		return
	}
	var results json.RawMessage
	err := h.DB.QueryRow(r.Context(), `SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC),'[]'::jsonb) FROM (
        SELECT to_jsonb(t)-'created_by_user_id'-'created_by_actor_type'-'created_by_actor_id'-'created_by_task_id' AS item,created_at
        FROM semantic_draft_policy_test_result t
        WHERE workspace_id=$1 AND ontology_id=$2
        ORDER BY created_at DESC LIMIT 100
    ) recent`, actor.WorkspaceID, id).Scan(&results)
	if err != nil {
		writeError(w, 500, "failed to load draft Policy test results")
		return
	}
	writeJSON(w, 200, map[string]any{"current_artifact_digest": currentArtifactDigest, "test_results": results})
}

func (h *Handler) semanticDraftPolicyScope(w http.ResponseWriter, r *http.Request, actor *semanticActor, ontologyID string) bool {
	if actor.ActorType != "agent" {
		return true
	}
	if !h.semanticTaskPrincipal(w, r, actor) {
		return false
	}
	var permitted bool
	err := h.DB.QueryRow(r.Context(), `WITH RECURSIVE tree AS (
        SELECT c.issue_id AS id FROM semantic_construction c WHERE c.workspace_id=$1 AND c.ontology_id=$2
        UNION
        SELECT i.id FROM issue i JOIN tree p ON i.parent_issue_id=p.id WHERE i.workspace_id=$1
    ) SELECT EXISTS(
        SELECT 1 FROM agent_task_queue t JOIN tree i ON i.id=t.issue_id
        WHERE t.id=$3 AND t.agent_id=$4 AND t.status='running'
    )`, actor.WorkspaceID, ontologyID, *actor.TaskID, actor.ActorID).Scan(&permitted)
	if err != nil || !permitted {
		writeError(w, 403, "task is outside this ontology's construction Issue family")
		return false
	}
	return true
}
