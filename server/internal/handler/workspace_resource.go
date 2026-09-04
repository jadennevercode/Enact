package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	agentpkg "github.com/enact-ai/enact/server/pkg/agent"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/protocol"
)

// WorkspaceResourceResponse is the JSON shape returned by the resource API.
type WorkspaceResourceResponse struct {
	ID           string          `json:"id"`
	WorkspaceID  string          `json:"workspace_id"`
	ResourceType string          `json:"resource_type"`
	ResourceRef  json.RawMessage `json:"resource_ref"`
	Label        *string         `json:"label"`
	Position     int32           `json:"position"`
	CreatedAt    string          `json:"created_at"`
	CreatedBy    *string         `json:"created_by"`
}

func workspaceResourceToResponse(r db.WorkspaceResource) WorkspaceResourceResponse {
	ref := json.RawMessage(r.ResourceRef)
	if len(ref) == 0 {
		ref = json.RawMessage("{}")
	}
	return WorkspaceResourceResponse{
		ID:           uuidToString(r.ID),
		WorkspaceID:  uuidToString(r.WorkspaceID),
		ResourceType: r.ResourceType,
		ResourceRef:  ref,
		Label:        textToPtr(r.Label),
		Position:     r.Position,
		CreatedAt:    timestampToString(r.CreatedAt),
		CreatedBy:    uuidToPtr(r.CreatedBy),
	}
}

// CreateWorkspaceResourceRequest is the body for POST /api/resources.
type CreateWorkspaceResourceRequest struct {
	ResourceType string          `json:"resource_type"`
	ResourceRef  json.RawMessage `json:"resource_ref"`
	Label        *string         `json:"label"`
	Position     *int32          `json:"position"`
}

// UpdateWorkspaceResourceRequest is the body for PUT /api/resources/{id}.
// resource_type cannot change after creation — pick a new type by deleting and
// re-adding. Every field is optional; omitted fields keep their current value.
type UpdateWorkspaceResourceRequest struct {
	ResourceRef json.RawMessage `json:"resource_ref"`
	Label       *string         `json:"label"`
	Position    *int32          `json:"position"`
}

// validateAndNormalizeResourceRef checks the payload for a known resource_type.
// New types are added here without schema migration; unknown types are rejected
// at the API boundary so a typo can't slip through and produce a resource the
// daemon/UI doesn't understand.
func validateAndNormalizeResourceRef(resourceType string, ref json.RawMessage) (json.RawMessage, error) {
	if len(ref) == 0 {
		return nil, errors.New("resource_ref is required")
	}
	switch resourceType {
	case "github_repo":
		return validateGithubRepoRef(ref)
	case "local_directory":
		return validateLocalDirectoryRef(ref)
	default:
		return nil, fmt.Errorf("unknown resource_type %q", resourceType)
	}
}

type githubRepoRef struct {
	URL               string `json:"url"`
	DefaultBranchHint string `json:"default_branch_hint,omitempty"`
	Ref               string `json:"ref,omitempty"`
}

func validateGithubRepoRef(ref json.RawMessage) (json.RawMessage, error) {
	var payload githubRepoRef
	if err := json.Unmarshal(ref, &payload); err != nil {
		return nil, fmt.Errorf("invalid github_repo payload: %w", err)
	}
	payload.URL = strings.TrimSpace(payload.URL)
	if payload.URL == "" {
		return nil, errors.New("github_repo: url is required")
	}
	if !isValidGitRepoURL(payload.URL) {
		return nil, errors.New("github_repo: url must be a valid http(s) or ssh git URL")
	}
	payload.DefaultBranchHint = strings.TrimSpace(payload.DefaultBranchHint)
	payload.Ref = strings.TrimSpace(payload.Ref)
	out, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Execution modes for resource_type=local_directory. The zero value (absent
// field) means in_place, so resources created before worktree mode existed keep
// their original behavior without a data migration.
const (
	// localDirectoryModeInPlace runs the agent directly in the user's
	// directory, serialised by the daemon's per-path mutex: one task at a
	// time, edits land in the user's working tree.
	localDirectoryModeInPlace = "in_place"
	// localDirectoryModeWorktree runs each task in its own git worktree of
	// the user's repo, created inside the daemon's env root. Tasks on the
	// same directory run concurrently and deliver their work as a branch.
	// Only valid when the directory is a git working tree — the daemon
	// verifies that at task time, since the server can't see the filesystem.
	localDirectoryModeWorktree = "worktree"
)

// localDirectoryRef is the JSONB shape stored for resource_type=local_directory.
// It pins the workspace to an existing directory on a specific user machine. The
// daemon_id scopes the path to one daemon registration — the same string path
// on a different machine is a different resource. The optional label is a
// human-readable hint used by the UI; the row-level workspace_resource.label
// column remains the generic column for any resource type.
//
// execution_mode selects how tasks share that directory: in_place (default)
// keeps the historical one-task-at-a-time behavior, worktree gives each task an
// isolated git worktree so tasks run concurrently.
type localDirectoryRef struct {
	LocalPath     string `json:"local_path"`
	DaemonID      string `json:"daemon_id"`
	Label         string `json:"label,omitempty"`
	ExecutionMode string `json:"execution_mode,omitempty"`
}

// requireWorktreeCapableDaemon rejects saving a local_directory ref that asks
// for execution_mode=worktree while the daemon owning the path is too old to
// implement the mode. An old daemon does not know the field exists: it would
// json-skip it and run tasks IN PLACE, editing the working copy the user
// explicitly asked to isolate — and it predates the daemon-side unknown-mode
// refusal, so only the server can stop it. Gating at save time surfaces the
// failure at the moment the user can act on it (upgrade the daemon), instead
// of as a silently-wrong task later.
//
// Residual gap, accepted for now: a daemon downgraded AFTER the resource was
// saved is not caught here; closing that needs a claim-time gate.
//
// Returns true to proceed; on false the 422 response has already been written,
// using the same daemon_version_unsupported code as the quick-create gate so
// clients can branch on it.
func (h *Handler) requireWorktreeCapableDaemon(w http.ResponseWriter, r *http.Request, workspaceID pgtype.UUID, resourceType string, normalizedRef json.RawMessage) bool {
	if resourceType != "local_directory" {
		return true
	}
	var ref localDirectoryRef
	if err := json.Unmarshal(normalizedRef, &ref); err != nil || ref.ExecutionMode != localDirectoryModeWorktree {
		return true
	}

	// One machine hosts one runtime row per provider, all registered by the
	// same daemon binary. A workspace has a handful of runtimes; the unfiltered
	// list is a tiny read.
	runtimes, err := h.Queries.ListAgentRuntimes(r.Context(), workspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check runtime capabilities")
		return false
	}
	// Same signal the claim gate uses: what the daemon advertised, recorded on
	// its runtime row at registration. Version numbers cannot answer this — a
	// dev-built daemon reports a git-describe string that the version floor
	// deliberately exempts (ENA-5707).
	if daemonAdvertisesWorktree(runtimes, ref.DaemonID) {
		return true
	}
	// Fail closed when no runtime for this daemon advertises it — including a
	// daemon_id with no registered runtime at all: a worktree resource that can
	// never dispatch correctly is worse than a save-time error.
	writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
		"error": fmt.Sprintf(
			"local_directory: %q is set to parallel (worktree) mode, but the Enact runtime on that machine does not support it. Update the Enact app on that machine to the latest version, or keep the resource on in_place.",
			ref.LocalPath),
		"code":            "daemon_version_unsupported",
		"current_version": latestDaemonCLIVersion(runtimes, ref.DaemonID),
		"min_version":     agentpkg.MinLocalWorktreeCLIVersion,
		"daemon_id":       ref.DaemonID,
	})
	return false
}

// daemonAdvertisesWorktree reports whether the daemon's MOST RECENTLY SEEN
// runtime row advertised worktree support.
//
// Deliberately not "any row advertised it". Deregistering a runtime only flips
// the row to offline — its metadata survives — and ListAgentRuntimes returns
// every row. So a machine that once ran a capable daemon, then downgraded,
// still has an old capable row sitting next to the fresh incapable one, and an
// any-match would keep saying yes forever. Newest-wins reads the machine's
// CURRENT binary, which is the question being asked.
//
// A row missing the capability is never skipped: being the newest is what makes
// it authoritative, not whether its answer is convenient.
func daemonAdvertisesWorktree(runtimes []db.AgentRuntime, daemonID string) bool {
	if strings.TrimSpace(daemonID) == "" {
		return false
	}
	var newest *db.AgentRuntime
	for i := range runtimes {
		rt := &runtimes[i]
		if !rt.DaemonID.Valid || rt.DaemonID.String != daemonID {
			continue
		}
		if newest == nil || runtimeSeenAfter(rt, newest) {
			newest = rt
		}
	}
	if newest == nil {
		return false
	}
	return runtimeHasCapability(newest.Metadata, protocol.DaemonCapabilityLocalWorktreeV1)
}

// runtimeSeenAfter orders two rows of the same daemon by last_seen_at. A row
// that never reported (NULL) sorts oldest, so a live row always wins over one
// that never checked in.
func runtimeSeenAfter(candidate, current *db.AgentRuntime) bool {
	if !candidate.LastSeenAt.Valid {
		return false
	}
	if !current.LastSeenAt.Valid {
		return true
	}
	return candidate.LastSeenAt.Time.After(current.LastSeenAt.Time)
}

// latestDaemonCLIVersion returns the cli_version of the freshest runtime row
// registered by daemonID, or "" when the daemon has no row carrying one. Rows
// without a version are skipped rather than treated as authoritative: one
// machine registers a row per provider, and only the freshest version-bearing
// row reflects the binary currently running there.
func latestDaemonCLIVersion(runtimes []db.AgentRuntime, daemonID string) string {
	current := ""
	var currentSeen pgtype.Timestamptz
	for _, rt := range runtimes {
		if !rt.DaemonID.Valid || rt.DaemonID.String != daemonID {
			continue
		}
		v := readRuntimeCLIVersion(rt.Metadata)
		if v == "" {
			continue
		}
		if current == "" || (rt.LastSeenAt.Valid && rt.LastSeenAt.Time.After(currentSeen.Time)) {
			current = v
			currentSeen = rt.LastSeenAt
		}
	}
	return current
}

func validateLocalDirectoryRef(ref json.RawMessage) (json.RawMessage, error) {
	var payload localDirectoryRef
	if err := json.Unmarshal(ref, &payload); err != nil {
		return nil, fmt.Errorf("invalid local_directory payload: %w", err)
	}
	payload.LocalPath = strings.TrimSpace(payload.LocalPath)
	if payload.LocalPath == "" {
		return nil, errors.New("local_directory: local_path is required")
	}
	if !isAbsoluteLocalPath(payload.LocalPath) {
		return nil, errors.New("local_directory: local_path must be an absolute path")
	}
	payload.DaemonID = strings.TrimSpace(payload.DaemonID)
	if payload.DaemonID == "" {
		return nil, errors.New("local_directory: daemon_id is required")
	}
	payload.Label = strings.TrimSpace(payload.Label)
	payload.ExecutionMode = strings.TrimSpace(payload.ExecutionMode)
	switch payload.ExecutionMode {
	case "", localDirectoryModeInPlace, localDirectoryModeWorktree:
	default:
		return nil, fmt.Errorf("local_directory: execution_mode must be %q or %q, got %q",
			localDirectoryModeInPlace, localDirectoryModeWorktree, payload.ExecutionMode)
	}
	out, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// localDirectoryRefLabel reads the label carried inside a local_directory ref,
// trimmed. Returns "" for a missing label or a ref that does not parse — the
// callers only compare labels, so an unreadable ref behaves like an unlabeled
// one instead of failing the write.
func localDirectoryRefLabel(ref json.RawMessage) string {
	var payload localDirectoryRef
	if err := json.Unmarshal(ref, &payload); err != nil {
		return ""
	}
	return strings.TrimSpace(payload.Label)
}

// localDirectoryRefDiffersOnlyByLabel reports whether two refs are identical
// once their labels are set aside.
//
// This is what separates "a ≤ v0.4.28 client renamed the folder" from "a client
// sent a ref it had been holding since before someone else renamed it". Both
// arrive as a full ref whose label differs from the stored one; only the first
// is a rename. The mode dialog snapshots the whole ref when it opens, so a
// second device renaming in between turns an execution-mode save into a name
// rollback unless the two are told apart.
//
// Compared as decoded values rather than bytes: the stored ref may have been
// written by a different build, so key order and spacing prove nothing. Unknown
// keys count — a difference this binary cannot interpret is still a difference,
// and calling such a request a pure rename would be a guess.
func localDirectoryRefDiffersOnlyByLabel(a, b json.RawMessage) bool {
	strip := func(raw json.RawMessage) (map[string]any, bool) {
		var fields map[string]any
		if err := json.Unmarshal(raw, &fields); err != nil {
			return nil, false
		}
		delete(fields, "label")
		return fields, true
	}
	left, ok := strip(a)
	if !ok {
		return false
	}
	right, ok := strip(b)
	if !ok {
		return false
	}
	return reflect.DeepEqual(left, right)
}

// withLocalDirectoryRefLabel returns ref with only its "label" key set (or
// removed, when label is NULL) and every other key preserved.
//
// A local_directory's display name has two homes: desktop builds up to v0.4.28
// rename by rewriting resource_ref.label, newer clients rename the top-level
// column precisely so they never resend the ref (an older server re-normalizes
// a resent ref and silently drops the fields it does not know — see
// handleRenameLocalDirectory in the resources settings section). This server is
// the only writer that sees both kinds of client, so it converges the two
// copies on every write; without that, each client generation keeps editing
// its own copy and the same row shows different names on different devices.
//
// Patch the raw map rather than round-tripping localDirectoryRef: the stored
// ref may carry fields written by a NEWER server, and re-marshaling through
// this binary's struct would drop them — the exact failure mode this PR exists
// to close. Key order and whitespace are not preserved (nor promised by JSONB);
// every key and value is.
func withLocalDirectoryRefLabel(ref json.RawMessage, label pgtype.Text) (json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(ref, &fields); err != nil {
		return nil, err
	}
	if label.Valid {
		encoded, err := json.Marshal(label.String)
		if err != nil {
			return nil, err
		}
		fields["label"] = encoded
	} else {
		delete(fields, "label")
	}
	return json.Marshal(fields)
}

// isAbsoluteLocalPath checks the path looks absolute on either POSIX or
// Windows daemons. The server can't know which OS the daemon runs on, so we
// accept the union: a leading "/" (POSIX), a UNC prefix "\\", or a drive
// letter like "C:\" or "C:/". The daemon still verifies existence at run
// time — this is a typo guard, not a filesystem check.
func isAbsoluteLocalPath(s string) bool {
	if s == "" {
		return false
	}
	if s[0] == '/' {
		return true
	}
	if strings.HasPrefix(s, `\\`) {
		return true
	}
	if len(s) >= 3 && isDriveLetter(s[0]) && s[1] == ':' && (s[2] == '\\' || s[2] == '/') {
		return true
	}
	return false
}

func isDriveLetter(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

// isValidGitRepoURL accepts the three forms a user can paste from GitHub's
// "Code" menu: https://, ssh:// (with explicit scheme), and the scp-like
// shorthand `git@host:owner/repo.git`. The check is intentionally lax — we are
// guarding against pasted garbage like "not-a-url", not enforcing a strict
// grammar — because the actual fetch happens client-side via `git clone` and
// the user gets a clearer error from git than from us.
func isValidGitRepoURL(s string) bool {
	if u, err := url.Parse(s); err == nil && u.Host != "" {
		switch u.Scheme {
		case "http", "https", "ssh", "git":
			return true
		}
	}
	// scp-like ssh shorthand: [user@]host:path with a non-empty host and path,
	// and no spaces. Reject anything that looks like a URL with a scheme
	// (those should go through url.Parse above).
	if strings.Contains(s, " ") || strings.Contains(s, "://") {
		return false
	}
	colon := strings.Index(s, ":")
	if colon <= 0 || colon == len(s)-1 {
		return false
	}
	// In scp-like ssh shorthand `[user@]host:path`, `@` is only meaningful
	// as a user separator before the first ':'. If '@' appears at or after
	// the colon it is not the user separator — reject as malformed rather
	// than guess (and avoid a slice-bounds panic from blindly slicing).
	at := strings.Index(s, "@")
	if at >= colon {
		return false
	}
	hostStart := 0
	if at >= 0 {
		hostStart = at + 1
	}
	host := s[hostStart:colon]
	path := s[colon+1:]
	if host == "" || path == "" {
		return false
	}
	return true
}

// loadWorkspaceForResource resolves the workspace a resource request is
// scoped to. Resources hung off a project until the project was removed; now
// the X-Workspace-ID header the router already authorized is the whole
// address, and there is no second id to validate.
func (h *Handler) loadWorkspaceForResource(w http.ResponseWriter, r *http.Request) (pgtype.UUID, bool) {
	return parseUUIDOrBadRequest(w, h.resolveWorkspaceID(r), "workspace id")
}

// ListWorkspaceResources returns the resources attached to the workspace.
func (h *Handler) ListWorkspaceResources(w http.ResponseWriter, r *http.Request) {
	wsID, ok := h.loadWorkspaceForResource(w, r)
	if !ok {
		return
	}
	resources, err := h.Queries.ListWorkspaceResources(r.Context(), wsID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list workspace resources")
		return
	}
	resp := make([]WorkspaceResourceResponse, len(resources))
	for i, res := range resources {
		resp[i] = workspaceResourceToResponse(res)
	}
	writeJSON(w, http.StatusOK, map[string]any{"resources": resp, "total": len(resp)})
}

// CreateWorkspaceResource attaches a new resource to the workspace.
func (h *Handler) CreateWorkspaceResource(w http.ResponseWriter, r *http.Request) {
	wsID, ok := h.loadWorkspaceForResource(w, r)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	var req CreateWorkspaceResourceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.ResourceType = strings.TrimSpace(req.ResourceType)
	if req.ResourceType == "" {
		writeError(w, http.StatusBadRequest, "resource_type is required")
		return
	}
	normalizedRef, err := validateAndNormalizeResourceRef(req.ResourceType, req.ResourceRef)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if conflict, err := h.findLocalDirectoryConflict(r.Context(), wsID, req.ResourceType, normalizedRef, pgtype.UUID{}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check existing resources")
		return
	} else if conflict {
		writeError(w, http.StatusConflict, "this daemon already has a local_directory attached to this workspace; remove it before adding another")
		return
	}

	if !h.requireWorktreeCapableDaemon(w, r, wsID, req.ResourceType, normalizedRef) {
		return
	}

	var label pgtype.Text
	if req.Label != nil && strings.TrimSpace(*req.Label) != "" {
		label = pgtype.Text{String: strings.TrimSpace(*req.Label), Valid: true}
	}
	var position int32
	if req.Position != nil {
		position = *req.Position
	} else {
		// Append after existing resources.
		count, _ := h.Queries.CountWorkspaceResources(r.Context(), wsID)
		position = int32(count)
	}

	creator, _ := h.parseUserUUIDOrZero(userID)
	resource, err := h.Queries.CreateWorkspaceResource(r.Context(), db.CreateWorkspaceResourceParams{
		WorkspaceID:  wsID,
		ResourceType: req.ResourceType,
		ResourceRef:  normalizedRef,
		Label:        label,
		Position:     position,
		CreatedBy:    creator,
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "this resource is already attached to this workspace")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create workspace resource")
		return
	}

	resp := workspaceResourceToResponse(resource)
	h.publish(
		protocol.EventWorkspaceResourceCreated,
		uuidToString(wsID),
		"member",
		userID,
		map[string]any{"resource": resp},
	)
	writeJSON(w, http.StatusCreated, resp)
}

// UpdateWorkspaceResource edits an existing resource's ref/label/position.
// resource_type is immutable — re-pointing a resource at a different type is
// almost always a different conceptual entity, so the caller should delete and
// re-add instead. Omitted fields keep their current value, including the
// `label` JSON null vs. missing distinction (missing = keep, explicit "" =
// clear).
func (h *Handler) UpdateWorkspaceResource(w http.ResponseWriter, r *http.Request) {
	wsID, ok := h.loadWorkspaceForResource(w, r)
	if !ok {
		return
	}
	resourceUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "resourceId"), "resource id")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	existing, err := h.Queries.GetWorkspaceResourceInWorkspace(r.Context(), db.GetWorkspaceResourceInWorkspaceParams{
		ID: resourceUUID, WorkspaceID: wsID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "resource not found")
		return
	}

	// Decode into a raw map first so we can tell "field omitted" from
	// "field present with zero value" — the label clear case in particular
	// relies on this distinction.
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	nextRef := json.RawMessage(existing.ResourceRef)
	rawRef, refProvided := raw["resource_ref"]
	if refProvided {
		normalized, err := validateAndNormalizeResourceRef(existing.ResourceType, rawRef)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		nextRef = normalized
	}

	if conflict, err := h.findLocalDirectoryConflict(r.Context(), wsID, existing.ResourceType, nextRef, existing.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check existing resources")
		return
	} else if conflict {
		writeError(w, http.StatusConflict, "another local_directory on this daemon is already attached to this workspace")
		return
	}

	// A ≤ v0.4.28 client renames by resending the ref, so "the ref was sent"
	// does not mean "the execution mode was touched". Anything else about the
	// ref changing does mean it might have been.
	refRenameOnly := refProvided &&
		existing.ResourceType == "local_directory" &&
		localDirectoryRefDiffersOnlyByLabel(nextRef, existing.ResourceRef)

	// Gate only when the caller is actually changing what would run: a label or
	// position update — including an old client's rename, which carries the ref
	// along — must not start failing because the daemon's registration drifted
	// after the mode was legitimately saved. The row already says worktree; the
	// claim gate is what stops it from running somewhere that cannot.
	if refProvided && !refRenameOnly {
		if !h.requireWorktreeCapableDaemon(w, r, wsID, existing.ResourceType, nextRef) {
			return
		}
	}

	nextLabel := existing.Label
	// Tracks an explicit clear, as opposed to a column that was never set.
	// Only the former may remove the ref's legacy label copy below: rows
	// created by older clients keep their only name inside the ref, and an
	// unrelated update must not strip it just because the column is NULL.
	labelCleared := false
	if rawLabel, ok := raw["label"]; ok {
		var labelStr *string
		if err := json.Unmarshal(rawLabel, &labelStr); err != nil {
			writeError(w, http.StatusBadRequest, "label must be a string or null")
			return
		}
		if labelStr == nil || strings.TrimSpace(*labelStr) == "" {
			nextLabel = pgtype.Text{}
			labelCleared = true
		} else {
			nextLabel = pgtype.Text{String: strings.TrimSpace(*labelStr), Valid: true}
		}
	} else if refRenameOnly {
		// No label field, and the ref differs ONLY by its embedded label: that
		// is how desktop builds up to v0.4.28 rename — they rewrite ref.label
		// and never send the column. Follow the rename into the column, or the
		// newer clients (which read the column first) keep showing the old
		// name this rename just replaced.
		//
		// A ref that also changes something else is not a rename however
		// different its label looks: the mode dialog snapshots the ref when it
		// opens, so a rename on another device in the meantime would otherwise
		// be undone by whoever saves an execution mode next.
		if refLabel := localDirectoryRefLabel(nextRef); refLabel != localDirectoryRefLabel(existing.ResourceRef) {
			if refLabel == "" {
				nextLabel = pgtype.Text{}
				labelCleared = true
			} else {
				nextLabel = pgtype.Text{String: refLabel, Valid: true}
			}
		}
	}

	nextPosition := existing.Position
	if rawPos, ok := raw["position"]; ok {
		var pos *int32
		if err := json.Unmarshal(rawPos, &pos); err != nil {
			writeError(w, http.StatusBadRequest, "position must be an integer")
			return
		}
		if pos != nil {
			nextPosition = *pos
		}
	}

	// Mirror the final label into the ref's legacy copy so both client
	// generations read the same name, including removing it on an explicit
	// clear — otherwise the display falls back to the name the user just
	// deleted. Rows the two-copy era left disagreeing converge on their first
	// write here. A NULL column that was never set stays out of the ref: for
	// rows created by older clients the ref copy IS the name.
	if existing.ResourceType == "local_directory" {
		// The name this request is entitled to write. Only a rename or an
		// explicit label field may change it; anything else keeps whatever the
		// row is called today, wherever that name currently lives — so a stale
		// ref snapshot cannot carry an old name back in behind an unrelated
		// edit.
		name := nextLabel
		if !nextLabel.Valid && !labelCleared {
			if stored := localDirectoryRefLabel(existing.ResourceRef); stored != "" {
				name = pgtype.Text{String: stored, Valid: true}
			}
		}
		// Rows that have never had a name at all are left alone, and so is the
		// ref on updates that do not touch it: an unrelated position change
		// must not rewrite a ref, and for old rows the ref copy IS the name.
		if refProvided || nextLabel.Valid || labelCleared {
			synced, err := withLocalDirectoryRefLabel(nextRef, name)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed to update workspace resource")
				return
			}
			nextRef = synced
		}
	}

	updated, err := h.Queries.UpdateWorkspaceResource(r.Context(), db.UpdateWorkspaceResourceParams{
		ID:          existing.ID,
		ResourceRef: nextRef,
		Label:       nextLabel,
		Position:    nextPosition,
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "this resource is already attached to this workspace")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update workspace resource")
		return
	}

	resp := workspaceResourceToResponse(updated)
	h.publish(
		protocol.EventWorkspaceResourceUpdated,
		uuidToString(wsID),
		"member",
		userID,
		map[string]any{"resource": resp},
	)
	writeJSON(w, http.StatusOK, resp)
}

// findLocalDirectoryConflict enforces "at most one local_directory resource
// per (workspace, daemon)". The daemon picks the first matching daemon_id row
// out of a task's resources (findLocalDirectoryAssignment), so letting a
// workspace carry two rows for the same daemon would mean the agent silently
// writes into whichever happens to come back first — a safety hazard for a
// feature that operates directly on the user's real working directory.
//
// The DB-level UNIQUE(workspace_id, resource_type, resource_ref) constraint
// alone is not enough here: it only fires on full ref-JSON equality, so a
// different local_path or even a typoed label on the same daemon would slip
// through. We do the daemon-scoped check here in application code instead.
//
// `excludeID` lets the update path ignore the row being edited.
func (h *Handler) findLocalDirectoryConflict(ctx context.Context, workspaceID pgtype.UUID, resourceType string, normalizedRef json.RawMessage, excludeID pgtype.UUID) (bool, error) {
	if resourceType != "local_directory" {
		return false, nil
	}
	var incoming localDirectoryRef
	if err := json.Unmarshal(normalizedRef, &incoming); err != nil {
		return false, err
	}
	rows, err := h.Queries.ListWorkspaceResources(ctx, workspaceID)
	if err != nil {
		return false, err
	}
	for _, row := range rows {
		if row.ResourceType != "local_directory" {
			continue
		}
		if excludeID.Valid && uuidToString(row.ID) == uuidToString(excludeID) {
			continue
		}
		var existing localDirectoryRef
		if err := json.Unmarshal(row.ResourceRef, &existing); err != nil {
			continue
		}
		// Daemon-scoped uniqueness: one local_directory per daemon per
		// workspace. Different daemons can each carry one row (one per
		// user device); the daemon-side resolver routes each daemon to
		// its own assignment by daemon_id.
		if existing.DaemonID == incoming.DaemonID {
			return true, nil
		}
	}
	return false, nil
}

// DeleteWorkspaceResource removes a resource from the workspace.
func (h *Handler) DeleteWorkspaceResource(w http.ResponseWriter, r *http.Request) {
	wsID, ok := h.loadWorkspaceForResource(w, r)
	if !ok {
		return
	}
	resourceUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "resourceId"), "resource id")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	resource, err := h.Queries.GetWorkspaceResourceInWorkspace(r.Context(), db.GetWorkspaceResourceInWorkspaceParams{
		ID: resourceUUID, WorkspaceID: wsID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "resource not found")
		return
	}
	if err := h.Queries.DeleteWorkspaceResource(r.Context(), resource.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete workspace resource")
		return
	}
	h.publish(
		protocol.EventWorkspaceResourceDeleted,
		uuidToString(wsID),
		"member",
		userID,
		map[string]any{
			"resource_id": uuidToString(resource.ID),
		},
	)
	w.WriteHeader(http.StatusNoContent)
}

// parseUserUUIDOrZero converts a user ID string to a pgtype.UUID, returning a
// zero value on any error so the caller can store NULL for created_by when the
// authenticated principal is not a workspace member (e.g. internal-server use).
func (h *Handler) parseUserUUIDOrZero(userID string) (pgtype.UUID, bool) {
	if userID == "" {
		return pgtype.UUID{}, false
	}
	u, err := parseUUIDLoose(userID)
	if err != nil {
		return pgtype.UUID{}, false
	}
	return u, true
}

// parseUUIDLoose mirrors util.ParseUUID but lives here to avoid pulling util
// into a tiny one-off helper. Keep the body minimal.
func parseUUIDLoose(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return pgtype.UUID{}, err
	}
	return u, nil
}

// listWorkspaceResourcesForClaim is a small helper used by the daemon claim
// handler to attach the workspace's resources to outgoing tasks.
func (h *Handler) listWorkspaceResourcesForClaim(ctx context.Context, workspaceID pgtype.UUID) []db.WorkspaceResource {
	if !workspaceID.Valid {
		return nil
	}
	rows, err := h.Queries.ListWorkspaceResources(ctx, workspaceID)
	if err != nil {
		return nil
	}
	return rows
}

// workspaceRepos returns the workspace's github_repo resources as the daemon's
// repo list.
//
// This is the only place repositories come from. `workspace.repos` used to be a
// second, parallel list edited in its own settings tab; migration 438 folded it
// into these rows because the two could not be reconciled at one level — the
// claim handler replaced the whole list rather than merging, so attaching one
// resource silently dropped every repository configured in the other surface.
//
// The resource's `label` carries what the old list called `description`: a
// human note rendered beside the URL in the agent's brief.
func (h *Handler) workspaceRepos(ctx context.Context, workspaceID pgtype.UUID) []RepoData {
	rows := h.listWorkspaceResourcesForClaim(ctx, workspaceID)
	repos := make([]RepoData, 0, len(rows))
	for _, row := range rows {
		if row.ResourceType != "github_repo" {
			continue
		}
		var payload struct {
			URL string `json:"url"`
			Ref string `json:"ref,omitempty"`
		}
		if json.Unmarshal(row.ResourceRef, &payload) != nil || strings.TrimSpace(payload.URL) == "" {
			continue
		}
		description := ""
		if row.Label.Valid {
			description = row.Label.String
		}
		repos = append(repos, RepoData{
			URL:         strings.TrimSpace(payload.URL),
			Ref:         strings.TrimSpace(payload.Ref),
			Description: description,
		})
	}
	return repos
}

// applyWorkspaceResourcesToClaim fills a claim response's resource list and its
// repo list from the workspace's resources.
func (h *Handler) applyWorkspaceResourcesToClaim(ctx context.Context, resp *AgentTaskResponse, workspaceID pgtype.UUID) {
	rows := h.listWorkspaceResourcesForClaim(ctx, workspaceID)
	if len(rows) == 0 {
		return
	}
	out := make([]WorkspaceResourceData, 0, len(rows))
	repos := make([]RepoData, 0, len(rows))
	for _, row := range rows {
		label := ""
		if row.Label.Valid {
			label = row.Label.String
		}
		ref := json.RawMessage(row.ResourceRef)
		if len(ref) == 0 {
			ref = json.RawMessage("{}")
		}
		out = append(out, WorkspaceResourceData{
			ID:           uuidToString(row.ID),
			ResourceType: row.ResourceType,
			ResourceRef:  ref,
			Label:        label,
		})
		// Lift github_repo resources into the daemon's repo list so
		// `enact repo checkout` and the meta-skill render them as the
		// task's repos.
		if row.ResourceType == "github_repo" {
			var payload struct {
				URL string `json:"url"`
				Ref string `json:"ref,omitempty"`
			}
			if json.Unmarshal(row.ResourceRef, &payload) == nil && strings.TrimSpace(payload.URL) != "" {
				repos = append(repos, RepoData{
					URL:         strings.TrimSpace(payload.URL),
					Ref:         strings.TrimSpace(payload.Ref),
					Description: label,
				})
			}
		}
	}
	resp.WorkspaceResources = out
	if len(repos) > 0 {
		resp.Repos = repos
	}
}
