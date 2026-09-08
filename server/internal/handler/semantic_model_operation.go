package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/enact-ai/enact/server/internal/middleware"
	"github.com/enact-ai/enact/server/internal/modeloperation"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// RegisterSemanticFamilyRoutes is mounted inside the authenticated semantic
// route group. Runtime callbacks also recheck the registered runtime owner.
func (h *Handler) RegisterSemanticFamilyRoutes(r chi.Router) {
	r.Post("/model-operations", h.semanticCreateModelOperation)
	r.Get("/model-operations/{id}", h.semanticGetModelOperation)
	h.registerSemanticConstructionRoutes(r)
}

// RegisterSemanticModelRuntimeRoutes is mounted inside /api/daemon with the
// existing DaemonAuth middleware, accepting registered machine tokens or PATs.
func (h *Handler) RegisterSemanticModelRuntimeRoutes(r chi.Router) {
	r.Post("/runtimes/{runtimeID}/model-operations/claim", h.semanticClaimModelOperation)
	r.Post("/runtimes/{runtimeID}/model-operations/{id}/result", h.semanticReportModelOperation)
}

func (h *Handler) semanticCreateModelOperation(w http.ResponseWriter, r *http.Request) {
	a, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	if !h.semanticTaskPrincipal(w, r, &a) {
		return
	}
	var in struct {
		OperationID    string          `json:"operation_id"`
		Prompt         string          `json:"prompt"`
		ResponseSchema json.RawMessage `json:"response_schema"`
		TimeoutSeconds int             `json:"timeout_seconds"`
	}
	if !semanticDecode(w, r, &in) {
		return
	}
	if _, ok := parseUUIDOrBadRequest(w, in.OperationID, "operation_id"); !ok {
		return
	}
	if strings.TrimSpace(in.Prompt) == "" || len(in.Prompt) > 2<<20 {
		writeError(w, 400, "prompt must contain between 1 byte and 2 MiB")
		return
	}
	if in.TimeoutSeconds == 0 {
		in.TimeoutSeconds = 180
	}
	if in.TimeoutSeconds < 10 || in.TimeoutSeconds > 600 {
		writeError(w, 400, "timeout_seconds must be between 10 and 600")
		return
	}
	if len(in.ResponseSchema) == 0 {
		in.ResponseSchema = json.RawMessage(`{"type":"object"}`)
	}
	if _, err := modeloperation.CompileSchema(in.ResponseSchema); err != nil {
		writeError(w, 400, "invalid response_schema: "+err.Error())
		return
	}
	var runtimeID, provider, model string
	err := h.DB.QueryRow(r.Context(), `SELECT t.runtime_id::text, rt.provider, COALESCE(NULLIF(t.context->>'model',''),a.model,'') FROM agent_task_queue t JOIN agent a ON a.id=t.agent_id JOIN agent_runtime rt ON rt.id=t.runtime_id AND rt.workspace_id=a.workspace_id WHERE t.id=$1 AND t.agent_id=$2 AND a.workspace_id=$3 AND t.status='running'`, *a.TaskID, a.ActorID, a.WorkspaceID).Scan(&runtimeID, &provider, &model)
	if err != nil {
		writeError(w, 409, "an active task on a registered runtime is required")
		return
	}
	if provider != "codex" && provider != "claude" {
		writeError(w, 422, "runtime does not support structured model operations")
		return
	}
	digest := sha256.Sum256(semanticMarshal(in))
	hash := hex.EncodeToString(digest[:])
	var existing json.RawMessage
	var oldHash string
	if err := h.DB.QueryRow(r.Context(), `SELECT to_jsonb(o)-'prompt'-'lease_token',request_hash FROM semantic_model_operation o WHERE id=$1 AND workspace_id=$2 AND task_id=$3`, in.OperationID, a.WorkspaceID, *a.TaskID).Scan(&existing, &oldHash); err == nil {
		if oldHash != hash {
			writeError(w, 409, "operation_id already names a different request")
			return
		}
		writeJSON(w, 200, existing)
		return
	}
	// Expiration never requeues an uncertain invocation. The caller can see
	// the failed record and deliberately create a fresh operation if needed.
	_, err = h.DB.Exec(r.Context(), `UPDATE semantic_model_operation SET status='failed',error='model operation expired; execution outcome may be unknown',completed_at=now() WHERE workspace_id=$1 AND task_id=$2 AND status IN ('pending','running') AND expires_at<now()`, a.WorkspaceID, *a.TaskID)
	if err != nil {
		writeError(w, 500, "failed to expire model operations")
		return
	}
	var out json.RawMessage
	err = h.DB.QueryRow(r.Context(), `INSERT INTO semantic_model_operation(id,workspace_id,task_id,agent_id,principal_id,runtime_id,provider,model,request_hash,prompt,response_schema,timeout_seconds,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+($12+30)*interval '1 second') ON CONFLICT DO NOTHING RETURNING to_jsonb(semantic_model_operation)-'prompt'-'lease_token'`, in.OperationID, a.WorkspaceID, *a.TaskID, a.ActorID, a.UserID, runtimeID, provider, model, hash, in.Prompt, in.ResponseSchema, in.TimeoutSeconds).Scan(&out)
	if err != nil {
		writeError(w, 409, "this task already has an active model operation")
		return
	}
	writeJSON(w, 202, out)
}

func (h *Handler) semanticGetModelOperation(w http.ResponseWriter, r *http.Request) {
	a, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	if !h.semanticTaskPrincipal(w, r, &a) {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	_, err := h.DB.Exec(r.Context(), `UPDATE semantic_model_operation o SET status=CASE WHEN o.expires_at<now() THEN 'failed' ELSE 'cancelled' END,error='parent task ended or operation expired',completed_at=now() WHERE o.id=$1 AND o.workspace_id=$2 AND o.task_id=$3 AND o.status IN ('pending','running') AND (o.expires_at<now() OR NOT EXISTS(SELECT 1 FROM agent_task_queue t WHERE t.id=o.task_id AND t.status='running'))`, id, a.WorkspaceID, *a.TaskID)
	if err != nil {
		writeError(w, 500, "failed to refresh model operation")
		return
	}
	h.semanticRow(w, r, 200, `SELECT to_jsonb(o)-'prompt'-'lease_token' FROM semantic_model_operation o WHERE o.id=$1 AND o.workspace_id=$2 AND o.task_id=$3 AND o.principal_id=$4`, id, a.WorkspaceID, *a.TaskID, a.UserID)
}

func (h *Handler) semanticModelRuntime(w http.ResponseWriter, r *http.Request) (string, bool) {
	if r.Header.Get("X-Actor-Source") == "task_token" || isMachineCredentialActor(r) {
		writeError(w, 403, "runtime callback requires daemon authentication")
		return "", false
	}
	rt, ok := h.requireDaemonRuntimeAccess(w, r, chi.URLParam(r, "runtimeID"))
	if !ok {
		return "", false
	}
	if daemonID := middleware.DaemonIDFromContext(r.Context()); daemonID != "" {
		if daemonID != rt.DaemonID.String {
			writeError(w, 403, "runtime belongs to another daemon")
			return "", false
		}
	} else if uuidToString(rt.OwnerID) != requestUserID(r) {
		writeError(w, 403, "runtime owner authentication required")
		return "", false
	}
	return uuidToString(rt.ID), true
}

func (h *Handler) semanticClaimModelOperation(w http.ResponseWriter, r *http.Request) {
	runtimeID, ok := h.semanticModelRuntime(w, r)
	if !ok {
		return
	}
	_, cleanupErr := h.DB.Exec(r.Context(), `UPDATE semantic_model_operation o SET status=CASE WHEN expires_at<now() THEN 'failed' ELSE 'cancelled' END,error='parent task ended or operation expired',completed_at=now() WHERE runtime_id=$1 AND status IN ('pending','running') AND (expires_at<now() OR NOT EXISTS(SELECT 1 FROM agent_task_queue t WHERE t.id=o.task_id AND t.status='running'))`, runtimeID)
	if cleanupErr != nil {
		writeError(w, 500, "failed to expire model operations")
		return
	}
	var out json.RawMessage
	err := h.DB.QueryRow(r.Context(), `WITH candidate AS (SELECT o.id FROM semantic_model_operation o JOIN agent_task_queue t ON t.id=o.task_id AND t.runtime_id=o.runtime_id JOIN member m ON m.workspace_id=o.workspace_id AND m.user_id=o.principal_id WHERE o.runtime_id=$1 AND o.status='pending' AND o.expires_at>now() AND t.status='running' ORDER BY o.created_at FOR UPDATE OF o SKIP LOCKED LIMIT 1) UPDATE semantic_model_operation o SET status='running',started_at=now(),lease_token=$2 FROM candidate c WHERE o.id=c.id RETURNING to_jsonb(o)`, runtimeID, uuid.NewString()).Scan(&out)
	if isNotFound(err) {
		writeJSON(w, 200, map[string]any{"operation": nil})
		return
	}
	if err != nil {
		writeError(w, 500, "failed to claim model operation")
		return
	}
	writeJSON(w, 200, map[string]any{"operation": out})
}

func (h *Handler) semanticReportModelOperation(w http.ResponseWriter, r *http.Request) {
	runtimeID, ok := h.semanticModelRuntime(w, r)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		LeaseToken string          `json:"lease_token"`
		Status     string          `json:"status"`
		Result     json.RawMessage `json:"result"`
		Usage      json.RawMessage `json:"usage"`
		Error      string          `json:"error"`
	}
	if !semanticDecode(w, r, &in) {
		return
	}
	if _, ok := parseUUIDOrBadRequest(w, in.LeaseToken, "lease_token"); !ok {
		return
	}
	if in.Status != "completed" && in.Status != "failed" && in.Status != "cancelled" {
		writeError(w, 400, "invalid terminal status")
		return
	}
	var schema json.RawMessage
	var status string
	err := h.DB.QueryRow(r.Context(), `SELECT response_schema,status FROM semantic_model_operation WHERE id=$1 AND runtime_id=$2 AND lease_token=$3`, id, runtimeID, in.LeaseToken).Scan(&schema, &status)
	if err != nil {
		writeError(w, 404, "model operation not found")
		return
	}
	if status != "running" {
		writeJSON(w, 200, map[string]any{"id": id, "status": status})
		return
	}
	if in.Status == "completed" {
		if err := modeloperation.ValidateResult(schema, in.Result); err != nil {
			in.Status = "failed"
			in.Error = "structured output validation failed: " + err.Error()
			in.Result = nil
		}
	}
	if len(in.Error) > 4096 {
		in.Error = in.Error[:4096]
	}
	if len(in.Usage) == 0 {
		in.Usage = json.RawMessage(`{}`)
	}
	var out json.RawMessage
	err = h.DB.QueryRow(r.Context(), `UPDATE semantic_model_operation o SET status=CASE WHEN expires_at<now() OR NOT EXISTS(SELECT 1 FROM agent_task_queue t WHERE t.id=o.task_id AND t.status='running') THEN 'cancelled' ELSE $4 END,result=$5,usage=$6,error=$7,completed_at=now() WHERE id=$1 AND runtime_id=$2 AND lease_token=$3 AND status='running' RETURNING to_jsonb(o)-'prompt'-'lease_token'`, id, runtimeID, in.LeaseToken, in.Status, in.Result, in.Usage, in.Error).Scan(&out)
	if err != nil {
		writeError(w, 409, "model operation already ended")
		return
	}
	writeJSON(w, 200, out)
}
