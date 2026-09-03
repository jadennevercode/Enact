package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/enact-ai/enact/server/pkg/agent"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/protocol"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ---------------------------------------------------------------------------
// Custom Runtime Profiles (ENA-3284)
//
// A runtime_profile is a definition of a custom runtime — e.g. an in-house
// Codex wrapper. Daemons pull the profiles that are live in their workspace,
// resolve command_name on PATH, and register an agent_runtime instance
// carrying the profile_id. The profile only changes how a runtime is
// launched/displayed; the underlying protocol_family must be a backend Enact
// officially supports (validated against agent.SupportedTypes).
//
// The definition is OWNED BY A USER and PUBLISHED INTO WORKSPACES (migration
// 416). One in-house wrapper is described once and made available to every
// team that needs it, instead of being retyped per workspace. Two consequences
// run through every handler below:
//
//   - `runtime_profile.workspace_id` is the origin workspace and is NOT an
//     access check. A row in runtime_profile_workspace is.
//   - There are two enable switches. The owner's `enabled` retires a
//     definition everywhere; a workspace's own `enabled` opts that team out.
//     A daemon registers only when both are true.
//
// Authority to change a definition follows from how far it has spread:
// a workspace admin may edit a profile only their workspace uses, which is
// exactly the pre-publication behaviour; once it reaches a second workspace,
// only the owner may change it, because an edit is felt by every team on it.
// See profileEditAuthority.
//
// Iron rule: a profile carries NO generic per-agent args. Per-agent launch args
// stay on agent.custom_args. The only args field is fixed_args — args every
// agent on this runtime must inherit to enter a compatible mode.
// ---------------------------------------------------------------------------

type RuntimeProfileResponse struct {
	ID             string   `json:"id"`
	WorkspaceID    string   `json:"workspace_id"`
	DisplayName    string   `json:"display_name"`
	ProtocolFamily string   `json:"protocol_family"`
	CommandName    string   `json:"command_name"`
	Description    *string  `json:"description"`
	FixedArgs      []string `json:"fixed_args"`
	Visibility     string   `json:"visibility"`
	CreatedBy      *string  `json:"created_by"`
	OwnerID        *string  `json:"owner_id"`
	Enabled        bool     `json:"enabled"`
	// WorkspaceEnabled is the reading workspace's own switch. Absent when the
	// profile is being returned outside a workspace context (the owner's
	// cross-workspace list).
	WorkspaceEnabled *bool `json:"workspace_enabled,omitempty"`
	// WorkspaceCount is how many workspaces this definition currently reaches.
	// Only populated on the owner's list, where it is the whole point.
	WorkspaceCount *int64 `json:"workspace_count,omitempty"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

// runtimeProfileFields is the subset of a profile every sqlc row shape for it
// shares. The publication joins each produce their own generated struct, so the
// response builder takes the fields rather than one row type.
type runtimeProfileFields struct {
	ID             pgtype.UUID
	WorkspaceID    pgtype.UUID
	DisplayName    string
	ProtocolFamily string
	CommandName    string
	Description    pgtype.Text
	FixedArgs      []byte
	Visibility     string
	CreatedBy      pgtype.UUID
	OwnerID        pgtype.UUID
	Enabled        bool
	CreatedAt      pgtype.Timestamptz
	UpdatedAt      pgtype.Timestamptz
}

func runtimeProfileFieldsFrom(p db.RuntimeProfile) runtimeProfileFields {
	return runtimeProfileFields{
		ID:             p.ID,
		WorkspaceID:    p.WorkspaceID,
		DisplayName:    p.DisplayName,
		ProtocolFamily: p.ProtocolFamily,
		CommandName:    p.CommandName,
		Description:    p.Description,
		FixedArgs:      p.FixedArgs,
		Visibility:     p.Visibility,
		CreatedBy:      p.CreatedBy,
		OwnerID:        p.OwnerID,
		Enabled:        p.Enabled,
		CreatedAt:      p.CreatedAt,
		UpdatedAt:      p.UpdatedAt,
	}
}

func runtimeProfileResponseFrom(p runtimeProfileFields) RuntimeProfileResponse {
	args := []string{}
	if len(p.FixedArgs) > 0 {
		_ = json.Unmarshal(p.FixedArgs, &args)
		if args == nil {
			args = []string{}
		}
	}
	return RuntimeProfileResponse{
		ID:             uuidToString(p.ID),
		WorkspaceID:    uuidToString(p.WorkspaceID),
		DisplayName:    p.DisplayName,
		ProtocolFamily: p.ProtocolFamily,
		CommandName:    p.CommandName,
		Description:    textToPtr(p.Description),
		FixedArgs:      args,
		Visibility:     p.Visibility,
		CreatedBy:      uuidToPtr(p.CreatedBy),
		OwnerID:        uuidToPtr(p.OwnerID),
		Enabled:        p.Enabled,
		CreatedAt:      timestampToString(p.CreatedAt),
		UpdatedAt:      timestampToString(p.UpdatedAt),
	}
}

func runtimeProfileToResponse(p db.RuntimeProfile) RuntimeProfileResponse {
	return runtimeProfileResponseFrom(runtimeProfileFieldsFrom(p))
}

// profileEditAuthority decides whether an actor may change or remove a profile
// DEFINITION from within one workspace.
//
// The owner always may. A workspace admin may only while the profile has not
// spread: if this workspace is the sole publication, editing it can affect no
// one else, and refusing would be a regression against the behaviour that
// existed before profiles could be shared. Once a second workspace depends on
// the definition, an admin's edit would reach a team they may not even be a
// member of, so it takes the owner.
//
// Callers that only touch THIS workspace's use of the profile — publish,
// unpublish, the workspace enable switch — do not consult this; workspace admin
// is sufficient for those, because their blast radius is the workspace itself.
func profileEditAuthority(actorID pgtype.UUID, profileOwner pgtype.UUID, memberRole string, publicationCount int64) bool {
	if profileOwner.Valid && actorID.Valid && profileOwner.Bytes == actorID.Bytes {
		return true
	}
	isAdmin := memberRole == "owner" || memberRole == "admin"
	return isAdmin && publicationCount <= 1
}

// NOTE: runtime_profile.visibility is intentionally NOT user-settable in v1.
// The column exists and the API still returns it, but creation always forces
// 'workspace': the daemon-pull, DaemonRegister and ListRuntimeProfiles read
// paths do not yet enforce 'private', so accepting 'private' from a client
// would silently leak a "private" profile's name/command to other members and
// let other machines' daemons register it (lateral data leak). Re-expose a
// visibility control only once those read paths enforce creator visibility.
// Follow-up: ENA-3308.
const runtimeProfileDefaultVisibility = "workspace"

// marshalFixedArgs validates and JSON-encodes the fixed_args list. Each entry
// must be a non-empty string; the column defaults to an empty array.
func marshalFixedArgs(args []string) ([]byte, error) {
	if len(args) == 0 {
		return []byte("[]"), nil
	}
	clean := make([]string, 0, len(args))
	for _, a := range args {
		// fixed_args are launch flags inherited by every agent on the runtime;
		// blank entries are always a client mistake.
		if strings.TrimSpace(a) == "" {
			return nil, errors.New("fixed_args entries must be non-empty")
		}
		if strings.ContainsRune(a, '\x00') {
			return nil, errors.New("fixed_args entries cannot contain NUL bytes")
		}
		clean = append(clean, a)
	}
	return json.Marshal(clean)
}

func validateRuntimeProfileCommandName(commandName string) error {
	if commandName == "" {
		return errors.New("command_name is required")
	}
	if strings.ContainsAny(commandName, " \t\r\n") {
		return errors.New("command_name must be a single executable token; put arguments in fixed_args")
	}
	if strings.ContainsRune(commandName, '\x00') {
		return errors.New("command_name cannot contain NUL bytes")
	}
	return nil
}

type createRuntimeProfileRequest struct {
	DisplayName    string   `json:"display_name"`
	ProtocolFamily string   `json:"protocol_family"`
	CommandName    string   `json:"command_name"`
	Description    *string  `json:"description"`
	FixedArgs      []string `json:"fixed_args"`
	Enabled        *bool    `json:"enabled"`
}

// CreateRuntimeProfile creates a workspace runtime profile. Admin-gated by the
// router. protocol_family is validated against the agent backend whitelist.
func (h *Handler) CreateRuntimeProfile(w http.ResponseWriter, r *http.Request) {
	wsID := strings.TrimSpace(chi.URLParam(r, "id"))
	member, ok := h.requireWorkspaceMember(w, r, wsID, "workspace not found")
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}

	var req createRuntimeProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.DisplayName = strings.TrimSpace(req.DisplayName)
	req.ProtocolFamily = strings.TrimSpace(req.ProtocolFamily)
	req.CommandName = strings.TrimSpace(req.CommandName)

	if req.DisplayName == "" {
		writeError(w, http.StatusBadRequest, "display_name is required")
		return
	}
	if !agent.IsSupportedType(req.ProtocolFamily) {
		writeError(w, http.StatusBadRequest, "unsupported protocol_family: must be one of "+strings.Join(agent.SupportedTypes, ", "))
		return
	}
	if req.CommandName == "" {
		writeError(w, http.StatusBadRequest, "command_name is required")
		return
	}
	if err := validateRuntimeProfileCommandName(req.CommandName); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	fixedArgs, err := marshalFixedArgs(req.FixedArgs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	// The definition and its first publication are one act: a profile that
	// exists but reaches no workspace is invisible to every read path and to
	// every daemon, so committing one without the other would leave the
	// creator's own workspace unable to see what it just created.
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to begin transaction")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	profile, err := qtx.CreateRuntimeProfile(r.Context(), db.CreateRuntimeProfileParams{
		WorkspaceID:    wsUUID,
		DisplayName:    req.DisplayName,
		ProtocolFamily: req.ProtocolFamily,
		CommandName:    req.CommandName,
		Description:    ptrToText(req.Description),
		FixedArgs:      fixedArgs,
		Visibility:     runtimeProfileDefaultVisibility,
		CreatedBy:      member.UserID,
		OwnerID:        member.UserID,
		Enabled:        enabled,
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "a runtime profile with this display_name already exists")
			return
		}
		slog.Error("CreateRuntimeProfile failed", "error", err, "workspace_id", wsID)
		writeError(w, http.StatusInternalServerError, "failed to create runtime profile")
		return
	}

	if _, err := qtx.PublishRuntimeProfileToWorkspace(r.Context(), db.PublishRuntimeProfileToWorkspaceParams{
		ProfileID:   profile.ID,
		WorkspaceID: wsUUID,
		PublishedBy: member.UserID,
	}); err != nil {
		slog.Error("CreateRuntimeProfile publish failed", "error", err, "workspace_id", wsID)
		writeError(w, http.StatusInternalServerError, "failed to create runtime profile")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create runtime profile")
		return
	}

	profileID := uuidToString(profile.ID)
	h.requestDaemonRuntimeProfileRefresh(wsID, profileID)
	h.publish(protocol.EventDaemonRegister, wsID, "member", uuidToString(member.UserID), map[string]any{
		"runtime_profile_id": profileID,
	})

	writeJSON(w, http.StatusCreated, runtimeProfileToResponse(profile))
}

// ListRuntimeProfiles returns every runtime profile in the workspace.
// Member-gated by the router.
func (h *Handler) ListRuntimeProfiles(w http.ResponseWriter, r *http.Request) {
	wsID := strings.TrimSpace(chi.URLParam(r, "id"))
	if _, ok := h.requireWorkspaceMember(w, r, wsID, "workspace not found"); !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}

	// Everything published into this workspace, wherever it originated.
	profiles, err := h.Queries.ListRuntimeProfilesForWorkspace(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list runtime profiles")
		return
	}
	resp := make([]RuntimeProfileResponse, len(profiles))
	for i, p := range profiles {
		item := runtimeProfileResponseFrom(runtimeProfileFields{
			ID:             p.ID,
			WorkspaceID:    p.WorkspaceID,
			DisplayName:    p.DisplayName,
			ProtocolFamily: p.ProtocolFamily,
			CommandName:    p.CommandName,
			Description:    p.Description,
			FixedArgs:      p.FixedArgs,
			Visibility:     p.Visibility,
			CreatedBy:      p.CreatedBy,
			OwnerID:        p.OwnerID,
			Enabled:        p.Enabled,
			CreatedAt:      p.CreatedAt,
			UpdatedAt:      p.UpdatedAt,
		})
		wsEnabled := p.WorkspaceEnabled
		item.WorkspaceEnabled = &wsEnabled
		resp[i] = item
	}
	writeJSON(w, http.StatusOK, map[string]any{"runtime_profiles": resp})
}

// ListMyRuntimeProfiles returns every profile the caller owns, with the number
// of workspaces each currently reaches. This is the cross-workspace management
// view: it is deliberately not workspace-scoped, because the whole point is to
// see one definition once instead of once per team.
//
// It never names the workspaces a profile is published to — see
// ListRuntimeProfilePublications for that, which filters to workspaces the
// reader belongs to.
func (h *Handler) ListMyRuntimeProfiles(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	rows, err := h.Queries.ListRuntimeProfilesByOwner(r.Context(), parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list runtime profiles")
		return
	}
	resp := make([]RuntimeProfileResponse, len(rows))
	for i, p := range rows {
		item := runtimeProfileResponseFrom(runtimeProfileFields{
			ID:             p.ID,
			WorkspaceID:    p.WorkspaceID,
			DisplayName:    p.DisplayName,
			ProtocolFamily: p.ProtocolFamily,
			CommandName:    p.CommandName,
			Description:    p.Description,
			FixedArgs:      p.FixedArgs,
			Visibility:     p.Visibility,
			CreatedBy:      p.CreatedBy,
			OwnerID:        p.OwnerID,
			Enabled:        p.Enabled,
			CreatedAt:      p.CreatedAt,
			UpdatedAt:      p.UpdatedAt,
		})
		count := p.WorkspaceCount
		item.WorkspaceCount = &count
		resp[i] = item
	}
	writeJSON(w, http.StatusOK, map[string]any{"runtime_profiles": resp})
}

// GetRuntimeProfile returns one runtime profile. Member-gated by the router.
func (h *Handler) GetRuntimeProfile(w http.ResponseWriter, r *http.Request) {
	wsID := strings.TrimSpace(chi.URLParam(r, "id"))
	if _, ok := h.requireWorkspaceMember(w, r, wsID, "workspace not found"); !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	profileUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "profileId"), "profile id")
	if !ok {
		return
	}

	profile, err := h.Queries.GetRuntimeProfileForWorkspace(r.Context(), db.GetRuntimeProfileForWorkspaceParams{
		ID:          profileUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		// The publication join is the access check: a profile that exists but
		// was never published here is indistinguishable from one that does not
		// exist, which is the same 404 a cross-workspace id got before.
		writeError(w, http.StatusNotFound, "runtime profile not found")
		return
	}
	resp := runtimeProfileResponseFrom(runtimeProfileFields{
		ID:             profile.ID,
		WorkspaceID:    profile.WorkspaceID,
		DisplayName:    profile.DisplayName,
		ProtocolFamily: profile.ProtocolFamily,
		CommandName:    profile.CommandName,
		Description:    profile.Description,
		FixedArgs:      profile.FixedArgs,
		Visibility:     profile.Visibility,
		CreatedBy:      profile.CreatedBy,
		OwnerID:        profile.OwnerID,
		Enabled:        profile.Enabled,
		CreatedAt:      profile.CreatedAt,
		UpdatedAt:      profile.UpdatedAt,
	})
	wsEnabled := profile.WorkspaceEnabled
	resp.WorkspaceEnabled = &wsEnabled
	writeJSON(w, http.StatusOK, resp)
}

type updateRuntimeProfileRequest struct {
	DisplayName *string   `json:"display_name"`
	CommandName *string   `json:"command_name"`
	Description *string   `json:"description"`
	FixedArgs   *[]string `json:"fixed_args"`
	Enabled     *bool     `json:"enabled"`
}

// UpdateRuntimeProfile applies a partial update. protocol_family is immutable
// (changing it would silently repoint bound agents onto a different backend).
// Admin-gated by the router.
func (h *Handler) UpdateRuntimeProfile(w http.ResponseWriter, r *http.Request) {
	wsID := strings.TrimSpace(chi.URLParam(r, "id"))
	member, ok := h.requireWorkspaceMember(w, r, wsID, "workspace not found")
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	profileUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "profileId"), "profile id")
	if !ok {
		return
	}

	var req updateRuntimeProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Load through the publication join first: it answers both "does this
	// workspace get to see this profile at all" (404) and "who owns the
	// definition" (the input to the edit-authority decision).
	existing, err := h.Queries.GetRuntimeProfileForWorkspace(r.Context(), db.GetRuntimeProfileForWorkspaceParams{
		ID:          profileUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "runtime profile not found")
		return
	}
	publicationCount, err := h.Queries.CountRuntimeProfilePublications(r.Context(), profileUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load runtime profile")
		return
	}
	if !profileEditAuthority(member.UserID, existing.OwnerID, member.Role, publicationCount) {
		writeError(w, http.StatusForbidden,
			"this runtime profile is shared with other workspaces; only its owner can change it")
		return
	}

	params := db.UpdateRuntimeProfileParams{ID: profileUUID, OwnerID: existing.OwnerID}
	if req.DisplayName != nil {
		name := strings.TrimSpace(*req.DisplayName)
		if name == "" {
			writeError(w, http.StatusBadRequest, "display_name cannot be empty")
			return
		}
		params.DisplayName = strToText(name)
	}
	if req.CommandName != nil {
		cmd := strings.TrimSpace(*req.CommandName)
		if err := validateRuntimeProfileCommandName(cmd); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		params.CommandName = strToText(cmd)
	}
	if req.Description != nil {
		params.Description = ptrToText(req.Description)
	}
	if req.FixedArgs != nil {
		fixedArgs, err := marshalFixedArgs(*req.FixedArgs)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		params.FixedArgs = fixedArgs
	}
	if req.Enabled != nil {
		params.Enabled = pgtype.Bool{Bool: *req.Enabled, Valid: true}
	}

	profile, err := h.Queries.UpdateRuntimeProfile(r.Context(), params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "runtime profile not found")
			return
		}
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "a runtime profile with this display_name already exists")
			return
		}
		slog.Error("UpdateRuntimeProfile failed", "error", err, "profile_id", uuidToString(profileUUID))
		writeError(w, http.StatusInternalServerError, "failed to update runtime profile")
		return
	}

	profileID := uuidToString(profile.ID)
	// An edit changes what every daemon on this definition should launch, so
	// the refresh has to reach every workspace it reaches — not just the one
	// the request came in through.
	h.notifyRuntimeProfileWorkspaces(r.Context(), profileUUID, profileID, uuidToString(member.UserID))

	writeJSON(w, http.StatusOK, runtimeProfileToResponse(profile))
}

// notifyRuntimeProfileWorkspaces fans a profile-set change out to every
// workspace the definition is published into. Best-effort: a workspace that
// cannot be resolved is skipped rather than failing the request the user
// already succeeded at, and the daemon's periodic profile reconcile picks the
// change up on its next tick regardless.
func (h *Handler) notifyRuntimeProfileWorkspaces(ctx context.Context, profileUUID pgtype.UUID, profileID, actorID string) {
	workspaceIDs, err := h.Queries.ListRuntimeProfileWorkspaceIDs(ctx, profileUUID)
	if err != nil {
		slog.Warn("runtime profile refresh fan-out failed", "error", err, "profile_id", profileID)
		return
	}
	for _, wsUUID := range workspaceIDs {
		wsID := uuidToString(wsUUID)
		h.requestDaemonRuntimeProfileRefresh(wsID, profileID)
		h.publish(protocol.EventDaemonRegister, wsID, "member", actorID, map[string]any{
			"runtime_profile_id": profileID,
		})
	}
}

// DeleteRuntimeProfile withdraws a profile from THIS workspace and, in the
// same transaction, removes the agent_runtime instance rows registered against
// it here. Migration 120 dropped the DB ON DELETE CASCADE, so this app-layer
// cleanup is what prevents orphaned runtime rows. Refuses (409) while active
// agents are still bound to the profile's runtimes. Admin-gated by the router.
//
// Since migration 416 a definition can reach several workspaces, so this is a
// withdrawal, not necessarily a deletion:
//
//   - Other workspaces still using the profile are untouched. An admin here
//     cannot delete a definition another team depends on.
//   - When this was the LAST workspace using it, the definition is deleted too.
//     That keeps the single-workspace case — still the common one — behaving
//     exactly as it did before profiles could be shared: you delete it in your
//     workspace and it is gone.
func (h *Handler) DeleteRuntimeProfile(w http.ResponseWriter, r *http.Request) {
	wsID := strings.TrimSpace(chi.URLParam(r, "id"))
	member, ok := h.requireWorkspaceMember(w, r, wsID, "workspace not found")
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	profileUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "profileId"), "profile id")
	if !ok {
		return
	}

	// The profile-delete cascade must run the SAME teardown the runtime-delete
	// path uses for each one: agent.runtime_id is ON DELETE RESTRICT, so an
	// agent still pointing at one of these rows would turn a bare delete into a
	// 500. Active agents are refused (409); everything else is unbound rather
	// than destroyed, exactly as in unbindRuntimeForDelete.
	// Guard: refuse while any active (non-archived) agent is bound to one of
	// the profile's runtimes. Keep this a 409 — the profile is the thing that
	// defines those runtimes, so the user should retire the agents or move them
	// deliberately instead of having them silently unbound in bulk.
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to begin transaction")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	// Lock the profile before planning the cascade. Daemon registration takes
	// a conflicting KEY SHARE lock in its own transaction, so it cannot insert
	// a runtime after the plan and have that row escape deletion. If the profile
	// row is already gone, still clean up any orphaned profile_id rows.
	lockedProfile, profileErr := qtx.LockRuntimeProfileForDelete(r.Context(), profileUUID)
	profileMissing := errors.Is(profileErr, pgx.ErrNoRows)
	if profileErr != nil && !profileMissing {
		writeError(w, http.StatusInternalServerError, "failed to load runtime profile")
		return
	}

	// Count publications under the profile lock, so a concurrent publish into
	// another workspace cannot slip in between this read and the decision it
	// feeds: whether removing the last link also deletes the definition.
	publicationCount, err := qtx.CountRuntimeProfilePublications(r.Context(), profileUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load runtime profile")
		return
	}
	// Withdrawing from one workspace is that workspace's own decision, so
	// workspace admin is enough. Deleting the definition is not, and it only
	// happens below when this was the last publication — which is precisely
	// when profileEditAuthority grants an admin the same power the
	// single-workspace world always gave them.
	deletesDefinition := !profileMissing && publicationCount <= 1
	if deletesDefinition && !profileEditAuthority(member.UserID, lockedProfile.OwnerID, member.Role, publicationCount) {
		writeError(w, http.StatusForbidden,
			"only the owner of this runtime profile can delete it")
		return
	}

	// Lock runtime rows in deterministic ID order. Their agent/task foreign-key
	// inserts take KEY SHARE locks, preventing dependencies from appearing after
	// the active-agent check.
	runtimeIDs, err := qtx.ListAgentRuntimeIDsByProfile(r.Context(), db.ListAgentRuntimeIDsByProfileParams{
		ProfileID:   profileUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to enumerate profile runtimes")
		return
	}
	if profileMissing && len(runtimeIDs) == 0 {
		writeError(w, http.StatusNotFound, "runtime profile not found")
		return
	}
	for _, runtimeID := range runtimeIDs {
		if _, err := qtx.ListUserAgentsByRuntimeForUpdate(r.Context(), runtimeID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to lock profile dependencies")
			return
		}
	}

	agentCount, err := qtx.CountAgentsByProfile(r.Context(), db.CountAgentsByProfileParams{
		ProfileID:   profileUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check profile usage")
		return
	}
	if agentCount > 0 {
		writeError(w, http.StatusConflict, "cannot delete runtime profile: active agents are still bound to its runtimes")
		return
	}

	// App-layer cascade, per runtime, mirroring DeleteAgentRuntime: unbind the
	// remaining (archived) agents and their task history, cancel anything still
	// in flight, and hard-delete only the system agents, so removing the runtime
	// rows below cannot destroy an agent, a conversation or a task record.
	var teardowns []runtimeTeardownResult
	for _, rid := range runtimeIDs {
		teardown, err := unbindRuntimeForDelete(r.Context(), qtx, rid)
		if err != nil {
			if errors.Is(err, errRuntimeNotDrained) {
				slog.Error("runtime profile delete aborted: tasks not drained",
					"runtime_id", uuidToString(rid), "profile_id", uuidToString(profileUUID), "error", err)
				writeJSON(w, http.StatusConflict, map[string]any{
					"error": "a runtime of this profile still has tasks in flight; retry in a moment.",
					"code":  "runtime_delete_not_drained",
				})
				return
			}
			slog.Error("runtime profile delete teardown failed",
				"runtime_id", uuidToString(rid), "profile_id", uuidToString(profileUUID), "error", err)
			writeError(w, http.StatusInternalServerError, "failed to unbind agents")
			return
		}
		teardowns = append(teardowns, teardown)
	}

	// Now the runtime rows have no agent references; remove them, then the
	// profile itself.
	if _, err := qtx.DeleteAgentRuntimesByProfile(r.Context(), db.DeleteAgentRuntimesByProfileParams{
		ProfileID:   profileUUID,
		WorkspaceID: wsUUID,
	}); err != nil {
		slog.Error("DeleteAgentRuntimesByProfile failed", "error", err, "profile_id", uuidToString(profileUUID))
		writeError(w, http.StatusInternalServerError, "failed to clean up runtime instances")
		return
	}
	// Withdraw this workspace's link regardless. Even when the definition
	// survives for other teams, this workspace must stop seeing it and its
	// daemons must stop registering it.
	if _, err := qtx.UnpublishRuntimeProfileFromWorkspace(r.Context(), db.UnpublishRuntimeProfileFromWorkspaceParams{
		ProfileID:   profileUUID,
		WorkspaceID: wsUUID,
	}); err != nil {
		slog.Error("UnpublishRuntimeProfileFromWorkspace failed", "error", err, "profile_id", uuidToString(profileUUID))
		writeError(w, http.StatusInternalServerError, "failed to withdraw runtime profile")
		return
	}

	if deletesDefinition {
		// Belt and braces: the count above says there is nothing else to
		// remove, but deleting the definition while any publication row
		// survived would leave a link pointing at nothing.
		if _, err := qtx.DeleteRuntimeProfilePublications(r.Context(), profileUUID); err != nil {
			slog.Error("DeleteRuntimeProfilePublications failed", "error", err, "profile_id", uuidToString(profileUUID))
			writeError(w, http.StatusInternalServerError, "failed to delete runtime profile")
			return
		}
		if err := qtx.DeleteRuntimeProfile(r.Context(), profileUUID); err != nil {
			slog.Error("DeleteRuntimeProfile failed", "error", err, "profile_id", uuidToString(profileUUID))
			writeError(w, http.StatusInternalServerError, "failed to delete runtime profile")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit transaction")
		return
	}

	// Tell connected clients to refetch the runtime list (instances vanished),
	// and fan out the per-runtime teardown so unbound agents and cancelled
	// tasks reach subscribers the same way the runtime-delete path emits them.
	profileID := uuidToString(profileUUID)
	userID := uuidToString(member.UserID)
	for _, teardown := range teardowns {
		h.publishRuntimeTeardown(r.Context(), teardown, wsID, userID)
	}
	h.requestDaemonRuntimeProfileRefresh(wsID, profileID)
	h.publish(protocol.EventDaemonRegister, wsID, "member", userID, map[string]any{
		"deleted_runtime_profile_id": profileID,
	})

	w.WriteHeader(http.StatusNoContent)
}

// DaemonListRuntimeProfiles serves the enabled runtime profiles for a workspace
// to a daemon. The daemon resolves each profile's command_name on PATH and
// registers an agent_runtime instance per profile it can run. Daemon-token
// gated by the router.
func (h *Handler) DaemonListRuntimeProfiles(w http.ResponseWriter, r *http.Request) {
	workspaceID := strings.TrimSpace(chi.URLParam(r, "workspaceId"))
	if !h.requireDaemonWorkspaceAccess(w, r, workspaceID) {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	profiles, err := h.Queries.ListEnabledRuntimeProfilesForWorkspace(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list runtime profiles")
		return
	}
	resp := make([]RuntimeProfileResponse, len(profiles))
	for i, p := range profiles {
		resp[i] = runtimeProfileToResponse(p)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"workspace_id":     workspaceID,
		"runtime_profiles": resp,
	})
}

func (h *Handler) requestDaemonRuntimeProfileRefresh(workspaceID, profileID string) {
	if h.DaemonProfileRefresh == nil {
		return
	}
	h.DaemonProfileRefresh.NotifyRuntimeProfilesChanged(workspaceID, profileID)
}

type publishRuntimeProfileRequest struct {
	ProfileID string `json:"profile_id"`
}

// PublishRuntimeProfile makes one of the caller's own runtime profiles
// available in this workspace. This is the write that makes a definition
// cross-workspace: configure the in-house wrapper once, then hand it to each
// team that needs it.
//
// Two conditions, both required:
//
//   - The caller OWNS the profile. A workspace admin cannot pull in someone
//     else's definition; the owner has to hand it over, because they are the
//     one accountable for what the command does and the only one who can
//     change it afterwards.
//   - The caller ADMINISTERS this workspace (enforced by the router). Adding a
//     runtime that every member can bind agents to is a workspace-level act.
//
// Idempotent: publishing an already-published profile re-enables it, which is
// the obvious undo for a workspace that had opted out.
func (h *Handler) PublishRuntimeProfile(w http.ResponseWriter, r *http.Request) {
	wsID := strings.TrimSpace(chi.URLParam(r, "id"))
	member, ok := h.requireWorkspaceMember(w, r, wsID, "workspace not found")
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}

	var req publishRuntimeProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	profileUUID, ok := parseUUIDOrBadRequest(w, strings.TrimSpace(req.ProfileID), "profile_id")
	if !ok {
		return
	}

	profile, err := h.Queries.GetRuntimeProfile(r.Context(), profileUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "runtime profile not found")
		return
	}
	// Not-found rather than forbidden: a profile the caller does not own is
	// none of their business, and distinguishing the two would let anyone probe
	// for the existence of other people's definitions.
	if !profile.OwnerID.Valid || profile.OwnerID.Bytes != member.UserID.Bytes {
		writeError(w, http.StatusNotFound, "runtime profile not found")
		return
	}

	if _, err := h.Queries.PublishRuntimeProfileToWorkspace(r.Context(), db.PublishRuntimeProfileToWorkspaceParams{
		ProfileID:   profileUUID,
		WorkspaceID: wsUUID,
		PublishedBy: member.UserID,
	}); err != nil {
		slog.Error("PublishRuntimeProfile failed", "error", err, "profile_id", uuidToString(profileUUID))
		writeError(w, http.StatusInternalServerError, "failed to publish runtime profile")
		return
	}

	profileID := uuidToString(profileUUID)
	// Only this workspace's daemons have anything new to do — the definition
	// itself did not change.
	h.requestDaemonRuntimeProfileRefresh(wsID, profileID)
	h.publish(protocol.EventDaemonRegister, wsID, "member", uuidToString(member.UserID), map[string]any{
		"runtime_profile_id": profileID,
	})

	resp := runtimeProfileToResponse(profile)
	enabled := true
	resp.WorkspaceEnabled = &enabled
	writeJSON(w, http.StatusOK, resp)
}

type setRuntimeProfileEnabledRequest struct {
	Enabled *bool `json:"enabled"`
}

// SetRuntimeProfileWorkspaceEnabled flips THIS workspace's switch on a
// published profile. Distinct from the owner's `enabled` field, which retires
// the definition everywhere, and from withdrawing it, which removes the link:
// this is a team saying "not right now" while keeping the profile available to
// turn back on without the owner's involvement.
//
// Workspace admin is sufficient. The blast radius is exactly this workspace —
// no other team's runtimes are affected — which is the line the whole
// cross-workspace design draws between assets and authorization.
func (h *Handler) SetRuntimeProfileWorkspaceEnabled(w http.ResponseWriter, r *http.Request) {
	wsID := strings.TrimSpace(chi.URLParam(r, "id"))
	member, ok := h.requireWorkspaceMember(w, r, wsID, "workspace not found")
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, wsID, "workspace id")
	if !ok {
		return
	}
	profileUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "profileId"), "profile id")
	if !ok {
		return
	}

	var req setRuntimeProfileEnabledRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Enabled == nil {
		writeError(w, http.StatusBadRequest, "enabled is required")
		return
	}

	if _, err := h.Queries.SetRuntimeProfileWorkspaceEnabled(r.Context(), db.SetRuntimeProfileWorkspaceEnabledParams{
		ProfileID:   profileUUID,
		WorkspaceID: wsUUID,
		Enabled:     *req.Enabled,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "runtime profile not found")
			return
		}
		slog.Error("SetRuntimeProfileWorkspaceEnabled failed", "error", err, "profile_id", uuidToString(profileUUID))
		writeError(w, http.StatusInternalServerError, "failed to update runtime profile")
		return
	}

	profileID := uuidToString(profileUUID)
	h.requestDaemonRuntimeProfileRefresh(wsID, profileID)
	h.publish(protocol.EventDaemonRegister, wsID, "member", uuidToString(member.UserID), map[string]any{
		"runtime_profile_id": profileID,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"profile_id":        profileID,
		"workspace_enabled": *req.Enabled,
	})
}
