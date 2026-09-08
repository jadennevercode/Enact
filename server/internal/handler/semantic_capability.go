package handler

import (
	"encoding/json"
	"github.com/enact-ai/enact/server/internal/semanticapp"
	"net/http"
)

// Direct agent/API calls into an application run keep the same capability
// boundary as the iframe gateway; otherwise run.get could expose extra data.
func (h *Handler) semanticRunCapability(w http.ResponseWriter, r *http.Request, actor semanticActor, runID, bindingID string, action bool) bool {
	var appID, buildID *string
	if err := h.DB.QueryRow(r.Context(), "SELECT application_id::text,application_build_id::text FROM semantic_run WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, runID).Scan(&appID, &buildID); err != nil {
		writeError(w, 404, "run not found")
		return false
	}
	if appID == nil {
		return true
	}
	if buildID == nil {
		writeError(w, 409, "application run has no pinned build; create a new run")
		return false
	}
	var raw json.RawMessage
	var manifest semanticapp.Manifest
	if err := h.DB.QueryRow(r.Context(), "SELECT manifest FROM semantic_application_build WHERE workspace_id=$1 AND application_id=$2 AND id=$3", actor.WorkspaceID, *appID, *buildID).Scan(&raw); err != nil || json.Unmarshal(raw, &manifest) != nil {
		writeError(w, 404, "application build not found")
		return false
	}
	allowed := manifest.Queries
	if action {
		allowed = manifest.Actions
	}
	if !applicationAllows(allowed, bindingID) {
		writeError(w, 403, "binding is outside the pinned application capabilities")
		return false
	}
	return true
}
