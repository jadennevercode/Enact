package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/enact-ai/enact/server/internal/events"
	"github.com/enact-ai/enact/server/internal/service"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
)

type finalRoute struct {
	Source          commentAgentTriggerSource `json:"source"`
	SquadID         string                    `json:"squad_id,omitempty"`
	FallbackID      string                    `json:"fallback_id,omitempty"`
	FallbackSquadID string                    `json:"fallback_squad_id,omitempty"`
}

func (h *Handler) EnableFinalDeliveryOutbox() { h.TaskService.PlanFinalDelivery = h.planFinalDelivery }
func (h *Handler) contextQueries(q *db.Queries) *Handler {
	scoped := *h
	scoped.Queries = q
	s := service.NewTaskService(q, nil, h.Hub, h.Bus, h.TaskService.Wakeup)
	s.Composio = h.TaskService.Composio
	s.FeatureFlags = h.TaskService.FeatureFlags
	s.Analytics = h.TaskService.Analytics
	s.Metrics = h.TaskService.Metrics
	scoped.TaskService = s
	return &scoped
}

// Capture targets once, while the comment and receipt are still uncommitted.
func (h *Handler) planFinalDelivery(ctx context.Context, q *db.Queries, c db.Comment) error {
	scoped := h.contextQueries(q)
	issue, err := q.GetIssue(ctx, c.IssueID)
	if err != nil {
		return err
	}
	var parent *db.Comment
	if c.ParentID.Valid {
		p, err := q.GetCommentInWorkspace(ctx, db.GetCommentInWorkspaceParams{ID: c.ParentID, WorkspaceID: c.WorkspaceID})
		if err != nil {
			return err
		}
		parent = &p
	}
	origin := uuidToString(scoped.TaskService.ResolveOriginatorFromTriggerComment(ctx, c.WorkspaceID, c.ID))
	triggers, _ := scoped.computeCommentAgentTriggers(ctx, issue, c.Content, parent, c.AuthorType, uuidToString(c.AuthorID), commentTriggerComputeOptions{ExcludeTriggerCommentID: c.ID, OriginatorUserID: origin, AutopilotDelegationAuthorityUserID: scoped.autopilotDelegationAuthorityFromComment(ctx, issue, c)})
	for _, trigger := range triggers {
		route := finalRoute{Source: trigger.Source}
		if trigger.Squad != nil {
			route.SquadID = uuidToString(trigger.Squad.ID)
		}
		if trigger.EscalationFallback != nil {
			route.FallbackID = uuidToString(trigger.EscalationFallback.Agent.ID)
			if trigger.EscalationFallback.Squad != nil {
				route.FallbackSquadID = uuidToString(trigger.EscalationFallback.Squad.ID)
			}
		}
		raw, err := json.Marshal(route)
		if err != nil {
			return err
		}
		if err = q.AddDeliveryOutbox(ctx, db.AddDeliveryOutboxParams{CommentID: c.ID, WorkspaceID: c.WorkspaceID, IssueID: c.IssueID, CommentRevision: c.Revision, TargetID: trigger.Agent.ID, Route: raw}); err != nil {
			return err
		}
	}
	return nil
}
func (h *Handler) RunFinalDeliveryOutbox(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		h.DrainFinalDeliveries(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (h *Handler) DrainFinalDeliveries(ctx context.Context) {
	for i := 0; i < 20; i++ {
		more, err := h.drainFinalDelivery(ctx)
		if err != nil {
			slog.Warn("final delivery pending", "error", err)
			return
		}
		if !more {
			return
		}
	}
}
func (h *Handler) drainFinalDelivery(ctx context.Context) (bool, error) {
	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var commentID, targetID string
	var revision int64
	var raw []byte
	err = tx.QueryRow(ctx, `SELECT comment_id,target_id,comment_revision,route FROM agent_delivery_outbox
 WHERE status='pending' AND (updated_at=created_at OR updated_at<now()-interval '1 second') ORDER BY updated_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1`).Scan(&commentID, &targetID, &revision, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var route finalRoute
	if err = json.Unmarshal(raw, &route); err != nil {
		return false, err
	}
	q := h.Queries.WithTx(tx)
	scoped := h.contextQueries(q)
	scoped.DB = tx
	scoped.TxStarter = tx
	scoped.TaskService.TxStarter = tx
	// Defer domain events until the enqueue and exact target receipt commit.
	buffered := events.New()
	var emitted []events.Event
	buffered.SubscribeAll(func(e events.Event) { emitted = append(emitted, e) })
	scoped.Bus = buffered
	scoped.TaskService.Bus = buffered
	status := "pending"
	c, err := q.GetComment(ctx, parseUUID(commentID))
	if errors.Is(err, pgx.ErrNoRows) {
		status = "cancelled"
	} else if err != nil {
		return false, err
	}
	if status == "pending" && c.Revision != revision {
		status = "stale_target"
	}
	if status == "pending" {
		issue, err := q.GetIssue(ctx, c.IssueID)
		if err != nil {
			return false, err
		}
		target, err := q.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{ID: parseUUID(targetID), WorkspaceID: c.WorkspaceID})
		origin := uuidToString(scoped.TaskService.ResolveOriginatorFromTriggerComment(ctx, c.WorkspaceID, c.ID))
		if origin == "" {
			origin = scoped.autopilotDelegationAuthorityFromComment(ctx, issue, c)
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return false, err
		}
		if errors.Is(err, pgx.ErrNoRows) || target.ArchivedAt.Valid || !scoped.canInvokeAgent(ctx, target, c.AuthorType, uuidToString(c.AuthorID), origin, uuidToString(c.WorkspaceID)) {
			status = "cancelled"
		} else if err != nil {
			return false, err
		} else {
			trigger := commentAgentTrigger{Agent: target, Source: route.Source}
			if route.SquadID != "" {
				sq, err := q.GetSquadInWorkspace(ctx, db.GetSquadInWorkspaceParams{ID: parseUUID(route.SquadID), WorkspaceID: c.WorkspaceID})
				if errors.Is(err, pgx.ErrNoRows) {
					status = "stale_target"
				} else if err != nil {
					return false, err
				} else if sq.LeaderID != target.ID {
					status = "stale_target"
				} else {
					trigger.Squad = &sq
				}
			}
			if route.FallbackID != "" {
				a, err := q.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{ID: parseUUID(route.FallbackID), WorkspaceID: c.WorkspaceID})
				if err == nil && !a.ArchivedAt.Valid && scoped.canInvokeAgent(ctx, a, c.AuthorType, uuidToString(c.AuthorID), origin, uuidToString(c.WorkspaceID)) {
					trigger.EscalationFallback = &commentEscalationFallback{Agent: a}
					if route.FallbackSquadID != "" {
						sq, err := q.GetSquadInWorkspace(ctx, db.GetSquadInWorkspaceParams{ID: parseUUID(route.FallbackSquadID), WorkspaceID: c.WorkspaceID})
						if err == nil {
							trigger.EscalationFallback.Squad = &sq
						}
					}
				}
			}
			// A busy running target keeps its durable obligation. It must never be
			// discharged merely because completion reconciliation might run later.
			active, err := scoped.hasActiveTaskForIssueAndAgent(ctx, issue.ID, target.ID)
			if err != nil {
				return false, err
			}
			if !active && status == "pending" {
				outcome, reason := scoped.resolveCommentTriggerEnqueue(ctx, issue, trigger, c.ID, func() time.Duration { return scoped.commentRoutingEscalationDelay(ctx, c.WorkspaceID) })
				if outcome == DispatchQueued || outcome == DispatchCoalesced {
					status = "delivered"
				} else if (reason == ReasonInvocationNotAllowed || reason == ReasonSelfTriggerSuppressed) && outcome == DispatchBlocked {
					status = "cancelled"
				}
			}
		}
	}
	_, err = tx.Exec(ctx, "UPDATE agent_delivery_outbox SET status=$4,updated_at=now() WHERE comment_id=$1 AND comment_revision=$2 AND target_id=$3", commentID, revision, targetID, status)
	if err != nil {
		return false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, err
	}
	for _, event := range emitted {
		h.Bus.Publish(event)
	}
	return true, nil
}
