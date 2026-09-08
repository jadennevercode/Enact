package handler

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
)

// Replay reads trusted, completed outputs instead of charging for the same model
// request again. The native provider also requires an exact prompt/schema match.
func (h *Handler) semanticNativeReplayOperations(w http.ResponseWriter, r *http.Request, actor semanticActor, value any) ([]map[string]any, bool) {
	items, ok := value.([]any)
	if !ok || len(items) == 0 || len(items) > 100 {
		writeError(w, 400, "model_operation_ids must select between one and 100 completed operations")
		return nil, false
	}
	ids, seen := make([]string, 0, len(items)), map[string]bool{}
	for _, item := range items {
		id, ok := item.(string)
		parsed, err := uuid.Parse(id)
		if !ok || err != nil || seen[parsed.String()] {
			writeError(w, 400, "model_operation_ids must contain distinct UUIDs")
			return nil, false
		}
		seen[parsed.String()] = true
		ids = append(ids, parsed.String())
	}
	rows, err := h.DB.Query(r.Context(), `SELECT id::text,prompt,response_schema,result FROM semantic_model_operation WHERE workspace_id=$1 AND principal_id=$2 AND status='completed' AND id=ANY($3::uuid[]) AND ($4::uuid IS NULL OR (task_id=$4 AND agent_id=$5))`, actor.WorkspaceID, actor.UserID, ids, actor.TaskID, actor.ActorID)
	if err != nil {
		writeError(w, 500, "failed to load completed model operations")
		return nil, false
	}
	defer rows.Close()
	operations := []map[string]any{}
	for rows.Next() {
		var id, prompt string
		var schema, result json.RawMessage
		if err := rows.Scan(&id, &prompt, &schema, &result); err != nil {
			writeError(w, 500, "failed to read completed model operation")
			return nil, false
		}
		operations = append(operations, map[string]any{"id": id, "prompt": prompt, "response_schema": schema, "result": result})
	}
	if rows.Err() != nil {
		writeError(w, 500, "failed to read completed model operations")
		return nil, false
	}
	if len(operations) != len(ids) {
		writeError(w, 404, "completed model operations are not accessible to this user and task")
		return nil, false
	}
	return operations, true
}
