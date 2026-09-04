package handler

import (
	"log/slog"
	"net/http"
	"strconv"

	db "github.com/enact-ai/enact/server/pkg/db/generated"
)

const (
	defaultArtifactLimit = 500
	maxArtifactLimit     = 2000
)

// ArtifactResponse is one file the workspace produced, carrying the issue it
// came from so the client can group the flat list into folders.
//
// The owner fields are omitted when the file came from chat rather than from
// an issue. Those files could not appear at all while this listing was scoped
// to a project, because a chat session belonged to none; the client files them
// under an unfiled group.
type ArtifactResponse struct {
	AttachmentResponse
	OwnerIssueID         string `json:"owner_issue_id,omitempty"`
	OwnerIssueNumber     int32  `json:"owner_issue_number,omitempty"`
	OwnerIssueIdentifier string `json:"owner_issue_identifier,omitempty"`
	OwnerIssueTitle      string `json:"owner_issue_title,omitempty"`
}

func artifactRowToAttachment(r db.ListAttachmentsByWorkspaceRow) db.Attachment {
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

// artifactLimit clamps the caller's ?limit. An unparseable or non-positive
// value takes the default rather than erroring: the parameter is a UI
// affordance, not part of the contract.
func artifactLimit(raw string) int32 {
	if raw == "" {
		return defaultArtifactLimit
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultArtifactLimit
	}
	if n > maxArtifactLimit {
		return maxArtifactLimit
	}
	return int32(n)
}

// ListArtifacts — GET /api/artifacts
//
// Every file the workspace produced. The response is flat; folder structure
// and version grouping are derived on the client from the owner issue and the
// filename.
func (h *Handler) ListArtifacts(w http.ResponseWriter, r *http.Request) {
	wsID, ok := parseUUIDOrBadRequest(w, h.resolveWorkspaceID(r), "workspace id")
	if !ok {
		return
	}

	limit := artifactLimit(r.URL.Query().Get("limit"))
	rows, err := h.Queries.ListAttachmentsByWorkspace(r.Context(), db.ListAttachmentsByWorkspaceParams{
		WorkspaceID: wsID,
		RowLimit:    limit,
	})
	if err != nil {
		slog.Error("failed to list workspace artifacts", "workspace_id", uuidToString(wsID), "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list artifacts")
		return
	}

	mode := attachmentURLModeFromRequest(r)
	prefix := h.getIssuePrefix(r.Context(), wsID)
	artifacts := make([]ArtifactResponse, len(rows))
	for i, row := range rows {
		out := ArtifactResponse{
			AttachmentResponse: h.attachmentToResponse(artifactRowToAttachment(row), mode),
		}
		// A chat upload has no owning issue, and the identifier must not be
		// synthesised from a zero number — `ENA-0` addresses nothing.
		if row.OwnerIssueID.Valid {
			out.OwnerIssueID = uuidToString(row.OwnerIssueID)
			out.OwnerIssueNumber = row.OwnerIssueNumber.Int32
			out.OwnerIssueIdentifier = prefix + "-" + strconv.Itoa(int(row.OwnerIssueNumber.Int32))
			out.OwnerIssueTitle = row.OwnerIssueTitle.String
		}
		artifacts[i] = out
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"artifacts": artifacts,
		"total":     len(artifacts),
		// The listing hit the row cap, so the tree the client builds is a
		// prefix of the truth. Surfaced so the UI can say so.
		"truncated": int32(len(artifacts)) >= limit,
	})
}
