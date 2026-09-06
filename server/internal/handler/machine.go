package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/protocol"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ---------------------------------------------------------------------------
// Machines (migration 412)
//
// A machine is the computer a daemon runs on. It is owned by a user and is not
// scoped to any workspace: the same host registered in five workspaces is one
// machine with five agent_runtime projections, and everything true of the host
// rather than of a team — its name, the CLI version it reports, whether it is
// online — lives here and is written once.
//
// The endpoints below are deliberately NOT under /api/workspaces. Routing them
// through a workspace would reintroduce the per-workspace duplication the
// machine exists to remove, and would make "rename my laptop" an act performed
// five times.
//
// Disclosure rule, which every read here obeys: a machine may tell its owner
// HOW MANY workspaces it serves, but may only name the ones the reader is a
// member of. Otherwise the runtimes page would become a way to enumerate the
// workspaces a colleague belongs to.
// ---------------------------------------------------------------------------

type MachineResponse struct {
	ID       string  `json:"id"`
	DaemonID string  `json:"daemon_id"`
	OwnerID  *string `json:"owner_id"`
	// DeviceName is what the daemon proposed; CustomName is the user's
	// override. Clients display CustomName ?? DeviceName, and seed a rename
	// field from the raw CustomName.
	DeviceName string  `json:"device_name"`
	CustomName *string `json:"custom_name"`
	Metadata   any     `json:"metadata"`
	Status     string  `json:"status"`
	LastSeenAt *string `json:"last_seen_at"`
	// WorkspaceCount is every workspace this machine is registered in,
	// including ones the reader cannot see. Workspaces lists only those the
	// reader is a member of, so the two can legitimately disagree.
	WorkspaceCount int64                      `json:"workspace_count"`
	Workspaces     []MachineWorkspaceResponse `json:"workspaces"`
	CreatedAt      string                     `json:"created_at"`
	UpdatedAt      string                     `json:"updated_at"`
}

// MachineWorkspaceResponse is one projection: this host, in one workspace, as
// one runtime. Visibility is the per-workspace authorization that deliberately
// did NOT move to the machine — a host shared with one team stays private to
// the others until its owner says otherwise.
type MachineWorkspaceResponse struct {
	RuntimeID     string  `json:"runtime_id"`
	WorkspaceID   string  `json:"workspace_id"`
	WorkspaceName string  `json:"workspace_name"`
	WorkspaceSlug string  `json:"workspace_slug"`
	Provider      string  `json:"provider"`
	ProfileID     *string `json:"profile_id"`
	Visibility    string  `json:"visibility"`
	Status        string  `json:"status"`
	LastSeenAt    *string `json:"last_seen_at"`
}

func machineToResponse(m db.Machine) MachineResponse {
	var metadata any
	if m.Metadata != nil {
		_ = json.Unmarshal(m.Metadata, &metadata)
	}
	if metadata == nil {
		metadata = map[string]any{}
	}
	return MachineResponse{
		ID:         uuidToString(m.ID),
		DaemonID:   m.DaemonID,
		OwnerID:    uuidToPtr(m.OwnerID),
		DeviceName: m.DeviceName,
		CustomName: textToPtr(m.CustomName),
		Metadata:   metadata,
		Status:     m.Status,
		LastSeenAt: timestampToPtr(m.LastSeenAt),
		Workspaces: []MachineWorkspaceResponse{},
		CreatedAt:  timestampToString(m.CreatedAt),
		UpdatedAt:  timestampToString(m.UpdatedAt),
	}
}

// ListMyMachines returns the machines the caller owns, across every workspace.
// This is the cross-workspace view: one computer appears once, whatever number
// of workspaces it is registered in.
func (h *Handler) ListMyMachines(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	userUUID := parseUUID(userID)

	machines, err := h.Queries.ListMachinesByOwner(r.Context(), userUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list machines")
		return
	}

	resp := make([]MachineResponse, 0, len(machines))
	for _, m := range machines {
		item := machineToResponse(m)
		count, err := h.Queries.CountMachineWorkspaceProjections(r.Context(), m.ID)
		if err != nil {
			// A machine whose projection count cannot be read is still worth
			// returning — the host exists and its identity is the useful part.
			slog.Warn("machine projection count failed", "error", err, "machine_id", item.ID)
		}
		item.WorkspaceCount = count
		resp = append(resp, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"machines": resp})
}

// GetMachine returns one machine with the workspaces the READER may see it in.
// Owner-gated: a machine is a person's computer, and its CLI version, device
// name and workspace footprint are not workspace-shared facts.
func (h *Handler) GetMachine(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	machineUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "machineId"), "machine id")
	if !ok {
		return
	}
	machine, ok := h.requireMachineOwner(w, r, machineUUID, parseUUID(userID))
	if !ok {
		return
	}

	resp := machineToResponse(machine)
	count, err := h.Queries.CountMachineWorkspaceProjections(r.Context(), machineUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load machine")
		return
	}
	resp.WorkspaceCount = count

	rows, err := h.Queries.ListMachineWorkspaceProjections(r.Context(), db.ListMachineWorkspaceProjectionsParams{
		MachineID: machineUUID,
		UserID:    parseUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load machine")
		return
	}
	for _, row := range rows {
		resp.Workspaces = append(resp.Workspaces, MachineWorkspaceResponse{
			RuntimeID:     uuidToString(row.RuntimeID),
			WorkspaceID:   uuidToString(row.WorkspaceID),
			WorkspaceName: row.WorkspaceName,
			WorkspaceSlug: row.WorkspaceSlug,
			Provider:      row.Provider,
			ProfileID:     uuidToPtr(row.ProfileID),
			Visibility:    row.Visibility,
			Status:        row.Status,
			LastSeenAt:    timestampToPtr(row.LastSeenAt),
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

type updateMachineRequest struct {
	// CustomName sets or clears the machine's display override. An empty or
	// whitespace-only string clears it, reverting to the daemon-proposed
	// device name — the same convention the per-runtime rename used.
	CustomName *string `json:"custom_name"`
}

// UpdateMachine renames a machine. One write, and every workspace the host is
// registered in shows the new name: this replaces the per-workspace
// UpdateAgentRuntimeCustomNameByDaemon fan-out, which could only reach the
// workspace the request arrived through and left the others disagreeing.
//
// Owner-only. A workspace admin can rename what they see of a machine through
// the runtime-level rename, but the host's own name belongs to the person whose
// computer it is.
func (h *Handler) UpdateMachine(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	machineUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "machineId"), "machine id")
	if !ok {
		return
	}
	if _, ok := h.requireMachineOwner(w, r, machineUUID, parseUUID(userID)); !ok {
		return
	}

	var req updateMachineRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.CustomName == nil {
		writeError(w, http.StatusBadRequest, "custom_name is required")
		return
	}

	name := pgtype.Text{}
	if trimmed := strings.TrimSpace(*req.CustomName); trimmed != "" {
		name = pgtype.Text{String: trimmed, Valid: true}
	}

	updated, err := h.Queries.UpdateMachineCustomName(r.Context(), db.UpdateMachineCustomNameParams{
		ID:         machineUUID,
		CustomName: name,
	})
	if err != nil {
		slog.Error("UpdateMachineCustomName failed", "error", err, "machine_id", uuidToString(machineUUID))
		writeError(w, http.StatusInternalServerError, "failed to update machine")
		return
	}

	// Every workspace this host serves is now showing a stale name, so tell
	// each one the reader belongs to. Workspaces the actor cannot see are
	// intentionally not published to: they will pick the change up on their
	// next runtime list read.
	h.publishMachineRenameToVisibleWorkspaces(r, machineUUID, parseUUID(userID))

	writeJSON(w, http.StatusOK, machineToResponse(updated))
}

// requireMachineOwner loads a machine and enforces that the caller owns it.
// A machine owned by someone else is reported as not found rather than
// forbidden, so machine ids stay non-enumerable — the same rule cross-workspace
// resource ids follow everywhere else in this package.
func (h *Handler) requireMachineOwner(w http.ResponseWriter, r *http.Request, machineID, userID pgtype.UUID) (db.Machine, bool) {
	machine, err := h.Queries.GetMachine(r.Context(), machineID)
	if err != nil {
		writeError(w, http.StatusNotFound, "machine not found")
		return db.Machine{}, false
	}
	if !machine.OwnerID.Valid || machine.OwnerID.Bytes != userID.Bytes {
		writeError(w, http.StatusNotFound, "machine not found")
		return db.Machine{}, false
	}
	return machine, true
}

// publishMachineRenameToVisibleWorkspaces nudges the runtime list in each
// workspace the actor shares with this machine. Best-effort by design: the name
// is already committed, and a missed event only delays a refresh.
func (h *Handler) publishMachineRenameToVisibleWorkspaces(r *http.Request, machineID, userID pgtype.UUID) {
	rows, err := h.Queries.ListMachineWorkspaceProjections(r.Context(), db.ListMachineWorkspaceProjectionsParams{
		MachineID: machineID,
		UserID:    userID,
	})
	if err != nil {
		slog.Warn("machine rename fan-out failed", "error", err, "machine_id", uuidToString(machineID))
		return
	}
	seen := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		wsID := uuidToString(row.WorkspaceID)
		if _, dup := seen[wsID]; dup {
			continue
		}
		seen[wsID] = struct{}{}
		// Reuse the daemon:register event: it is what the runtime list
		// already listens to for "this workspace's runtime rows changed",
		// and a rename is exactly that from a client's point of view.
		h.publish(protocol.EventDaemonRegister, wsID, "member", uuidToString(userID), map[string]any{
			"machine_id": uuidToString(machineID),
		})
	}
}
