package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func (h *Handler) semanticRuns(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	if actor.ActorType == "agent" {
		writeJSON(w, 200, []any{})
		return
	}
	h.semanticRows(w, r, "SELECT to_jsonb(x) FROM semantic_run x WHERE workspace_id=$1 AND requested_by=$2 ORDER BY created_at DESC LIMIT 100", actor.WorkspaceID, actor.UserID)
}
func (h *Handler) semanticCreateRun(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	if actor.ActorType == "agent" && !h.semanticTaskPrincipal(w, r, &actor) {
		return
	}
	var input struct {
		ReleaseID string  `json:"release_id"`
		Question  string  `json:"question"`
		IssueID   *string `json:"issue_id"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	if _, err := uuid.Parse(input.ReleaseID); err != nil {
		writeError(w, 400, "release_id must be a UUID")
		return
	}
	if _, err := h.semanticLoadRelease(r, actor.WorkspaceID, input.ReleaseID); err != nil {
		writeError(w, 404, err.Error())
		return
	}
	continueOnIssue := false
	if input.IssueID != nil {
		issue, ok := h.loadIssueForUser(w, r, *input.IssueID)
		if !ok {
			return
		}
		if uuidToString(issue.WorkspaceID) != actor.WorkspaceID {
			writeError(w, 404, "issue not found")
			return
		}
		resolved := uuidToString(issue.ID)
		input.IssueID = &resolved
		if actor.ActorType == "agent" {
			if err := h.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM agent_task_queue WHERE id=$1 AND agent_id=$2 AND issue_id=$3 AND originator_user_id=$4)`, actor.TaskID, actor.ActorID, resolved, actor.UserID).Scan(&continueOnIssue); err != nil || !continueOnIssue {
				writeError(w, 403, "an agent may create an Issue investigation only on its assigned task's Issue")
				return
			}
		}
	}
	h.semanticRow(w, r, 201, "INSERT INTO semantic_run(workspace_id,release_id,requested_by,actor_type,question,issue_id,actor_id,task_id,delegated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $9 THEN now() ELSE NULL END) RETURNING to_jsonb(semantic_run)", actor.WorkspaceID, input.ReleaseID, actor.UserID, actor.ActorType, input.Question, input.IssueID, actor.ActorID, actor.TaskID, continueOnIssue)
}

func (h *Handler) semanticGetRun(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	if !h.semanticOwnRun(w, r, &actor, id) {
		return
	}
	var raw json.RawMessage
	err := h.DB.QueryRow(r.Context(), `SELECT to_jsonb(x) || jsonb_build_object(
 'steps',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY created_at) FROM semantic_step s WHERE s.workspace_id=x.workspace_id AND s.run_id=x.id),'[]'::jsonb),
 'approvals',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY created_at) FROM semantic_approval a WHERE a.workspace_id=x.workspace_id AND a.run_id=x.id),'[]'::jsonb),
 'receipts',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY created_at) FROM semantic_receipt p WHERE p.workspace_id=x.workspace_id AND p.run_id=x.id),'[]'::jsonb))
 FROM semantic_run x WHERE workspace_id=$1 AND id=$2 AND requested_by=$3`, actor.WorkspaceID, id, actor.UserID).Scan(&raw)
	var run map[string]any
	if err != nil || json.Unmarshal(raw, &run) != nil {
		writeError(w, 500, "failed to load investigation")
		return
	}
	writeJSON(w, 200, semanticPresentationRun(r.Context(), run))
}

func (h *Handler) semanticRunRelease(r *http.Request, ws, id string) (semanticRelease, error) {
	return h.semanticRunReleaseRecord(r, ws, id, false)
}
func (h *Handler) semanticRunReleaseRecord(r *http.Request, ws, id string, allowRetired bool) (semanticRelease, error) {
	var releaseID string
	if err := h.DB.QueryRow(r.Context(), "SELECT release_id::text FROM semantic_run WHERE workspace_id=$1 AND id=$2", ws, id).Scan(&releaseID); err != nil {
		return semanticRelease{}, errors.New("run not found in this workspace")
	}
	return h.semanticLoadReleaseRecord(r, ws, releaseID, allowRetired)
}

func (h *Handler) semanticStep(w http.ResponseWriter, r *http.Request, actor semanticActor, runID, kind string, input any, execute func() (json.RawMessage, error)) {
	id := uuid.NewString()
	attempt := 1
	var err error
	if resumed, ok := r.Context().Value(semanticResumeKey{}).(semanticResumedStep); ok {
		id = resumed.ID
		attempt = resumed.Attempt
	} else {
		tx, beginErr := h.TxStarter.Begin(r.Context())
		if beginErr != nil {
			writeError(w, 500, "failed to persist execution step")
			return
		}
		defer tx.Rollback(r.Context())
		if err = semanticLockWorkspace(r.Context(), tx, actor.WorkspaceID); err == nil {
			_, err = tx.Exec(r.Context(), "INSERT INTO semantic_step(id,workspace_id,run_id,kind,status,input,actor_id,task_id) VALUES($1,$2,$3,$4,'running',$5,$6,$7)", id, actor.WorkspaceID, runID, kind, semanticMarshal(input), actor.ActorID, actor.TaskID)
		}
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			writeError(w, 500, "failed to persist execution step")
			return
		}
	}
	output, executeErr := execute()
	status := "succeeded"
	message := ""
	if executeErr != nil {
		status = "failed"
		message = executeErr.Error()
	}
	// A disconnected browser must not lose the completed step. This write is
	// independently bounded; the durable step remains resumable if it fails.
	ctx, cancel := semanticPersistContext()
	defer cancel()
	updated, err := h.DB.Exec(ctx, "UPDATE semantic_step SET status=$3,output=$4,error=$5,finished_at=now() WHERE workspace_id=$1 AND id=$2 AND attempt=$6", actor.WorkspaceID, id, status, output, message, attempt)
	if err != nil {
		writeError(w, 500, "execution completed but its step result could not be persisted")
		return
	}
	if updated.RowsAffected() != 1 {
		writeError(w, 409, "step was resumed by a newer attempt; reload its durable result")
		return
	}
	if executeErr != nil {
		writeJSON(w, 422, map[string]any{"error": message, "step_id": id})
		return
	}
	writeJSON(w, 200, map[string]any{"step_id": id, "status": status, "output": output})
}

type semanticResumeKey struct{}
type semanticResumedStep struct {
	ID      string
	Attempt int
}

// Only reads and pure inference are resumable. A possibly dispatched system
// write is recovered through its receipt and independent readback instead.
func (h *Handler) semanticResumeStep(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	runID, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	stepID, ok := semanticParam(w, r, "stepID")
	if !ok {
		return
	}
	if !h.semanticOwnRun(w, r, &actor, runID) {
		return
	}
	var kind string
	var input json.RawMessage
	var attempt int
	err := h.DB.QueryRow(r.Context(), `UPDATE semantic_step SET status='running',attempt=attempt+1,started_at=now(),finished_at=NULL,error='' WHERE workspace_id=$1 AND run_id=$2 AND id=$3 AND kind IN ('data_query','ontology_query','rule_evaluation') AND (status='failed' OR (status='running' AND started_at < now()-interval '90 seconds')) RETURNING kind,input,attempt`, actor.WorkspaceID, runID, stepID).Scan(&kind, &input, &attempt)
	if err != nil {
		writeError(w, 409, "step is complete, still running, or unavailable for this run")
		return
	}
	ctx := context.WithValue(r.Context(), semanticResumeKey{}, semanticResumedStep{ID: stepID, Attempt: attempt})
	route := chi.NewRouteContext()
	route.URLParams.Add("id", runID)
	ctx = context.WithValue(ctx, chi.RouteCtxKey, route)
	next := r.Clone(ctx)
	next.Body = io.NopCloser(bytes.NewReader(input))
	next.ContentLength = int64(len(input))
	if kind == "rule_evaluation" {
		h.semanticEvaluate(w, next)
	} else {
		h.semanticQuery(w, next)
	}
}

func (h *Handler) semanticQuery(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	if !h.semanticOwnRun(w, r, &actor, id) {
		return
	}
	release, err := h.semanticRunRelease(r, actor.WorkspaceID, id)
	if err != nil {
		writeError(w, 404, err.Error())
		return
	}
	var input struct {
		BindingID  string          `json:"binding_id"`
		Parameters map[string]any  `json:"parameters"`
		Query      string          `json:"query"`
		Data       json.RawMessage `json:"data"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	if input.BindingID == "" && input.Query == "" {
		writeError(w, 400, "binding_id or ontology query is required")
		return
	}
	if input.BindingID != "" && input.Query != "" {
		writeError(w, 400, "choose a data binding or ontology query for each step")
		return
	}
	capability := input.BindingID
	if capability == "" {
		capability = "@ontology"
	}
	if !h.semanticRunCapability(w, r, actor, id, capability, false) {
		return
	}
	if input.BindingID != "" {
		binding, err := release.Bindings.Find(input.BindingID, false)
		if err != nil {
			writeError(w, 400, err.Error())
			return
		}
		h.semanticStep(w, r, actor, id, "data_query", input, func() (json.RawMessage, error) {
			c, s, err := h.semanticConnection(r.Context(), actor.WorkspaceID, binding.ConnectionID)
			if err != nil {
				return nil, err
			}
			s, err = semantic.CredentialFor(c, s, actor.UserID, actor.Role, false)
			if err != nil {
				return nil, err
			}
			if len(binding.AllowedRoles) > 0 && !semantic.HasRole(binding.AllowedRoles, actor.Role) && !semanticAnyRole(binding.AllowedRoles, s.Roles) {
				return nil, errors.New("role cannot query this data binding")
			}
			if semanticNativeArtifact(release.Artifact) {
				return h.semanticNativeRead(r, actor, release, id, c, s, binding, input.Parameters)
			}
			return semanticAdapter().Query(r.Context(), c, s, binding, input.Parameters)
		})
		return
	}
	h.semanticStep(w, r, actor, id, "ontology_query", input, func() (json.RawMessage, error) {
		return semanticService(r.Context(), "query", map[string]any{"scope": semanticRunScope(actor, release, id), "artifact": release.Artifact, "query": input.Query, "data": input.Data, "limit": 100})
	})
}

func (h *Handler) semanticEvaluate(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	if !h.semanticOwnRun(w, r, &actor, id) {
		return
	}
	release, err := h.semanticRunRelease(r, actor.WorkspaceID, id)
	if err != nil {
		writeError(w, 404, err.Error())
		return
	}
	var input struct {
		Facts         map[string]any `json:"facts"`
		SourceStepIDs []string       `json:"source_step_ids"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	if len(input.SourceStepIDs) == 0 || len(input.SourceStepIDs) > 100 {
		writeError(w, 400, "source_step_ids must identify between one and 100 successful data queries from this run")
		return
	}
	observations := map[string][]map[string]any{}
	facts := map[string]any{"bindings": map[string]any{}, "steps": map[string]any{}, "binding_step_ids": map[string]any{}, "binding_observations": observations}
	seenSteps := map[string]bool{}
	for _, stepID := range input.SourceStepIDs {
		if _, err := uuid.Parse(stepID); err != nil {
			writeError(w, 400, "invalid source_step_id")
			return
		}
		if seenSteps[stepID] {
			writeError(w, 400, "source_step_ids must not contain duplicate queries")
			return
		}
		seenSteps[stepID] = true
		var request, output json.RawMessage
		if err := h.DB.QueryRow(r.Context(), "SELECT input,output FROM semantic_step WHERE workspace_id=$1 AND run_id=$2 AND id=$3 AND kind='data_query' AND status='succeeded'", actor.WorkspaceID, id, stepID).Scan(&request, &output); err != nil {
			writeError(w, 400, "source step is not a successful query in this run")
			return
		}
		var query struct {
			BindingID  string         `json:"binding_id"`
			Parameters map[string]any `json:"parameters"`
		}
		var value any
		if json.Unmarshal(request, &query) != nil || json.Unmarshal(output, &value) != nil {
			writeError(w, 500, "stored query evidence is invalid")
			return
		}
		facts["bindings"].(map[string]any)[query.BindingID] = value
		facts["binding_step_ids"].(map[string]any)[query.BindingID] = []string{stepID}
		facts["steps"].(map[string]any)[stepID] = value
		observations[query.BindingID] = append(observations[query.BindingID], map[string]any{"step_id": stepID, "parameters": query.Parameters, "output": value})
	}
	h.semanticStep(w, r, actor, id, "rule_evaluation", input, func() (json.RawMessage, error) {
		return semanticService(r.Context(), "evaluate", map[string]any{"scope": semanticRunScope(actor, release, id), "artifact": release.Artifact, "data": map[string]any{"facts": facts}, "source_step_ids": input.SourceStepIDs})
	})
}
func semanticRunScope(actor semanticActor, release semanticRelease, run string) map[string]string {
	return map[string]string{"workspace_id": actor.WorkspaceID, "ontology_id": release.OntologyID, "release_id": release.ID, "run_id": run}
}

// semanticPersistContext keeps receipts durable even when a transport timeout
// or a closed browser cancels the original request.
func semanticPersistContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 10*time.Second)
}
