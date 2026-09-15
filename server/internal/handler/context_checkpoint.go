package handler

import (
	"encoding/json"
	"net/http"

	"github.com/enact-ai/enact/server/pkg/contextstate"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
)

func (h *Handler) currentContextTask(w http.ResponseWriter, r *http.Request) (contextstate.Session, bool) {
	task, ok := h.taskFromRequestHeader(r)
	if !ok || (task.Status != "running" && task.Status != "dispatched") {
		writeError(w, 403, "an active agent task is required")
		return contextstate.Session{}, false
	}
	var session contextstate.Session
	var raw []byte
	err := h.DB.QueryRow(r.Context(), "SELECT to_jsonb(s) FROM agent_context_session s WHERE task_id=$1 AND workspace_id=$2", task.ID, parseUUID(ctxWorkspaceID(r.Context()))).Scan(&raw)
	if err != nil || json.Unmarshal(raw, &session) != nil {
		writeError(w, 404, "context session unavailable")
		return session, false
	}
	return session, true
}
func (h *Handler) GetTaskContext(w http.ResponseWriter, r *http.Request) {
	session, ok := h.currentContextTask(w, r)
	if !ok {
		return
	}
	var raw json.RawMessage
	if err := h.DB.QueryRow(r.Context(), "SELECT envelope FROM agent_context_turn WHERE task_id=$1 AND workspace_id=$2", session.TaskID, session.WorkspaceID).Scan(&raw); err != nil {
		contextError(w, err)
		return
	}
	writeJSON(w, 200, raw)
}
func (h *Handler) SaveTaskCheckpoint(w http.ResponseWriter, r *http.Request) {
	session, ok := h.currentContextTask(w, r)
	if !ok {
		return
	}
	var req contextstate.Checkpoint
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&req) != nil {
		writeError(w, 400, "invalid checkpoint")
		return
	}
	// An execution cannot publish a checkpoint using another task's authority.
	req.SourceTaskID = session.TaskID
	result, err := h.contextService().SaveCheckpoint(r.Context(), session, req)
	if err != nil {
		contextError(w, err)
		return
	}
	h.publishContextChange(session)
	writeJSON(w, 201, result)
}
func (h *Handler) ListContextCheckpoints(w http.ResponseWriter, r *http.Request) {
	kind, id := "issue", r.URL.Query().Get("issue_id")
	if id == "" {
		kind, id = "chat", r.URL.Query().Get("chat_session_id")
	}
	id, ok := h.contextScope(w, r, kind, id)
	if !ok {
		return
	}
	rows, err := h.DB.Query(r.Context(), `SELECT c.body,c.agent_id FROM agent_context_checkpoint c
 JOIN agent_task_queue t ON t.id=c.source_task_id WHERE c.workspace_id=$1 AND c.scope_type=$2 AND c.scope_id=$3 AND t.status='completed'
 ORDER BY c.created_at DESC LIMIT 20`, ctxWorkspaceID(r.Context()), kind, id)
	if err != nil {
		contextError(w, err)
		return
	}
	defer rows.Close()
	checkpoints := []contextstate.Checkpoint{}
	for rows.Next() {
		var body []byte
		var id string
		if rows.Scan(&body, &id) != nil {
			continue
		}
		a, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{ID: parseUUID(id), WorkspaceID: parseUUID(ctxWorkspaceID(r.Context()))})
		if err != nil || !h.canAccessPrivateAgent(r.Context(), a, "member", requestUserID(r), ctxWorkspaceID(r.Context())) {
			continue
		}
		var c contextstate.Checkpoint
		if json.Unmarshal(body, &c) == nil {
			checkpoints = append(checkpoints, c)
		}
	}
	if rows.Err() != nil {
		contextError(w, rows.Err())
		return
	}
	writeJSON(w, 200, map[string]any{"checkpoints": checkpoints})
}
