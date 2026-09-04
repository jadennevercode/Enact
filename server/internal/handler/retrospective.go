package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/service"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/dbid"
	"github.com/enact-ai/enact/server/pkg/protocol"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// A retrospective is one scan by the Lesson Learner over finished work.
//
// Starting one files an issue assigned to the Learner and lets the ordinary
// assignee-triggered flow run it. That is the whole dispatch mechanism: no new
// queue, no new claim path, no second definition of who may make an agent work.
// It also means the scan is visible as work — it has a transcript, a comment
// thread someone can steer it from, and a place for the Learner to report what
// it found and what it decided not to file.

const (
	retrospectiveStatusSuggested = "suggested"
	retrospectiveStatusDismissed = "dismissed"
	retrospectiveStatusQueued    = "queued"
	retrospectiveStatusRunning   = "running"
	retrospectiveStatusCompleted = "completed"
	retrospectiveStatusFailed    = "failed"
)

const (
	retrospectiveScopeIssue     = "issue"
	retrospectiveScopeWorkspace = "workspace"
)

const (
	retrospectiveTriggerSuggestion = "suggestion"
	retrospectiveTriggerManual     = "manual"
	retrospectiveTriggerSchedule   = "schedule"
)

// LessonLearnerSystemKey identifies the workspace's Lesson Learner. Its display
// name is owner-editable, so nothing server-side may key off that. Aliased from
// the provisioner rather than restated, so the two cannot drift into the
// retrospective endpoint looking for an agent nothing creates.
const LessonLearnerSystemKey = service.LessonsLearnerSystemKey

// defaultRetrospectiveWindowDays bounds a workspace scan that did
// not name a window. Long enough to catch a pattern repeating, short enough
// that the Learner is reading work people still remember.
const defaultRetrospectiveWindowDays = 14

const maxRetrospectiveWindowDays = 180

type RetrospectiveResponse struct {
	ID          string  `json:"id"`
	WorkspaceID string  `json:"workspace_id"`
	Status      string  `json:"status"`
	Scope       string  `json:"scope"`
	ScopeID     *string `json:"scope_id"`
	Trigger     string  `json:"trigger"`
	Since       *string `json:"since"`

	IssueID       *string `json:"issue_id"`
	TaskID        *string `json:"task_id"`
	AutopilotID   *string `json:"autopilot_id"`
	RequestedBy   *string `json:"requested_by"`
	DismissedAt   *string `json:"dismissed_at"`
	DismissedBy   *string `json:"dismissed_by"`
	LessonCount   int32   `json:"lesson_count"`
	FailureReason string  `json:"failure_reason"`

	StartedAt   *string `json:"started_at"`
	CompletedAt *string `json:"completed_at"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

func retrospectiveToResponse(r db.Retrospective) RetrospectiveResponse {
	return RetrospectiveResponse{
		ID:            uuidToString(r.ID),
		WorkspaceID:   uuidToString(r.WorkspaceID),
		Status:        r.Status,
		Scope:         r.Scope,
		ScopeID:       uuidToPtr(r.ScopeID),
		Trigger:       r.Trigger,
		Since:         timestampToPtr(r.Since),
		IssueID:       uuidToPtr(r.IssueID),
		TaskID:        uuidToPtr(r.TaskID),
		AutopilotID:   uuidToPtr(r.AutopilotID),
		RequestedBy:   uuidToPtr(r.RequestedBy),
		DismissedAt:   timestampToPtr(r.DismissedAt),
		DismissedBy:   uuidToPtr(r.DismissedBy),
		LessonCount:   r.LessonCount,
		FailureReason: r.FailureReason,
		StartedAt:     timestampToPtr(r.StartedAt),
		CompletedAt:   timestampToPtr(r.CompletedAt),
		CreatedAt:     timestampToString(r.CreatedAt),
		UpdatedAt:     timestampToString(r.UpdatedAt),
	}
}

// --- List / get ---

func (h *Handler) ListRetrospectives(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := h.requireRetrospectiveWorkspace(w, r, "owner", "admin", "member")
	if !ok {
		return
	}

	params := db.ListRetrospectivesByWorkspaceParams{
		WorkspaceID: parseUUID(workspaceID),
		Limit:       int32(clampLimit(r.URL.Query().Get("limit"), defaultLessonPageLen, maxLessonPageLen)),
		Offset:      int32(parseOffset(r.URL.Query().Get("offset"))),
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		if !validRetrospectiveStatus(status) {
			writeError(w, http.StatusBadRequest, "invalid status")
			return
		}
		params.Status = pgtype.Text{String: status, Valid: true}
	}

	rows, err := h.Queries.ListRetrospectivesByWorkspace(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list retrospectives")
		return
	}
	out := make([]RetrospectiveResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, retrospectiveToResponse(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"retrospectives": out})
}

func (h *Handler) GetRetrospective(w http.ResponseWriter, r *http.Request) {
	retro, ok := h.loadRetrospectiveForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	lessons, err := h.Queries.ListLessonsByRetrospective(r.Context(), retro.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list lessons")
		return
	}
	out := make([]LessonResponse, 0, len(lessons))
	for _, l := range lessons {
		out = append(out, lessonToResponse(l))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"retrospective": retrospectiveToResponse(retro),
		"lessons":       out,
	})
}

// GetIssueRetrospective answers the question the issue page asks on every load:
// has this issue been offered a retrospective, and what happened to it. Returns
// null rather than 404 when there is none, because "none" is the normal answer
// and a 404 would make every issue page log an error.
func (h *Handler) GetIssueRetrospective(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := h.requireRetrospectiveWorkspace(w, r, "owner", "admin", "member")
	if !ok {
		return
	}
	issueUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "issueId"), "issue id")
	if !ok {
		return
	}
	retro, err := h.Queries.GetIssueRetrospective(r.Context(), db.GetIssueRetrospectiveParams{
		WorkspaceID: parseUUID(workspaceID),
		ScopeID:     issueUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusOK, map[string]any{"retrospective": nil})
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to read retrospective")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"retrospective": retrospectiveToResponse(retro)})
}

// --- Create / start / dismiss ---

type CreateRetrospectiveRequest struct {
	Scope     string `json:"scope"`
	ScopeID   string `json:"scope_id,omitempty"`
	SinceDays int    `json:"since_days,omitempty"`
}

// CreateRetrospective starts a scan someone asked for. Any workspace member may
// ask: a retrospective only reads finished work and files proposals, and every
// proposal still has to be approved by someone who can change the skill.
func (h *Handler) CreateRetrospective(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := h.requireRetrospectiveWorkspace(w, r, "owner", "admin", "member")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req CreateRetrospectiveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	scope := strings.TrimSpace(req.Scope)
	if scope == "" {
		scope = retrospectiveScopeWorkspace
	}
	if scope != retrospectiveScopeIssue && scope != retrospectiveScopeWorkspace {
		writeError(w, http.StatusBadRequest, "scope must be issue or workspace")
		return
	}

	workspaceUUID := parseUUID(workspaceID)
	var scopeID pgtype.UUID
	if scope != retrospectiveScopeWorkspace {
		if strings.TrimSpace(req.ScopeID) == "" {
			writeError(w, http.StatusBadRequest, "scope_id is required for this scope")
			return
		}
		parsed, ok := parseUUIDOrBadRequest(w, req.ScopeID, "scope id")
		if !ok {
			return
		}
		scopeID = parsed
	}

	var since pgtype.Timestamptz
	if scope != retrospectiveScopeIssue {
		days := req.SinceDays
		if days <= 0 {
			days = defaultRetrospectiveWindowDays
		}
		if days > maxRetrospectiveWindowDays {
			writeError(w, http.StatusBadRequest, "since_days is too large")
			return
		}
		since = pgtype.Timestamptz{Time: time.Now().AddDate(0, 0, -days), Valid: true}
	}

	// One scan at a time. Two concurrent scans read the same window and file
	// the same lessons twice, and the second reviewer has no way to tell which
	// duplicate to keep.
	active, err := h.Queries.CountActiveRetrospectives(r.Context(), workspaceUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check running retrospectives")
		return
	}
	if active > 0 {
		writeError(w, http.StatusConflict, "a retrospective is already running in this workspace")
		return
	}

	// An issue-scoped retrospective reuses the row the suggestion already
	// created, so the "asked once" guarantee is not defeated by pressing the
	// button on an issue that was already offered one.
	var retro db.Retrospective
	if scope == retrospectiveScopeIssue {
		existing, err := h.Queries.GetIssueRetrospective(r.Context(), db.GetIssueRetrospectiveParams{
			WorkspaceID: workspaceUUID,
			ScopeID:     scopeID,
		})
		switch {
		case err == nil:
			if existing.Status != retrospectiveStatusSuggested && existing.Status != retrospectiveStatusDismissed {
				writeError(w, http.StatusConflict, "this issue already has a retrospective")
				return
			}
			retro = existing
		case errors.Is(err, pgx.ErrNoRows):
		default:
			writeError(w, http.StatusInternalServerError, "failed to check retrospective")
			return
		}
	}

	if !retro.ID.Valid {
		created, err := h.Queries.CreateRetrospective(r.Context(), db.CreateRetrospectiveParams{
			WorkspaceID: workspaceUUID,
			Status:      retrospectiveStatusSuggested,
			Scope:       scope,
			ScopeID:     scopeID,
			Trigger:     retrospectiveTriggerManual,
			Since:       since,
			RequestedBy: parseUUID(userID),
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create retrospective: "+err.Error())
			return
		}
		retro = created
	}

	started, status, msg := h.startRetrospective(r.Context(), retro, parseUUID(userID))
	if status != 0 {
		writeError(w, status, msg)
		return
	}

	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	h.publish(protocol.EventRetrospectiveCreated, workspaceID, actorType, actorID,
		map[string]any{"retrospective": retrospectiveToResponse(started)})
	writeJSON(w, http.StatusCreated, map[string]any{"retrospective": retrospectiveToResponse(started)})
}

// StartRetrospective accepts a suggestion the server offered.
func (h *Handler) StartRetrospective(w http.ResponseWriter, r *http.Request) {
	retro, ok := h.loadRetrospectiveForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	if retro.Status != retrospectiveStatusSuggested {
		writeError(w, http.StatusConflict, "this retrospective has already been answered")
		return
	}

	started, status, msg := h.startRetrospective(r.Context(), retro, parseUUID(userID))
	if status != 0 {
		writeError(w, status, msg)
		return
	}

	wsID := uuidToString(started.WorkspaceID)
	actorType, actorID := h.resolveActor(r, userID, wsID)
	h.publish(protocol.EventRetrospectiveUpdated, wsID, actorType, actorID,
		map[string]any{"retrospective": retrospectiveToResponse(started)})
	writeJSON(w, http.StatusOK, map[string]any{"retrospective": retrospectiveToResponse(started)})
}

// DismissRetrospective records that someone was asked and said no. The row
// stays: it is what stops the question being asked again.
func (h *Handler) DismissRetrospective(w http.ResponseWriter, r *http.Request) {
	retro, ok := h.loadRetrospectiveForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	updated, err := h.Queries.DismissRetrospective(r.Context(), db.DismissRetrospectiveParams{
		ID:          retro.ID,
		DismissedBy: parseUUID(userID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusConflict, "this retrospective has already been answered")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to dismiss retrospective")
		return
	}

	wsID := uuidToString(updated.WorkspaceID)
	actorType, actorID := h.resolveActor(r, userID, wsID)
	h.publish(protocol.EventRetrospectiveUpdated, wsID, actorType, actorID,
		map[string]any{"retrospective": retrospectiveToResponse(updated)})
	writeJSON(w, http.StatusOK, map[string]any{"retrospective": retrospectiveToResponse(updated)})
}

// startRetrospective files the issue and enqueues the Learner.
func (h *Handler) startRetrospective(ctx context.Context, retro db.Retrospective, requesterID pgtype.UUID) (db.Retrospective, int, string) {
	learner, err := h.Queries.GetAgentBySystemKey(ctx, db.GetAgentBySystemKeyParams{
		WorkspaceID: retro.WorkspaceID,
		SystemKey:   pgtype.Text{String: LessonLearnerSystemKey, Valid: true},
	})
	if err != nil {
		return db.Retrospective{}, http.StatusFailedDependency,
			"this workspace has no Lesson Learner agent yet"
	}
	if !learner.RuntimeID.Valid {
		return db.Retrospective{}, http.StatusFailedDependency,
			"the Lesson Learner is not bound to a runtime yet"
	}

	title, body := h.retrospectiveBrief(ctx, retro)

	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return db.Retrospective{}, http.StatusInternalServerError, "failed to start transaction"
	}
	defer tx.Rollback(ctx)
	qtx := h.Queries.WithTx(tx)

	number, err := qtx.IncrementIssueCounter(ctx, retro.WorkspaceID)
	if err != nil {
		return db.Retrospective{}, http.StatusInternalServerError, "failed to allocate issue number"
	}
	issue, err := qtx.CreateIssue(ctx, db.CreateIssueParams{
		ID:           dbid.NewV7(),
		WorkspaceID:  retro.WorkspaceID,
		Title:        title,
		Description:  pgtype.Text{String: body, Valid: true},
		Status:       "todo",
		Priority:     "medium",
		AssigneeType: pgtype.Text{String: "agent", Valid: true},
		AssigneeID:   learner.ID,
		CreatorType:  "member",
		CreatorID:    requesterID,
		Number:       int32(number),
		Position:     0,
	})
	if err != nil {
		return db.Retrospective{}, http.StatusInternalServerError, "failed to create retrospective issue: " + err.Error()
	}

	updated, err := qtx.StartRetrospective(ctx, db.StartRetrospectiveParams{
		ID:          retro.ID,
		IssueID:     issue.ID,
		RequestedBy: requesterID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Retrospective{}, http.StatusConflict, "this retrospective has already been answered"
		}
		return db.Retrospective{}, http.StatusInternalServerError, "failed to start retrospective"
	}

	if err := tx.Commit(ctx); err != nil {
		return db.Retrospective{}, http.StatusInternalServerError, "failed to commit retrospective"
	}

	// Enqueue after the commit: the task the Learner claims must be able to read
	// the issue it is about, and a daemon can claim faster than an open
	// transaction settles.
	task, err := h.TaskService.EnqueueTaskForIssue(ctx, issue)
	if err != nil {
		slog.Error("retrospective task enqueue failed",
			"retrospective_id", uuidToString(retro.ID),
			"issue_id", uuidToString(issue.ID), "error", err)
		// The issue exists and is assigned; the run can still be triggered from
		// the issue itself. Reporting success here would be a lie, but failing
		// the request would strand the issue, so the retrospective is marked
		// failed and the reason says where to look.
		if _, ferr := h.Queries.FailRetrospective(ctx, db.FailRetrospectiveParams{
			ID:            updated.ID,
			FailureReason: "could not enqueue the Lesson Learner: " + err.Error(),
		}); ferr != nil {
			slog.Error("retrospective fail write failed", "error", ferr)
		}
		return db.Retrospective{}, http.StatusInternalServerError,
			"created the retrospective issue but could not enqueue the Lesson Learner"
	}

	linked, err := h.Queries.SetRetrospectiveTask(ctx, db.SetRetrospectiveTaskParams{
		ID:     updated.ID,
		TaskID: task.ID,
	})
	if err != nil {
		// Losing the link costs the completion hook its lookup, not the run.
		slog.Warn("retrospective task link failed", "error", err)
		return updated, 0, ""
	}
	return linked, 0, ""
}

// retrospectiveBrief writes what the Learner is being asked to do. It states
// the scope and the standard, and deliberately does not restate how to file a
// lesson: that belongs in the Learner's skill, where it can be changed without
// redeploying the server.
func (h *Handler) retrospectiveBrief(ctx context.Context, retro db.Retrospective) (string, string) {
	var (
		title = "Retrospective: this workspace"
		what  = "all work finished in this workspace"
	)
	switch retro.Scope {
	case retrospectiveScopeIssue:
		if issue, err := h.Queries.GetIssue(ctx, retro.ScopeID); err == nil {
			title = fmt.Sprintf("Retrospective: %s", issue.Title)
			what = fmt.Sprintf("issue #%d (%s)", issue.Number, issue.Title)
		} else {
			title = "Retrospective: one issue"
			what = "one issue"
		}
	}

	var b strings.Builder
	b.WriteString("Review ")
	b.WriteString(what)
	if retro.Since.Valid {
		b.WriteString(", limited to work since ")
		b.WriteString(retro.Since.Time.Format(time.RFC3339))
	}
	b.WriteString(".\n\n")
	b.WriteString("Look for what should change about how the agents in this workspace work: ")
	b.WriteString("the same clarification asked twice, the same check missed twice, rework that keeps landing in one place, ")
	b.WriteString("a practice that plainly saved time and nobody would think of next time.\n\n")
	b.WriteString("File a lesson only for something you saw happen more than once, and only when you can say where it does not apply. ")
	b.WriteString("One occurrence is an anecdote. A rule with no stated boundary cannot be reviewed.\n\n")
	b.WriteString("Report what you filed and what you considered and rejected, as a comment on this issue. ")
	b.WriteString("Finding nothing worth filing is a real and common outcome; say so plainly rather than filing something to have filed something.\n\n")
	b.WriteString("Retrospective id: ")
	b.WriteString(uuidToString(retro.ID))
	b.WriteString("\n")
	return title, b.String()
}

// --- Shared helpers ---

func (h *Handler) requireRetrospectiveWorkspace(w http.ResponseWriter, r *http.Request, roles ...string) (string, bool) {
	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace not specified")
		return "", false
	}
	if _, ok := h.requireWorkspaceRole(w, r, workspaceID, "workspace not found", roles...); !ok {
		return "", false
	}
	return workspaceID, true
}

func (h *Handler) loadRetrospectiveForUser(w http.ResponseWriter, r *http.Request, id string) (db.Retrospective, bool) {
	workspaceID, ok := h.requireRetrospectiveWorkspace(w, r, "owner", "admin", "member")
	if !ok {
		return db.Retrospective{}, false
	}
	retroUUID, ok := parseUUIDOrBadRequest(w, id, "retrospective id")
	if !ok {
		return db.Retrospective{}, false
	}
	retro, err := h.Queries.GetRetrospectiveInWorkspace(r.Context(), db.GetRetrospectiveInWorkspaceParams{
		ID:          retroUUID,
		WorkspaceID: parseUUID(workspaceID),
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "retrospective not found")
		return db.Retrospective{}, false
	}
	return retro, true
}

func validRetrospectiveStatus(status string) bool {
	switch status {
	case retrospectiveStatusSuggested, retrospectiveStatusDismissed, retrospectiveStatusQueued,
		retrospectiveStatusRunning, retrospectiveStatusCompleted, retrospectiveStatusFailed:
		return true
	}
	return false
}
