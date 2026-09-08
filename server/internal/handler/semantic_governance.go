package handler

import (
	"context"
	"github.com/jackc/pgx/v5"
	"net/http"
)

func semanticLockWorkspace(ctx context.Context, tx pgx.Tx, ws string) error {
	var id string
	return tx.QueryRow(ctx, "SELECT id::text FROM workspace WHERE id=$1 FOR SHARE", ws).Scan(&id)
}

func (h *Handler) semanticDisableConnection(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, true)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	h.semanticRow(w, r, 200, "UPDATE semantic_connection SET enabled=false WHERE workspace_id=$1 AND id=$2 RETURNING to_jsonb(semantic_connection)-'secret'-'created_by'", actor.WorkspaceID, id)
}
func (h *Handler) semanticRetireRelease(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, true)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	h.semanticRow(w, r, 200, "UPDATE semantic_release SET retired_at=COALESCE(retired_at,now()),retired_by=COALESCE(retired_by,$3),retirement_reason=CASE WHEN retired_at IS NULL THEN $4 ELSE retirement_reason END WHERE workspace_id=$1 AND id=$2 RETURNING to_jsonb(semantic_release)", actor.WorkspaceID, id, actor.UserID, input.Reason)
}
