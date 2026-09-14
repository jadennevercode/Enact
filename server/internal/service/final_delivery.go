package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/enact-ai/enact/server/internal/util"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/dbid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// CreateFinalComment is called inside the same transaction as its receipt.
// The source task row serializes competing explicit/fallback final deliveries.
func CreateFinalComment(ctx context.Context, q *db.Queries, params db.CreateCommentParams, revision int64) (db.Comment, int64, bool, error) {
	if revision < 1 || !params.SourceTaskID.Valid {
		return db.Comment{}, 0, false, fmt.Errorf("final delivery requires a source task and positive revision")
	}
	task, err := q.GetAgentTaskForDelegatedFailureUpdate(ctx, params.SourceTaskID)
	if err != nil {
		return db.Comment{}, 0, false, err
	}
	if task.IssueID != params.IssueID || task.AgentID != params.AuthorID {
		return db.Comment{}, 0, false, fmt.Errorf("final delivery must target the source task's issue")
	}
	key := "root"
	if params.ParentID.Valid {
		root, err := q.GetThreadRoot(ctx, db.GetThreadRootParams{CommentID: params.ParentID, WorkspaceID: params.WorkspaceID})
		if err != nil {
			return db.Comment{}, 0, false, err
		}
		key = util.UUIDToString(root.ID)
	}
	existing, err := q.GetFinalDelivery(ctx, db.GetFinalDeliveryParams{TaskID: task.ID, ParentKey: key, Revision: revision})
	if err == nil {
		return existing, 0, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return db.Comment{}, 0, false, err
	}
	if recorded, err := q.FinalDeliveryRecorded(ctx, db.FinalDeliveryRecordedParams{TaskID: task.ID, ParentKey: key, Revision: revision}); err != nil {
		return db.Comment{}, 0, false, err
	} else if recorded {
		return db.Comment{}, 0, false, ErrContextStale
	} // A human deleted the delivered comment; do not recreate it.
	if task.Status != "running" && task.Status != "dispatched" && task.Status != "completed" {
		return db.Comment{}, 0, false, fmt.Errorf("source task is not deliverable")
	}
	created, err := q.CreateComment(ctx, params)
	if err != nil {
		return db.Comment{}, 0, false, err
	}
	err = q.CreateFinalDelivery(ctx, db.CreateFinalDeliveryParams{TaskID: task.ID, WorkspaceID: params.WorkspaceID, IssueID: params.IssueID, ParentKey: key, Revision: revision, CommentID: created.ID})
	return created.Comment(), created.IssueRevision, true, err
}

// PersistFinalFallback runs before completion commits. Progress comments do
// not discharge this obligation; each original thread gets at most one result.
func PersistFinalFallback(ctx context.Context, q *db.Queries, task db.AgentTaskQueue, content string, plan func(context.Context, *db.Queries, db.Comment) error) error {
	if content == "" || (task.TriggerCommentID.Valid && isTrivialDoneOutput(content)) {
		return nil
	}
	noAction, err := HasSquadLeaderNoActionEvaluationForTask(ctx, q, task)
	if err != nil {
		return err
	}
	if noAction {
		return nil
	}
	issue, err := q.GetIssue(ctx, task.IssueID)
	if err != nil {
		return err
	}
	parents := []pgtype.UUID{task.TriggerCommentID}
	if task.TriggerCommentID.Valid {
		parents = append(parents, task.DeliveredCommentIds...)
	}
	for _, parent := range parents {
		if task.TriggerCommentID.Valid && !parent.Valid {
			continue
		}
		if parent.Valid {
			if _, err := q.GetCommentInWorkspace(ctx, db.GetCommentInWorkspaceParams{ID: parent, WorkspaceID: issue.WorkspaceID}); errors.Is(err, pgx.ErrNoRows) {
				continue // The original target was deleted; never reroute it to a different thread.
			} else if err != nil {
				return err
			}
		}
		key := "root"
		if parent.Valid {
			root, err := q.GetThreadRoot(ctx, db.GetThreadRootParams{CommentID: parent, WorkspaceID: issue.WorkspaceID})
			if err != nil {
				return err
			}
			key = util.UUIDToString(root.ID)
		}
		if delivered, err := q.HasFinalDeliveryForThread(ctx, db.HasFinalDeliveryForThreadParams{TaskID: task.ID, ParentKey: key}); err != nil {
			return err
		} else if delivered {
			continue
		}
		comment, _, fresh, createErr := CreateFinalComment(ctx, q, db.CreateCommentParams{ID: dbid.NewV7(), IssueID: issue.ID, WorkspaceID: issue.WorkspaceID, AuthorType: "agent", AuthorID: task.AgentID, Content: content, Type: "comment", ParentID: parent, SourceTaskID: task.ID}, 1)
		if createErr != nil {
			return createErr
		}
		if fresh && plan != nil {
			if err = plan(ctx, q, comment); err != nil {
				return err
			}
		}
	}
	return nil
}
