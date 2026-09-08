package handler

import (
	"encoding/json"
	"net/http"
	"strings"
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
	var input struct {
		TestData      json.RawMessage `json:"test_data"`
		Query         string          `json:"query"`
		Data          json.RawMessage `json:"data"`
		Facts         map[string]any  `json:"facts"`
		SourceStepIDs json.RawMessage `json:"source_step_ids"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	var fixtureStepIDs []string
	if len(input.SourceStepIDs) > 0 {
		if operation != "evaluate" {
			writeError(w, 400, "source_step_ids are accepted only for draft evaluate fixtures")
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
	case "graph":
	}
	result, err := semanticService(r.Context(), operation, payload)
	if err != nil {
		writeError(w, 422, err.Error())
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
