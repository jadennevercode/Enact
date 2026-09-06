package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/enact-ai/enact/server/internal/logger"
	"github.com/enact-ai/enact/server/internal/workspaceprofile"
	"github.com/enact-ai/enact/server/internal/workspacesetup"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/dbid"
	"github.com/enact-ai/enact/server/pkg/protocol"
)

// A new workspace's setup checklist.
//
// Two things are filed when a workspace is created: one inbox item, and a
// parent issue with a step under it for each thing the workspace still needs.
// The inbox item is the notification; the issue is the destination, because
// the inbox renders `body` as plain text and an explanation of what Enact is
// needs headings, a list, and links.
//
// Nothing here is assigned to an agent, and nothing here starts a run. The
// checklist is a person's list. That is deliberate: seeding agent work into
// every new workspace would bind a runtime nobody chose and spend tokens for
// a team that only wanted a tracker.
//
// Steps close themselves. `GET /api/workspaces/{id}/setup` derives each step's
// truth from real state — is a runtime connected, does a resource exist, is
// the profile filled in, has anything been installed or dismissed — and closes
// the ones that have become true. Deriving rather than storing is what keeps
// the checklist honest when a member does the thing without touching the
// issue, which is the common case.

// setupStepStatus is the status a filed step opens in. `todo` rather than
// `backlog`: these are things to do now, and the backlog is where a workspace
// puts what it has decided not to do yet.
const setupStepStatus = "todo"

// setupDoneStatus is the built-in terminal status every workspace has (see
// issuestatus.Ensure). Steps are closed into it rather than into a workspace's
// own custom status, which may not exist.
const setupDoneStatus = "done"

// WorkspaceSetupStepResponse is one row of the checklist.
type WorkspaceSetupStepResponse struct {
	Key string `json:"key"`
	// Done is derived, never stored. See the file comment.
	Done bool `json:"done"`
	// IssueID is the step's issue, empty when the workspace predates the
	// checklist and has not been backfilled yet.
	IssueID string `json:"issue_id,omitempty"`
	// IssueIdentifier is the human handle ("ENA-4"), so a client can link to
	// the step without resolving the prefix itself.
	IssueIdentifier string `json:"issue_identifier,omitempty"`
}

// WorkspaceSetupResponse is the whole checklist plus the profile it reports
// on, so a client that renders both makes one request.
type WorkspaceSetupResponse struct {
	Steps    []WorkspaceSetupStepResponse `json:"steps"`
	Complete bool                         `json:"complete"`
	// ParentIssueID is the "Set up <workspace>" issue.
	ParentIssueID         string                   `json:"parent_issue_id,omitempty"`
	ParentIssueIdentifier string                   `json:"parent_issue_identifier,omitempty"`
	Profile               WorkspaceProfileResponse `json:"profile"`
	// RepoAnalysisIssueID is the run reading a connected repository, when one
	// is in flight. The repository step stays open while it runs, so a client
	// can say "reading your repository" rather than "not done".
	RepoAnalysisIssueID string `json:"repo_analysis_issue_id,omitempty"`
}

// seedWorkspaceSetupInTx files the checklist and the welcome item for a
// workspace being created. It runs inside CreateWorkspace's transaction, so a
// workspace is never visible without the thing that explains it.
//
// language has already been normalized by the caller.
func (h *Handler) seedWorkspaceSetupInTx(
	ctx context.Context,
	qtx *db.Queries,
	ws db.Workspace,
	ownerID pgtype.UUID,
	language string,
) error {
	parent, _, err := ensureWorkspaceSetupIssues(ctx, qtx, ws, ownerID, language)
	if err != nil {
		return err
	}
	if !parent.ID.Valid {
		return nil
	}

	text := workspacesetup.For(language)
	if _, err := qtx.CreateInboxItem(ctx, db.CreateInboxItemParams{
		ID:            dbid.NewV7(),
		WorkspaceID:   ws.ID,
		RecipientType: "member",
		RecipientID:   ownerID,
		Type:          workspacesetup.InboxTypeWelcome,
		Severity:      "action_required",
		IssueID:       parent.ID,
		Title:         text.InboxTitle,
		Body:          strOrNullText(text.InboxBody),
		ActorType:     pgtype.Text{String: "system", Valid: true},
		Details:       []byte(`{}`),
	}); err != nil {
		return fmt.Errorf("file the welcome inbox item: %w", err)
	}
	return nil
}

// ensureWorkspaceSetupIssues files any setup issue this workspace is missing
// and returns the parent plus the steps, keyed by step.
//
// Idempotent, and safe to call on a workspace that already has some of them:
// each insert is skipped when the partial unique index (migrations 447, 448)
// would refuse it. The pre-check is not the guarantee — the index is — but
// inside a transaction a conflict aborts everything after it, so the check is
// what lets a backfill file the two steps a workspace is missing without
// losing the ones it has.
func ensureWorkspaceSetupIssues(
	ctx context.Context,
	qtx *db.Queries,
	ws db.Workspace,
	ownerID pgtype.UUID,
	language string,
) (db.Issue, map[workspacesetup.Step]db.Issue, error) {
	var parent db.Issue
	steps := map[workspacesetup.Step]db.Issue{}

	wsUUID, err := uuid.Parse(uuidToString(ws.ID))
	if err != nil {
		return parent, steps, fmt.Errorf("workspace id: %w", err)
	}

	// Serialize concurrent filers on this workspace. Two clients reading the
	// setup of a workspace that predates the checklist would otherwise both
	// pass the pre-check and race into the index.
	if err := qtx.LockIssueDuplicateKey(ctx, "workspace-setup:"+uuidToString(ws.ID)); err != nil {
		return parent, steps, fmt.Errorf("lock workspace setup: %w", err)
	}

	existing, err := qtx.ListWorkspaceSetupIssues(ctx, ws.ID)
	if err != nil {
		return parent, steps, fmt.Errorf("read existing setup issues: %w", err)
	}
	parentOrigin := uuidToString(pgtype.UUID{Bytes: workspacesetup.ParentOriginID(wsUUID), Valid: true})
	byOrigin := make(map[string]db.Issue, len(existing))
	for _, issue := range existing {
		byOrigin[uuidToString(issue.OriginID)] = issue
	}

	text := workspacesetup.For(language)
	if found, ok := byOrigin[parentOrigin]; ok {
		parent = found
	} else {
		parent, err = createSetupIssue(ctx, qtx, ws, ownerID, setupIssueSpec{
			Title:       text.ParentTitleFor(ws.Name),
			Body:        text.ParentBody,
			OriginID:    workspacesetup.ParentOriginID(wsUUID),
			MetaValue:   workspacesetup.ParentMetadataValue,
			ParentIssue: pgtype.UUID{},
			// The parent sorts above its steps in a position-ordered column.
			Position: 0,
		})
		if err != nil {
			return parent, steps, err
		}
	}

	for i, step := range workspacesetup.Steps {
		originUUID := workspacesetup.StepOriginID(wsUUID, step)
		origin := uuidToString(pgtype.UUID{Bytes: originUUID, Valid: true})
		if found, ok := byOrigin[origin]; ok {
			steps[step] = found
			continue
		}
		issue, err := createSetupIssue(ctx, qtx, ws, ownerID, setupIssueSpec{
			Title:       text.StepTitles[step],
			Body:        text.StepBodies[step],
			OriginID:    originUUID,
			MetaValue:   string(step),
			ParentIssue: parent.ID,
			Position:    float64(i + 1),
		})
		if err != nil {
			return parent, steps, err
		}
		steps[step] = issue
	}
	return parent, steps, nil
}

type setupIssueSpec struct {
	Title       string
	Body        string
	OriginID    uuid.UUID
	MetaValue   string
	ParentIssue pgtype.UUID
	Position    float64
}

// createSetupIssue writes one checklist issue and stamps the step it is.
//
// The step key is written twice on purpose. origin_id carries it as a derived
// UUID, which is what the unique index can enforce; metadata carries it as the
// readable key, which is what a person inspecting the row and the checklist
// endpoint both match on. Neither alone does both jobs.
func createSetupIssue(
	ctx context.Context,
	qtx *db.Queries,
	ws db.Workspace,
	ownerID pgtype.UUID,
	spec setupIssueSpec,
) (db.Issue, error) {
	number, err := qtx.IncrementIssueCounter(ctx, ws.ID)
	if err != nil {
		return db.Issue{}, fmt.Errorf("allocate issue number: %w", err)
	}
	issue, err := qtx.CreateIssueWithOrigin(ctx, db.CreateIssueWithOriginParams{
		ID:          dbid.NewV7(),
		WorkspaceID: ws.ID,
		Title:       spec.Title,
		Description: strOrNullText(spec.Body),
		Status:      setupStepStatus,
		// Deliberately unprioritized. A workspace's first four issues all
		// reading "high" teaches the priority field means nothing here.
		Priority: "medium",
		// Assigned to the person who created the workspace: this is their
		// list, and an unassigned issue in a one-member workspace reads as
		// nobody's.
		AssigneeType: pgtype.Text{String: "member", Valid: true},
		AssigneeID:   ownerID,
		// Filed in the member's own name, the way a retrospect sub-issue is.
		// creator_id is NOT NULL, and a "system" creator with no id is not
		// representable; naming the member is also what puts the issue in
		// their subscriptions, so the checklist reaches the person it is for.
		// That the product filed it is carried by origin_type, not by the
		// creator.
		CreatorType:   "member",
		CreatorID:     ownerID,
		ParentIssueID: spec.ParentIssue,
		Position:      spec.Position,
		Number:        number,
		OriginType:    pgtype.Text{String: workspacesetup.OriginType, Valid: true},
		OriginID:      pgtype.UUID{Bytes: spec.OriginID, Valid: true},
	})
	if err != nil {
		return db.Issue{}, fmt.Errorf("file setup issue %q: %w", spec.MetaValue, err)
	}
	value, err := json.Marshal(spec.MetaValue)
	if err != nil {
		return db.Issue{}, fmt.Errorf("encode setup step key: %w", err)
	}
	stamped, err := qtx.SetIssueMetadataKey(ctx, db.SetIssueMetadataKeyParams{
		ID:          issue.ID,
		WorkspaceID: ws.ID,
		Key:         workspacesetup.MetadataKey,
		Value:       value,
	})
	if err != nil {
		return db.Issue{}, fmt.Errorf("stamp setup step %q: %w", spec.MetaValue, err)
	}
	return stamped, nil
}

// GetWorkspaceSetup reports the checklist, files anything missing, and closes
// the steps that have become true.
//
// It writes on a GET, which is unusual enough to say why: the checklist is a
// projection of state the member changes elsewhere — they connect a runtime on
// the Runtimes page, add a resource in Settings — and the alternative is
// hooking a close into every one of those paths, where a missed hook leaves a
// step open forever with no way to notice. Reading the checklist is exactly
// when its staleness matters, so that is when it is repaired.
func (h *Handler) GetWorkspaceSetup(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := workspaceIDFromURL(r, "id")
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	ws, err := h.Queries.GetWorkspace(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}

	state, err := h.readWorkspaceSetupState(r.Context(), ws)
	if err != nil {
		slog.Warn("read workspace setup state failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to read the setup checklist")
		return
	}

	language := workspacesetup.NormalizeLanguage(r.URL.Query().Get("language"))
	resp, closed, err := h.reconcileWorkspaceSetup(r.Context(), ws, parseUUID(userID), language, state)
	if err != nil {
		slog.Warn("reconcile workspace setup failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to read the setup checklist")
		return
	}

	// Broadcast the closes so an open issue list updates without a refresh.
	// Outside the transaction: a websocket fanout must never be able to hold
	// a database transaction open.
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	for _, issue := range closed {
		issueResp := issueToResponse(issue, ws.IssuePrefix)
		h.fillStatusCategory(r.Context(), ws.ID, &issueResp)
		h.publish(protocol.EventIssueUpdated, workspaceID, actorType, actorID, map[string]any{
			"issue":          issueResp,
			"status_changed": true,
			"prev_status":    setupStepStatus,
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

// workspaceSetupState is the real state each step reports on, read once.
type workspaceSetupState struct {
	HasRuntime  bool
	HasResource bool
	Profile     workspaceprofile.Profile
	// ReviewedCapability is true once the workspace has installed something
	// from the Marketplace or dismissed a recommendation. Either is a member
	// having looked; the step asks for a decision, not for an install.
	ReviewedCapability bool
	// RepoAnalysisIssueID is an analysis run still in flight, if any.
	RepoAnalysisIssueID string
}

func (h *Handler) readWorkspaceSetupState(ctx context.Context, ws db.Workspace) (workspaceSetupState, error) {
	var state workspaceSetupState

	runtimes, err := h.Queries.ListAgentRuntimes(ctx, ws.ID)
	if err != nil {
		return state, fmt.Errorf("list runtimes: %w", err)
	}
	state.HasRuntime = len(runtimes) > 0

	resources, err := h.Queries.CountWorkspaceResources(ctx, ws.ID)
	if err != nil {
		return state, fmt.Errorf("count resources: %w", err)
	}
	state.HasResource = resources > 0

	state.Profile = workspaceprofile.Parse(ws.Profile)

	installs, err := h.Queries.ListMarketplaceInstallsForWorkspace(ctx, ws.ID)
	if err != nil {
		return state, fmt.Errorf("list installs: %w", err)
	}
	if len(installs) > 0 {
		state.ReviewedCapability = true
	} else {
		dismissed, err := h.Queries.CountMarketplaceRecommendationDecisions(ctx, ws.ID)
		if err != nil {
			return state, fmt.Errorf("count recommendation decisions: %w", err)
		}
		state.ReviewedCapability = dismissed > 0
	}

	// An analysis still running is what makes "the repository step is not done"
	// explicable: the member connected the repository and something is reading
	// it, which is a different thing to say than "you have not done this".
	if running, err := h.Queries.ListActiveIssuesByOriginType(ctx, db.ListActiveIssuesByOriginTypeParams{
		WorkspaceID: ws.ID,
		OriginType:  pgtype.Text{String: workspacesetup.RepoAnalysisOriginType, Valid: true},
	}); err == nil && len(running) > 0 {
		state.RepoAnalysisIssueID = uuidToString(running[0].ID)
	}
	return state, nil
}

// reconcileWorkspaceSetup files anything missing, closes what is now true, and
// renders the checklist. One transaction, because a member reading the
// checklist twice in two tabs must not produce two copies of it.
func (h *Handler) reconcileWorkspaceSetup(
	ctx context.Context,
	ws db.Workspace,
	actorID pgtype.UUID,
	language string,
	state workspaceSetupState,
) (WorkspaceSetupResponse, []db.Issue, error) {
	var resp WorkspaceSetupResponse
	var closed []db.Issue

	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return resp, nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := h.Queries.WithTx(tx)

	parent, steps, err := ensureWorkspaceSetupIssues(ctx, qtx, ws, actorID, language)
	if err != nil {
		return resp, nil, err
	}

	done := map[workspacesetup.Step]bool{
		workspacesetup.StepRuntime:    state.HasRuntime,
		workspacesetup.StepRepository: state.HasResource && state.Profile.HasRepoBrief(),
		workspacesetup.StepProfile:    !state.Profile.IsEmpty(),
		workspacesetup.StepCapability: state.ReviewedCapability,
	}
	// A workspace with a resource but no runtime can never produce a
	// repository brief — nothing can read the tree. Holding the step open on a
	// brief that cannot be written would strand it, so the resource alone
	// closes it once there is no agent that could have written one.
	if state.HasResource && !state.HasRuntime {
		done[workspacesetup.StepRepository] = true
	}

	resp.Steps = make([]WorkspaceSetupStepResponse, 0, len(workspacesetup.Steps))
	allDone := true
	for _, step := range workspacesetup.Steps {
		issue := steps[step]
		row := WorkspaceSetupStepResponse{Key: string(step), Done: done[step]}
		if issue.ID.Valid {
			if done[step] && issue.Status != setupDoneStatus {
				updated, err := qtx.UpdateIssueStatus(ctx, db.UpdateIssueStatusParams{
					ID:          issue.ID,
					Status:      setupDoneStatus,
					WorkspaceID: ws.ID,
				})
				if err != nil {
					return resp, nil, fmt.Errorf("close setup step %q: %w", step, err)
				}
				issue = updated
				closed = append(closed, updated)
			}
			row.IssueID = uuidToString(issue.ID)
			row.IssueIdentifier = issueIdentifier(ws.IssuePrefix, issue.Number)
		}
		if !done[step] {
			allDone = false
		}
		resp.Steps = append(resp.Steps, row)
	}
	resp.Complete = allDone

	if parent.ID.Valid {
		resp.ParentIssueID = uuidToString(parent.ID)
		resp.ParentIssueIdentifier = issueIdentifier(ws.IssuePrefix, parent.Number)
		// The parent closes with its last step. A checklist that stays open
		// after everything under it is done is a chore the product created and
		// left for the member.
		if allDone && parent.Status != setupDoneStatus {
			updated, err := qtx.UpdateIssueStatus(ctx, db.UpdateIssueStatusParams{
				ID:          parent.ID,
				Status:      setupDoneStatus,
				WorkspaceID: ws.ID,
			})
			if err != nil {
				return resp, nil, fmt.Errorf("close the setup issue: %w", err)
			}
			closed = append(closed, updated)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return resp, nil, fmt.Errorf("commit: %w", err)
	}

	resp.Profile = profileToResponse(state.Profile)
	resp.RepoAnalysisIssueID = state.RepoAnalysisIssueID
	return resp, closed, nil
}

// issueIdentifier renders the human handle for an issue. The prefix is a
// workspace setting, so an empty one yields the bare number rather than a
// leading dash.
func issueIdentifier(prefix string, number int32) string {
	if strings.TrimSpace(prefix) == "" {
		return fmt.Sprintf("%d", number)
	}
	return fmt.Sprintf("%s-%d", prefix, number)
}
