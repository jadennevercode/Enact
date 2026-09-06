package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/enact-ai/enact/server/internal/logger"
	"github.com/enact-ai/enact/server/internal/workspaceprofile"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
)

// The workspace's project profile.
//
// Two things read it, and they are why it is a first-class field rather than
// more prose in `workspace.context`:
//
//   - the task brief renders it as its own section, so a run starts knowing
//     what the project is;
//   - the Marketplace recommender scores listings against `stack` and
//     `typical_work`, which needs them as lists rather than as a paragraph.
//
// Writable by any member, unlike `workspace.context`, which stays admin-only.
// The distinction is what the two are: context is a standing instruction that
// every agent must follow, and profile is a description of the project that
// every agent may consult. The profile grants nothing and instructs nothing —
// the brief says so where it renders it — and an interview run writes it on
// the member's behalf, so gating it on admin would mean an ordinary member
// cannot answer questions about their own project.

// WorkspaceProfileResponse is the profile on the wire. It mirrors the stored
// shape exactly: the client renders a form over it and posts it back whole.
type WorkspaceProfileResponse struct {
	Summary          string   `json:"summary"`
	Domain           string   `json:"domain"`
	Stack            []string `json:"stack"`
	Languages        []string `json:"languages"`
	TeamSize         string   `json:"team_size"`
	TypicalWork      []string `json:"typical_work"`
	Constraints      string   `json:"constraints"`
	RepoBrief        string   `json:"repo_brief"`
	RepoBriefSources []string `json:"repo_brief_sources"`
	UpdatedAt        string   `json:"updated_at"`
	UpdatedBy        string   `json:"updated_by"`
	// Empty is the question every consumer actually asks, answered once here
	// so no client re-derives "did they fill anything in" from eight fields
	// and gets it subtly different.
	Empty bool `json:"empty"`
}

// profileToResponse renders a stored profile. Lists are emitted as `[]` rather
// than `null` so a client can bind a form to them without a null check.
func profileToResponse(p workspaceprofile.Profile) WorkspaceProfileResponse {
	return WorkspaceProfileResponse{
		Summary:          p.Summary,
		Domain:           p.Domain,
		Stack:            orEmptySlice(p.Stack),
		Languages:        orEmptySlice(p.Languages),
		TeamSize:         p.TeamSize,
		TypicalWork:      orEmptySlice(p.TypicalWork),
		Constraints:      p.Constraints,
		RepoBrief:        p.RepoBrief,
		RepoBriefSources: orEmptySlice(p.RepoBriefSources),
		UpdatedAt:        p.UpdatedAt,
		UpdatedBy:        p.UpdatedBy,
		Empty:            p.IsEmpty(),
	}
}

func orEmptySlice(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

// UpdateWorkspaceProfileRequest is the whole profile. There is no PATCH
// variant on purpose: a profile is authored in one act, and a merge would make
// clearing a field impossible to express.
//
// RepoBrief and RepoBriefSources are accepted so the repository-analysis run
// can write what it found through the same endpoint. A person's form leaves
// them out, which would clear them — so the handler carries them forward when
// the request omits the key entirely. That is the one place this endpoint is
// not a pure replace, and it is what keeps a member editing their summary from
// silently discarding an agent's reading of the repository.
type UpdateWorkspaceProfileRequest struct {
	Summary          *string   `json:"summary"`
	Domain           *string   `json:"domain"`
	Stack            *[]string `json:"stack"`
	Languages        *[]string `json:"languages"`
	TeamSize         *string   `json:"team_size"`
	TypicalWork      *[]string `json:"typical_work"`
	Constraints      *string   `json:"constraints"`
	RepoBrief        *string   `json:"repo_brief"`
	RepoBriefSources *[]string `json:"repo_brief_sources"`
}

// updateWorkspaceProfileBodyLimit bounds the request. The field caps in
// workspaceprofile already bound what is stored; this bounds what is parsed,
// so a multi-megabyte body is refused before it is decoded.
const updateWorkspaceProfileBodyLimit = 64 * 1024

// GetWorkspaceProfile returns the stored profile.
func (h *Handler) GetWorkspaceProfile(w http.ResponseWriter, r *http.Request) {
	ws, ok := h.loadWorkspaceForProfile(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, profileToResponse(workspaceprofile.Parse(ws.Profile)))
}

// UpdateWorkspaceProfile replaces the profile.
func (h *Handler) UpdateWorkspaceProfile(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	ws, ok := h.loadWorkspaceForProfile(w, r)
	if !ok {
		return
	}

	var req UpdateWorkspaceProfileRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, updateWorkspaceProfileBodyLimit))
	if err := decoder.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	current := workspaceprofile.Parse(ws.Profile)
	next := workspaceprofile.Profile{
		Summary:     valueOr(req.Summary, ""),
		Domain:      valueOr(req.Domain, ""),
		Stack:       sliceOr(req.Stack, nil),
		Languages:   sliceOr(req.Languages, nil),
		TeamSize:    valueOr(req.TeamSize, ""),
		TypicalWork: sliceOr(req.TypicalWork, nil),
		Constraints: valueOr(req.Constraints, ""),
		// Carried forward when omitted; see the request type's comment.
		RepoBrief:        valueOr(req.RepoBrief, current.RepoBrief),
		RepoBriefSources: sliceOr(req.RepoBriefSources, current.RepoBriefSources),
	}

	normalized, err := workspaceprofile.Normalize(next)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	normalized.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	normalized.UpdatedBy = userID

	encoded, err := workspaceprofile.Encode(normalized)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	updated, err := h.Queries.UpdateWorkspaceProfile(r.Context(), db.UpdateWorkspaceProfileParams{
		ID:      ws.ID,
		Profile: encoded,
	})
	if err != nil {
		slog.Warn("update workspace profile failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to save the workspace profile")
		return
	}

	slog.Info("workspace profile updated", append(logger.RequestAttrs(r),
		"workspace_id", uuidToString(ws.ID), "empty", normalized.IsEmpty())...)
	writeJSON(w, http.StatusOK, profileToResponse(workspaceprofile.Parse(updated.Profile)))
}

// loadWorkspaceForProfile resolves the workspace both profile endpoints act
// on. Membership was already proven by the route's middleware; this is the
// row read, and a 404 here means the id is not a workspace at all.
func (h *Handler) loadWorkspaceForProfile(w http.ResponseWriter, r *http.Request) (db.Workspace, bool) {
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceIDFromURL(r, "id"), "workspace id")
	if !ok {
		return db.Workspace{}, false
	}
	ws, err := h.Queries.GetWorkspace(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return db.Workspace{}, false
	}
	return ws, true
}

func valueOr(ptr *string, fallback string) string {
	if ptr == nil {
		return fallback
	}
	return *ptr
}

func sliceOr(ptr *[]string, fallback []string) []string {
	if ptr == nil {
		return fallback
	}
	return *ptr
}
