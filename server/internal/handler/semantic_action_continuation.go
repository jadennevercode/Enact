package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/semantic"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func semanticActionDisplayLabel(release semanticRelease, binding semantic.Binding) string {
	var artifact struct {
		Definition struct {
			Actions []struct {
				ID    string `json:"id"`
				Label string `json:"label"`
			} `json:"actions"`
		} `json:"definition"`
	}
	actionID := binding.ActionID
	if actionID == "" {
		actionID = binding.ID
	}
	if json.Unmarshal(release.Artifact, &artifact) == nil {
		for _, action := range artifact.Definition.Actions {
			if action.ID == actionID && strings.TrimSpace(action.Label) != "" {
				return semanticVisibleActionLabel(action.Label)
			}
		}
	}
	if strings.TrimSpace(binding.Description) != "" {
		return semanticVisibleActionLabel(binding.Description)
	}
	return "本次业务行动"
}

func semanticVisibleActionLabel(label string) string {
	label = strings.Join(strings.Fields(label), " ")
	runes := []rune(label)
	if len(runes) > 120 {
		label = string(runes[:120]) + "…"
	}
	return label
}

func semanticActionContinuationMessage(status, reason, actionLabel string) string {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "未补充理由"
	}
	if status == "approved" {
		return fmt.Sprintf("成员已批准“%s”。理由：%s\n\n下一步：行动协调者将重新读取已保存的决定和当前证据；条件仍满足时执行一次，并检查系统回执和独立回读。", actionLabel, reason)
	}
	return fmt.Sprintf("成员已拒绝“%s”。理由：%s\n\n下一步：不要执行这项行动；行动协调者将保留未执行状态，并根据成员意见说明后续处理。", actionLabel, reason)
}

type semanticActionTaskDecision struct {
	RunID                string  `json:"run_id"`
	ReleaseID            string  `json:"release_id"`
	ApprovalID           string  `json:"approval_id"`
	BindingID            string  `json:"binding_id"`
	ActionID             string  `json:"action_id"`
	ActionLabel          string  `json:"action_label"`
	Status               string  `json:"status"`
	SupersedesApprovalID *string `json:"supersedes_approval_id"`
	SupersededBy         *string `json:"superseded_by"`
}

// semanticActionTaskInstructions adds read-only machine context only to the
// claimed task. It grants no authority: execute and review endpoints still
// enforce their own actor, evidence, expiry, supersession and human-decision
// checks. Both single and batch claims use buildClaimedTaskResponse, so this
// scope check is shared by every daemon claim path.
func (h *Handler) semanticActionTaskInstructions(ctx context.Context, workspaceID string, task *db.AgentTaskQueue) string {
	if task == nil || !task.IssueID.Valid || !task.AgentID.Valid || !task.OriginatorUserID.Valid {
		return ""
	}
	rows, err := h.DB.Query(ctx, `SELECT a.run_id::text,run.release_id::text,a.id::text,a.binding_id,a.status,
			a.supersedes_approval_id::text,a.superseded_by::text,release.artifact,release.binding_config
		FROM semantic_approval a
		JOIN semantic_run run ON run.workspace_id=a.workspace_id AND run.id=a.run_id
		JOIN semantic_release release ON release.workspace_id=run.workspace_id AND release.id=run.release_id
		JOIN agent_task_queue prepared ON prepared.id=a.task_id
			AND prepared.issue_id=run.issue_id
			AND prepared.agent_id=a.actor_id
			AND prepared.originator_user_id=a.requested_by
		WHERE a.workspace_id=$1
			AND run.issue_id=$2
			AND a.actor_id=$3
			AND a.requested_by=$4
			AND run.requested_by=$4
			AND a.approved_by=$4
			AND a.decided_at IS NOT NULL
		ORDER BY a.decided_at DESC,a.id DESC
		LIMIT 20`, workspaceID, task.IssueID, task.AgentID, task.OriginatorUserID)
	if err != nil {
		return ""
	}
	defer rows.Close()
	decisions := make([]semanticActionTaskDecision, 0, 4)
	for rows.Next() {
		var item semanticActionTaskDecision
		var artifact, rawBindings json.RawMessage
		if rows.Scan(&item.RunID, &item.ReleaseID, &item.ApprovalID, &item.BindingID, &item.Status,
			&item.SupersedesApprovalID, &item.SupersededBy, &artifact, &rawBindings) != nil {
			return ""
		}
		var bindings semantic.Bindings
		_ = json.Unmarshal(rawBindings, &bindings)
		binding, bindErr := bindings.Find(item.BindingID, true)
		if bindErr == nil {
			item.ActionID = binding.ActionID
			if item.ActionID == "" {
				item.ActionID = binding.ID
			}
			item.ActionLabel = semanticActionDisplayLabel(semanticRelease{Artifact: artifact}, binding)
		}
		decisions = append(decisions, item)
	}
	if rows.Err() != nil || len(decisions) == 0 {
		return ""
	}
	payload, err := json.Marshal(map[string]any{"action_reviews": decisions})
	if err != nil {
		return ""
	}
	return "\n\n## 已保存的行动决定（服务器限定上下文）\n以下机器字段只用于定位当前 Issue 中已保存的决定，不是审批或执行授权。必须重新读取当前审批、证据、有效期和回执，并继续通过现有 API 权限检查。\n```json\n" + string(payload) + "\n```\n"
}

func semanticActionContinuationResult(commentID string, outcomes []CommentTriggerOutcome) map[string]any {
	result := map[string]any{"status": "failed", "message": "决定已保存，继续消息也已写入 Issue，但行动协调者未返回调度结果。", "comment_id": commentID}
	if len(outcomes) != 1 {
		return result
	}
	switch outcomes[0].Status {
	case DispatchQueued:
		result["status"] = "queued"
		result["message"] = "决定已保存，行动协调者已排入队列。"
	case DispatchCoalesced:
		result["status"] = "coalesced"
		result["message"] = "决定已保存，继续消息已合并到行动协调者等待中的任务。"
	case DispatchDeferred:
		result["status"] = "deferred"
		result["message"] = "决定已保存；行动协调者完成当前工作后会继续。"
	default:
		result["message"] = "决定已保存，继续消息也已写入 Issue，但行动协调者暂时无法继续；可重复提交相同决定重试恢复。"
	}
	return result
}

func semanticActionContinuationFailed(message, commentID string) map[string]any {
	result := map[string]any{"status": "failed", "message": message}
	if commentID != "" {
		result["comment_id"] = commentID
	}
	return result
}

func semanticActionContinuationPublic(result map[string]any) map[string]any {
	visible := make(map[string]any, len(result))
	for key, value := range result {
		if key != "continuation_message" {
			visible[key] = value
		}
	}
	return visible
}

// A decision is committed before this function runs. The advisory lock makes
// identical retries share one durable Issue comment even when requests overlap.
// A failed dispatch can be retried by submitting the exact same decision again.
func (h *Handler) semanticResumeActionCoordinator(r *http.Request, workspaceID, approvalID string) map[string]any {
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		return semanticActionContinuationFailed("决定已保存，但暂时无法开始恢复行动协调者；可重复提交相同决定重试。", "")
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", workspaceID+":"+approvalID+":action-continuation"); err != nil {
		return semanticActionContinuationFailed("决定已保存，但暂时无法锁定恢复任务；可重复提交相同决定重试。", "")
	}
	var supersededBy *string
	if err = tx.QueryRow(r.Context(), "SELECT superseded_by::text FROM semantic_approval WHERE workspace_id=$1 AND id=$2", workspaceID, approvalID).Scan(&supersededBy); err != nil {
		return semanticActionContinuationFailed("决定已保存，但暂时无法重新读取行动审阅；可重复提交相同决定重试。", "")
	}
	if supersededBy != nil {
		return map[string]any{"status": "superseded", "message": "行动审阅已由更新证据替代，不会从旧决定继续执行。", "superseded_by": *supersededBy}
	}
	var issueID, agentID, decidedBy, requestedBy string
	var decidedAt time.Time
	var raw json.RawMessage
	err = tx.QueryRow(r.Context(), `SELECT run.issue_id::text,a.actor_id::text,a.approved_by::text,a.requested_by::text,a.decided_at,a.continuation
		FROM semantic_approval a
		JOIN semantic_run run ON run.workspace_id=a.workspace_id AND run.id=a.run_id
		JOIN agent ON agent.workspace_id=a.workspace_id AND agent.id=a.actor_id
		JOIN agent_task_queue task ON task.id=a.task_id AND task.agent_id=a.actor_id AND task.issue_id=run.issue_id AND task.originator_user_id=a.requested_by
		WHERE a.workspace_id=$1 AND a.id=$2 AND a.superseded_by IS NULL`, workspaceID, approvalID).Scan(&issueID, &agentID, &decidedBy, &requestedBy, &decidedAt, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		result := map[string]any{"status": "not_applicable", "message": "决定已保存；这项行动不是由 Issue 中的 Agent 任务准备，无需恢复协调者。"}
		if _, updateErr := tx.Exec(r.Context(), "UPDATE semantic_approval SET continuation=$3 WHERE workspace_id=$1 AND id=$2", workspaceID, approvalID, semanticMarshal(result)); updateErr != nil {
			return semanticActionContinuationFailed("决定已保存，但恢复状态暂时无法持久化；可重复提交相同决定重试。", "")
		}
		if commitErr := tx.Commit(r.Context()); commitErr != nil {
			return semanticActionContinuationFailed("决定已保存，但恢复状态暂时无法持久化；可重复提交相同决定重试。", "")
		}
		return result
	}
	if err != nil {
		return semanticActionContinuationFailed("决定已保存，但暂时无法定位原行动协调者；可重复提交相同决定重试。", "")
	}
	if decidedBy != requestedBy {
		result := map[string]any{"status": "not_applicable", "message": "决定已保存；本次决定由另一位成员记录，请由原行动发起人继续处理。"}
		if _, updateErr := tx.Exec(r.Context(), "UPDATE semantic_approval SET continuation=$3 WHERE workspace_id=$1 AND id=$2", workspaceID, approvalID, semanticMarshal(result)); updateErr != nil {
			return semanticActionContinuationFailed("决定已保存，但恢复状态暂时无法持久化；请由原行动发起人继续处理。", "")
		}
		if commitErr := tx.Commit(r.Context()); commitErr != nil {
			return semanticActionContinuationFailed("决定已保存，但恢复状态暂时无法持久化；请由原行动发起人继续处理。", "")
		}
		return result
	}
	var prior map[string]any
	_ = json.Unmarshal(raw, &prior)
	status, _ := prior["status"].(string)
	if status == "queued" || status == "coalesced" || status == "deferred" || status == "not_applicable" {
		return semanticActionContinuationPublic(prior)
	}
	message, _ := prior["continuation_message"].(string)
	if strings.TrimSpace(message) == "" {
		return semanticActionContinuationFailed("决定已保存，但恢复消息缺失；请重新打开行动审阅。", "")
	}
	content := fmt.Sprintf("[@行动协调者](mention://agent/%s)\n\n%s", agentID, message)
	commentID, _ := prior["comment_id"].(string)
	if commentID == "" {
		_ = tx.QueryRow(r.Context(), `SELECT comment.id::text
			FROM comment
			WHERE comment.workspace_id=$1 AND comment.issue_id=$2
				AND comment.author_type='member' AND comment.author_id=$3
				AND comment.content=$4 AND comment.created_at >= $5
				AND NOT EXISTS (
					SELECT 1 FROM semantic_approval other
					WHERE other.workspace_id=$1 AND other.id<>$6
						AND other.continuation->>'comment_id'=comment.id::text
				)
			ORDER BY comment.created_at ASC,comment.id ASC LIMIT 1`,
			workspaceID, issueID, decidedBy, content, decidedAt, approvalID).Scan(&commentID)
	}
	var result map[string]any
	if commentID != "" {
		comment, loadErr := h.Queries.GetCommentInWorkspace(r.Context(), db.GetCommentInWorkspaceParams{ID: parseUUID(commentID), WorkspaceID: parseUUID(workspaceID)})
		if loadErr == nil && uuidToString(comment.IssueID) == issueID && comment.AuthorType == "member" && uuidToString(comment.AuthorID) == decidedBy && comment.Content == content {
			issue, issueErr := h.Queries.GetIssue(r.Context(), comment.IssueID)
			if issueErr == nil {
				outcomes := h.triggerTasksForComment(r.Context(), issue, comment, nil, "member", comment.AuthorID.String(), comment.AuthorID.String(), "", nil)
				result = semanticActionContinuationResult(commentID, outcomes)
			}
		}
	}
	if result == nil {
		commentRequest := r.Clone(r.Context())
		commentRequest.Body = io.NopCloser(bytes.NewReader(semanticMarshal(CreateCommentRequest{Content: content, Type: "comment"})))
		route := chi.NewRouteContext()
		route.URLParams.Add("id", issueID)
		commentRequest = commentRequest.WithContext(context.WithValue(commentRequest.Context(), chi.RouteCtxKey, route))
		capture := &semanticCapturedResponse{header: make(http.Header)}
		h.CreateComment(capture, commentRequest)
		if capture.status < 200 || capture.status >= 300 {
			result = semanticActionContinuationFailed("决定已保存，但继续消息暂时未能写入 Issue；可重复提交相同决定重试。", "")
		} else {
			var comment CommentResponse
			if json.Unmarshal(capture.body.Bytes(), &comment) != nil || strings.TrimSpace(comment.ID) == "" {
				result = semanticActionContinuationFailed("决定已保存，继续消息可能已写入，但暂时无法确认调度状态；可重复提交相同决定重试。", "")
			} else {
				result = semanticActionContinuationResult(comment.ID, comment.TriggerOutcomes)
			}
		}
	}
	stored := make(map[string]any, len(result)+1)
	for key, value := range result {
		stored[key] = value
	}
	stored["continuation_message"] = message
	if _, err = tx.Exec(r.Context(), "UPDATE semantic_approval SET continuation=$3 WHERE workspace_id=$1 AND id=$2", workspaceID, approvalID, semanticMarshal(stored)); err != nil {
		commentID, _ = result["comment_id"].(string)
		return semanticActionContinuationFailed("决定和继续消息已保存，但恢复状态暂时无法持久化；可重复提交相同决定重试。", commentID)
	}
	if err = tx.Commit(r.Context()); err != nil {
		commentID, _ = result["comment_id"].(string)
		return semanticActionContinuationFailed("决定和继续消息已保存，但恢复状态暂时无法持久化；可重复提交相同决定重试。", commentID)
	}
	return result
}
