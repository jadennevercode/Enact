package handler

import (
	"context"
	"errors"
	"fmt"

	"github.com/enact-ai/enact/server/internal/issuestatus"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/dbid"
	"github.com/enact-ai/enact/server/pkg/protocol"
	"github.com/jackc/pgx/v5"
)

// A specialist can finish its work with an Issue still in review. An explicit
// construction handoff, followed by successful task completion, wakes the
// construction coordinator without treating that handoff as member approval.
// Ordinary Issues retain their existing child-done stage barriers.
func (h *Handler) semanticReconcileConstructionHandoff(ctx context.Context, task *db.AgentTaskQueue) error {
	if task == nil || task.Status != "completed" || !task.IssueID.Valid || !task.OriginatorUserID.Valid {
		return nil
	}
	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", task.ID.String()+":ontology-handoff"); err != nil {
		return err
	}
	var eventID, parentID, squadID, stage string
	err = tx.QueryRow(ctx, `WITH RECURSIVE ancestors AS (
        SELECT id,parent_issue_id,workspace_id FROM issue WHERE id=$1
        UNION ALL SELECT i.id,i.parent_issue_id,i.workspace_id FROM issue i JOIN ancestors a ON a.parent_issue_id=i.id AND a.workspace_id=i.workspace_id
    ) SELECT e.id::text,c.issue_id::text,c.squad_id::text,c.stage
    FROM semantic_construction_event e
    JOIN semantic_construction c ON c.id=e.construction_id AND c.workspace_id=e.workspace_id
    JOIN ancestors a ON a.id=c.issue_id AND a.workspace_id=c.workspace_id
    JOIN agent_task_queue t ON t.id=e.task_id AND t.agent_id=e.actor_id
    WHERE t.id=$2 AND t.status='completed' AND t.issue_id=$1
      AND e.actor_type='agent' AND e.kind='handoff' AND e.stage=c.stage
      AND c.issue_id<>t.issue_id AND c.status='active'
      AND NOT EXISTS (SELECT 1 FROM semantic_review_packet p WHERE p.workspace_id=c.workspace_id AND p.construction_id=c.id AND p.gate=c.stage AND p.status='pending')
    ORDER BY e.created_at DESC,e.id DESC LIMIT 1`, task.IssueID, task.ID).Scan(&eventID, &parentID, &squadID, &stage)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	qtx := db.New(tx)
	parent, err := qtx.GetIssue(ctx, parseUUID(parentID))
	if err != nil {
		return err
	}
	if !parent.AssigneeType.Valid || parent.AssigneeType.String != "squad" || parent.AssigneeID.String() != squadID {
		return nil
	}
	status := issuestatus.Effective(ctx, h.Queries, parent.WorkspaceID, parent.Status)
	if status == "backlog" || status == "done" || status == "cancelled" {
		return nil
	}
	names := map[string]string{"scope": "范围", "model": "模型", "operations": "行动与规则", "release": "发布"}
	content := fmt.Sprintf("[@本体构建协调者](mention://squad/%s)\n\n本轮「%s」的[专业任务](mention://issue/%s)已完成，结果已保存。请读取检查与交接记录，继续组织必要的修正和复核。需要人工确认时，准备对应的审阅内容并等待确认；这条交接消息不代表批准。", squadID, names[stage], task.IssueID.String())
	// The comment and its source task are the idempotency identity, not fields
	// supplied by the Family in an arbitrary event data object.
	var commentID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM comment WHERE workspace_id=$1 AND issue_id=$2 AND source_task_id=$3 AND author_type='agent' AND author_id=$4 AND content=$5 ORDER BY created_at,id LIMIT 1`, parent.WorkspaceID, parent.ID, task.ID, task.AgentID, content).Scan(&commentID)
	createdNew := false
	var issueRevision int64
	if errors.Is(err, pgx.ErrNoRows) {
		created, createErr := qtx.CreateComment(ctx, db.CreateCommentParams{ID: dbid.NewV7(), IssueID: parent.ID, WorkspaceID: parent.WorkspaceID, AuthorType: "agent", AuthorID: task.AgentID, Content: content, Type: "comment", SourceTaskID: task.ID})
		if createErr != nil {
			return createErr
		}
		commentID = created.ID.String()
		issueRevision = created.IssueRevision
		createdNew = true
	} else if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE semantic_construction_event SET data=data || jsonb_build_object('coordinator_handoff',jsonb_build_object('comment_id',$2::text,'status','pending')) WHERE id=$1`, eventID, commentID); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	comment, err := h.Queries.GetCommentInWorkspace(ctx, db.GetCommentInWorkspaceParams{ID: parseUUID(commentID), WorkspaceID: parent.WorkspaceID})
	if err != nil {
		return err
	}
	if createdNew {
		h.publish(protocol.EventCommentCreated, parent.WorkspaceID.String(), "agent", task.AgentID.String(), map[string]any{"comment": commentToResponse(comment, nil, nil), "issue_title": parent.Title, "issue_assignee_type": textToPtr(parent.AssigneeType), "issue_assignee_id": uuidToPtr(parent.AssigneeID), "issue_status": parent.Status, "issue_revision": issueRevision})
	}
	// Serialize retries after the comment is visible to normal routing. That
	// routing owns invocation checks and queued/coalesced/deferred delivery.
	dispatchTx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return err
	}
	defer dispatchTx.Rollback(ctx)
	if _, err = dispatchTx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", task.ID.String()+":ontology-handoff-dispatch"); err != nil {
		return err
	}
	var delivered, cancelled bool
	err = dispatchTx.QueryRow(ctx, `SELECT
        EXISTS(SELECT 1 FROM agent_task_queue WHERE issue_id=$1 AND
            ($2=ANY(delivered_comment_ids) OR (status NOT IN ('failed','cancelled','completed') AND (trigger_comment_id=$2 OR $2=ANY(coalesced_comment_ids))))),
        EXISTS(SELECT 1 FROM agent_task_queue WHERE issue_id=$1 AND status='cancelled' AND (trigger_comment_id=$2 OR $2=ANY(coalesced_comment_ids)))`, parent.ID, parseUUID(commentID)).Scan(&delivered, &cancelled)
	if err != nil {
		return err
	}
	result := map[string]any{"status": "delivered", "comment_id": commentID}
	if cancelled {
		result["status"] = "cancelled"
	} else if !delivered {
		outcomes := h.triggerTasksForComment(ctx, parent, comment, nil, "agent", task.AgentID.String(), task.OriginatorUserID.String(), "", nil)
		result = semanticCoordinatorResumeResult(commentID, outcomes)
	}
	if _, err = dispatchTx.Exec(ctx, `UPDATE semantic_construction_event SET data=data || jsonb_build_object('coordinator_handoff',$2::jsonb) WHERE id=$1`, eventID, semanticMarshal(result)); err != nil {
		return err
	}
	if err = dispatchTx.Commit(ctx); err != nil {
		return err
	}
	if result["status"] == "failed" {
		return fmt.Errorf("ontology handoff saved but coordinator dispatch failed")
	}
	return nil
}
