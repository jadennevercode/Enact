package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	skillpkg "github.com/enact-ai/enact/server/internal/skill"
	"github.com/enact-ai/enact/server/internal/skillversion"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/protocol"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// --- Response structs ---

// SkillVersionResponse is the list shape: everything about a snapshot except
// what it says. Version bodies are the same 50-200KB SKILL.md documents that
// keep `content` out of the skill list, and a version list is read to choose a
// version, not to read one.
type SkillVersionResponse struct {
	ID          string  `json:"id"`
	SkillID     string  `json:"skill_id"`
	WorkspaceID string  `json:"workspace_id"`
	Version     int32   `json:"version"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Config      any     `json:"config"`
	ContentHash string  `json:"content_hash"`
	Source      string  `json:"source"`
	CreatedBy   *string `json:"created_by"`
	Summary     string  `json:"summary"`
	CreatedAt   string  `json:"created_at"`
	// IsCurrent marks the version the skill currently serves. Derived rather
	// than stored: the version rows are immutable and "current" is a property
	// of the skill, not of the snapshot.
	IsCurrent bool `json:"is_current"`
}

type SkillVersionFileResponse struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type SkillVersionDetailResponse struct {
	SkillVersionResponse
	Content string                     `json:"content"`
	Files   []SkillVersionFileResponse `json:"files"`
}

func skillVersionToResponse(v db.SkillVersion, currentID pgtype.UUID) SkillVersionResponse {
	return SkillVersionResponse{
		ID:          uuidToString(v.ID),
		SkillID:     uuidToString(v.SkillID),
		WorkspaceID: uuidToString(v.WorkspaceID),
		Version:     v.Version,
		Name:        v.Name,
		Description: v.Description,
		Config:      decodeSkillConfig(v.Config),
		ContentHash: v.ContentHash,
		Source:      v.Source,
		CreatedBy:   uuidToPtr(v.CreatedBy),
		Summary:     v.Summary,
		CreatedAt:   timestampToString(v.CreatedAt),
		IsCurrent:   currentID.Valid && v.ID.Valid && uuidToString(v.ID) == uuidToString(currentID),
	}
}

func skillVersionSummaryToResponse(v db.ListSkillVersionSummariesRow, currentID pgtype.UUID) SkillVersionResponse {
	return SkillVersionResponse{
		ID:          uuidToString(v.ID),
		SkillID:     uuidToString(v.SkillID),
		WorkspaceID: uuidToString(v.WorkspaceID),
		Version:     v.Version,
		Name:        v.Name,
		Description: v.Description,
		Config:      decodeSkillConfig(v.Config),
		ContentHash: v.ContentHash,
		Source:      v.Source,
		CreatedBy:   uuidToPtr(v.CreatedBy),
		Summary:     v.Summary,
		CreatedAt:   timestampToString(v.CreatedAt),
		IsCurrent:   currentID.Valid && v.ID.Valid && uuidToString(v.ID) == uuidToString(currentID),
	}
}

func skillVersionDetailToResponse(v db.SkillVersion, currentID pgtype.UUID) SkillVersionDetailResponse {
	files := skillversion.DecodeFiles(v.Files)
	out := make([]SkillVersionFileResponse, 0, len(files))
	for _, f := range files {
		out = append(out, SkillVersionFileResponse{Path: f.Path, Content: f.Content})
	}
	return SkillVersionDetailResponse{
		SkillVersionResponse: skillVersionToResponse(v, currentID),
		Content:              v.Content,
		Files:                out,
	}
}

// --- The one write primitive ---

// skillSnapshot is a complete proposed state for a skill. Every field is
// authoritative: applying a snapshot replaces the file set wholesale rather
// than merging it, so a file the snapshot omits is a file the skill no longer
// has.
type skillSnapshot struct {
	Name        string
	Description string
	Content     string
	Config      []byte
	Files       []skillversion.File
}

func snapshotFromVersion(v db.SkillVersion) skillSnapshot {
	return skillSnapshot{
		Name:        v.Name,
		Description: v.Description,
		Content:     v.Content,
		Config:      v.Config,
		Files:       skillversion.DecodeFiles(v.Files),
	}
}

// applySkillSnapshotInTx writes a complete skill state and records the version
// it produced, in the caller's transaction.
//
// Every content change that is not a plain PATCH goes through here — restoring
// an older version, and a Retrospect Agent rewriting one — so there is exactly
// one place where "the skill changed" and "a version was recorded" are decided
// together. Splitting them, even across two adjacent statements in the same
// function, is how a history grows holes.
func applySkillSnapshotInTx(
	ctx context.Context,
	qtx *db.Queries,
	skill db.Skill,
	snap skillSnapshot,
	source string,
	actorID pgtype.UUID,
	summary string,
) (db.Skill, db.SkillVersion, error) {
	params := db.UpdateSkillParams{ID: skill.ID}
	if name := sanitizeNullBytes(snap.Name); name != "" && name != skill.Name {
		params.Name = pgtype.Text{String: name, Valid: true}
	}
	params.Description = pgtype.Text{String: sanitizeNullBytes(snap.Description), Valid: true}
	params.Content = pgtype.Text{String: sanitizeNullBytes(snap.Content), Valid: true}
	if len(snap.Config) > 0 {
		params.Config = snap.Config
	}

	updated, err := qtx.UpdateSkill(ctx, params)
	if err != nil {
		return db.Skill{}, db.SkillVersion{}, err
	}

	if err := qtx.DeleteSkillFilesBySkill(ctx, updated.ID); err != nil {
		return db.Skill{}, db.SkillVersion{}, err
	}
	stored := make([]skillversion.File, 0, len(snap.Files))
	for _, f := range snap.Files {
		// SKILL.md is the skill's own content; a snapshot that carries one as a
		// supporting file would round-trip into a duplicate on the next apply.
		if skillpkg.IsReservedContentPath(f.Path) {
			continue
		}
		row, err := qtx.UpsertSkillFile(ctx, db.UpsertSkillFileParams{
			SkillID: updated.ID,
			Path:    sanitizeNullBytes(f.Path),
			Content: sanitizeNullBytes(f.Content),
		})
		if err != nil {
			return db.Skill{}, db.SkillVersion{}, err
		}
		stored = append(stored, skillversion.File{Path: row.Path, Content: row.Content})
	}

	version, _, err := skillversion.Record(ctx, qtx, skillversion.Input{
		Skill:   updated,
		Files:   stored,
		Source:  source,
		ActorID: actorID,
		Summary: summary,
	})
	if err != nil {
		return db.Skill{}, db.SkillVersion{}, err
	}
	updated.CurrentVersionID = version.ID
	return updated, version, nil
}

// recordSkillVersionInTx snapshots a skill whose row and files the caller has
// already written. Used by the PATCH and import paths, which build their new
// state incrementally rather than handing over a complete snapshot.
func recordSkillVersionInTx(
	ctx context.Context,
	qtx *db.Queries,
	skill db.Skill,
	source string,
	actorID pgtype.UUID,
	summary string,
) (db.SkillVersion, error) {
	files, err := qtx.ListSkillFiles(ctx, skill.ID)
	if err != nil {
		return db.SkillVersion{}, err
	}
	version, _, err := skillversion.Record(ctx, qtx, skillversion.Input{
		Skill:   skill,
		Files:   skillversion.FilesFromRows(files),
		Source:  source,
		ActorID: actorID,
		Summary: summary,
	})
	return version, err
}

// --- Endpoints ---

func (h *Handler) ListSkillVersions(w http.ResponseWriter, r *http.Request) {
	skill, ok := h.loadSkillForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}

	rows, err := h.Queries.ListSkillVersionSummaries(r.Context(), skill.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list skill versions")
		return
	}

	out := make([]SkillVersionResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, skillVersionSummaryToResponse(row, skill.CurrentVersionID))
	}
	writeJSON(w, http.StatusOK, map[string]any{"versions": out})
}

func (h *Handler) GetSkillVersion(w http.ResponseWriter, r *http.Request) {
	skill, ok := h.loadSkillForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	versionUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "versionId"), "version id")
	if !ok {
		return
	}

	version, err := h.Queries.GetSkillVersion(r.Context(), versionUUID)
	if err != nil || uuidToString(version.SkillID) != uuidToString(skill.ID) {
		writeError(w, http.StatusNotFound, "skill version not found")
		return
	}
	writeJSON(w, http.StatusOK, skillVersionDetailToResponse(version, skill.CurrentVersionID))
}

type RestoreSkillVersionRequest struct {
	Summary string `json:"summary,omitempty"`
}

// RestoreSkillVersion puts an older snapshot back, as a new version.
//
// It does not rewind history: the restored state is appended, so the version
// that was current stays readable and a restore can itself be restored. That
// costs one row and buys the property that the history is never a claim about
// what happened that the rows cannot support.
//
// Restoring is an edit, not a decision, and is gated by canManageSkill like any
// other edit. Putting a review in front of undoing a bad rule would mean the
// fastest way out is slower than the way in.
func (h *Handler) RestoreSkillVersion(w http.ResponseWriter, r *http.Request) {
	skill, ok := h.loadSkillForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if !h.canManageSkill(w, r, skill) {
		return
	}
	versionUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "versionId"), "version id")
	if !ok {
		return
	}

	var req RestoreSkillVersionRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	target, err := h.Queries.GetSkillVersion(r.Context(), versionUUID)
	if err != nil || uuidToString(target.SkillID) != uuidToString(skill.ID) {
		writeError(w, http.StatusNotFound, "skill version not found")
		return
	}
	if skill.CurrentVersionID.Valid && uuidToString(target.ID) == uuidToString(skill.CurrentVersionID) {
		writeError(w, http.StatusConflict, "this version is already current")
		return
	}

	userID := requestUserID(r)
	summary := sanitizeNullBytes(req.Summary)
	if summary == "" {
		summary = "Restored version " + strconv.Itoa(int(target.Version))
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	updated, _, err := applySkillSnapshotInTx(
		r.Context(), qtx, skill, snapshotFromVersion(target),
		skillversion.SourceRollback, parseUUID(userID), summary,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "skill not found")
			return
		}
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "a skill with this name already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to restore skill version: "+err.Error())
		return
	}

	files, err := qtx.ListSkillFiles(r.Context(), updated.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read restored skill files")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit skill restore")
		return
	}

	fileResps := make([]SkillFileResponse, len(files))
	for i, f := range files {
		fileResps[i] = skillFileToResponse(f)
	}
	resp := SkillWithFilesResponse{SkillResponse: skillToResponse(updated), Files: fileResps}

	wsID := uuidToString(updated.WorkspaceID)
	actorType, actorID := h.resolveActor(r, userID, wsID)
	h.publish(protocol.EventSkillUpdated, wsID, actorType, actorID, map[string]any{"skill": resp})
	writeJSON(w, http.StatusOK, resp)
}
