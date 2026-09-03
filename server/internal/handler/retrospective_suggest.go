package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/enact-ai/enact/server/internal/issuestatus"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/dbid"
	"github.com/enact-ai/enact/server/pkg/protocol"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Offering a retrospective when work finishes.
//
// This is the only part of the lessons feature that reaches someone who did not
// go looking for it, so the conditions are narrow on purpose:
//
//   - The issue just moved into a done-category status, and was not already in
//     one. A status touched twice does not ask twice.
//   - Agents actually worked on it. A retrospective over work no agent did has
//     nothing to say about how agents work.
//   - The workspace has not turned suggestions off.
//   - This issue has never been offered one. Guaranteed by the partial unique
//     index rather than by this check, so a race cannot produce two.
//
// Everything here is best-effort. Failing to offer a retrospective must never
// fail the status change that triggered it: the user was closing an issue, and
// that is the operation they are entitled to have succeed.
func (h *Handler) maybeSuggestRetrospective(ctx context.Context, prev, issue db.Issue, actorType, actorID string) {
	if issue.Status == prev.Status {
		return
	}
	if issuestatus.Effective(ctx, h.Queries, issue.WorkspaceID, issue.Status) != issuestatus.Done {
		return
	}
	if issuestatus.Effective(ctx, h.Queries, prev.WorkspaceID, prev.Status) == issuestatus.Done {
		return
	}

	workspace, err := h.Queries.GetWorkspace(ctx, issue.WorkspaceID)
	if err != nil || !workspace.RetrospectiveSuggestionsEnabled {
		return
	}

	tasks, err := h.Queries.ListTasksByIssue(ctx, issue.ID)
	if err != nil || len(tasks) == 0 {
		return
	}

	// Do not offer a retrospective on a retrospective. The Learner's own scan
	// issue reaching done is the end of the loop, not another turn of it.
	if _, err := h.Queries.GetRetrospectiveByIssue(ctx, issue.ID); err == nil {
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return
	}

	retro, err := h.Queries.SuggestIssueRetrospective(ctx, db.SuggestIssueRetrospectiveParams{
		WorkspaceID: issue.WorkspaceID,
		ScopeID:     issue.ID,
	})
	if err != nil {
		// ErrNoRows is the ON CONFLICT DO NOTHING path: this issue has been
		// offered one before. That is the expected case, not a problem.
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Error("retrospective suggestion write failed",
				"issue_id", uuidToString(issue.ID), "error", err)
		}
		return
	}

	h.notifyRetrospectiveSuggested(ctx, retro, issue, actorType, actorID)
	h.publish(protocol.EventRetrospectiveCreated, uuidToString(issue.WorkspaceID), actorType, actorID,
		map[string]any{"retrospective": retrospectiveToResponse(retro)})
}

// notifyRetrospectiveSuggested asks the person whose work it was. The issue's
// creator is the best available answer to "whose work was this": the assignee
// is usually the agent that did it, and agents have no inbox.
func (h *Handler) notifyRetrospectiveSuggested(ctx context.Context, retro db.Retrospective, issue db.Issue, actorType, actorID string) {
	if issue.CreatorType != "member" || !issue.CreatorID.Valid {
		return
	}
	details, _ := json.Marshal(map[string]string{
		"retrospective_id": uuidToString(retro.ID),
		"issue_id":         uuidToString(issue.ID),
	})
	if _, err := h.Queries.CreateInboxItem(ctx, db.CreateInboxItemParams{
		ID:            dbid.NewV7(),
		WorkspaceID:   issue.WorkspaceID,
		RecipientType: "member",
		RecipientID:   issue.CreatorID,
		Type:          "retrospective_suggested",
		// Information, not a demand. Declining is a valid answer and the most
		// common one; action_required would make the inbox lie about that.
		Severity:  "info",
		IssueID:   issue.ID,
		Title:     issue.Title,
		Body:      pgtype.Text{},
		ActorType: pgtype.Text{String: actorType, Valid: actorType != ""},
		ActorID:   optionalUUID(actorID),
		Details:   details,
	}); err != nil {
		slog.Error("retrospective suggestion inbox write failed",
			"retrospective_id", uuidToString(retro.ID), "error", err)
	}
}
