package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/enact-ai/enact/server/internal/logger"
	"github.com/enact-ai/enact/server/internal/service"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/protocol"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// The Retrospect Agent's product-defined identity, held as server constants for
// the same reason Mika's are: the public CreateAgent API accepts neither `kind`
// nor `system_key`, so a client cannot mint an agent that would receive the
// system instruction layer or be picked up as this workspace's retrospector.
const (
	// One at a time. A retrospect reads a finished issue and writes a comment;
	// running several at once buys nothing and multiplies the cost of a noisy
	// workspace that just closed a batch of issues.
	retrospectAgentMaxConcurrency = 1
	retrospectAgentVisibility     = "workspace"
	retrospectAgentPermissionMode = "public_to"
	retrospectAgentAvatarURL      = agentEmojiAvatarPrefix + "🔭"
)

// retrospectAgentDescriptions is user-facing copy, so it is localized. Like
// Mika's it is stored on the row: description is owner-editable and the product
// does not reclaim it after creation.
var retrospectAgentDescriptions = map[string]string{
	"en": "Reviews finished work, proposes changes to skills, agents and agent families, and writes down what was learned.",
	"zh": "复盘已完成的工作，提出对技能、智能体和智能体家族配置的修改建议，并把学到的东西沉淀成文档。",
	"ko": "완료된 작업을 회고하고 스킬·에이전트·에이전트 패밀리 설정 변경을 제안하며 배운 것을 문서로 남깁니다.",
	"ja": "完了した仕事を振り返り、スキル・エージェント・エージェントファミリーの設定変更を提案し、学んだことを文書に残します。",
}

type createRetrospectAgentRequest struct {
	RuntimeID string `json:"runtime_id"`
	Language  string `json:"language"`
	// Model is the runtime model to run on. Optional: empty means "whatever the
	// runtime defaults to".
	Model string `json:"model"`
}

// CreateRetrospectAgent provisions this workspace's Retrospect Agent, or hands
// back the one it already has.
//
// Configuring the agent is what turns the retrospect loop on: nothing seeds it,
// and registerRetrospectListeners files a sub-issue only in workspaces where
// this call has been made and the agent has not been archived. That is the
// whole opt-in — there is deliberately no second workspace-level switch, which
// would let the two disagree about whether the workspace retrospects.
//
// Idempotent. A retry, a second tab, or two members clicking at once converge
// on one agent; see the advisory lock below for why the pre-check alone is not
// enough.
func (h *Handler) CreateRetrospectAgent(w http.ResponseWriter, r *http.Request) {
	workspaceID := ctxWorkspaceID(r.Context())
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace not specified")
		return
	}
	userID := requestUserID(r)

	var req createRetrospectAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	agent, created, ok := h.resolveRetrospectAgent(w, r, workspaceID, userID, req)
	if !ok {
		return
	}

	resp := h.agentToResponse(agent)
	if err := h.enrichAgentResponseWithTargets(r.Context(), &resp, agent.ID); err != nil {
		slog.Warn("retrospect agent: load invocation targets failed",
			append(logger.RequestAttrs(r), "error", err, "agent_id", uuidToString(agent.ID))...)
	}

	if created {
		actorType, actorID := h.resolveActor(r, uuidToString(agent.OwnerID), workspaceID)
		h.publish(protocol.EventAgentCreated, workspaceID, actorType, actorID,
			map[string]any{"agent": broadcastAgentResponse(resp)})
		writeJSON(w, http.StatusCreated, resp)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// resolveRetrospectAgent returns the workspace's Retrospect Agent — the existing
// one if there is one, otherwise a freshly provisioned one. The bool pair is
// (created, ok); when ok is false it has already written the error response.
func (h *Handler) resolveRetrospectAgent(w http.ResponseWriter, r *http.Request, workspaceID, userID string, req createRetrospectAgentRequest) (db.Agent, bool, bool) {
	description, ok := retrospectAgentDescriptions[req.Language]
	if !ok {
		writeError(w, http.StatusBadRequest, "language must be en, zh, ko, or ja")
		return db.Agent{}, false, false
	}
	runtimeID, ok := parseUUIDOrBadRequest(w, req.RuntimeID, "runtime_id")
	if !ok {
		return db.Agent{}, false, false
	}
	wsUUID := parseUUID(workspaceID)
	systemKey := pgtype.Text{String: service.RetrospectSystemKey, Valid: true}

	// Already configured: hand back the same agent.
	//
	// Archived counts as configured, which is why this looks past archived_at.
	// Archiving is how a workspace turns the loop off, so restoring is the way
	// back on — and the alternative is not "create a second one" but a 500:
	// agent_system_identity_unique (migration 172) has no archived predicate,
	// so the archived row still holds the slot and the insert would fail on the
	// index. Un-archiving here instead would turn "turn it off" into a button
	// that silently stops working.
	if existing, err := h.Queries.GetAgentBySystemKeyIncludingArchived(r.Context(), db.GetAgentBySystemKeyIncludingArchivedParams{
		WorkspaceID: wsUUID,
		SystemKey:   systemKey,
	}); err == nil {
		return existing, false, true
	} else if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to look up the retrospect agent")
		return db.Agent{}, false, false
	}

	member, ok := h.workspaceMember(w, r, workspaceID)
	if !ok {
		return db.Agent{}, false, false
	}
	runtime, err := h.Queries.GetAgentRuntime(r.Context(), runtimeID)
	if err != nil || uuidToString(runtime.WorkspaceID) != workspaceID {
		writeError(w, http.StatusBadRequest, "runtime not found in this workspace")
		return db.Agent{}, false, false
	}
	if !canUseRuntimeForAgent(member, runtime) {
		writeError(w, http.StatusForbidden, "you cannot bind an agent to this runtime")
		return db.Agent{}, false, false
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start agent create transaction")
		return db.Agent{}, false, false
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	// Serialize provisioning per workspace. The check above is only a fast
	// path: without this, two members configuring at the same moment both miss
	// and both insert. Migration 172's unique index would not stop them either
	// — it covers (workspace_id, owner_id, runtime_id, system_key), so
	// different owners or different runtimes are distinct tuples, and the
	// workspace would end up with two live Retrospect Agents, each filing its
	// own sub-issue under every finished issue.
	if _, err := tx.Exec(r.Context(),
		"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
		"retrospect:"+workspaceID,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to lock the retrospect agent")
		return db.Agent{}, false, false
	}
	if existing, err := qtx.GetAgentBySystemKeyIncludingArchived(r.Context(), db.GetAgentBySystemKeyIncludingArchivedParams{
		WorkspaceID: wsUUID,
		SystemKey:   systemKey,
	}); err == nil {
		return existing, false, true
	} else if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to look up the retrospect agent")
		return db.Agent{}, false, false
	}

	created, err := qtx.CreateSystemUserAgent(r.Context(), db.CreateSystemUserAgentParams{
		WorkspaceID:        wsUUID,
		Name:               service.RetrospectDefaultName,
		Description:        description,
		AvatarUrl:          pgtype.Text{String: retrospectAgentAvatarURL, Valid: true},
		RuntimeMode:        runtime.RuntimeMode,
		RuntimeID:          runtime.ID,
		Model:              pgtype.Text{String: strings.TrimSpace(req.Model), Valid: strings.TrimSpace(req.Model) != ""},
		Visibility:         retrospectAgentVisibility,
		PermissionMode:     retrospectAgentPermissionMode,
		MaxConcurrentTasks: retrospectAgentMaxConcurrency,
		OwnerID:            parseUUID(userID),
		SystemKey:          systemKey,
	})
	if err != nil {
		slog.Warn("create retrospect agent failed",
			append(logger.RequestAttrs(r), "error", err, "workspace_id", workspaceID)...)
		writeError(w, http.StatusInternalServerError, "failed to create the retrospect agent")
		return db.Agent{}, false, false
	}
	// Workspace-invocable: every member may assign it work and @-mention it on
	// an issue, which are the two manual ways to ask for a retrospect.
	if err := replaceInvocationTargetsWithQueries(r.Context(), qtx, created.ID, parseUUID(userID), []targetSpec{
		{targetType: invocationTargetWorkspace, targetID: wsUUID},
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save agent access")
		return db.Agent{}, false, false
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit agent create")
		return db.Agent{}, false, false
	}
	slog.Info("retrospect agent created",
		append(logger.RequestAttrs(r), "agent_id", uuidToString(created.ID), "workspace_id", workspaceID)...)

	if runtime.Status == "online" {
		h.TaskService.ReconcileAgentStatus(r.Context(), created.ID)
		created, _ = h.Queries.GetAgent(r.Context(), created.ID)
	}
	return created, true, true
}
