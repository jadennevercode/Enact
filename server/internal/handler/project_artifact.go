package handler

import (
	"log/slog"
	"net/http"
	"strconv"

	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/go-chi/chi/v5"
)

// Row caps for GET /api/projects/{id}/artifacts. The artifacts browser builds
// its whole tree client-side from one response, so the listing is bounded here
// rather than paged: a project past the cap reports `truncated` and the UI says
// so, instead of silently rendering a partial tree as if it were complete.
const (
	defaultProjectArtifactLimit = 500
	maxProjectArtifactLimit     = 2000
)

// ProjectArtifactResponse is one file in a project's artifact listing: the
// attachment itself plus the issue it came from. The owner issue is always
// present — it is the edge the project membership was derived through — and is
// what the browser groups files into folders by.
//
// OwnerIssueID is distinct from the embedded AttachmentResponse.IssueID: a file
// attached to a COMMENT has a null IssueID but still resolves to an owner issue
// through that comment.
type ProjectArtifactResponse struct {
	AttachmentResponse
	OwnerIssueID         string `json:"owner_issue_id"`
	OwnerIssueNumber     int32  `json:"owner_issue_number"`
	OwnerIssueIdentifier string `json:"owner_issue_identifier"`
	OwnerIssueTitle      string `json:"owner_issue_title"`
}

// projectArtifactRowToAttachment re-forms the attachment columns of a joined
// artifact row so the shared attachmentToResponse mapper stays the single place
// that decides download/markdown URL policy.
func projectArtifactRowToAttachment(r db.ListAttachmentsByProjectRow) db.Attachment {
	return db.Attachment{
		ID:            r.ID,
		WorkspaceID:   r.WorkspaceID,
		IssueID:       r.IssueID,
		CommentID:     r.CommentID,
		UploaderType:  r.UploaderType,
		UploaderID:    r.UploaderID,
		Filename:      r.Filename,
		Url:           r.Url,
		ContentType:   r.ContentType,
		SizeBytes:     r.SizeBytes,
		CreatedAt:     r.CreatedAt,
		ChatSessionID: r.ChatSessionID,
		ChatMessageID: r.ChatMessageID,
		TaskID:        r.TaskID,
	}
}

// projectArtifactLimit reads ?limit=, clamping to the row caps. An absent,
// unparseable or non-positive value takes the default rather than erroring:
// the parameter is a UI affordance, not part of the contract.
func projectArtifactLimit(raw string) int32 {
	if raw == "" {
		return defaultProjectArtifactLimit
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultProjectArtifactLimit
	}
	if n > maxProjectArtifactLimit {
		return maxProjectArtifactLimit
	}
	return int32(n)
}

// ListProjectArtifacts — GET /api/projects/{id}/artifacts
//
// Every file produced under a project, resolved through the issues in it. The
// response is flat; folder structure and version grouping are derived on the
// client from the owner issue and filename.
func (h *Handler) ListProjectArtifacts(w http.ResponseWriter, r *http.Request) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}

	limit := projectArtifactLimit(r.URL.Query().Get("limit"))
	rows, err := h.Queries.ListAttachmentsByProject(r.Context(), db.ListAttachmentsByProjectParams{
		ProjectID:   project.ID,
		WorkspaceID: project.WorkspaceID,
		RowLimit:    limit,
	})
	if err != nil {
		slog.Error("failed to list project artifacts", "project_id", uuidToString(project.ID), "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list project artifacts")
		return
	}

	mode := attachmentURLModeFromRequest(r)
	prefix := h.getIssuePrefix(r.Context(), project.WorkspaceID)
	artifacts := make([]ProjectArtifactResponse, len(rows))
	for i, row := range rows {
		artifacts[i] = ProjectArtifactResponse{
			AttachmentResponse:   h.attachmentToResponse(projectArtifactRowToAttachment(row), mode),
			OwnerIssueID:         uuidToString(row.OwnerIssueID),
			OwnerIssueNumber:     row.OwnerIssueNumber,
			OwnerIssueIdentifier: prefix + "-" + strconv.Itoa(int(row.OwnerIssueNumber)),
			OwnerIssueTitle:      row.OwnerIssueTitle,
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"artifacts": artifacts,
		"total":     len(artifacts),
		// The listing hit the row cap, so the tree the client builds is a
		// prefix of the truth. Surfaced so the UI can say so.
		"truncated": int32(len(artifacts)) >= limit,
	})
}
