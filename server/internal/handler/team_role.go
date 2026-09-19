package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/enact-ai/enact/server/internal/logger"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/protocol"
)

// Team role API.
//
// A team role is a FUNCTIONAL role a person plays (business owner, architect,
// QA...). It is never a permission: member.role (owner/admin/member) stays the
// only access gate. Roles exist so work can be routed by the kind of judgement
// it needs — the AI-SDLC suite maps each phase to the roles that review it and
// resolves the people from here.
//
// Reading the catalog is open to any workspace member. Mutating the catalog,
// and deciding who holds a role, is owner/admin only: holding a role is a
// statement that someone is entitled to sign off that kind of work, so letting
// people assign themselves would be self-authorization.

// maxActiveTeamRoles bounds the catalog. A role picker longer than this stops
// being a picker, and it bounds the per-member assignment payload too.
const maxActiveTeamRoles = 30

var teamRoleKeyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_]{0,31}$`)

type TeamRoleResponse struct {
	ID          string  `json:"id"`
	WorkspaceID string  `json:"workspace_id"`
	Key         string  `json:"key"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Color       string  `json:"color"`
	Position    float64 `json:"position"`
	ArchivedAt  *string `json:"archived_at"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

// TeamRoleRef is the compact form carried on member payloads. Key, name and
// color are denormalized so a roster or an agent reading the member list does
// not need a second request to render or route on a role.
type TeamRoleRef struct {
	ID       string `json:"id"`
	Key      string `json:"key"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	Archived bool   `json:"archived"`
}

func teamRoleToResponse(t db.TeamRole) TeamRoleResponse {
	return TeamRoleResponse{
		ID:          uuidToString(t.ID),
		WorkspaceID: uuidToString(t.WorkspaceID),
		Key:         t.Key,
		Name:        t.Name,
		Description: t.Description,
		Color:       t.Color,
		Position:    t.Position,
		ArchivedAt:  timestampToPtr(t.ArchivedAt),
		CreatedAt:   timestampToString(t.CreatedAt),
		UpdatedAt:   timestampToString(t.UpdatedAt),
	}
}

type CreateTeamRoleRequest struct {
	// Key is optional; it is derived from Name when omitted. Immutable once
	// created, because routing config and agent instructions reference it.
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Color       string `json:"color"`
}

// UpdateTeamRoleRequest has no Key field on purpose: keys are immutable.
type UpdateTeamRoleRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Color       *string `json:"color"`
}

type ReorderTeamRolesRequest struct {
	IDs []string `json:"ids"`
}

type ImportTeamRolePresetRequest struct {
	Preset string `json:"preset"`
	Locale string `json:"locale"`
}

type SetMemberTeamRolesRequest struct {
	TeamRoleIDs []string `json:"team_role_ids"`
}

// ListTeamRoles returns the workspace's role catalog in display order.
func (h *Handler) ListTeamRoles(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	if _, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found"); !ok {
		return
	}

	includeArchived := strings.EqualFold(r.URL.Query().Get("include_archived"), "true")
	roles, err := h.Queries.ListTeamRoles(r.Context(), db.ListTeamRolesParams{
		WorkspaceID:     wsUUID,
		IncludeArchived: includeArchived,
	})
	if err != nil {
		slog.Warn("ListTeamRoles failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to list team roles")
		return
	}
	writeTeamRoleList(w, roles)
}

// CreateTeamRole adds a role to the workspace catalog.
func (h *Handler) CreateTeamRole(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	member, ok := h.requireWorkspaceRole(w, r, workspaceID, "workspace not found", "owner", "admin")
	if !ok {
		return
	}

	var req CreateTeamRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	name, err := validateTeamRoleName(req.Name)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateTeamRoleDescription(req.Description); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	color, err := normalizeColor(req.Color)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	key, err := resolveTeamRoleKey(req.Key, name)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	count, err := h.Queries.CountActiveTeamRoles(r.Context(), wsUUID)
	if err != nil {
		slog.Warn("CountActiveTeamRoles failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to create team role")
		return
	}
	if count >= maxActiveTeamRoles {
		writeError(w, http.StatusConflict, "a workspace can have at most 30 active roles")
		return
	}

	role, err := h.Queries.CreateTeamRole(r.Context(), db.CreateTeamRoleParams{
		WorkspaceID: wsUUID,
		Key:         key,
		Name:        name,
		Description: req.Description,
		Color:       color,
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "a role with this key or name already exists")
			return
		}
		slog.Warn("CreateTeamRole failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to create team role")
		return
	}
	h.publishTeamRoleChanged(workspaceID, member, "created")
	writeJSON(w, http.StatusCreated, teamRoleToResponse(role))
}

// UpdateTeamRole edits an active role's name, description or color.
func (h *Handler) UpdateTeamRole(w http.ResponseWriter, r *http.Request) {
	role, wsUUID, member, ok := h.loadTeamRoleForAdmin(w, r)
	if !ok {
		return
	}
	var req UpdateTeamRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if role.ArchivedAt.Valid {
		writeError(w, http.StatusConflict, "archived roles cannot be modified")
		return
	}

	var name, description, color pgtype.Text
	if req.Name != nil {
		trimmed, err := validateTeamRoleName(*req.Name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		name = pgtype.Text{String: trimmed, Valid: true}
	}
	if req.Description != nil {
		if err := validateTeamRoleDescription(*req.Description); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		description = pgtype.Text{String: *req.Description, Valid: true}
	}
	if req.Color != nil {
		normalized, err := normalizeColor(*req.Color)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		color = pgtype.Text{String: normalized, Valid: true}
	}

	updated, err := h.Queries.UpdateTeamRole(r.Context(), db.UpdateTeamRoleParams{
		ID:          role.ID,
		WorkspaceID: wsUUID,
		Name:        name,
		Description: description,
		Color:       color,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusConflict, "role is no longer editable")
			return
		}
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "a role with this name already exists")
			return
		}
		slog.Warn("UpdateTeamRole failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to update team role")
		return
	}
	h.publishTeamRoleChanged(uuidToString(wsUUID), member, "updated")
	writeJSON(w, http.StatusOK, teamRoleToResponse(updated))
}

// ArchiveTeamRole retires a role from future assignment. People who hold it
// keep the assignment, so restoring the role restores who held it.
//
// Unlike issue statuses there is no catalog lock here: a concurrent assignment
// racing an archive can at worst leave one more row on an archived role, which
// is exactly the state archiving already preserves for everyone else.
func (h *Handler) ArchiveTeamRole(w http.ResponseWriter, r *http.Request) {
	role, wsUUID, member, ok := h.loadTeamRoleForAdmin(w, r)
	if !ok {
		return
	}
	if role.ArchivedAt.Valid {
		writeJSON(w, http.StatusOK, teamRoleToResponse(role))
		return
	}
	archived, err := h.Queries.ArchiveTeamRole(r.Context(), db.ArchiveTeamRoleParams{
		ID:          role.ID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusConflict, "role is no longer archivable")
			return
		}
		slog.Warn("ArchiveTeamRole failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to archive team role")
		return
	}
	h.publishTeamRoleChanged(uuidToString(wsUUID), member, "archived")
	writeJSON(w, http.StatusOK, teamRoleToResponse(archived))
}

// RestoreTeamRole brings an archived role back to the end of the active list.
func (h *Handler) RestoreTeamRole(w http.ResponseWriter, r *http.Request) {
	role, wsUUID, member, ok := h.loadTeamRoleForAdmin(w, r)
	if !ok {
		return
	}
	if !role.ArchivedAt.Valid {
		writeJSON(w, http.StatusOK, teamRoleToResponse(role))
		return
	}
	count, err := h.Queries.CountActiveTeamRoles(r.Context(), wsUUID)
	if err != nil {
		slog.Warn("CountActiveTeamRoles failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to restore team role")
		return
	}
	if count >= maxActiveTeamRoles {
		writeError(w, http.StatusConflict, "a workspace can have at most 30 active roles")
		return
	}
	restored, err := h.Queries.RestoreTeamRole(r.Context(), db.RestoreTeamRoleParams{
		ID:          role.ID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusConflict, "role is no longer restorable")
			return
		}
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "an active role already uses this name; rename it first")
			return
		}
		slog.Warn("RestoreTeamRole failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to restore team role")
		return
	}
	h.publishTeamRoleChanged(uuidToString(wsUUID), member, "restored")
	writeJSON(w, http.StatusOK, teamRoleToResponse(restored))
}

// ReorderTeamRoles rewrites the order of every active role atomically. `ids`
// must name every active role exactly once: positions come from the array
// index, so a partial order would collide with the roles left out.
func (h *Handler) ReorderTeamRoles(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	member, ok := h.requireWorkspaceRole(w, r, workspaceID, "workspace not found", "owner", "admin")
	if !ok {
		return
	}
	var req ReorderTeamRolesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	ids, ok := parseDistinctUUIDs(w, req.IDs, "team role id")
	if !ok {
		return
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		slog.Warn("ReorderTeamRoles begin failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to reorder team roles")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	active, err := qtx.ListActiveTeamRoleIDs(r.Context(), wsUUID)
	if err != nil {
		slog.Warn("ReorderTeamRoles list failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to reorder team roles")
		return
	}
	if !sameUUIDSet(active, ids) {
		writeError(w, http.StatusConflict, "ids must name every active role exactly once")
		return
	}
	affected, err := qtx.ReorderTeamRoles(r.Context(), db.ReorderTeamRolesParams{
		Ids:         ids,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		slog.Warn("ReorderTeamRoles failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to reorder team roles")
		return
	}
	if affected != int64(len(ids)) {
		writeError(w, http.StatusConflict, "role catalog changed during reorder")
		return
	}
	roles, err := qtx.ListTeamRoles(r.Context(), db.ListTeamRolesParams{
		WorkspaceID:     wsUUID,
		IncludeArchived: true,
	})
	if err != nil {
		slog.Warn("list team roles after reorder failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to reorder team roles")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		slog.Warn("ReorderTeamRoles commit failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to reorder team roles")
		return
	}
	h.publishTeamRoleChanged(workspaceID, member, "reordered")
	writeTeamRoleList(w, roles)
}

// ImportTeamRolePreset adds a predefined set of roles. Idempotent: roles whose
// key or name already exists are left untouched, so a workspace that renamed a
// preset role keeps its rename.
func (h *Handler) ImportTeamRolePreset(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	member, ok := h.requireWorkspaceRole(w, r, workspaceID, "workspace not found", "owner", "admin")
	if !ok {
		return
	}
	var req ImportTeamRolePresetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	preset, ok := teamRolePresets[req.Preset]
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown preset")
		return
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		slog.Warn("ImportTeamRolePreset begin failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to import roles")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	count, err := qtx.CountActiveTeamRoles(r.Context(), wsUUID)
	if err != nil {
		slog.Warn("CountActiveTeamRoles failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to import roles")
		return
	}
	var created int64
	for _, entry := range preset {
		if count+created >= maxActiveTeamRoles {
			writeError(w, http.StatusConflict, "a workspace can have at most 30 active roles")
			return
		}
		name, description := entry.localized(req.Locale)
		n, err := qtx.CreateTeamRoleIfAbsent(r.Context(), db.CreateTeamRoleIfAbsentParams{
			WorkspaceID: wsUUID,
			Key:         entry.Key,
			Name:        name,
			Description: description,
			Color:       entry.Color,
		})
		if err != nil {
			slog.Warn("ImportTeamRolePreset insert failed", append(logger.RequestAttrs(r), "error", err, "key", entry.Key)...)
			writeError(w, http.StatusInternalServerError, "failed to import roles")
			return
		}
		created += n
	}
	roles, err := qtx.ListTeamRoles(r.Context(), db.ListTeamRolesParams{
		WorkspaceID:     wsUUID,
		IncludeArchived: true,
	})
	if err != nil {
		slog.Warn("list team roles after import failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to import roles")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		slog.Warn("ImportTeamRolePreset commit failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to import roles")
		return
	}
	if created > 0 {
		h.publishTeamRoleChanged(workspaceID, member, "imported")
	}
	writeTeamRoleList(w, roles)
}

// SetMemberTeamRoles replaces the set of ACTIVE roles a member holds.
//
// Set semantics, not add/remove: the UI is a multi-select, so one request
// always carries the whole intended set and a retry is naturally idempotent.
// Assignments to archived roles are outside the set and survive untouched —
// the picker cannot offer an archived role, so saving from it must not
// silently drop one either.
//
// Mounted under the owner/admin route group, so the permission gate has
// already run by the time this handler is reached.
func (h *Handler) SetMemberTeamRoles(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "id")
	requester, ok := h.workspaceMember(w, r, workspaceID)
	if !ok {
		return
	}
	memberUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "memberId"), "member id")
	if !ok {
		return
	}
	target, err := h.Queries.GetMember(r.Context(), memberUUID)
	if err != nil || uuidToString(target.WorkspaceID) != uuidToString(requester.WorkspaceID) {
		writeError(w, http.StatusNotFound, "member not found")
		return
	}

	var req SetMemberTeamRolesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.TeamRoleIDs == nil {
		writeError(w, http.StatusBadRequest, "team_role_ids is required")
		return
	}
	if len(req.TeamRoleIDs) > maxActiveTeamRoles {
		writeError(w, http.StatusBadRequest, "too many roles")
		return
	}
	ids, ok := parseDistinctUUIDs(w, req.TeamRoleIDs, "team role id")
	if !ok {
		return
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		slog.Warn("SetMemberTeamRoles begin failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to update member roles")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	// Every requested id must be an ACTIVE role in THIS workspace. Checking
	// against the workspace's own active set rejects another workspace's role
	// id and an archived role in one comparison.
	active, err := qtx.ListActiveTeamRoleIDs(r.Context(), target.WorkspaceID)
	if err != nil {
		slog.Warn("SetMemberTeamRoles list failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to update member roles")
		return
	}
	activeSet := make(map[[16]byte]struct{}, len(active))
	for _, id := range active {
		activeSet[id.Bytes] = struct{}{}
	}
	for _, id := range ids {
		if _, ok := activeSet[id.Bytes]; !ok {
			writeError(w, http.StatusBadRequest, "team role not found or archived")
			return
		}
	}

	if err := qtx.DeleteActiveTeamRoleAssignmentsForMember(r.Context(), db.DeleteActiveTeamRoleAssignmentsForMemberParams{
		WorkspaceID: target.WorkspaceID,
		UserID:      target.UserID,
	}); err != nil {
		slog.Warn("SetMemberTeamRoles delete failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to update member roles")
		return
	}
	if len(ids) > 0 {
		if _, err := qtx.InsertMemberTeamRoles(r.Context(), db.InsertMemberTeamRolesParams{
			WorkspaceID: target.WorkspaceID,
			UserID:      target.UserID,
			TeamRoleIds: ids,
		}); err != nil {
			slog.Warn("SetMemberTeamRoles insert failed", append(logger.RequestAttrs(r), "error", err)...)
			writeError(w, http.StatusInternalServerError, "failed to update member roles")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		slog.Warn("SetMemberTeamRoles commit failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to update member roles")
		return
	}

	user, err := h.Queries.GetUser(r.Context(), target.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load member")
		return
	}
	resp := h.memberWithUserResponse(target, user)
	resp.TeamRoles = h.teamRoleRefsForMember(r.Context(), target.WorkspaceID, target.UserID)

	h.publish(protocol.EventMemberUpdated, uuidToString(target.WorkspaceID), "member", requestUserID(r), map[string]any{
		"member": resp,
	})
	writeJSON(w, http.StatusOK, resp)
}

// loadTeamRoleForAdmin resolves the {id} path param inside the caller's
// workspace and enforces the owner/admin gate.
func (h *Handler) loadTeamRoleForAdmin(w http.ResponseWriter, r *http.Request) (db.TeamRole, pgtype.UUID, db.Member, bool) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return db.TeamRole{}, pgtype.UUID{}, db.Member{}, false
	}
	member, ok := h.requireWorkspaceRole(w, r, workspaceID, "workspace not found", "owner", "admin")
	if !ok {
		return db.TeamRole{}, pgtype.UUID{}, db.Member{}, false
	}
	idUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "team role id")
	if !ok {
		return db.TeamRole{}, pgtype.UUID{}, db.Member{}, false
	}
	role, err := h.Queries.GetTeamRoleByID(r.Context(), db.GetTeamRoleByIDParams{
		ID:          idUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "team role not found")
			return db.TeamRole{}, pgtype.UUID{}, db.Member{}, false
		}
		slog.Warn("load team role failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to load team role")
		return db.TeamRole{}, pgtype.UUID{}, db.Member{}, false
	}
	return role, wsUUID, member, true
}

// publishTeamRoleChanged announces that the catalog moved. Clients re-read the
// catalog AND the member list, because member payloads denormalize role names
// and colors.
func (h *Handler) publishTeamRoleChanged(workspaceID string, actor db.Member, action string) {
	h.publish(protocol.EventTeamRoleChanged, workspaceID, "member", uuidToString(actor.UserID), map[string]any{
		"action": action,
	})
}

// teamRoleRefsForMember loads one member's roles for a single-member payload.
// A failure degrades to an empty list with a warning rather than failing the
// write that already committed: the realtime member:updated event makes every
// client re-read the list, which carries the authoritative roles.
func (h *Handler) teamRoleRefsForMember(ctx context.Context, workspaceID, userID pgtype.UUID) []TeamRoleRef {
	rows, err := h.Queries.ListTeamRoleRefsForMember(ctx, db.ListTeamRoleRefsForMemberParams{
		WorkspaceID: workspaceID,
		UserID:      userID,
	})
	if err != nil {
		slog.Warn("load member team roles failed", "error", err, "workspace_id", uuidToString(workspaceID), "user_id", uuidToString(userID))
		return []TeamRoleRef{}
	}
	refs := make([]TeamRoleRef, len(rows))
	for i, row := range rows {
		refs[i] = TeamRoleRef{
			ID:       uuidToString(row.ID),
			Key:      row.Key,
			Name:     row.Name,
			Color:    row.Color,
			Archived: row.Archived,
		}
	}
	return refs
}

// teamRoleRefsByUser loads every member's roles in one query, keyed by user id.
func (h *Handler) teamRoleRefsByUser(ctx context.Context, workspaceID pgtype.UUID) (map[string][]TeamRoleRef, error) {
	rows, err := h.Queries.ListMemberTeamRoleRefs(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	byUser := make(map[string][]TeamRoleRef)
	for _, row := range rows {
		userID := uuidToString(row.ActorID)
		byUser[userID] = append(byUser[userID], TeamRoleRef{
			ID:       uuidToString(row.ID),
			Key:      row.Key,
			Name:     row.Name,
			Color:    row.Color,
			Archived: row.Archived,
		})
	}
	return byUser, nil
}

func writeTeamRoleList(w http.ResponseWriter, roles []db.TeamRole) {
	resp := make([]TeamRoleResponse, len(roles))
	for i, role := range roles {
		resp[i] = teamRoleToResponse(role)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"team_roles": resp,
		"total":      len(resp),
	})
}

func validateTeamRoleName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" || len([]rune(name)) > 64 {
		return "", errors.New("name must be 1-64 characters")
	}
	return name, nil
}

func validateTeamRoleDescription(description string) error {
	if len([]rune(description)) > 256 {
		return errors.New("description must be at most 256 characters")
	}
	return nil
}

// resolveTeamRoleKey returns an explicit key when one is given, otherwise a
// key derived from the name. Names with no ASCII letters or digits (most
// Chinese names) derive nothing, so they get a random `role_` key instead of
// forcing the admin to invent one; the key is a machine handle, not a label.
func resolveTeamRoleKey(explicit, name string) (string, error) {
	if trimmed := strings.ToLower(strings.TrimSpace(explicit)); trimmed != "" {
		if !teamRoleKeyPattern.MatchString(trimmed) {
			return "", errors.New("role key must be 1-32 characters of lowercase letters, digits or underscore, starting with a letter or digit")
		}
		return trimmed, nil
	}
	if slug := slugifyTeamRoleKey(name); slug != "" {
		return slug, nil
	}
	var suffix [3]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return "", errors.New("failed to generate role key")
	}
	return "role_" + hex.EncodeToString(suffix[:]), nil
}

func slugifyTeamRoleKey(name string) string {
	var b strings.Builder
	lastUnderscore := false
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastUnderscore = false
		case !lastUnderscore && b.Len() > 0:
			b.WriteRune('_')
			lastUnderscore = true
		}
	}
	slug := strings.Trim(b.String(), "_")
	if len(slug) > 32 {
		slug = strings.Trim(slug[:32], "_")
	}
	return slug
}

// parseDistinctUUIDs parses request ids, rejecting malformed and duplicate
// entries with a 400.
func parseDistinctUUIDs(w http.ResponseWriter, raw []string, field string) ([]pgtype.UUID, bool) {
	ids := make([]pgtype.UUID, 0, len(raw))
	seen := make(map[[16]byte]struct{}, len(raw))
	for _, s := range raw {
		id, ok := parseUUIDOrBadRequest(w, s, field)
		if !ok {
			return nil, false
		}
		if _, dup := seen[id.Bytes]; dup {
			writeError(w, http.StatusBadRequest, "duplicate "+field)
			return nil, false
		}
		seen[id.Bytes] = struct{}{}
		ids = append(ids, id)
	}
	return ids, true
}

func sameUUIDSet(a, b []pgtype.UUID) bool {
	if len(a) != len(b) {
		return false
	}
	set := make(map[[16]byte]struct{}, len(a))
	for _, id := range a {
		set[id.Bytes] = struct{}{}
	}
	for _, id := range b {
		if _, ok := set[id.Bytes]; !ok {
			return false
		}
	}
	return true
}
