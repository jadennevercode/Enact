package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/enact-ai/enact/server/internal/service"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (h *Handler) registerSemanticConstructionRoutes(r chi.Router) {
	r.Post("/ontologies/{id}/constructions", h.semanticStartConstruction)
	r.Get("/ontologies/{id}/constructions", h.semanticListConstructions)
	r.Get("/constructions/{id}", h.semanticGetConstruction)
	r.Post("/constructions/{id}/revise", h.semanticReviseConstruction)
	r.Post("/constructions/{id}/events", h.semanticConstructionEvent)
}

func (h *Handler) semanticListConstructions(w http.ResponseWriter, r *http.Request) {
	a, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	h.semanticRows(w, r, `SELECT to_jsonb(c) FROM semantic_construction c WHERE workspace_id=$1 AND ontology_id=$2 ORDER BY created_at DESC`, a.WorkspaceID, id)
}

func (h *Handler) semanticStartConstruction(w http.ResponseWriter, r *http.Request) {
	a, ok := h.semanticScope(w, r, true)
	if !ok {
		return
	}
	ontologyID, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		Title               string          `json:"title"`
		Prompt              string          `json:"prompt"`
		RuntimeID           string          `json:"runtime_id"`
		SourceSnapshotIDs   []string        `json:"source_snapshot_ids"`
		CompetencyQuestions json.RawMessage `json:"competency_questions"`
	}
	if !semanticDecode(w, r, &in) {
		return
	}
	if len(in.SourceSnapshotIDs) == 0 || len(in.SourceSnapshotIDs) > 30 {
		writeError(w, 400, "select between one and thirty knowledge source snapshots")
		return
	}
	if len(in.CompetencyQuestions) == 0 {
		in.CompetencyQuestions = json.RawMessage(`[]`)
	}
	var ontologyName string
	if err := h.DB.QueryRow(r.Context(), `SELECT name FROM semantic_ontology WHERE id=$1 AND workspace_id=$2`, ontologyID, a.WorkspaceID).Scan(&ontologyName); err != nil {
		writeError(w, 404, "ontology not found")
		return
	}
	for _, snapshotID := range in.SourceSnapshotIDs {
		if _, ok := parseUUIDOrBadRequest(w, snapshotID, "source_snapshot_ids"); !ok {
			return
		}
		var exists bool
		if err := h.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM semantic_source_snapshot WHERE id=$1 AND workspace_id=$2 AND principal_id=$3)`, snapshotID, a.WorkspaceID, a.UserID).Scan(&exists); err != nil || !exists {
			writeError(w, 404, "source snapshot not available to this principal")
			return
		}
	}
	var runtimeID string
	if in.RuntimeID != "" {
		if _, ok := parseUUIDOrBadRequest(w, in.RuntimeID, "runtime_id"); !ok {
			return
		}
	}
	err := h.DB.QueryRow(r.Context(), `SELECT id::text FROM agent_runtime WHERE workspace_id=$1 AND owner_id=$2 AND provider IN ('codex','claude') AND status='online' AND ($3='' OR id::text=$3) ORDER BY CASE WHEN provider='codex' THEN 0 ELSE 1 END,last_seen_at DESC LIMIT 1`, a.WorkspaceID, a.UserID, in.RuntimeID).Scan(&runtimeID)
	if err != nil {
		writeError(w, 409, "connect an online Codex or Claude runtime to start the Family")
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "failed to install Ontologizer Family")
		return
	}
	defer tx.Rollback(r.Context())
	if err = service.EnsureOntologizerDefaultsInTx(r.Context(), h.Queries.WithTx(tx), parseUUID(a.WorkspaceID), parseUUID(a.UserID), parseUUID(runtimeID)); err != nil {
		writeError(w, 409, "failed to install Ontologizer Family: "+err.Error())
		return
	}
	var squadID string
	if err = tx.QueryRow(r.Context(), `SELECT id::text FROM squad WHERE workspace_id=$1 AND system_key=$2`, a.WorkspaceID, service.OntologizerSquadSystemKey).Scan(&squadID); err != nil {
		writeError(w, 500, "Ontology Family unavailable")
		return
	}
	if status, message := h.semanticConfigureFamilyModel(r.Context(), tx, a.WorkspaceID, squadID, runtimeID); status != 0 {
		writeError(w, status, message)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		writeError(w, 500, "failed to install Ontologizer Family")
		return
	}
	assigneeType := pgtype.Text{String: "squad", Valid: true}
	assigneeID := parseUUID(squadID)
	if status, msg := h.validateAssigneePair(r.Context(), r, a.WorkspaceID, assigneeType, assigneeID); status != 0 {
		writeError(w, status, msg)
		return
	}
	constructionID := uuid.NewString()
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = "Construct Ontology: " + ontologyName
	}
	prompt := fmt.Sprintf("Construct and review a Semantica-native Ontology through the five-role Ontologizer Family.\n\nConstruction ID: %s\nOntology ID: %s\nSource snapshot IDs: %s\nCompetency questions: %s\n\n%s\n\nRead enact-ontology-authoring and ontologizer:orchestrator. Record scoped construction events, delegate through actual child Issues and the Family roster, and use POST /api/semantic/ontologies/%s/native with source_snapshot_ids. Native RDF/OWL, SHACL, graph, provenance, rules, bindings and validation are the primary delivery. Skill Package is only an explicitly requested compatibility export. Present scope, semantic review and release decisions in the Issue; do not invent human approvals. Never wait synchronously for other Family tasks while occupying a runtime slot: dispatch and yield.", constructionID, ontologyID, semanticMarshal(in.SourceSnapshotIDs), in.CompetencyQuestions, in.Prompt, ontologyID)
	var construction json.RawMessage
	res, err := h.IssueService.Create(r.Context(), service.IssueCreateParams{WorkspaceID: parseUUID(a.WorkspaceID), Title: title, Description: pgtype.Text{String: prompt, Valid: true}, Status: "todo", Priority: "medium", AssigneeType: assigneeType, AssigneeID: assigneeID, CreatorType: a.ActorType, CreatorID: parseUUID(a.ActorID), AllowDuplicate: true}, service.IssueCreateOpts{ActorID: a.ActorID, Platform: "web", PersistRelated: func(ctx context.Context, tx pgx.Tx, issue db.Issue) error {
		err := tx.QueryRow(ctx, `INSERT INTO semantic_construction(id,workspace_id,ontology_id,issue_id,squad_id,created_by,source_snapshot_ids,competency_questions) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING to_jsonb(semantic_construction)`, constructionID, a.WorkspaceID, ontologyID, issue.ID, squadID, a.UserID, semanticMarshal(in.SourceSnapshotIDs), in.CompetencyQuestions).Scan(&construction)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO semantic_construction_event(id,workspace_id,construction_id,actor_type,actor_id,stage,kind,message,data) VALUES($1,$2,$3,$4,$5,'scope','started',$6,$7)`, uuid.NewString(), a.WorkspaceID, constructionID, a.ActorType, a.ActorID, "Ontology construction requested", semanticMarshal(map[string]any{"source_snapshot_ids": in.SourceSnapshotIDs, "runtime_id": runtimeID}))
		return err
	}})
	if err != nil {
		writeError(w, 500, "failed to create construction Issue: "+err.Error())
		return
	}
	writeJSON(w, 201, map[string]any{"construction": construction, "issue": issueToResponse(res.Issue, h.getIssuePrefix(r.Context(), res.Issue.WorkspaceID))})
}

// A product Family with no explicit model must use a model advertised by its
// selected Runtime, rather than inheriting an unrelated host CLI preference.
// Explicit workspace choices remain untouched, including their thinking level.
func (h *Handler) semanticConfigureFamilyModel(ctx context.Context, tx pgx.Tx, workspaceID, squadID, runtimeID string) (int, string) {
	var needsModel bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM agent a JOIN squad_member m ON m.member_id=a.id AND m.member_type='agent' WHERE a.workspace_id=$1 AND m.squad_id=$2 AND a.system_key LIKE 'ontology:%' AND COALESCE(btrim(a.model),'')='')`, workspaceID, squadID).Scan(&needsModel); err != nil {
		return 500, "failed to check Ontologizer model configuration"
	}
	if !needsModel {
		return 0, ""
	}
	catalog := h.cachedModelCatalog(ctx, runtimeID)
	model := semanticDefaultFamilyModel(catalog)
	if model == "" {
		h.revalidateModelCatalog(ctx, runtimeID)
		return 409, "Runtime model discovery requested; retry construction when its model catalog is ready"
	}
	if _, err := tx.Exec(ctx, `UPDATE agent a SET model=$3,updated_at=now() FROM squad_member m WHERE m.member_id=a.id AND m.member_type='agent' AND a.workspace_id=$1 AND m.squad_id=$2 AND a.system_key LIKE 'ontology:%' AND COALESCE(btrim(a.model),'')=''`, workspaceID, squadID, model); err != nil {
		return 500, "failed to configure Ontologizer Runtime model"
	}
	return 0, ""
}

func semanticDefaultFamilyModel(catalog *ModelCatalogSnapshot) string {
	if catalog == nil || !catalog.Supported {
		return ""
	}
	var first string
	for _, model := range catalog.Models {
		id := strings.TrimSpace(model.ID)
		if id == "" {
			continue
		}
		if first == "" {
			first = id
		}
		if model.Default {
			return id
		}
	}
	return first
}

// constructionScope permits only a task on this construction's actual Issue
// tree to write Family progress. Workspace membership alone is insufficient.
func (h *Handler) semanticConstructionScope(w http.ResponseWriter, r *http.Request) (semanticActor, string, string, bool) {
	a, ok := h.semanticScope(w, r, false)
	if !ok {
		return a, "", "", false
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return a, "", "", false
	}
	var issueID string
	if err := h.DB.QueryRow(r.Context(), `SELECT issue_id::text FROM semantic_construction WHERE id=$1 AND workspace_id=$2`, id, a.WorkspaceID).Scan(&issueID); err != nil {
		writeError(w, 404, "construction not found")
		return a, "", "", false
	}
	if a.TaskID != nil {
		if !h.semanticTaskPrincipal(w, r, &a) {
			return a, "", "", false
		}
		var permitted bool
		err := h.DB.QueryRow(r.Context(), `WITH RECURSIVE tree AS (SELECT id FROM issue WHERE id=$1 AND workspace_id=$2 UNION ALL SELECT i.id FROM issue i JOIN tree p ON i.parent_issue_id=p.id WHERE i.workspace_id=$2) SELECT EXISTS(SELECT 1 FROM agent_task_queue t JOIN tree i ON i.id=t.issue_id WHERE t.id=$3 AND t.agent_id=$4 AND t.status='running')`, issueID, a.WorkspaceID, *a.TaskID, a.ActorID).Scan(&permitted)
		if err != nil || !permitted {
			writeError(w, 403, "task is outside this construction Issue family")
			return a, "", "", false
		}
	}
	return a, id, issueID, true
}

func (h *Handler) semanticGetConstruction(w http.ResponseWriter, r *http.Request) {
	a, id, issueID, ok := h.semanticConstructionScope(w, r)
	if !ok {
		return
	}
	var out json.RawMessage
	err := h.DB.QueryRow(r.Context(), `WITH RECURSIVE tree AS (SELECT id FROM issue WHERE id=$3 AND workspace_id=$1 UNION ALL SELECT i.id FROM issue i JOIN tree p ON i.parent_issue_id=p.id WHERE i.workspace_id=$1) SELECT jsonb_build_object('construction',to_jsonb(c),'issue',(SELECT jsonb_build_object('id',i.id,'title',i.title,'status',i.status,'identifier',w.issue_prefix||'-'||i.number) FROM issue i JOIN workspace w ON w.id=i.workspace_id WHERE i.id=c.issue_id),'tasks',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'issue_id',t.issue_id,'agent_id',t.agent_id,'agent_name',a.name,'role',a.system_key,'status',t.status,'started_at',t.started_at,'completed_at',t.completed_at,'error',t.error) ORDER BY t.created_at) FROM agent_task_queue t JOIN tree i ON i.id=t.issue_id JOIN agent a ON a.id=t.agent_id),'[]'::jsonb),'events',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at) FROM semantic_construction_event e WHERE e.construction_id=c.id AND e.workspace_id=c.workspace_id),'[]'::jsonb),'model_operations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'task_id',o.task_id,'status',o.status,'provider',o.provider,'model',o.model,'usage',o.usage,'error',o.error)) FROM semantic_model_operation o JOIN agent_task_queue t ON t.id=o.task_id JOIN tree i ON i.id=t.issue_id WHERE o.workspace_id=$1),'[]'::jsonb)) FROM semantic_construction c WHERE c.id=$2 AND c.workspace_id=$1`, a.WorkspaceID, id, issueID).Scan(&out)
	if err != nil {
		writeError(w, 500, "failed to load construction")
		return
	}
	writeJSON(w, 200, out)
}

type semanticCapturedResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (c *semanticCapturedResponse) Header() http.Header    { return c.header }
func (c *semanticCapturedResponse) WriteHeader(status int) { c.status = status }
func (c *semanticCapturedResponse) Write(b []byte) (int, error) {
	if c.status == 0 {
		c.status = 200
	}
	return c.body.Write(b)
}

func (h *Handler) semanticReviseConstruction(w http.ResponseWriter, r *http.Request) {
	a, id, issueID, ok := h.semanticConstructionScope(w, r)
	if !ok {
		return
	}
	if a.TaskID != nil || isMachineCredentialActor(r) || a.ActorType == "agent" {
		writeError(w, 403, "only a human may record a construction decision")
		return
	}
	var in struct {
		Message  string `json:"message"`
		Decision string `json:"decision"`
		Stage    string `json:"stage"`
	}
	if !semanticDecode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Message) == "" {
		writeError(w, 400, "message is required")
		return
	}
	if in.Decision != "" && in.Decision != "accept" && in.Decision != "revise" {
		writeError(w, 400, "decision must be accept or revise")
		return
	}
	if !semanticConstructionStage(in.Stage) && in.Stage != "" {
		writeError(w, 400, "invalid construction stage")
		return
	}
	if in.Stage == "" {
		if err := h.DB.QueryRow(r.Context(), `SELECT stage FROM semantic_construction WHERE id=$1 AND workspace_id=$2`, id, a.WorkspaceID).Scan(&in.Stage); err != nil {
			writeError(w, 404, "construction not found")
			return
		}
	}
	// Reuse the actual Issue comment handler, including routing, attribution,
	// invocation authorization and task enqueue, with the original auth context.
	commentRequest := r.Clone(r.Context())
	commentRequest.Body = io.NopCloser(bytes.NewReader(semanticMarshal(CreateCommentRequest{Content: fmt.Sprintf("Ontology construction decision (%s, %s):\n\n%s", in.Stage, in.Decision, in.Message), Type: "comment"})))
	route := chi.NewRouteContext()
	route.URLParams.Add("id", issueID)
	commentRequest = commentRequest.WithContext(context.WithValue(commentRequest.Context(), chi.RouteCtxKey, route))
	capture := &semanticCapturedResponse{header: make(http.Header)}
	h.CreateComment(capture, commentRequest)
	if capture.status >= 400 {
		w.WriteHeader(capture.status)
		_, _ = w.Write(capture.body.Bytes())
		return
	}
	var comment map[string]any
	_ = json.Unmarshal(capture.body.Bytes(), &comment)
	_, err := h.DB.Exec(r.Context(), `INSERT INTO semantic_construction_event(id,workspace_id,construction_id,actor_type,actor_id,stage,kind,message,data) VALUES($1,$2,$3,$4,$5,$6,'human_decision',$7,$8)`, uuid.NewString(), a.WorkspaceID, id, a.ActorType, a.ActorID, in.Stage, in.Message, semanticMarshal(map[string]any{"decision": in.Decision, "comment_id": comment["id"]}))
	if err != nil {
		writeError(w, 500, "comment posted but decision event could not be recorded")
		return
	}
	_, err = h.DB.Exec(r.Context(), `UPDATE semantic_construction SET status='active',updated_at=now() WHERE id=$1 AND workspace_id=$2`, id, a.WorkspaceID)
	if err != nil {
		writeError(w, 500, "failed to update construction")
		return
	}
	writeJSON(w, 200, map[string]any{"id": id, "status": "active", "comment": comment})
}

func semanticConstructionStage(stage string) bool {
	switch stage {
	case "scope", "evidence", "model", "review", "release":
		return true
	}
	return false
}
func (h *Handler) semanticConstructionEvent(w http.ResponseWriter, r *http.Request) {
	a, id, _, ok := h.semanticConstructionScope(w, r)
	if !ok {
		return
	}
	if a.TaskID == nil {
		writeError(w, 403, "Family task token required")
		return
	}
	var in struct {
		Stage   string          `json:"stage"`
		Kind    string          `json:"kind"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if !semanticDecode(w, r, &in) {
		return
	}
	if !semanticConstructionStage(in.Stage) {
		writeError(w, 400, "invalid construction stage")
		return
	}
	switch in.Kind {
	case "artifact", "handoff", "review_requested", "validation", "finding":
	default:
		writeError(w, 400, "invalid construction event kind")
		return
	}
	if strings.TrimSpace(in.Message) == "" {
		writeError(w, 400, "message is required")
		return
	}
	if len(in.Data) == 0 {
		in.Data = json.RawMessage(`{}`)
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "failed to record construction event")
		return
	}
	defer tx.Rollback(r.Context())
	var event json.RawMessage
	err = tx.QueryRow(r.Context(), `INSERT INTO semantic_construction_event(id,workspace_id,construction_id,task_id,actor_type,actor_id,stage,kind,message,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING to_jsonb(semantic_construction_event)`, uuid.NewString(), a.WorkspaceID, id, *a.TaskID, a.ActorType, a.ActorID, in.Stage, in.Kind, in.Message, in.Data).Scan(&event)
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE semantic_construction SET stage=$3,status=CASE WHEN $4='review_requested' THEN 'awaiting_review' ELSE 'active' END,updated_at=now() WHERE id=$1 AND workspace_id=$2 AND status<>'completed'`, id, a.WorkspaceID, in.Stage, in.Kind)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, 500, "failed to record construction event")
		return
	}
	writeJSON(w, 201, event)
}
