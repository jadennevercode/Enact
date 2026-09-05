// Package-level note: this file owns the automatic half of the retrospect
// loop. The manual halves — assigning an issue to the Retrospect Agent,
// @-mentioning it, pointing an autopilot at it — need nothing here; they are
// ordinary assignment and go through the paths that already exist.
package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/enact-ai/enact/server/internal/issuestatus"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// OriginRetrospect is issue.origin_type for a sub-issue this service filed.
// Mirrors the CHECK constraint amended in migration 441.
const OriginRetrospect = "retrospect"

// RetrospectService files the sub-issue that reviews a finished piece of work.
//
// The whole feature is opt-in through one fact: the workspace has a live agent
// with system_key='retrospect'. No workspace-level flag mirrors that, because a
// flag and an agent can disagree and then nobody can say why the workspace did
// or did not learn from a piece of work.
type RetrospectService struct {
	Queries      *db.Queries
	IssueService *IssueService
}

func NewRetrospectService(q *db.Queries, issues *IssueService) *RetrospectService {
	return &RetrospectService{Queries: q, IssueService: issues}
}

// ErrNoRetrospectAgent means the workspace has not configured one. It is the
// ordinary case, not a failure: most workspaces never will.
var ErrNoRetrospectAgent = errors.New("workspace has no retrospect agent")

// MaybeFileForFinishedIssue files a retrospect sub-issue under issueID, if this
// workspace retrospects and this issue has just become the kind of work worth
// reviewing.
//
// Called from the EventIssueUpdated listener rather than from the update
// handler, so that the batch-update path and the GitHub webhook path — which
// publish the same event and never touched the handler's post-commit block —
// are covered by the same code.
//
// Every return is best-effort. Failing to file a retrospect must never be
// visible as a failure of the status change that triggered it, so the caller
// logs and moves on.
func (s *RetrospectService) MaybeFileForFinishedIssue(ctx context.Context, workspaceID, issueID pgtype.UUID, prevStatus string) error {
	if !workspaceID.Valid || !issueID.Valid {
		return nil
	}

	issue, err := s.Queries.GetIssue(ctx, issueID)
	if err != nil {
		return fmt.Errorf("load issue: %w", err)
	}

	if !s.finishedNow(ctx, workspaceID, issue, prevStatus) {
		return nil
	}

	// Never retrospect a retrospect. Without this the loop is infinite: the
	// sub-issue this service files is itself an issue that reaches done.
	if issue.OriginType.Valid && issue.OriginType.String == OriginRetrospect {
		return nil
	}

	// Whether the workspace retrospects at all, asked before anything about
	// this particular issue. Most workspaces never configure the agent, and
	// this runs on the request goroutine for every status change in every one
	// of them, so the question that ends it soonest goes first.
	agent, err := s.liveRetrospectAgent(ctx, workspaceID)
	if err != nil {
		return err
	}

	// Only work an agent actually did. A person closing a note to themselves
	// has nothing for an agent to read: no run transcript, usually no comments,
	// and the retrospect would be a guess dressed as a finding.
	ran, err := s.Queries.IssueHasAgentTask(ctx, issue.ID)
	if err != nil {
		return fmt.Errorf("check issue for agent runs: %w", err)
	}
	if !ran {
		return nil
	}

	// Cheap pre-check. The guarantee is the partial unique index from migration
	// 443, which the insert below conflicts against; this only saves the work
	// of building a create for an issue already retrospected.
	if existing, err := s.Queries.GetIssueByOrigin(ctx, db.GetIssueByOriginParams{
		WorkspaceID: workspaceID,
		OriginType:  pgtype.Text{String: OriginRetrospect, Valid: true},
		OriginID:    issue.ID,
	}); err == nil && existing.ID.Valid {
		return nil
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("look up existing retrospect: %w", err)
	}

	// The prefix renders the issue key in the event payload. A workspace that
	// cannot be read here is not worth failing the filing over — the key is
	// cosmetic in the broadcast and the row carries the real number.
	issuePrefix := ""
	if ws, err := s.Queries.GetWorkspace(ctx, workspaceID); err == nil {
		issuePrefix = ws.IssuePrefix
	}

	title, description := retrospectBrief(issue)

	_, err = s.IssueService.Create(ctx, IssueCreateParams{
		WorkspaceID:  workspaceID,
		Title:        title,
		Description:  pgtype.Text{String: description, Valid: true},
		Status:       issuestatus.Todo,
		Priority:     "low",
		AssigneeType: pgtype.Text{String: "agent", Valid: true},
		AssigneeID:   agent.ID,
		// Filed in the name of whoever the finished issue belongs to, so it
		// lands in a person's subscriptions and someone is there to answer the
		// proposal. An agent creator would leave the thread with nobody in it.
		CreatorType:   "member",
		CreatorID:     retrospectCreator(issue),
		ParentIssueID: issue.ID,
		OriginType:    pgtype.Text{String: OriginRetrospect, Valid: true},
		OriginID:      issue.ID,
		// The duplicate guard keys on (workspace, parent, normalized title) and
		// would suppress a legitimate second retrospect after a title change.
		// Once-only is the index's job here, not the guard's.
		AllowDuplicate: true,
	}, IssueCreateOpts{
		// Without a payload builder Create emits a minimal {"issue_id": ...}
		// event, and the subscriber listener returns early on it — leaving the
		// sub-issue with nobody subscribed. That is the one thing this must not
		// do: the proposal it will post needs a person watching the thread to
		// answer it. Same map shape the autopilot create uses.
		BroadcastPayload: func(created db.Issue, _ []db.Attachment, _ []db.IssueLabel) map[string]any {
			return map[string]any{
				"issue": IssueToMapWithCategory(ctx, s.Queries, created, issuePrefix),
			}
		},
	})
	if err != nil {
		// The index rejecting a second retrospect is the success case of a
		// race, not an error worth reporting.
		if isRetrospectDuplicate(err) {
			return nil
		}
		return fmt.Errorf("create retrospect sub-issue: %w", err)
	}
	return nil
}

// finishedNow reports whether this update is the transition into a done status.
//
// Both sides go through issuestatus.Effective so a workspace's custom status
// inheriting the done category counts, and a status touched twice while already
// done does not.
func (s *RetrospectService) finishedNow(ctx context.Context, workspaceID pgtype.UUID, issue db.Issue, prevStatus string) bool {
	if prevStatus == "" || prevStatus == issue.Status {
		return false
	}
	now := issuestatus.Effective(ctx, s.Queries, workspaceID, issue.Status)
	if now != issuestatus.Done {
		return false
	}
	return issuestatus.Effective(ctx, s.Queries, workspaceID, prevStatus) != issuestatus.Done
}

// liveRetrospectAgent returns the workspace's Retrospect Agent when it is in a
// state that can be assigned work.
//
// Archiving it is how a workspace turns the loop off, so an archived one is
// ErrNoRetrospectAgent and not an error to report. An agent with no runtime is
// the same answer for a different reason: assigning work to it would queue a
// task nothing will ever claim.
func (s *RetrospectService) liveRetrospectAgent(ctx context.Context, workspaceID pgtype.UUID) (db.Agent, error) {
	agent, err := s.Queries.GetAgentBySystemKey(ctx, db.GetAgentBySystemKeyParams{
		WorkspaceID: workspaceID,
		SystemKey:   pgtype.Text{String: RetrospectSystemKey, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Agent{}, ErrNoRetrospectAgent
		}
		return db.Agent{}, fmt.Errorf("look up retrospect agent: %w", err)
	}
	if agent.ArchivedAt.Valid || !agent.RuntimeID.Valid {
		return db.Agent{}, ErrNoRetrospectAgent
	}
	return agent, nil
}

// retrospectCreator picks the member the sub-issue is filed for.
//
// The finished issue's creator, when that was a person. An issue an agent
// created has no better answer available here, and an invalid UUID is what the
// create path already treats as "no creator", so it degrades to an unattributed
// issue rather than to a wrong attribution.
func retrospectCreator(issue db.Issue) pgtype.UUID {
	if issue.CreatorType == "member" && issue.CreatorID.Valid {
		return issue.CreatorID
	}
	return pgtype.UUID{}
}

// retrospectBrief is the sub-issue's title and body.
//
// Deliberately short, and deliberately silent about how to run a retrospect:
// that belongs in the agent's instructions, where it can be changed without
// redeploying the server. What the body carries is the one thing the
// instructions cannot know — which issue this is about.
func retrospectBrief(issue db.Issue) (string, string) {
	title := strings.TrimSpace(issue.Title)
	if title == "" {
		title = "this issue"
	}
	const titleLimit = 120
	if len([]rune(title)) > titleLimit {
		title = string([]rune(title)[:titleLimit]) + "…"
	}

	body := strings.Join([]string{
		"Review the work on the parent issue and decide what, if anything, should change as a result.",
		"",
		"Read the parent issue's comments, timeline and agent runs before forming a view.",
		"Most retrospects conclude that nothing needs to change; that is a result, and reporting it is the job.",
		"",
		"If you want to change a skill, an agent's instructions or an agent family's brief, propose it here first and wait for a person to agree.",
	}, "\n")

	return "Retrospect: " + title, body
}

// isRetrospectDuplicate reports whether err is the once-only index rejecting a
// second retrospect for the same origin issue.
func isRetrospectDuplicate(err error) bool {
	return strings.Contains(err.Error(), "idx_issue_origin_retrospect")
}
