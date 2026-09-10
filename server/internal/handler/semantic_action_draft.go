package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func semanticActionBusinessKey(release semanticRelease, binding semantic.Binding, parameters map[string]any) (string, error) {
	target := parameters
	actionID := binding.ActionID
	if actionID == "" {
		actionID = binding.ID
	}
	var artifact struct {
		Definition struct {
			Actions []struct {
				ID                 string   `json:"id"`
				IdentityParameters []string `json:"identity_parameters"`
			} `json:"actions"`
		} `json:"definition"`
	}
	if json.Unmarshal(release.Artifact, &artifact) != nil {
		return "", errors.New("invalid action definition")
	}
	for _, action := range artifact.Definition.Actions {
		if action.ID != binding.ActionID || len(action.IdentityParameters) == 0 {
			continue
		}
		target = map[string]any{}
		for _, key := range action.IdentityParameters {
			value, ok := parameters[key]
			if !ok || value == nil {
				return "", errors.New("business target identity is incomplete")
			}
			target[key] = value
		}
	}
	return semantic.Digest(map[string]any{"action_id": actionID, "connection_id": binding.ConnectionID, "target": target}), nil
}

// Serializing preparation by principal and semantic target prevents concurrent
// evaluations from producing duplicate drafts. A deliberate second draft must
// be a human request and records its reason separately from action parameters.
func (h *Handler) semanticPersistPreparedAction(w http.ResponseWriter, r *http.Request, actor semanticActor, runID string, release semanticRelease, binding semantic.Binding, parameters map[string]any, digest, status string, approvedBy *string, evaluation *string, intent string, createAnother bool, repeatReason string) {
	key, err := semanticActionBusinessKey(release, binding, parameters)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	if createAnother && (actor.ActorType == "agent" || isMachineCredentialActor(r) || strings.TrimSpace(repeatReason) == "" || len(repeatReason) > 2000) {
		writeError(w, 400, "another draft requires a human request with an explicit reason")
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "failed to prepare action")
		return
	}
	defer tx.Rollback(r.Context())
	if err = semanticLockWorkspace(r.Context(), tx, actor.WorkspaceID); err != nil {
		writeError(w, 404, "workspace not found")
		return
	}
	if _, err = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", actor.WorkspaceID+":"+actor.UserID+":"+key); err != nil {
		writeError(w, 500, "failed to lock business target")
		return
	}
	var previous json.RawMessage
	var supersedes *string
	err = tx.QueryRow(r.Context(), `SELECT to_jsonb(a)||jsonb_build_object('receipt', (SELECT to_jsonb(p) FROM semantic_receipt p WHERE p.workspace_id=a.workspace_id AND p.approval_id=a.id LIMIT 1)) FROM semantic_approval a WHERE a.workspace_id=$1 AND a.requested_by=$2 AND (a.business_key=$3 OR (a.business_key IS NULL AND a.digest=$4)) AND a.superseded_by IS NULL AND a.status IN ('pending','approved','executed') ORDER BY a.created_at DESC,a.id DESC LIMIT 1 FOR UPDATE OF a`, actor.WorkspaceID, actor.UserID, key, digest).Scan(&previous)
	if err == nil && !createAnother {
		var record map[string]any
		_ = json.Unmarshal(previous, &record)
		if record["run_id"] != runID || semantic.Digest(record["parameters"]) != semantic.Digest(parameters) {
			writeJSON(w, 409, map[string]any{"error": "a draft already exists for this business target; continue it or explicitly request another with a reason", "existing_draft": map[string]any{"approval_id": record["id"], "run_id": record["run_id"], "status": record["status"]}})
			return
		}
		// A receipt may represent a dispatched operation whose outcome is still
		// unknown. Refreshing its review must never dispatch the operation again.
		expiresText, _ := record["expires_at"].(string)
		expires, _ := time.Parse(time.RFC3339Nano, expiresText)
		evidenceChanged := evaluation != nil && record["evaluation_step_id"] != *evaluation
		refresh := record["receipt"] == nil && record["status"] != "executed" &&
			(evidenceChanged || record["digest"] != digest || expires.IsZero() || !expires.After(time.Now()))
		if !refresh {
			record["resumed"] = true
			record["existing_draft"] = true
			writeJSON(w, 200, record)
			return
		}
		priorID, _ := record["id"].(string)
		supersedes = &priorID
		// Evidence/configuration freshness creates a review version of the same
		// business draft. Preserve the previous decision and require review again.
		status, approvedBy = "pending", nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 500, "failed to inspect existing drafts")
		return
	}
	if createAnother {
		status = "pending"
		approvedBy = nil
	}
	var saved json.RawMessage
	approvalID := uuid.NewString()
	err = tx.QueryRow(r.Context(), `INSERT INTO semantic_approval(id,workspace_id,run_id,binding_id,parameters,digest,status,requested_by,approved_by,expires_at,actor_id,task_id,evaluation_step_id,intent_id,business_key,repeat_reason,supersedes_approval_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING to_jsonb(semantic_approval)`, approvalID, actor.WorkspaceID, runID, binding.ID, semanticMarshal(parameters), digest, status, actor.UserID, approvedBy, time.Now().Add(15*time.Minute), actor.ActorID, actor.TaskID, evaluation, intent, key, strings.TrimSpace(repeatReason), supersedes).Scan(&saved)
	if err == nil && supersedes != nil {
		_, err = tx.Exec(r.Context(), "UPDATE semantic_approval SET superseded_by=$3 WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, *supersedes, approvalID)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, 500, "failed to persist prepared action")
		return
	}
	writeJSON(w, 201, saved)
}
