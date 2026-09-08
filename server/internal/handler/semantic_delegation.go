package handler

import "net/http"

// A task is authenticated as its runtime owner. Business operations use the
// human originator of that task instead, and never inherit runtime-owner roles.
func (h *Handler) semanticTaskPrincipal(w http.ResponseWriter, r *http.Request, actor *semanticActor) bool {
	if actor.TaskID == nil {
		writeError(w, 403, "a task token is required")
		return false
	}
	var principal, role string
	err := h.DB.QueryRow(r.Context(), `SELECT t.originator_user_id::text,m.role FROM agent_task_queue t JOIN member m ON m.user_id=t.originator_user_id AND m.workspace_id=$3 WHERE t.id=$1 AND t.agent_id=$2`, *actor.TaskID, actor.ActorID, actor.WorkspaceID).Scan(&principal, &role)
	if err != nil {
		writeError(w, 403, "task has no authorized human originator in this workspace")
		return false
	}
	actor.UserID = principal
	actor.Role = role
	return true
}

func (h *Handler) semanticDelegateRun(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	if actor.ActorType == "agent" || isMachineCredentialActor(r) {
		writeError(w, 403, "only the human run owner may delegate it")
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	if !h.semanticOwnRun(w, r, &actor, id) {
		return
	}
	var input struct {
		IssueID string `json:"issue_id"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	issue, ok := h.loadIssueForUser(w, r, input.IssueID)
	if !ok {
		return
	}
	if uuidToString(issue.WorkspaceID) != actor.WorkspaceID {
		writeError(w, 404, "issue not found")
		return
	}
	h.semanticRow(w, r, 200, "UPDATE semantic_run SET issue_id=$3,delegated_at=now(),updated_at=now() WHERE workspace_id=$1 AND id=$2 AND requested_by=$4 RETURNING to_jsonb(semantic_run)", actor.WorkspaceID, id, uuidToString(issue.ID), actor.UserID)
}

func (h *Handler) semanticReceiptActor(w http.ResponseWriter, r *http.Request, actor *semanticActor, id string) bool {
	if actor.ActorType != "agent" {
		return true
	}
	var runID string
	if err := h.DB.QueryRow(r.Context(), "SELECT run_id::text FROM semantic_receipt WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, id).Scan(&runID); err != nil {
		writeError(w, 404, "receipt not found")
		return false
	}
	return h.semanticOwnRun(w, r, actor, runID)
}
