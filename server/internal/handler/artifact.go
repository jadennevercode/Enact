package handler

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/enact-ai/enact/server/pkg/db/generated"
)

const (
	defaultArtifactLimit = 500
	maxArtifactLimit     = 2000
)

// ArtifactResponse is one file produced under an issue or a chat session,
// carrying the issue it came from so the client can group the flat list.
//
// The owner fields are omitted when the file came from chat rather than from
// an issue. Under the issue scope every row has one; under the chat scope
// normally none does.
type ArtifactResponse struct {
	AttachmentResponse
	OwnerIssueID         string `json:"owner_issue_id,omitempty"`
	OwnerIssueNumber     int32  `json:"owner_issue_number,omitempty"`
	OwnerIssueIdentifier string `json:"owner_issue_identifier,omitempty"`
	OwnerIssueTitle      string `json:"owner_issue_title,omitempty"`
}

// artifactRow is the shape both listings share.
//
// sqlc emits a distinct row type per query, and here they genuinely differ:
// the issue listing INNER JOINs the issue, so its owner columns are non-null
// (`int32`, `string`), while the chat listing LEFT JOINs and gets nullable
// ones. Both are normalised here, with `ownerIssueID.Valid` as the single test
// for whether an owner exists — on the chat side that flag also covers the
// number and the title, which come from the same joined row.
type artifactRow struct {
	attachment       db.Attachment
	ownerIssueID     pgtype.UUID
	ownerIssueNumber int32
	ownerIssueTitle  string
}

func issueArtifactRow(r db.ListArtifactsByIssueRow) artifactRow {
	return artifactRow{
		attachment: db.Attachment{
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
		},
		ownerIssueID:     r.OwnerIssueID,
		ownerIssueNumber: r.OwnerIssueNumber,
		ownerIssueTitle:  r.OwnerIssueTitle,
	}
}

func chatArtifactRow(r db.ListArtifactsByChatSessionRow) artifactRow {
	return artifactRow{
		attachment: db.Attachment{
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
		},
		ownerIssueID:     r.OwnerIssueID,
		ownerIssueNumber: r.OwnerIssueNumber.Int32,
		ownerIssueTitle:  r.OwnerIssueTitle.String,
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

// writeArtifacts renders one listing. extra carries scope identity the client
// cannot derive from the route on its own — an issue route accepts a
// human-readable identifier, so the resolved UUID has to be told, not assumed.
func (h *Handler) writeArtifacts(w http.ResponseWriter, r *http.Request, wsID pgtype.UUID, rows []artifactRow, limit int32, extra map[string]any) {
	mode := attachmentURLModeFromRequest(r)
	prefix := h.getIssuePrefix(r.Context(), wsID)
	artifacts := make([]ArtifactResponse, len(rows))
	for i, row := range rows {
		out := ArtifactResponse{
			AttachmentResponse: h.attachmentToResponse(row.attachment, mode),
		}
		// A chat upload has no owning issue, and the identifier must not be
		// synthesised from a zero number — `ENA-0` addresses nothing.
		if row.ownerIssueID.Valid {
			out.OwnerIssueID = uuidToString(row.ownerIssueID)
			out.OwnerIssueNumber = row.ownerIssueNumber
			out.OwnerIssueIdentifier = prefix + "-" + strconv.Itoa(int(row.ownerIssueNumber))
			out.OwnerIssueTitle = row.ownerIssueTitle
		}
		artifacts[i] = out
	}

	body := map[string]any{
		"artifacts": artifacts,
		"total":     len(artifacts),
		// The listing hit the row cap, so the tree the client builds is a
		// prefix of the truth. Surfaced so the UI can say so.
		"truncated": int32(len(artifacts)) >= limit,
	}
	for k, v := range extra {
		body[k] = v
	}
	writeJSON(w, http.StatusOK, body)
}

// ListIssueArtifacts — GET /api/issues/{id}/artifacts
//
// Every file this issue produced, plus the files its direct children produced.
// The response is flat; the client splits the issue's own files from each
// child's by the owner issue, and groups versions by filename.
//
// scope_issue_id is the resolved issue, so a client that arrived by
// identifier ("ENA-42") can still tell its own rows from a child's.
func (h *Handler) ListIssueArtifacts(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}

	limit := artifactLimit(r.URL.Query().Get("limit"))
	rows, err := h.Queries.ListArtifactsByIssue(r.Context(), db.ListArtifactsByIssueParams{
		WorkspaceID: issue.WorkspaceID,
		IssueID:     issue.ID,
		RowLimit:    limit,
	})
	if err != nil {
		slog.Error("failed to list issue artifacts", "issue_id", uuidToString(issue.ID), "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list artifacts")
		return
	}

	out := make([]artifactRow, len(rows))
	for i, row := range rows {
		out[i] = issueArtifactRow(row)
	}
	h.writeArtifacts(w, r, issue.WorkspaceID, out, limit, map[string]any{
		"scope_issue_id": uuidToString(issue.ID),
	})
}

// ListChatSessionArtifacts — GET /api/chat/sessions/{sessionId}/artifacts
//
// Every file uploaded into one chat session, by the member or by the agent.
// Gated exactly like the transcript: losing access to the agent takes the
// files with it.
func (h *Handler) ListChatSessionArtifacts(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	session, ok := h.gatePublicChatSessionForUser(w, r, userID, workspaceID, chi.URLParam(r, "sessionId"))
	if !ok {
		return
	}

	limit := artifactLimit(r.URL.Query().Get("limit"))
	rows, err := h.Queries.ListArtifactsByChatSession(r.Context(), db.ListArtifactsByChatSessionParams{
		WorkspaceID:   session.WorkspaceID,
		ChatSessionID: session.ID,
		RowLimit:      limit,
	})
	if err != nil {
		slog.Error("failed to list chat artifacts", "chat_session_id", uuidToString(session.ID), "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list artifacts")
		return
	}

	out := make([]artifactRow, len(rows))
	for i, row := range rows {
		out[i] = chatArtifactRow(row)
	}
	h.writeArtifacts(w, r, session.WorkspaceID, out, limit, nil)
}
