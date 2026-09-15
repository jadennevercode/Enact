package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/codegraph"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Code graph: the repository structure graph the codegraph container builds
// for repositories that opted in through resource_ref.code_graph. The
// server owns the opt-in, the build queue and the build record; every graph
// read is proxied to the container behind workspace authorization. See
// docs/architecture/code-graph-contracts.md for the wire contract.

// RegisterCodeGraphRoutes mounts /api/code-graph. Reads are open to every
// member and to task tokens; rebuild needs a human owner/admin.
func (h *Handler) RegisterCodeGraphRoutes(r chi.Router) {
	r.Route("/api/code-graph", func(r chi.Router) {
		r.Get("/capability", h.codeGraphCapability)
		r.Get("/status", h.codeGraphBulkStatus)
		r.Route("/resources/{resourceId}", func(r chi.Router) {
			r.Get("/status", h.codeGraphStatus)
			r.Post("/rebuild", h.codeGraphRebuild)
			r.Get("/report", h.codeGraphReport)
			for _, suffix := range []string{"communities", "god-nodes", "graph", "tree", "callflow", "wiki", "stats"} {
				r.Get("/"+suffix, h.codeGraphForwardGet(suffix))
			}
			r.Get("/wiki/{slug}", h.codeGraphForwardWikiArticle)
			for _, suffix := range []string{"query", "path", "explain", "affected"} {
				r.Post("/"+suffix, h.codeGraphForwardPost(suffix))
			}
		})
	})
}

// codeGraphActor is the authorized caller of a code graph route.
type codeGraphActor struct {
	WorkspaceID pgtype.UUID
	UserID      string
	ActorType   string
	ActorID     string
}

// codeGraphScope rechecks membership on every call, like semanticScope: an
// agent or a stale tab does not keep access after membership is revoked.
// admin additionally requires a human owner/admin — task tokens and cloud
// PATs are machine credentials and never manage configuration.
func (h *Handler) codeGraphScope(w http.ResponseWriter, r *http.Request, admin bool) (codeGraphActor, bool) {
	user, ok := requireUserID(w, r)
	if !ok {
		return codeGraphActor{}, false
	}
	ws := h.resolveWorkspaceID(r)
	if _, err := uuid.Parse(ws); err != nil {
		writeError(w, http.StatusBadRequest, "workspace is required")
		return codeGraphActor{}, false
	}
	member, ok := h.requireWorkspaceMember(w, r, ws, "workspace not found")
	if !ok {
		return codeGraphActor{}, false
	}
	actorType, actorID := h.resolveActor(r, user, ws)
	if admin && (isMachineCredentialActor(r) || actorType == "agent" || !roleAllowed(member.Role, "owner", "admin")) {
		writeError(w, http.StatusForbidden, "a workspace owner or admin must manage code graphs")
		return codeGraphActor{}, false
	}
	return codeGraphActor{WorkspaceID: parseUUID(ws), UserID: user, ActorType: actorType, ActorID: actorID}, true
}

// loadCodeGraphResource resolves the resource in the path and requires it to
// be a repository that opted into a code graph. Anything else is 404 so a
// caller cannot tell a foreign resource from a disabled one.
func (h *Handler) loadCodeGraphResource(w http.ResponseWriter, r *http.Request, wsID pgtype.UUID) (db.WorkspaceResource, bool) {
	resourceID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "resourceId"), "resource id")
	if !ok {
		return db.WorkspaceResource{}, false
	}
	resource, err := h.Queries.GetWorkspaceResourceInWorkspace(r.Context(), db.GetWorkspaceResourceInWorkspaceParams{ID: resourceID, WorkspaceID: wsID})
	if err != nil || !codeGraphEnabled(resource) {
		writeError(w, http.StatusNotFound, "code graph is not enabled for this resource")
		return db.WorkspaceResource{}, false
	}
	return resource, true
}

// codeGraphEnabled reads the opt-in flag off a github_repo resource.
func codeGraphEnabled(resource db.WorkspaceResource) bool {
	if resource.ResourceType != "github_repo" {
		return false
	}
	return githubRepoRefCodeGraph(resource.ResourceRef)
}

func githubRepoRefCodeGraph(ref json.RawMessage) bool {
	var payload codeRepositoryRef
	if json.Unmarshal(ref, &payload) != nil {
		return false
	}
	return payload.CodeGraph
}

// codeGraphRepoURLAndRef reads the clone URL and the pinned ref of a
// github_repo resource. An empty ref means the default branch.
func codeGraphRepoURLAndRef(resource db.WorkspaceResource) (url, ref string) {
	var payload codeRepositoryRef
	if json.Unmarshal(resource.ResourceRef, &payload) != nil {
		return "", ""
	}
	return payload.URL, payload.Ref
}

// codeGraphProjectKey is the container identifier of a resource.
func codeGraphProjectKey(resource db.WorkspaceResource) (string, error) {
	return codegraph.ProjectKey(uuidToString(resource.WorkspaceID), uuidToString(resource.ID))
}

// ── Responses ────────────────────────────────────────────────────────────────

// CodeGraphBuildResponse is one build row on the wire. report_md is served
// on its own route and deliberately absent here: a monorepo report is
// hundreds of kilobytes and the status endpoint is polled for chips.
type CodeGraphBuildResponse struct {
	ID              string          `json:"id"`
	State           string          `json:"state"`
	Commit          *string         `json:"commit"`
	Ref             string          `json:"ref"`
	SkippedReason   *string         `json:"skipped_reason"`
	Error           *string         `json:"error"`
	Stats           json.RawMessage `json:"stats"`
	Diff            json.RawMessage `json:"diff"`
	GraphifyVersion *string         `json:"graphify_version"`
	CreatedAt       string          `json:"created_at"`
	FinishedAt      *string         `json:"finished_at"`
}

// CodeGraphStatusResponse is BuildStatus in the contract.
type CodeGraphStatusResponse struct {
	Enabled bool                    `json:"enabled"`
	Queued  bool                    `json:"queued"`
	Stale   bool                    `json:"stale"`
	Build   *CodeGraphBuildResponse `json:"build"`
}

func codeGraphBuildToResponse(b db.CodeGraphBuild) *CodeGraphBuildResponse {
	out := &CodeGraphBuildResponse{
		ID:              uuidToString(b.ID),
		State:           b.State,
		Commit:          textToPtr(b.Commit),
		Ref:             b.Ref,
		SkippedReason:   textToPtr(b.SkippedReason),
		Error:           textToPtr(b.Error),
		Stats:           nullableJSON(b.Stats),
		Diff:            nullableJSON(b.Diff),
		GraphifyVersion: textToPtr(b.GraphifyVersion),
		CreatedAt:       timestampToString(b.CreatedAt),
	}
	if b.FinishedAt.Valid {
		s := timestampToString(b.FinishedAt)
		out.FinishedAt = &s
	}
	return out
}

func nullableJSON(raw []byte) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage("null")
	}
	return json.RawMessage(raw)
}

// codeGraphStatusFor composes BuildStatus from the newest row and the newest
// ready row. stale compares the ready commit with the newest known head; a
// stale graph is re-queued once, which the NOT EXISTS guard on enqueue makes
// idempotent.
func (h *Handler) codeGraphStatusFor(ctx context.Context, resource db.WorkspaceResource, latest, latestReady *db.CodeGraphBuild) CodeGraphStatusResponse {
	out := CodeGraphStatusResponse{Enabled: codeGraphEnabled(resource)}
	if latest == nil {
		return out
	}
	out.Build = codeGraphBuildToResponse(*latest)
	out.Queued = latest.State == codegraph.StateQueued || latest.State == codegraph.StateBuilding
	if latestReady != nil && latest.HeadCommit.Valid && latestReady.Commit.Valid && latest.HeadCommit.String != latestReady.Commit.String {
		out.Stale = true
		if !out.Queued && out.Enabled {
			if h.enqueueCodeGraphBuild(ctx, resource, latest.HeadCommit.String, time.Time{}) {
				out.Queued = true
			}
		}
	}
	return out
}

// ── Handlers ─────────────────────────────────────────────────────────────────

func (h *Handler) codeGraphCapability(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.codeGraphScope(w, r, false); !ok {
		return
	}
	out := map[string]any{"enabled": h.CodeGraph.Enabled(), "graphify_version": nil}
	if h.CodeGraph.Enabled() {
		if health, err := h.CodeGraph.Health(r.Context()); err == nil && health.GraphifyVersion != "" {
			out["graphify_version"] = health.GraphifyVersion
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handler) codeGraphBulkStatus(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.codeGraphScope(w, r, false)
	if !ok {
		return
	}
	resources, err := h.Queries.ListCodeGraphEnabledResourcesByWorkspace(r.Context(), actor.WorkspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list code graph resources")
		return
	}
	latestRows, err := h.Queries.ListLatestCodeGraphBuildsByWorkspace(r.Context(), actor.WorkspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load code graph builds")
		return
	}
	readyRows, err := h.Queries.ListLatestReadyCodeGraphBuildsByWorkspace(r.Context(), actor.WorkspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load code graph builds")
		return
	}
	latest := make(map[string]db.CodeGraphBuild, len(latestRows))
	for _, row := range latestRows {
		latest[uuidToString(row.ResourceID)] = row
	}
	ready := make(map[string]db.CodeGraphBuild, len(readyRows))
	for _, row := range readyRows {
		ready[uuidToString(row.ResourceID)] = row
	}
	statuses := make(map[string]CodeGraphStatusResponse, len(resources))
	for _, resource := range resources {
		id := uuidToString(resource.ID)
		var l, rd *db.CodeGraphBuild
		if row, ok := latest[id]; ok {
			l = &row
		}
		if row, ok := ready[id]; ok {
			rd = &row
		}
		statuses[id] = h.codeGraphStatusFor(r.Context(), resource, l, rd)
	}
	writeJSON(w, http.StatusOK, map[string]any{"statuses": statuses})
}

func (h *Handler) codeGraphStatus(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.codeGraphScope(w, r, false)
	if !ok {
		return
	}
	resource, ok := h.loadCodeGraphResource(w, r, actor.WorkspaceID)
	if !ok {
		return
	}
	status, err := h.codeGraphResourceStatus(r.Context(), resource)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load code graph status")
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (h *Handler) codeGraphResourceStatus(ctx context.Context, resource db.WorkspaceResource) (CodeGraphStatusResponse, error) {
	params := db.GetLatestCodeGraphBuildParams{WorkspaceID: resource.WorkspaceID, ResourceID: resource.ID}
	var latest, latestReady *db.CodeGraphBuild
	row, err := h.Queries.GetLatestCodeGraphBuild(ctx, params)
	switch {
	case err == nil:
		latest = &row
	case errors.Is(err, pgx.ErrNoRows):
	default:
		return CodeGraphStatusResponse{}, err
	}
	readyRow, err := h.Queries.GetLatestReadyCodeGraphBuild(ctx, db.GetLatestReadyCodeGraphBuildParams(params))
	switch {
	case err == nil:
		latestReady = &readyRow
	case errors.Is(err, pgx.ErrNoRows):
	default:
		return CodeGraphStatusResponse{}, err
	}
	return h.codeGraphStatusFor(ctx, resource, latest, latestReady), nil
}

func (h *Handler) codeGraphRebuild(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.codeGraphScope(w, r, true)
	if !ok {
		return
	}
	resource, ok := h.loadCodeGraphResource(w, r, actor.WorkspaceID)
	if !ok {
		return
	}
	if !h.CodeGraph.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "code graph service is not configured")
		return
	}
	build, queued, err := h.enqueueCodeGraphBuildRow(r.Context(), resource, "", time.Time{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to queue code graph build")
		return
	}
	if !queued {
		// A build is already pending; report it rather than a second one.
		row, err := h.Queries.GetLatestCodeGraphBuild(r.Context(), db.GetLatestCodeGraphBuildParams{WorkspaceID: resource.WorkspaceID, ResourceID: resource.ID})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to queue code graph build")
			return
		}
		build = row
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"build_id": uuidToString(build.ID)})
}

func (h *Handler) codeGraphReport(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.codeGraphScope(w, r, false)
	if !ok {
		return
	}
	resource, ok := h.loadCodeGraphResource(w, r, actor.WorkspaceID)
	if !ok {
		return
	}
	row, err := h.Queries.GetLatestReadyCodeGraphBuild(r.Context(), db.GetLatestReadyCodeGraphBuildParams{WorkspaceID: resource.WorkspaceID, ResourceID: resource.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusConflict, "code graph is not built yet")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load code graph report")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"report_md": row.ReportMd.String})
}

// codeGraphForwardGet proxies a read projection to the container.
func (h *Handler) codeGraphForwardGet(suffix string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.codeGraphForward(w, r, http.MethodGet, suffix)
	}
}

func (h *Handler) codeGraphForwardPost(suffix string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h.codeGraphForward(w, r, http.MethodPost, suffix)
	}
}

func (h *Handler) codeGraphForwardWikiArticle(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if slug == "" || strings.ContainsAny(slug, "/\\") {
		writeError(w, http.StatusBadRequest, "invalid wiki slug")
		return
	}
	h.codeGraphForward(w, r, http.MethodGet, "wiki/"+url.PathEscape(slug))
}

func (h *Handler) codeGraphForward(w http.ResponseWriter, r *http.Request, method, suffix string) {
	actor, ok := h.codeGraphScope(w, r, false)
	if !ok {
		return
	}
	resource, ok := h.loadCodeGraphResource(w, r, actor.WorkspaceID)
	if !ok {
		return
	}
	if !h.CodeGraph.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "code graph service is not configured")
		return
	}
	key, err := codeGraphProjectKey(resource)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "invalid code graph project")
		return
	}
	h.CodeGraph.Forward(w, r, method, "/v1/projects/"+url.PathEscape(key)+"/"+suffix)
}

// ── Queue and cleanup ────────────────────────────────────────────────────────

// enqueueCodeGraphBuild queues a build unless one is pending. headCommit,
// when known, is recorded so the status can say what the build is chasing.
// availableAt delays the run (push debounce); zero means now.
func (h *Handler) enqueueCodeGraphBuild(ctx context.Context, resource db.WorkspaceResource, headCommit string, availableAt time.Time) bool {
	_, queued, err := h.enqueueCodeGraphBuildRow(ctx, resource, headCommit, availableAt)
	if err != nil {
		slog.Warn("code graph: enqueue failed", "resource_id", uuidToString(resource.ID), "error", err)
		return false
	}
	return queued
}

func (h *Handler) enqueueCodeGraphBuildRow(ctx context.Context, resource db.WorkspaceResource, headCommit string, availableAt time.Time) (db.CodeGraphBuild, bool, error) {
	key, err := codeGraphProjectKey(resource)
	if err != nil {
		return db.CodeGraphBuild{}, false, err
	}
	repoURL, ref := codeGraphRepoURLAndRef(resource)
	params := db.EnqueueCodeGraphBuildParams{
		WorkspaceID: resource.WorkspaceID,
		ResourceID:  resource.ID,
		ProjectKey:  key,
		RepoUrl:     repoURL,
		Ref:         ref,
	}
	if headCommit != "" {
		params.HeadCommit = pgtype.Text{String: headCommit, Valid: true}
	}
	if !availableAt.IsZero() {
		params.AvailableAt = pgtype.Timestamptz{Time: availableAt, Valid: true}
	}
	row, err := h.Queries.EnqueueCodeGraphBuild(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		// A pending build exists. Still record the newer head on it so the
		// eventual status compares against what the repository is at now.
		if headCommit != "" {
			_ = h.Queries.SetCodeGraphHeadCommit(ctx, db.SetCodeGraphHeadCommitParams{
				WorkspaceID: resource.WorkspaceID, ResourceID: resource.ID,
				HeadCommit: pgtype.Text{String: headCommit, Valid: true},
			})
		}
		return db.CodeGraphBuild{}, false, nil
	}
	if err != nil {
		return db.CodeGraphBuild{}, false, err
	}
	if h.CodeGraphWorker != nil {
		h.CodeGraphWorker.Notify()
	}
	return row, true, nil
}

// deleteCodeGraphForResource clears the build rows inside the caller's
// transaction; the container's copy is released after commit by
// releaseCodeGraphProject, best-effort.
func deleteCodeGraphForResource(ctx context.Context, qtx *db.Queries, resource db.WorkspaceResource) error {
	return qtx.DeleteCodeGraphBuildsByResource(ctx, db.DeleteCodeGraphBuildsByResourceParams{WorkspaceID: resource.WorkspaceID, ResourceID: resource.ID})
}

// releaseCodeGraphProject asks the container to drop the project's checkout
// and graph. Failures are logged, never surfaced: the rows are already gone
// and a leftover directory is reclaimed by the next build or by an operator.
func (h *Handler) releaseCodeGraphProject(resource db.WorkspaceResource) {
	if !h.CodeGraph.Enabled() {
		return
	}
	key, err := codeGraphProjectKey(resource)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := h.CodeGraph.Delete(ctx, key); err != nil {
		slog.Warn("code graph: release project failed", "project_key", key, "error", err)
	}
}
