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

func (h *Handler) semanticActionConnection(r *http.Request, actor semanticActor, binding semantic.Binding) (semantic.Connection, semantic.Secret, error) {
	c, s, err := h.semanticConnection(r.Context(), actor.WorkspaceID, binding.ConnectionID)
	if err != nil {
		return c, s, err
	}
	if c.Kind != "rest" && c.Kind != "openapi" && c.Kind != "mcp" {
		return c, s, errors.New("actions require a REST, OpenAPI or MCP system operation connection")
	}
	s, err = semantic.CredentialFor(c, s, actor.UserID, actor.Role, true)
	if err != nil {
		return c, s, err
	}
	if len(binding.AllowedRoles) > 0 && !semantic.HasRole(binding.AllowedRoles, actor.Role) && !semanticAnyRole(binding.AllowedRoles, s.Roles) {
		return c, s, errors.New("caller may not execute this binding")
	}
	return c, s, nil
}
func semanticAnyRole(allowed, actual []string) bool {
	for _, role := range actual {
		if semantic.HasRole(allowed, role) {
			return true
		}
	}
	return false
}
func semanticActionDigest(release semanticRelease, binding semantic.Binding, params map[string]any, c semantic.Connection, s semantic.Secret) string {
	return semantic.Digest(map[string]any{"release": release.ID, "binding": binding, "parameters": params, "connection": c, "credential_revision": c.CredentialRevision})
}

func (h *Handler) semanticPrepareAction(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	runID, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	release, err := h.semanticRunRelease(r, actor.WorkspaceID, runID)
	if err != nil {
		writeError(w, 404, err.Error())
		return
	}
	if !h.semanticOwnRun(w, r, &actor, runID) {
		return
	}
	var input struct {
		BindingID        string         `json:"binding_id"`
		Parameters       map[string]any `json:"parameters"`
		EvaluationStepID *string        `json:"evaluation_step_id"`
		IntentID         string         `json:"intent_id"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	if !h.semanticRunCapability(w, r, actor, runID, input.BindingID, true) {
		return
	}
	if actor.ActorType == "agent" && input.EvaluationStepID == nil {
		writeError(w, 400, "agent actions require a persisted evaluation_step_id and intent_id")
		return
	}
	if input.EvaluationStepID != nil {
		if _, ok := parseUUIDOrBadRequest(w, *input.EvaluationStepID, "evaluation_step_id"); !ok {
			return
		}
		var raw json.RawMessage
		if err := h.DB.QueryRow(r.Context(), "SELECT output FROM semantic_step WHERE workspace_id=$1 AND run_id=$2 AND id=$3 AND kind='rule_evaluation' AND status='succeeded'", actor.WorkspaceID, runID, *input.EvaluationStepID).Scan(&raw); err != nil {
			writeError(w, 400, "evaluation step is not successful in this run")
			return
		}
		var result struct {
			Intents []struct {
				ID         string         `json:"intent_id"`
				ActionID   string         `json:"action_id"`
				BindingID  string         `json:"binding_id"`
				Parameters map[string]any `json:"parameters"`
			} `json:"action_intents"`
		}
		if json.Unmarshal(raw, &result) != nil {
			writeError(w, 500, "stored evaluation is invalid")
			return
		}
		found := false
		for _, intent := range result.Intents {
			bindingID := intent.BindingID
			if bindingID == "" {
				bindingID = intent.ActionID
			}
			if intent.ID == input.IntentID && input.IntentID != "" && bindingID == input.BindingID && semantic.Digest(intent.Parameters) == semantic.Digest(input.Parameters) {
				found = true
				break
			}
		}
		if !found {
			writeError(w, 409, "action parameters do not match the persisted intent")
			return
		}
	}
	binding, err := release.Bindings.Find(input.BindingID, true)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	if err = binding.CheckParameters(input.Parameters); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	c, s, err := h.semanticActionConnection(r, actor, binding)
	if err != nil {
		writeError(w, 403, err.Error())
		return
	}
	status := "pending"
	var approvedBy *string
	if binding.Authorization.Mode == "allow" {
		status = "approved"
		approvedBy = &actor.UserID
	}
	if binding.Authorization.Mode == "role" {
		status = "pending"
	}
	if input.Parameters == nil {
		input.Parameters = map[string]any{}
	}
	digest := semanticActionDigest(release, binding, input.Parameters, c, s)
	h.semanticRow(w, r, 201, "INSERT INTO semantic_approval(workspace_id,run_id,binding_id,parameters,digest,status,requested_by,approved_by,expires_at,actor_id,task_id,evaluation_step_id,intent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING to_jsonb(semantic_approval)", actor.WorkspaceID, runID, input.BindingID, semanticMarshal(input.Parameters), digest, status, actor.UserID, approvedBy, time.Now().Add(15*time.Minute), actor.ActorID, actor.TaskID, input.EvaluationStepID, input.IntentID)
}

type semanticApproval struct {
	ID          string
	RunID       string
	BindingID   string
	Parameters  map[string]any
	Digest      string
	Status      string
	RequestedBy string
	ApprovedBy  *string
	ExpiresAt   time.Time
}

func scanSemanticApproval(row pgx.Row) (semanticApproval, error) {
	var a semanticApproval
	var params json.RawMessage
	err := row.Scan(&a.ID, &a.RunID, &a.BindingID, &params, &a.Digest, &a.Status, &a.RequestedBy, &a.ApprovedBy, &a.ExpiresAt)
	if err == nil {
		err = json.Unmarshal(params, &a.Parameters)
	}
	return a, err
}

const semanticApprovalColumns = "id::text,run_id::text,binding_id,parameters,digest,status,requested_by::text,approved_by::text,expires_at"

func (h *Handler) semanticDecide(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	if actor.ActorType == "agent" || isMachineCredentialActor(r) {
		writeError(w, 403, "an action confirmation requires a human decision")
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	var input struct {
		Approve *bool  `json:"approve"`
		Reason  string `json:"reason"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	if input.Approve == nil {
		writeError(w, 400, "approve is required")
		return
	}
	a, err := scanSemanticApproval(h.DB.QueryRow(r.Context(), "SELECT "+semanticApprovalColumns+" FROM semantic_approval WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, id))
	if err != nil {
		writeError(w, 404, "approval not found")
		return
	}
	release, err := h.semanticRunRelease(r, actor.WorkspaceID, a.RunID)
	if err != nil {
		writeError(w, 404, err.Error())
		return
	}
	binding, err := release.Bindings.Find(a.BindingID, true)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	// Confirmation is bound to its requester by default. Explicit business
	// approval roles can delegate that decision without broad workspace grants.
	if len(binding.Authorization.Roles) == 0 {
		if actor.UserID != a.RequestedBy {
			writeError(w, 403, "only the action requester may confirm this operation")
			return
		}
	} else {
		c, s, err := h.semanticConnection(r.Context(), actor.WorkspaceID, binding.ConnectionID)
		if err == nil {
			s, err = semantic.CredentialFor(c, s, actor.UserID, actor.Role, false)
		}
		if err != nil || !semanticAnyRole(binding.Authorization.Roles, s.Roles) {
			writeError(w, 403, "configured business role is required to decide")
			return
		}
	}
	status := "rejected"
	if *input.Approve {
		status = "approved"
	}
	h.semanticRow(w, r, 200, "UPDATE semantic_approval SET status=$3,approved_by=$4,reason=$5,decided_at=now() WHERE workspace_id=$1 AND id=$2 AND status='pending' AND expires_at>now() RETURNING to_jsonb(semantic_approval)", actor.WorkspaceID, id, status, actor.UserID, input.Reason)
}

func (h *Handler) semanticExecute(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 200 {
		writeError(w, 400, "Idempotency-Key is required and must not exceed 200 characters")
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "failed to begin action execution")
		return
	}
	defer tx.Rollback(r.Context())
	if err = semanticLockWorkspace(r.Context(), tx, actor.WorkspaceID); err != nil {
		writeError(w, 404, "workspace not found")
		return
	}
	a, err := scanSemanticApproval(tx.QueryRow(r.Context(), "SELECT "+semanticApprovalColumns+" FROM semantic_approval WHERE workspace_id=$1 AND id=$2 FOR UPDATE", actor.WorkspaceID, id))
	if err != nil {
		writeError(w, 404, "approval not found")
		return
	}
	if actor.ActorType == "agent" && !h.semanticOwnRun(w, r, &actor, a.RunID) {
		return
	}
	if actor.UserID != a.RequestedBy && (a.ApprovedBy == nil || *a.ApprovedBy != actor.UserID) {
		writeError(w, 403, "only the requesting or approving principal may execute this action")
		return
	}
	var existing json.RawMessage
	err = tx.QueryRow(r.Context(), "SELECT to_jsonb(p) FROM semantic_receipt p WHERE workspace_id=$1 AND approval_id=$2", actor.WorkspaceID, id).Scan(&existing)
	if err == nil {
		writeJSON(w, 200, existing)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 500, "failed to load action receipt")
		return
	}
	if a.Status != "approved" || time.Now().After(a.ExpiresAt) {
		writeError(w, 409, "action is not approved or its approval expired")
		return
	}
	release, err := h.semanticRunRelease(r, actor.WorkspaceID, a.RunID)
	if err != nil {
		writeError(w, 404, err.Error())
		return
	}
	binding, err := release.Bindings.Find(a.BindingID, true)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	c, s, err := h.semanticActionConnection(r, actor, binding)
	if err != nil {
		writeError(w, 403, err.Error())
		return
	}
	if semanticActionDigest(release, binding, a.Parameters, c, s) != a.Digest {
		writeError(w, 409, "action configuration or credential changed; prepare and authorize again")
		return
	}
	receiptID := uuid.NewString()
	_, err = tx.Exec(r.Context(), "INSERT INTO semantic_receipt(id,workspace_id,run_id,approval_id,binding_id,idempotency_key,request_digest,status,executed_by,actor_id,task_id) VALUES($1,$2,$3,$4,$5,$6,$7,'executing',$8,$9,$10)", receiptID, actor.WorkspaceID, a.RunID, id, a.BindingID, key, a.Digest, actor.UserID, actor.ActorID, actor.TaskID)
	if err != nil {
		writeError(w, 409, "Idempotency-Key already belongs to another action")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		writeError(w, 500, "could not persist action before dispatch")
		return
	}
	response, httpStatus, callErr := semanticAdapter().Action(r.Context(), c, s, binding, a.Parameters, key)
	status := "succeeded"
	message := ""
	var readback json.RawMessage
	if callErr != nil {
		status = "unknown"
		message = callErr.Error()
		if httpStatus >= 400 && httpStatus < 500 {
			status = "failed"
		}
	} else {
		params := semanticReadbackParameters(a.Parameters, response)
		readback, callErr = semanticAdapter().Readback(r.Context(), c, s, *binding.Readback, params)
		if callErr == nil {
			callErr = semantic.CheckReadback(readback, binding.Readback.Expected, params)
		}
		if callErr != nil {
			status = "unknown"
			message = callErr.Error()
		}
		if httpStatus == http.StatusAccepted {
			status = "unknown"
			message = "system accepted the operation; completion requires reconciliation"
		}
	}
	ctx, cancel := semanticPersistContext()
	defer cancel()
	_, err = h.DB.Exec(ctx, "UPDATE semantic_receipt SET status=$3,response=$4,readback=$5,error=$6,updated_at=now() WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, receiptID, status, response, readback, message)
	if err != nil {
		writeError(w, 500, "system operation was dispatched; reload its durable receipt before retrying")
		return
	}
	if status == "succeeded" {
		_, _ = h.DB.Exec(ctx, "UPDATE semantic_approval SET status='executed' WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, id)
	}
	h.semanticRow(w, r, 200, "SELECT to_jsonb(p) FROM semantic_receipt p WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, receiptID)
}

func semanticReadbackParameters(params map[string]any, response json.RawMessage) map[string]any {
	out := map[string]any{}
	for k, v := range params {
		out[k] = v
	}
	var decoded any
	if json.Unmarshal(response, &decoded) == nil {
		out["response"] = decoded
	}
	return out
}
func (h *Handler) semanticGetReceipt(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	if !h.semanticReceiptActor(w, r, &actor, id) {
		return
	}
	h.semanticRow(w, r, 200, "SELECT to_jsonb(p) FROM semantic_receipt p WHERE workspace_id=$1 AND id=$2 AND executed_by=$3", actor.WorkspaceID, id, actor.UserID)
}

// Reconciliation performs only an independent readback. It never retries a
// possibly successful write. A pending source-system reconciliation is itself
// a separately bound, authorized action, with a new immutable receipt.
func (h *Handler) semanticReconcile(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	if !h.semanticReceiptActor(w, r, &actor, id) {
		return
	}
	var approvalID, status string
	var response json.RawMessage
	if err := h.DB.QueryRow(r.Context(), "SELECT approval_id::text,status,response FROM semantic_receipt WHERE workspace_id=$1 AND id=$2 AND executed_by=$3", actor.WorkspaceID, id, actor.UserID).Scan(&approvalID, &status, &response); err != nil {
		writeError(w, 404, "receipt not found")
		return
	}
	if status == "succeeded" || status == "failed" {
		h.semanticGetReceipt(w, r)
		return
	}
	a, err := scanSemanticApproval(h.DB.QueryRow(r.Context(), "SELECT "+semanticApprovalColumns+" FROM semantic_approval WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, approvalID))
	if err != nil {
		writeError(w, 404, "approval not found")
		return
	}
	release, err := h.semanticRunReleaseRecord(r, actor.WorkspaceID, a.RunID, true)
	if err != nil {
		writeError(w, 404, err.Error())
		return
	}
	binding, err := release.Bindings.Find(a.BindingID, true)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	c, s, err := h.semanticActionConnection(r, actor, binding)
	if err != nil {
		writeError(w, 403, err.Error())
		return
	}
	params := semanticReadbackParameters(a.Parameters, response)
	if semanticActionDigest(release, binding, a.Parameters, c, s) != a.Digest {
		writeError(w, 409, "connection configuration changed; the original operation cannot be verified with a different binding")
		return
	}
	readback, err := semanticAdapter().Readback(r.Context(), c, s, *binding.Readback, params)
	if err == nil {
		err = semantic.CheckReadback(readback, binding.Readback.Expected, params)
	}
	message := ""
	status = "unknown"
	if err != nil {
		message = err.Error()
	} else if len(binding.Readback.Expected) == 0 {
		message = "readback retrieved; explicit completion conditions are required to settle an uncertain operation"
	} else {
		status = "succeeded"
	}
	h.semanticRow(w, r, 200, `WITH settled AS (
 UPDATE semantic_receipt SET status=$3,readback=$4,error=$5,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *
), marked AS (
 UPDATE semantic_approval a SET status='executed' FROM settled s WHERE a.workspace_id=s.workspace_id AND a.id=s.approval_id AND s.status='succeeded'
) SELECT to_jsonb(s) FROM settled s`, actor.WorkspaceID, id, status, readback, message)
}

func (h *Handler) semanticOwnRun(w http.ResponseWriter, r *http.Request, actor *semanticActor, id string) bool {
	var owner string
	var issueID, taskID *string
	var delegated bool
	if err := h.DB.QueryRow(r.Context(), "SELECT requested_by::text,issue_id::text,task_id::text,delegated_at IS NOT NULL FROM semantic_run WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, id).Scan(&owner, &issueID, &taskID, &delegated); err != nil {
		writeError(w, 404, "run not found")
		return false
	}
	if actor.ActorType == "agent" {
		if actor.TaskID == nil {
			writeError(w, 403, "a task token is required to access semantic runs")
			return false
		}
		if taskID == nil || *taskID != *actor.TaskID {
			if !delegated || issueID == nil {
				writeError(w, 404, "run is not delegated to this task")
				return false
			}
			var authorized bool
			if err := h.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM agent_task_queue WHERE id=$1 AND issue_id=$2 AND agent_id=$3 AND originator_user_id=$4)`, *actor.TaskID, *issueID, actor.ActorID, owner).Scan(&authorized); err != nil || !authorized {
				writeError(w, 404, "run is not delegated to this task")
				return false
			}
		}
		var role string
		if err := h.DB.QueryRow(r.Context(), "SELECT role FROM member WHERE workspace_id=$1 AND user_id=$2", actor.WorkspaceID, owner).Scan(&role); err != nil {
			writeError(w, 403, "delegating principal is no longer a workspace member")
			return false
		}
		actor.UserID = owner
		actor.Role = role
	} else if owner != actor.UserID {
		writeError(w, 404, "run not found")
		return false
	}
	return true
}
