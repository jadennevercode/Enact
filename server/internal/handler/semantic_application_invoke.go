package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/enact-ai/enact/server/internal/semanticapp"
	"github.com/go-chi/chi/v5"
)

// The bridge chooses operations, not URLs. Release and capability scope are
// resolved again on the server, even if the iframe bypasses the frontend SDK.
func (h *Handler) invokeSemanticApplication(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	if actor.ActorType == "agent" && !h.semanticTaskPrincipal(w, r, &actor) {
		return
	}
	appID := chi.URLParam(r, "appID")
	if _, ok := parseUUIDOrBadRequest(w, appID, "application id"); !ok {
		return
	}
	var request struct {
		BuildID   string         `json:"build_id"`
		Operation string         `json:"operation"`
		Input     map[string]any `json:"input"`
	}
	if !semanticDecode(w, r, &request) {
		return
	}
	if _, ok := parseUUIDOrBadRequest(w, request.BuildID, "build_id"); !ok {
		return
	}
	app, err := scanSemanticApplication(h.DB.QueryRow(r.Context(), applicationSelect+` WHERE workspace_id=$1 AND id=$2`, actor.WorkspaceID, appID))
	if err != nil {
		writeError(w, 404, "application not found")
		return
	}
	var raw json.RawMessage
	var author string
	err = h.DB.QueryRow(r.Context(), `SELECT manifest,created_by::text FROM semantic_application_build WHERE workspace_id=$1 AND application_id=$2 AND id=$3`, actor.WorkspaceID, appID, request.BuildID).Scan(&raw, &author)
	if err != nil {
		writeError(w, 404, "application build not found")
		return
	}
	if (app.PublishedBuildID == nil || *app.PublishedBuildID != request.BuildID) && author != actor.UserID && !roleAllowed(actor.Role, "owner", "admin") {
		writeError(w, 403, "this build is not published")
		return
	}
	var manifest semanticapp.Manifest
	if json.Unmarshal(raw, &manifest) != nil {
		writeError(w, 500, "invalid application manifest")
		return
	}
	if manifest.OntologyReleaseID != app.OntologyReleaseID {
		writeError(w, 409, "application release mismatch")
		return
	}
	input := request.Input
	if input == nil {
		input = map[string]any{}
	}
	if request.Operation == "context" {
		release, err := h.semanticLoadRelease(r, actor.WorkspaceID, app.OntologyReleaseID)
		if err != nil {
			writeError(w, 404, "ontology release not available")
			return
		}
		writeJSON(w, 200, map[string]any{"application": app, "manifest": manifest, "release": release.Artifact, "bindings": release.Bindings, "user_id": actor.UserID, "requested_run_id": input["requested_run_id"]})
		return
	}
	if request.Operation == "run.attach" {
		runID, _ := input["run_id"].(string)
		if _, ok := parseUUIDOrBadRequest(w, runID, "run_id"); !ok {
			return
		}
		if !h.semanticOwnRun(w, r, &actor, runID) {
			return
		}
		var releaseID string
		if err := h.DB.QueryRow(r.Context(), `SELECT release_id::text FROM semantic_run WHERE workspace_id=$1 AND id=$2 AND requested_by=$3`, actor.WorkspaceID, runID, actor.UserID).Scan(&releaseID); err != nil || releaseID != app.OntologyReleaseID {
			writeError(w, 409, "investigation and application must use the same ontology release")
			return
		}
		_, err := h.DB.Exec(r.Context(), `INSERT INTO semantic_run_presentation(workspace_id,run_id,application_id,application_build_id,principal_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, actor.WorkspaceID, runID, appID, request.BuildID, actor.UserID)
		if err != nil {
			writeError(w, 500, "failed to attach investigation")
			return
		}
		writeJSON(w, 200, map[string]any{"id": runID, "run_id": runID, "release_id": releaseID, "application_id": appID, "application_build_id": request.BuildID})
		return
	}
	if request.Operation == "run.create" {
		if _, err := h.semanticLoadRelease(r, actor.WorkspaceID, app.OntologyReleaseID); err != nil {
			writeError(w, 409, "ontology release is not available")
			return
		}
		question, _ := input["question"].(string)
		h.semanticRow(w, r, 201, `INSERT INTO semantic_run(workspace_id,release_id,requested_by,actor_type,question,application_id,application_build_id,actor_id,task_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING to_jsonb(semantic_run)`, actor.WorkspaceID, app.OntologyReleaseID, actor.UserID, actor.ActorType, question, appID, request.BuildID, actor.ActorID, actor.TaskID)
		return
	}
	if request.Operation == "run.list" {
		h.semanticRows(w, r, `SELECT to_jsonb(run) FROM semantic_run run WHERE workspace_id=$1 AND requested_by=$3 AND ((application_id=$2 AND application_build_id=$4) OR EXISTS(SELECT 1 FROM semantic_run_presentation p WHERE p.workspace_id=run.workspace_id AND p.run_id=run.id AND p.application_id=$2 AND p.application_build_id=$4 AND p.principal_id=$3)) ORDER BY created_at DESC LIMIT 100`, actor.WorkspaceID, appID, actor.UserID, request.BuildID)
		return
	}
	objectID := ""
	runID, _ := input["run_id"].(string)
	bindingID, _ := input["binding_id"].(string)
	var handler http.HandlerFunc
	switch request.Operation {
	case "run.get":
		handler = h.semanticGetRun
		objectID = runID
	case "run.trace":
		handler = h.semanticRunTrace
		objectID = runID
	case "query":
		if !applicationAllows(manifest.Queries, bindingID) {
			writeError(w, 403, "query is outside the application capabilities")
			return
		}
		if bindingID == "@ontology" {
			delete(input, "binding_id")
		} else {
			delete(input, "query")
			delete(input, "data")
		}
		handler = h.semanticQuery
		objectID = runID
	case "evaluate":
		if !h.semanticPresentationEvaluation(w, r, actor, runID, input, manifest) {
			return
		}
		handler = h.semanticEvaluate
		objectID = runID
	case "action.prepare":
		if !applicationAllows(manifest.Actions, bindingID) {
			writeError(w, 403, "action is outside the application capabilities")
			return
		}
		handler = h.semanticPrepareAction
		objectID = runID
	case "approval.get", "approval.decide", "action.execute":
		objectID, _ = input["approval_id"].(string)
		if _, ok := parseUUIDOrBadRequest(w, objectID, "approval_id"); !ok {
			return
		}
		err = h.DB.QueryRow(r.Context(), `SELECT run_id::text,binding_id FROM semantic_approval WHERE workspace_id=$1 AND id=$2`, actor.WorkspaceID, objectID).Scan(&runID, &bindingID)
		if err != nil || !applicationAllows(manifest.Actions, bindingID) {
			writeError(w, 404, "application approval not found")
			return
		}
		if request.Operation == "approval.get" {
			handler = func(w http.ResponseWriter, r *http.Request) {
				h.semanticRow(w, r, 200, "SELECT to_jsonb(a) FROM semantic_approval a WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, objectID)
			}
		} else if request.Operation == "approval.decide" {
			handler = h.semanticDecide
		} else {
			handler = h.semanticExecute
			r.Header.Set("Idempotency-Key", "app-approval-"+objectID)
		}
	case "receipt.get", "receipt.reconcile":
		objectID, _ = input["receipt_id"].(string)
		if _, ok := parseUUIDOrBadRequest(w, objectID, "receipt_id"); !ok {
			return
		}
		err = h.DB.QueryRow(r.Context(), `SELECT run_id::text,binding_id FROM semantic_receipt WHERE workspace_id=$1 AND id=$2`, actor.WorkspaceID, objectID).Scan(&runID, &bindingID)
		if err != nil || !applicationAllows(manifest.Actions, bindingID) {
			writeError(w, 404, "application receipt not found")
			return
		}
		if request.Operation == "receipt.get" {
			handler = h.semanticGetReceipt
		} else {
			handler = h.semanticReconcile
		}
	default:
		writeError(w, 400, "unsupported application operation")
		return
	}
	if _, ok := parseUUIDOrBadRequest(w, runID, "run_id"); !ok {
		return
	}
	var belongs bool
	if err := h.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM semantic_run x WHERE workspace_id=$1 AND id=$2 AND release_id=$4 AND requested_by=$5 AND ((application_id=$3 AND application_build_id=$6) OR EXISTS(SELECT 1 FROM semantic_run_presentation p WHERE p.workspace_id=x.workspace_id AND p.run_id=x.id AND p.application_id=$3 AND p.application_build_id=$6 AND p.principal_id=$5)))`, actor.WorkspaceID, runID, appID, app.OntologyReleaseID, actor.UserID, request.BuildID).Scan(&belongs); err != nil || !belongs {
		writeError(w, 404, "run not found for this application and user")
		return
	}
	collection, visibleID := "", objectID
	switch request.Operation {
	case "approval.get", "approval.decide", "action.execute":
		collection = "approvals"
	case "receipt.get", "receipt.reconcile":
		collection = "receipts"
	case "action.prepare":
		if evaluation, exists := input["evaluation_step_id"]; exists && evaluation != nil {
			visibleID, _ = evaluation.(string)
			if _, ok := parseUUIDOrBadRequest(w, visibleID, "evaluation_step_id"); !ok {
				return
			}
			collection = "steps"
		}
	}
	if collection != "" && !h.semanticPresentationObject(w, r, actor, runID, collection, visibleID, manifest) {
		return
	}
	delete(input, "run_id")
	delete(input, "approval_id")
	delete(input, "receipt_id")
	body, err := json.Marshal(input)
	if err != nil {
		writeError(w, 400, "invalid application input")
		return
	}
	next := r.Clone(context.WithValue(r.Context(), semanticPresentationKey{}, manifest))
	next.Body = io.NopCloser(bytes.NewReader(body))
	next.ContentLength = int64(len(body))
	route := chi.NewRouteContext()
	route.URLParams.Add("id", objectID)
	next = next.WithContext(context.WithValue(next.Context(), chi.RouteCtxKey, route))
	handler(w, next)
}

// Object endpoints must use the same projection as run.get. An allowed action
// can still contain evidence from queries that this particular Site cannot see.
func (h *Handler) semanticPresentationObject(w http.ResponseWriter, r *http.Request, actor semanticActor, runID, collection, objectID string, manifest semanticapp.Manifest) bool {
	var raw json.RawMessage
	err := h.DB.QueryRow(r.Context(), `SELECT jsonb_build_object(
 'steps',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY created_at,id) FROM semantic_step s WHERE s.workspace_id=x.workspace_id AND s.run_id=x.id),'[]'::jsonb),
 'approvals',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY created_at,id) FROM semantic_approval a WHERE a.workspace_id=x.workspace_id AND a.run_id=x.id),'[]'::jsonb),
 'receipts',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY created_at,id) FROM semantic_receipt p WHERE p.workspace_id=x.workspace_id AND p.run_id=x.id),'[]'::jsonb))
 FROM semantic_run x WHERE workspace_id=$1 AND id=$2 AND requested_by=$3`, actor.WorkspaceID, runID, actor.UserID).Scan(&raw)
	var run map[string]any
	if err != nil || json.Unmarshal(raw, &run) != nil {
		writeError(w, 500, "failed to load application evidence")
		return false
	}
	projected := semanticPresentationRun(context.WithValue(r.Context(), semanticPresentationKey{}, manifest), run)
	objects, _ := projected[collection].([]any)
	for _, rawObject := range objects {
		if object, ok := rawObject.(map[string]any); ok && object["id"] == objectID {
			return true
		}
	}
	writeError(w, 404, "evidence not found for this application")
	return false
}

func applicationAllows(ids []string, id string) bool {
	for _, allowed := range ids {
		if id != "" && id == allowed {
			return true
		}
	}
	return false
}
