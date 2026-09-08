package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/google/uuid"
)

func (h *Handler) semanticNativeOntology(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticSourceActor(w, r, false)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	var input struct {
		SourceSnapshotIDs   []string         `json:"source_snapshot_ids"`
		Ontology            map[string]any   `json:"ontology"`
		Extractions         map[string]any   `json:"extractions"`
		Rules               []map[string]any `json:"rules"`
		CompetencyQuestions []map[string]any `json:"competency_questions"`
		ReviewDecisions     []map[string]any `json:"review_decisions"`
		Extraction          map[string]any   `json:"extraction"`
		Data                map[string]any   `json:"data"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	var before, bindingConfig json.RawMessage
	if err := h.DB.QueryRow(r.Context(), `SELECT bundle,binding_config FROM semantic_ontology WHERE workspace_id=$1 AND id=$2`, actor.WorkspaceID, id).Scan(&before, &bindingConfig); err != nil {
		writeError(w, 404, "ontology not found")
		return
	}
	var prior struct {
		SourceSnapshotIDs []string `json:"source_snapshot_ids"`
		Artifact          struct {
			Ontology  map[string]any   `json:"native_ontology"`
			Graph     map[string]any   `json:"knowledge_graph"`
			Rules     []map[string]any `json:"native_rules"`
			Questions []map[string]any `json:"competency_questions"`
		} `json:"native_artifact"`
	}
	_ = json.Unmarshal(before, &prior)
	if input.SourceSnapshotIDs == nil {
		input.SourceSnapshotIDs = prior.SourceSnapshotIDs
	}
	if input.Ontology == nil {
		input.Ontology = prior.Artifact.Ontology
	}
	usesModelResults := input.Extraction["mode"] == "runtime" || input.Extraction["mode"] == "replay"
	if usesModelResults && input.Extractions != nil {
		writeError(w, 400, "runtime and replay extraction must omit provided extractions")
		return
	}
	if input.Extractions == nil && !usesModelResults {
		input.Extractions = prior.Artifact.Graph
	}
	if input.Rules == nil {
		input.Rules = prior.Artifact.Rules
	}
	if input.CompetencyQuestions == nil {
		input.CompetencyQuestions = prior.Artifact.Questions
	}
	if len(input.SourceSnapshotIDs) == 0 || len(input.SourceSnapshotIDs) > 30 {
		writeError(w, 400, "select between one and thirty source snapshots")
		return
	}
	if input.Rules == nil {
		input.Rules = []map[string]any{}
	}
	if input.CompetencyQuestions == nil {
		input.CompetencyQuestions = []map[string]any{}
	}
	if input.ReviewDecisions == nil {
		input.ReviewDecisions = []map[string]any{}
	}
	documents := []map[string]any{}
	for _, snapshotID := range input.SourceSnapshotIDs {
		if _, err := uuid.Parse(snapshotID); err != nil {
			writeError(w, 400, "invalid source snapshot ID")
			return
		}
		var raw json.RawMessage
		err := h.DB.QueryRow(r.Context(), `SELECT s.documents FROM semantic_source_snapshot s JOIN semantic_connection c ON c.id=s.connection_id AND c.workspace_id=s.workspace_id WHERE s.workspace_id=$1 AND s.id=$2 AND s.principal_id=$3 AND c.enabled`, actor.WorkspaceID, snapshotID, actor.UserID).Scan(&raw)
		if err != nil {
			writeError(w, 404, "source snapshot is not accessible to the current business user")
			return
		}
		var batch []map[string]any
		if json.Unmarshal(raw, &batch) != nil {
			writeError(w, 500, "source snapshot contains invalid documents")
			return
		}
		for _, document := range batch {
			metadata, _ := document["metadata"].(map[string]any)
			if metadata == nil {
				metadata = map[string]any{}
			}
			metadata["snapshot_id"] = snapshotID
			document["metadata"] = metadata
		}
		documents = append(documents, batch...)
	}
	if input.Extraction == nil {
		input.Extraction = map[string]any{"mode": "provided"}
	}
	if input.Extraction["mode"] == "runtime" {
		if actor.TaskID == nil {
			writeError(w, 400, "runtime extraction must run in an assigned Family task")
			return
		}
		serverURL := strings.TrimRight(os.Getenv("ENACT_SEMANTIC_MODEL_API_URL"), "/")
		if serverURL == "" {
			writeError(w, 503, "semantic model callback URL is not configured")
			return
		}
		selection, err := semanticNativeExtractionSelection(input.Extraction)
		if err != nil {
			writeError(w, 400, err.Error())
			return
		}
		input.Extraction = selection
		input.Extraction["mode"] = "runtime"
		input.Extraction["server_url"] = serverURL
		input.Extraction["task_token"] = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		input.Extraction["operation_id"] = uuid.NewString()
	} else if input.Extraction["mode"] == "replay" {
		selection, err := semanticNativeExtractionSelection(input.Extraction)
		if err != nil {
			writeError(w, 400, err.Error())
			return
		}
		operations, ok := h.semanticNativeReplayOperations(w, r, actor, input.Extraction["model_operation_ids"])
		if !ok {
			return
		}
		input.Extraction = selection
		input.Extraction["mode"] = "replay"
		input.Extraction["replay_operations"] = operations
	} else {
		input.Extraction = map[string]any{"mode": "provided"}
	}
	var bindings semantic.Bindings
	if json.Unmarshal(bindingConfig, &bindings) != nil {
		writeError(w, 400, "saved bindings are invalid")
		return
	}
	allBindings := semanticNativeBindings(bindings)
	payload := map[string]any{
		"scope":   map[string]string{"workspace_id": actor.WorkspaceID, "ontology_id": id, "release_id": "draft:" + id},
		"sources": documents, "ontology": input.Ontology, "extractions": input.Extractions,
		"rules": input.Rules, "competency_questions": input.CompetencyQuestions, "review_decisions": input.ReviewDecisions,
		"extraction": input.Extraction, "bindings": allBindings,
	}
	if input.Data != nil {
		payload["data"] = input.Data
	}
	for key, value := range payload {
		if value == nil {
			delete(payload, key)
		}
	}
	if input.Ontology == nil {
		delete(payload, "ontology")
	}
	if input.Extractions == nil {
		delete(payload, "extractions")
	}
	raw, err := semanticService(r.Context(), "native/pipeline", payload)
	if err != nil {
		h.semanticNativeFailure(w, r, actor, id, err)
		return
	}
	var output struct {
		Artifact       map[string]any  `json:"artifact"`
		Stages         json.RawMessage `json:"stages"`
		Findings       json.RawMessage `json:"findings"`
		ReviewRequired bool            `json:"review_required"`
		Graph          json.RawMessage `json:"graph"`
	}
	if json.Unmarshal(raw, &output) != nil || output.Artifact == nil {
		writeError(w, 502, "native pipeline returned no artifact")
		return
	}
	if len(output.Stages) == 0 {
		output.Stages = json.RawMessage(`[]`)
	}
	if len(output.Findings) == 0 {
		output.Findings = json.RawMessage(`[]`)
	}
	var nextBundle map[string]any
	_ = json.Unmarshal(before, &nextBundle)
	if nextBundle == nil {
		nextBundle = map[string]any{}
	}
	nextBundle["native_artifact"] = output.Artifact
	nextBundle["source_snapshot_ids"] = input.SourceSnapshotIDs
	bundle := semanticMarshal(nextBundle)
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "failed to save native ontology")
		return
	}
	defer tx.Rollback(r.Context())
	if err = semanticLockWorkspace(r.Context(), tx, actor.WorkspaceID); err != nil {
		writeError(w, 404, "workspace not found")
		return
	}
	var current, currentBindings json.RawMessage
	if err = tx.QueryRow(r.Context(), `SELECT bundle,binding_config FROM semantic_ontology WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, actor.WorkspaceID, id).Scan(&current, &currentBindings); err != nil {
		writeError(w, 404, "ontology not found")
		return
	}
	if semantic.Digest(before) != semantic.Digest(current) || semantic.Digest(bindingConfig) != semantic.Digest(currentBindings) {
		writeError(w, 409, "ontology or bindings changed while the pipeline was running; review the newer draft")
		return
	}
	var saved json.RawMessage
	err = tx.QueryRow(r.Context(), `UPDATE semantic_ontology SET bundle=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING to_jsonb(semantic_ontology)`, actor.WorkspaceID, id, bundle).Scan(&saved)
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO semantic_ontology_revision(workspace_id,ontology_id,digest,artifact,stages,findings,source_snapshot_ids,review_required,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, actor.WorkspaceID, id, semantic.Digest(output.Artifact), semanticMarshal(output.Artifact), output.Stages, output.Findings, semanticMarshal(input.SourceSnapshotIDs), output.ReviewRequired, actor.UserID)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, 500, "failed to persist native ontology revision")
		return
	}
	writeJSON(w, 200, map[string]any{"ontology": saved, "artifact": output.Artifact, "stages": output.Stages, "findings": output.Findings, "review_required": output.ReviewRequired, "graph": output.Graph})
}

// Keep caller-selected extraction scope while replacing all callback credentials
// and addresses with the assigned task's server-controlled values.
func semanticNativeExtractionSelection(input map[string]any) (map[string]any, error) {
	result := map[string]any{}
	for _, key := range []string{"source_ids", "chunk_ids"} {
		value, exists := input[key]
		if !exists {
			continue
		}
		items, ok := value.([]any)
		if !ok || len(items) == 0 || len(items) > 2000 {
			return nil, fmt.Errorf("%s must contain between one and 2000 IDs", key)
		}
		ids := make([]string, 0, len(items))
		for _, item := range items {
			id, ok := item.(string)
			if !ok || strings.TrimSpace(id) == "" || len(id) > 1024 {
				return nil, fmt.Errorf("%s contains an invalid ID", key)
			}
			ids = append(ids, id)
		}
		result[key] = ids
	}
	if value, exists := input["max_model_operations"]; exists {
		budget, ok := value.(float64)
		if !ok || budget < 1 || budget > 2000 || budget != float64(int(budget)) {
			return nil, fmt.Errorf("max_model_operations must be an integer between one and 2000")
		}
		result["max_model_operations"] = int(budget)
	}
	return result, nil
}

func semanticNativeBindings(bindings semantic.Bindings) []semantic.Binding {
	all := make([]semantic.Binding, 0, len(bindings.Data)+len(bindings.Actions))
	for _, binding := range bindings.Data {
		binding.Kind = "data"
		all = append(all, binding)
	}
	for _, binding := range bindings.Actions {
		binding.Kind = "action"
		all = append(all, binding)
	}
	return all
}

func (h *Handler) semanticOntologyRevisions(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	h.semanticRows(w, r, `SELECT to_jsonb(v) FROM semantic_ontology_revision v WHERE workspace_id=$1 AND ontology_id=$2 ORDER BY created_at DESC LIMIT 50`, actor.WorkspaceID, id)
}
