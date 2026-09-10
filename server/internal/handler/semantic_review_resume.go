package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/go-chi/chi/v5"
)

// A human decision is committed before this wake-up is attempted. The comment
// is the durable input consumed by Enact's normal queued/coalesced/deferred
// task machinery, so a runtime outage cannot erase or disguise the decision.
func (h *Handler) semanticResumeConstructionCoordinator(r *http.Request, workspaceID, constructionID, eventID, message string) map[string]any {
	var issueID, squadID string
	if err := h.DB.QueryRow(r.Context(), `SELECT c.issue_id::text,c.squad_id::text
		FROM semantic_construction c JOIN squad s ON s.id=c.squad_id AND s.workspace_id=c.workspace_id
		WHERE c.workspace_id=$1 AND c.id=$2`, workspaceID, constructionID).Scan(&issueID, &squadID); err != nil {
		return h.semanticRecordCoordinatorResume(r.Context(), workspaceID, eventID, semanticCoordinatorResumeFailed("已保存你的决定，但暂时找不到本体构建协调者。", ""))
	}
	content := fmt.Sprintf("[@本体构建协调者](mention://squad/%s)\n\n%s", squadID, message)
	commentRequest := r.Clone(r.Context())
	commentRequest.Body = io.NopCloser(bytes.NewReader(semanticMarshal(CreateCommentRequest{Content: content, Type: "comment"})))
	route := chi.NewRouteContext()
	route.URLParams.Add("id", issueID)
	commentRequest = commentRequest.WithContext(context.WithValue(commentRequest.Context(), chi.RouteCtxKey, route))
	capture := &semanticCapturedResponse{header: make(http.Header)}
	h.CreateComment(capture, commentRequest)
	if capture.status < 200 || capture.status >= 300 {
		return h.semanticRecordCoordinatorResume(r.Context(), workspaceID, eventID, semanticCoordinatorResumeFailed("已保存你的决定，但继续消息暂时未能写入 Issue。", ""))
	}
	var comment CommentResponse
	if json.Unmarshal(capture.body.Bytes(), &comment) != nil || strings.TrimSpace(comment.ID) == "" {
		return h.semanticRecordCoordinatorResume(r.Context(), workspaceID, eventID, semanticCoordinatorResumeFailed("已保存你的决定和继续消息，但暂时无法确认协调者调度状态。", ""))
	}
	return h.semanticRecordCoordinatorResume(r.Context(), workspaceID, eventID, semanticCoordinatorResumeResult(comment.ID, comment.TriggerOutcomes))
}

func semanticCoordinatorResumeResult(commentID string, outcomes []CommentTriggerOutcome) map[string]any {
	result := map[string]any{"status": "failed", "message": "继续消息已保存，但协调者未返回调度结果。", "comment_id": commentID}
	if len(outcomes) != 1 {
		return result
	}
	switch outcomes[0].Status {
	case DispatchQueued:
		result["status"] = "queued"
		result["message"] = "继续消息已排入本体构建协调者队列。"
	case DispatchCoalesced:
		result["status"] = "coalesced"
		result["message"] = "继续消息已合并到本体构建协调者等待中的任务。"
	case DispatchDeferred:
		result["status"] = "deferred"
		result["message"] = "继续消息已保存；本体构建协调者完成当前工作后会继续。"
	default:
		result["message"] = "继续消息已保存，但本体构建协调者暂时无法继续。"
	}
	return result
}

func semanticCoordinatorResumeFailed(message, commentID string) map[string]any {
	result := map[string]any{"status": "failed", "message": message}
	if commentID != "" {
		result["comment_id"] = commentID
	}
	return result
}

func (h *Handler) semanticRecordCoordinatorResume(ctx context.Context, workspaceID, eventID string, result map[string]any) map[string]any {
	if _, err := h.DB.Exec(ctx, `UPDATE semantic_construction_event
		SET data=(data-'coordinator_resume_status') || jsonb_build_object('coordinator_resume',$3::jsonb)
		WHERE workspace_id=$1 AND id=$2`, workspaceID, eventID, semanticMarshal(result)); err != nil {
		commentID, _ := result["comment_id"].(string)
		return semanticCoordinatorResumeFailed("已保存你的决定，但继续状态暂时无法持久化；可以重试恢复。", commentID)
	}
	return result
}

// semanticResumeConstruction retries only the durable continuation associated
// with the latest saved human decision. It never recreates or changes that
// decision. When a comment already exists, dispatch is retried from that exact
// comment so the Issue timeline stays idempotent.
func (h *Handler) semanticResumeConstruction(w http.ResponseWriter, r *http.Request) {
	a, constructionID, issueID, ok := h.semanticConstructionScope(w, r)
	if !ok {
		return
	}
	if a.TaskID != nil || a.ActorType == "agent" || isMachineCredentialActor(r) {
		writeError(w, 403, "only a signed-in workspace member may resume a saved human decision")
		return
	}
	var eventID, message string
	var resumeRaw json.RawMessage
	err := h.DB.QueryRow(r.Context(), `SELECT id::text,COALESCE(data->>'coordinator_resume_message',''),COALESCE(data->'coordinator_resume','null'::jsonb)
		FROM semantic_construction_event
		WHERE workspace_id=$1 AND construction_id=$2 AND kind='human_decision' AND data ? 'coordinator_resume_message'
		ORDER BY created_at DESC,id DESC LIMIT 1`, a.WorkspaceID, constructionID).Scan(&eventID, &message, &resumeRaw)
	if err != nil {
		writeError(w, 409, "this construction has no saved human decision to resume")
		return
	}
	var prior map[string]any
	_ = json.Unmarshal(resumeRaw, &prior)
	status, _ := prior["status"].(string)
	if status == "queued" || status == "coalesced" || status == "deferred" {
		writeJSON(w, 200, map[string]any{"coordinator_resume": prior})
		return
	}
	commentID, _ := prior["comment_id"].(string)
	var result map[string]any
	if commentID != "" {
		comment, loadErr := h.Queries.GetCommentInWorkspace(r.Context(), db.GetCommentInWorkspaceParams{ID: parseUUID(commentID), WorkspaceID: parseUUID(a.WorkspaceID)})
		if loadErr == nil && uuidToString(comment.IssueID) == issueID {
			issue, issueErr := h.Queries.GetIssue(r.Context(), comment.IssueID)
			if issueErr == nil {
				outcomes := h.triggerTasksForComment(r.Context(), issue, comment, nil, a.ActorType, a.ActorID, a.UserID, "", nil)
				result = semanticCoordinatorResumeResult(commentID, outcomes)
			}
		}
	}
	if result == nil {
		result = h.semanticResumeConstructionCoordinator(r, a.WorkspaceID, constructionID, eventID, message)
	} else {
		result = h.semanticRecordCoordinatorResume(r.Context(), a.WorkspaceID, eventID, result)
	}
	writeJSON(w, 200, map[string]any{"coordinator_resume": result})
}
