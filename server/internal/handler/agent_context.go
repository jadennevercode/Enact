package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/enact-ai/enact/server/internal/featureflags"
	"github.com/enact-ai/enact/server/internal/service"
	"github.com/enact-ai/enact/server/pkg/agent"
	"github.com/enact-ai/enact/server/pkg/contextstate"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func (h *Handler) contextService() *service.AgentContextService {
	return &service.AgentContextService{DB: h.DB, Begin: h.TxStarter.Begin}
}

func contextError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrContextBusy):
		writeError(w, http.StatusLocked, "context session is busy")
	case errors.Is(err, service.ErrContextStale):
		writeError(w, http.StatusConflict, "context session changed")
	case errors.Is(err, service.ErrContextUnsupported):
		writeError(w, http.StatusUnprocessableEntity, "native compaction is not supported")
	case errors.Is(err, pgx.ErrNoRows):
		writeError(w, http.StatusNotFound, "context session not found")
	default:
		slog.Error("agent context request failed", "error", err)
		writeError(w, http.StatusInternalServerError, "context operation failed")
	}
}

func (h *Handler) contextScope(w http.ResponseWriter, r *http.Request, kind, id string) (string, bool) {
	switch kind {
	case "issue":
		issue, ok := h.loadIssueForUser(w, r, id)
		return uuidToString(issue.ID), ok
	case "chat":
		user, ok := requireUserID(w, r)
		if !ok {
			return "", false
		}
		chat, ok := h.gateChatSessionForUser(w, r, user, ctxWorkspaceID(r.Context()), id)
		return uuidToString(chat.ID), ok
	default:
		writeError(w, http.StatusBadRequest, "specify exactly one issue_id or chat_session_id")
		return "", false
	}
}

func (h *Handler) contextAgentAllowed(r *http.Request, s contextstate.Session, user string, invoke bool) bool {
	a, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{ID: parseUUID(s.AgentID), WorkspaceID: parseUUID(s.WorkspaceID)})
	if err != nil || a.ArchivedAt.Valid {
		return false
	}
	if invoke {
		return h.canInvokeAgent(r.Context(), a, "member", user, user, s.WorkspaceID)
	}
	return h.canAccessPrivateAgent(r.Context(), a, "member", user, s.WorkspaceID)
}

func (h *Handler) ListContextSessions(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUserID(w, r)
	if !ok {
		return
	}
	issue, chat := r.URL.Query().Get("issue_id"), r.URL.Query().Get("chat_session_id")
	kind, id := "issue", issue
	if (issue == "") == (chat == "") {
		writeError(w, http.StatusBadRequest, "specify exactly one scope")
		return
	}
	if chat != "" {
		kind, id = "chat", chat
	}
	id, ok = h.contextScope(w, r, kind, id)
	if !ok {
		return
	}
	sessions, err := h.contextService().List(r.Context(), ctxWorkspaceID(r.Context()), kind, id)
	if err != nil {
		contextError(w, err)
		return
	}
	if !h.FeatureFlags.IsEnabled(r.Context(), featureflags.AgentContextTelemetry, true) {
		sessions = nil
	}
	visible := make([]contextstate.Session, 0, len(sessions))
	for _, session := range sessions {
		if h.contextAgentAllowed(r, session, user, false) {
			if !h.contextAgentAllowed(r, session, user, true) || !h.FeatureFlags.IsEnabled(r.Context(), featureflags.AgentContextCompaction, true) {
				session.Capabilities.NativeCompact = false
			}
			visible = append(visible, session)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": visible})
}

func (h *Handler) userContextSession(w http.ResponseWriter, r *http.Request, id string, invoke bool) (contextstate.Session, bool) {
	user, ok := requireUserID(w, r)
	if !ok {
		return contextstate.Session{}, false
	}
	parsed, ok := parseUUIDOrBadRequest(w, id, "context session id")
	if !ok {
		return contextstate.Session{}, false
	}
	session, err := h.contextService().Session(r.Context(), uuidToString(parsed))
	if err != nil {
		contextError(w, err)
		return session, false
	}
	if session.WorkspaceID != ctxWorkspaceID(r.Context()) {
		writeError(w, http.StatusNotFound, "context session not found")
		return session, false
	}
	if _, ok = h.contextScope(w, r, session.ScopeType, session.ScopeID); !ok {
		return session, false
	}
	if !h.contextAgentAllowed(r, session, user, invoke) {
		writeError(w, http.StatusForbidden, "agent access denied")
		return session, false
	}
	return session, true
}

func (h *Handler) CreateContextCompaction(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(r.Header.Get("X-Task-ID")) != "" {
		writeError(w, http.StatusForbidden, "compaction requires a human request")
		return
	}
	session, ok := h.userContextSession(w, r, chi.URLParam(r, "id"), true)
	if !ok {
		return
	}
	if !h.FeatureFlags.IsEnabled(r.Context(), featureflags.AgentContextCompaction, true) {
		contextError(w, service.ErrContextUnsupported)
		return
	}
	var req struct {
		Generation int64  `json:"expected_generation"`
		Key        string `json:"idempotency_key"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req) != nil || req.Generation <= 0 || len(req.Key) < 8 || len(req.Key) > 128 {
		writeError(w, http.StatusBadRequest, "expected_generation and idempotency_key are required")
		return
	}
	op, err := h.contextService().CreateOperation(r.Context(), session.ID, requestUserID(r), req.Key, req.Generation)
	if err != nil {
		contextError(w, err)
		return
	}
	h.publishContextChange(session)
	h.requestDaemonPendingWork(session.RuntimeID, "context")
	writeJSON(w, http.StatusAccepted, op)
}

func (h *Handler) GetContextOperation(w http.ResponseWriter, r *http.Request) {
	op, ok := h.userContextOperation(w, r, false)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, op)
}

func (h *Handler) userContextOperation(w http.ResponseWriter, r *http.Request, invoke bool) (contextstate.Operation, bool) {
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "operation id")
	if !ok {
		return contextstate.Operation{}, false
	}
	op, err := h.contextService().Operation(r.Context(), uuidToString(id))
	if err != nil {
		contextError(w, err)
		return op, false
	}
	_, ok = h.userContextSession(w, r, op.SessionID, invoke)
	return op, ok
}

func (h *Handler) CancelContextOperation(w http.ResponseWriter, r *http.Request) {
	op, ok := h.userContextOperation(w, r, true)
	if !ok {
		return
	}
	op, err := h.contextService().CancelOperation(r.Context(), op.ID)
	if err != nil {
		contextError(w, err)
		return
	}
	if session, err := h.contextService().Session(r.Context(), op.SessionID); err == nil {
		h.publishContextChange(session)
	}
	writeJSON(w, http.StatusOK, op)
}

func (h *Handler) BeginTaskContext(w http.ResponseWriter, r *http.Request) {
	task, workspace, ok := h.requireDaemonTaskAccessWithWorkspace(w, r, chi.URLParam(r, "taskId"))
	if !ok {
		return
	}
	if !task.RuntimeID.Valid || (task.Status != "dispatched" && task.Status != "running" && task.Status != "waiting_local_directory") {
		writeError(w, http.StatusConflict, "task is not executable")
		return
	}
	rt, ok := h.requireDaemonRuntimeAccess(w, r, uuidToString(task.RuntimeID))
	if !ok {
		return
	}
	var req contextstate.TurnRequest
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req) != nil {
		writeError(w, http.StatusBadRequest, "invalid context capabilities")
		return
	}
	if _, ok = parseUUIDOrBadRequest(w, req.ProducerID, "producer id"); !ok {
		return
	}
	kind, scope := "issue", uuidToString(task.IssueID)
	if task.ChatSessionID.Valid {
		kind, scope = "chat", uuidToString(task.ChatSessionID)
	}
	if scope == "" {
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}
	// Native maintenance is enabled only for a vendor adapter on this runtime.
	allowed := agent.RuntimeContextCapabilities(rt.Provider, !rt.ProfileID.Valid, req.Capabilities.RuntimeVersion)
	req.Capabilities.NativeCompact = req.Capabilities.NativeCompact && allowed.NativeCompact
	req.Capabilities.CompletionSignal = req.Capabilities.CompletionSignal && allowed.CompletionSignal
	result, err := h.contextService().BeginTurn(r.Context(), contextstate.Session{
		ProducerID: req.ProducerID, WorkspaceID: workspace, AgentID: uuidToString(task.AgentID), ScopeType: kind, ScopeID: scope,
		RuntimeID: uuidToString(rt.ID), Provider: rt.Provider, TaskID: uuidToString(task.ID), Capabilities: req.Capabilities,
	})
	if err != nil {
		contextError(w, err)
		return
	}
	envelopes := h.contextService()
	envelopes.CanReadCheckpoint = func(ctx context.Context, sourceAgent string) bool {
		origin := uuidToString(task.OriginatorUserID)
		if origin == "" {
			return false
		}
		a, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{ID: parseUUID(sourceAgent), WorkspaceID: parseUUID(workspace)})
		if err != nil {
			return false
		}
		return h.canAccessPrivateAgent(ctx, a, "member", origin, workspace)
	}
	req.FinalDelivery = req.FinalDelivery && h.FeatureFlags.IsEnabled(r.Context(), featureflags.AgentFinalDelivery, true)
	result.Envelope, err = envelopes.BuildContextEnvelope(r.Context(), result, req.FinalDelivery)
	if err != nil {
		// Envelope enhancement failure never prevents ordinary execution.
		slog.Warn("context envelope unavailable", "task_id", result.TaskID, "error", err)
	} else {
		result.FinalDelivery, err = h.Queries.UsesFinalDelivery(r.Context(), task.ID)
		if err != nil {
			contextError(w, err)
			return
		}
	}
	if !h.FeatureFlags.IsEnabled(r.Context(), featureflags.AgentContextEnvelope, true) {
		result.Envelope = nil
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) UpdateContextSession(w http.ResponseWriter, r *http.Request) {
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "context session id")
	if !ok {
		return
	}
	session, err := h.contextService().Session(r.Context(), uuidToString(id))
	if err != nil {
		contextError(w, err)
		return
	}
	if _, ok = h.requireDaemonRuntimeAccess(w, r, session.RuntimeID); !ok {
		return
	}
	var req contextstate.Update
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 32768)).Decode(&req) != nil || req.EventSeq < 0 || req.PeakTokens < 0 {
		writeError(w, http.StatusBadRequest, "invalid context update")
		return
	}
	if _, ok = parseUUIDOrBadRequest(w, req.LeaseToken, "lease token"); !ok {
		return
	}
	if req.Snapshot != nil && (req.Snapshot.UsedTokens != nil && *req.Snapshot.UsedTokens < 0) {
		writeError(w, http.StatusBadRequest, "invalid token count")
		return
	}
	result, err := h.contextService().Update(r.Context(), session.ID, req)
	if err != nil {
		contextError(w, err)
		return
	}
	if req.Snapshot != nil || req.Release {
		h.publishContextChange(result)
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) ClaimContextMaintenance(w http.ResponseWriter, r *http.Request) {
	rt, ok := h.requireDaemonRuntimeAccess(w, r, chi.URLParam(r, "runtimeId"))
	if !ok {
		return
	}
	session, err := h.contextService().ClaimMaintenance(r.Context(), uuidToString(rt.ID))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && session.ID == "") {
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}
	if err != nil {
		contextError(w, err)
		return
	}
	// Permission can change while a request is queued. The actor remains the
	// original human, not the daemon or the current task's originator.
	authorized := h.contextAgentAllowed(r, session, session.Operation.ActorID, true) && agent.NativeContextCapabilities(rt.Provider, !rt.ProfileID.Valid).NativeCompact
	if _, err := h.getWorkspaceMember(r.Context(), session.Operation.ActorID, session.WorkspaceID); err != nil {
		authorized = false
	}
	if session.ScopeType == "issue" {
		if _, err := h.Queries.GetIssueInWorkspace(r.Context(), db.GetIssueInWorkspaceParams{ID: parseUUID(session.ScopeID), WorkspaceID: parseUUID(session.WorkspaceID)}); err != nil {
			authorized = false
		}
	}
	if session.ScopeType == "chat" {
		chat, err := h.Queries.GetChatSessionInWorkspace(r.Context(), db.GetChatSessionInWorkspaceParams{ID: parseUUID(session.ScopeID), WorkspaceID: parseUUID(session.WorkspaceID)})
		if err != nil || uuidToString(chat.CreatorID) != session.Operation.ActorID {
			authorized = false
		}
	}
	if !authorized && session.Operation.Status != "reconciliation_required" {
		_, err = h.contextService().Update(r.Context(), session.ID, contextstate.Update{
			LeaseToken: session.LeaseToken, Epoch: session.Epoch, Release: true, Status: "cancelled", Reason: "permission revoked",
		})
		if err != nil {
			contextError(w, err)
			return
		}
		h.publishContextChange(session)
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}
	h.publishContextChange(session)
	writeJSON(w, http.StatusOK, session)
}

func (h *Handler) publishContextChange(session contextstate.Session) {
	payload := map[string]any{"session_id": session.ID, "scope_type": session.ScopeType, "scope_id": session.ScopeID, "agent_id": session.AgentID}
	if session.ScopeType == "chat" {
		h.publishChat("context_session:updated", session.WorkspaceID, "system", "", session.ScopeID, payload)
	} else {
		h.publish("context_session:updated", session.WorkspaceID, "system", "", payload)
	}
}
