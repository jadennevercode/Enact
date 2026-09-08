package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/semanticapp"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type semanticApplication struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	Description       string    `json:"description"`
	OntologyReleaseID string    `json:"ontology_release_id"`
	PublishedBuildID  *string   `json:"published_build_id"`
	CreatedAt         time.Time `json:"created_at"`
}

type semanticApplicationBuild struct {
	ID             string          `json:"id"`
	SourceRevision string          `json:"source_revision"`
	Digest         string          `json:"digest"`
	Manifest       json.RawMessage `json:"manifest"`
	Report         json.RawMessage `json:"report"`
	CreatedAt      time.Time       `json:"created_at"`
	SourceFiles    json.RawMessage `json:"source_files,omitempty"`
	Files          json.RawMessage `json:"files,omitempty"`
}

func (h *Handler) registerSemanticApplicationRoutes(r chi.Router) {
	r.Post("/apps/{appID}/invoke", h.invokeSemanticApplication)
	r.Get("/apps", h.listSemanticApplications)
	r.Post("/apps", h.createSemanticApplication)
	r.Get("/apps/{appID}", h.getSemanticApplication)
	r.Get("/apps/{appID}/builds", h.listSemanticApplicationBuilds)
	r.Post("/apps/{appID}/builds", h.createSemanticApplicationBuild)
	r.Get("/apps/{appID}/builds/{buildID}", h.getSemanticApplicationBuild)
	r.Post("/apps/{appID}/publish", h.publishSemanticApplication)
	r.Get("/apps/{appID}/deployments", h.listSemanticApplicationDeployments)
}

const applicationSelect = `SELECT id::text,name,description,ontology_release_id::text,published_build_id::text,created_at FROM semantic_application`

func scanSemanticApplication(row pgx.Row) (semanticApplication, error) {
	var a semanticApplication
	err := row.Scan(&a.ID, &a.Name, &a.Description, &a.OntologyReleaseID, &a.PublishedBuildID, &a.CreatedAt)
	return a, err
}

func (h *Handler) listSemanticApplications(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	rows, err := h.DB.Query(r.Context(), applicationSelect+` WHERE workspace_id=$1 ORDER BY updated_at DESC`, actor.WorkspaceID)
	if err != nil {
		writeError(w, 500, "failed to list applications")
		return
	}
	defer rows.Close()
	result := []semanticApplication{}
	for rows.Next() {
		a, err := scanSemanticApplication(rows)
		if err != nil {
			writeError(w, 500, "failed to read applications")
			return
		}
		result = append(result, a)
	}
	if rows.Err() != nil {
		writeError(w, 500, "failed to read applications")
		return
	}
	writeJSON(w, 200, result)
}

func (h *Handler) createSemanticApplication(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		ReleaseID   string `json:"ontology_release_id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeError(w, 400, "invalid application")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 160 || len(req.Description) > 4000 {
		writeError(w, 400, "name is required (maximum 160 characters)")
		return
	}
	if _, ok := parseUUIDOrBadRequest(w, req.ReleaseID, "ontology_release_id"); !ok {
		return
	}
	if _, err := h.semanticLoadRelease(r, actor.WorkspaceID, req.ReleaseID); err != nil {
		writeError(w, 404, "ontology release not found")
		return
	}
	h.semanticRow(w, r, 201, `INSERT INTO semantic_application(workspace_id,name,description,ontology_release_id,created_by) SELECT $1,$2,$3,$4,$5 FROM semantic_release WHERE workspace_id=$1 AND id=$4 AND retired_at IS NULL RETURNING to_jsonb(semantic_application)`, actor.WorkspaceID, req.Name, req.Description, req.ReleaseID, actor.UserID)
}

func (h *Handler) getSemanticApplication(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id := chi.URLParam(r, "appID")
	if _, ok := parseUUIDOrBadRequest(w, id, "application id"); !ok {
		return
	}
	a, err := scanSemanticApplication(h.DB.QueryRow(r.Context(), applicationSelect+` WHERE workspace_id=$1 AND id=$2`, actor.WorkspaceID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 404, "application not found")
		return
	}
	if err != nil {
		writeError(w, 500, "failed to read application")
		return
	}
	writeJSON(w, 200, a)
}

func (h *Handler) listSemanticApplicationBuilds(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id := chi.URLParam(r, "appID")
	if _, ok := parseUUIDOrBadRequest(w, id, "application id"); !ok {
		return
	}
	rows, err := h.DB.Query(r.Context(), `SELECT id::text,source_revision,digest,manifest,report,created_at FROM semantic_application_build WHERE workspace_id=$1 AND application_id=$2 ORDER BY created_at DESC`, actor.WorkspaceID, id)
	if err != nil {
		writeError(w, 500, "failed to list builds")
		return
	}
	defer rows.Close()
	result := []semanticApplicationBuild{}
	for rows.Next() {
		var b semanticApplicationBuild
		if err := rows.Scan(&b.ID, &b.SourceRevision, &b.Digest, &b.Manifest, &b.Report, &b.CreatedAt); err != nil {
			writeError(w, 500, "failed to read build")
			return
		}
		result = append(result, b)
	}
	if rows.Err() != nil {
		writeError(w, 500, "failed to read builds")
		return
	}
	writeJSON(w, 200, result)
}

func (h *Handler) createSemanticApplicationBuild(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id := chi.URLParam(r, "appID")
	if _, ok := parseUUIDOrBadRequest(w, id, "application id"); !ok {
		return
	}
	a, err := scanSemanticApplication(h.DB.QueryRow(r.Context(), applicationSelect+` WHERE workspace_id=$1 AND id=$2`, actor.WorkspaceID, id))
	if err != nil {
		writeError(w, 404, "application not found")
		return
	}
	var req semanticapp.Build
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 80<<20)).Decode(&req); err != nil {
		writeError(w, 400, "invalid application build (maximum 80 MiB encoded)")
		return
	}
	digest, err := semanticapp.Validate(req, a.OntologyReleaseID)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	release, err := h.semanticLoadRelease(r, actor.WorkspaceID, a.OntologyReleaseID)
	if err != nil {
		writeError(w, 409, "ontology release is not available")
		return
	}
	queries := map[string]bool{"@ontology": true}
	actions := map[string]bool{}
	for _, binding := range release.Bindings.Data {
		queries[binding.ID] = true
	}
	for _, binding := range release.Bindings.Actions {
		actions[binding.ID] = true
	}
	for _, binding := range req.Manifest.Queries {
		if !queries[binding] {
			writeError(w, 400, "query capability is not in the pinned ontology release")
			return
		}
	}
	for _, binding := range req.Manifest.Actions {
		if !actions[binding] {
			writeError(w, 400, "action capability is not in the pinned ontology release")
			return
		}
	}
	manifest, err := json.Marshal(req.Manifest)
	if err != nil {
		writeError(w, 400, "invalid manifest")
		return
	}
	files, err := json.Marshal(req.Files)
	if err != nil {
		writeError(w, 400, "invalid files")
		return
	}
	if req.Report == nil {
		req.Report = map[string]any{}
	}
	report, err := json.Marshal(req.Report)
	if err != nil {
		writeError(w, 400, "invalid report")
		return
	}
	sources, err := json.Marshal(req.SourceFiles)
	if err != nil {
		writeError(w, 400, "invalid source files")
		return
	}
	var b semanticApplicationBuild
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "failed to begin build storage")
		return
	}
	defer tx.Rollback(r.Context())
	if err = semanticLockWorkspace(r.Context(), tx, actor.WorkspaceID); err != nil {
		writeError(w, 404, "workspace not found")
		return
	}
	var active string
	if err = tx.QueryRow(r.Context(), `SELECT id::text FROM semantic_release WHERE workspace_id=$1 AND id=$2 AND retired_at IS NULL FOR SHARE`, actor.WorkspaceID, a.OntologyReleaseID).Scan(&active); err != nil {
		writeError(w, 409, "ontology release is not available")
		return
	}
	err = tx.QueryRow(r.Context(), `INSERT INTO semantic_application_build(workspace_id,application_id,source_revision,digest,manifest,files,report,created_by,source_files) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 FROM semantic_application WHERE workspace_id=$1 AND id=$2 RETURNING id::text,source_revision,digest,manifest,report,created_at`, actor.WorkspaceID, id, req.SourceRevision, digest, manifest, files, report, actor.UserID, sources).Scan(&b.ID, &b.SourceRevision, &b.Digest, &b.Manifest, &b.Report, &b.CreatedAt)
	if err != nil {
		writeError(w, 500, "failed to save application build")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		writeError(w, 500, "failed to commit build")
		return
	}
	writeJSON(w, 201, b)
}

func (h *Handler) getSemanticApplicationBuild(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id, bid := chi.URLParam(r, "appID"), chi.URLParam(r, "buildID")
	if _, ok := parseUUIDOrBadRequest(w, id, "application id"); !ok {
		return
	}
	if _, ok := parseUUIDOrBadRequest(w, bid, "build id"); !ok {
		return
	}
	var b semanticApplicationBuild
	err := h.DB.QueryRow(r.Context(), `SELECT id::text,source_revision,digest,manifest,report,created_at,files,source_files FROM semantic_application_build WHERE workspace_id=$1 AND application_id=$2 AND id=$3`, actor.WorkspaceID, id, bid).Scan(&b.ID, &b.SourceRevision, &b.Digest, &b.Manifest, &b.Report, &b.CreatedAt, &b.Files, &b.SourceFiles)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 404, "build not found")
		return
	}
	if err != nil {
		writeError(w, 500, "failed to read build")
		return
	}
	writeJSON(w, 200, b)
}

// Publish always points at a reviewed immutable build; rollback is another deployment.
func (h *Handler) publishSemanticApplication(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, true)
	if !ok {
		return
	}
	id := chi.URLParam(r, "appID")
	if _, ok := parseUUIDOrBadRequest(w, id, "application id"); !ok {
		return
	}
	var req struct {
		BuildID string `json:"build_id"`
		Digest  string `json:"digest"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req); err != nil {
		writeError(w, 400, "invalid publication")
		return
	}
	if _, ok := parseUUIDOrBadRequest(w, req.BuildID, "build_id"); !ok {
		return
	}
	a, err := scanSemanticApplication(h.DB.QueryRow(r.Context(), applicationSelect+` WHERE workspace_id=$1 AND id=$2`, actor.WorkspaceID, id))
	if err != nil {
		writeError(w, 404, "application not found")
		return
	}
	if _, err := h.semanticLoadRelease(r, actor.WorkspaceID, a.OntologyReleaseID); err != nil {
		writeError(w, 409, "ontology release is not available")
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "failed to begin publication")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if err = semanticLockWorkspace(r.Context(), tx, actor.WorkspaceID); err != nil {
		writeError(w, 404, "workspace not found")
		return
	}
	var active string
	if err = tx.QueryRow(r.Context(), `SELECT id::text FROM semantic_release WHERE workspace_id=$1 AND id=$2 AND retired_at IS NULL FOR SHARE`, actor.WorkspaceID, a.OntologyReleaseID).Scan(&active); err != nil {
		writeError(w, 409, "ontology release is not available")
		return
	}
	var digest string
	err = tx.QueryRow(r.Context(), `SELECT digest FROM semantic_application_build WHERE workspace_id=$1 AND application_id=$2 AND id=$3`, actor.WorkspaceID, id, req.BuildID).Scan(&digest)
	if err != nil {
		writeError(w, 404, "build not found")
		return
	}
	if req.Digest == "" || digest != req.Digest {
		writeError(w, 409, "reviewed build digest does not match")
		return
	}
	tag, err := tx.Exec(r.Context(), `UPDATE semantic_application SET published_build_id=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2`, actor.WorkspaceID, id, req.BuildID)
	if err != nil || tag.RowsAffected() != 1 {
		writeError(w, 404, "application not found")
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO semantic_application_deployment(workspace_id,application_id,build_id,published_by) VALUES($1,$2,$3,$4)`, actor.WorkspaceID, id, req.BuildID, actor.UserID)
	if err != nil {
		writeError(w, 500, "failed to record publication")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, 500, "failed to publish application")
		return
	}
	writeJSON(w, 200, map[string]any{"application_id": id, "build_id": req.BuildID, "digest": digest, "status": "published"})
}

func (h *Handler) listSemanticApplicationDeployments(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id := chi.URLParam(r, "appID")
	if _, ok := parseUUIDOrBadRequest(w, id, "application id"); !ok {
		return
	}
	rows, err := h.DB.Query(r.Context(), `SELECT id::text,build_id::text,published_by::text,created_at FROM semantic_application_deployment WHERE workspace_id=$1 AND application_id=$2 ORDER BY created_at DESC`, actor.WorkspaceID, id)
	if err != nil {
		writeError(w, 500, "failed to list deployments")
		return
	}
	defer rows.Close()
	result := []map[string]any{}
	for rows.Next() {
		var id, build, user string
		var created time.Time
		if err := rows.Scan(&id, &build, &user, &created); err != nil {
			writeError(w, 500, "failed to read deployment")
			return
		}
		result = append(result, map[string]any{"id": id, "build_id": build, "published_by": user, "created_at": created})
	}
	if rows.Err() != nil {
		writeError(w, 500, "failed to read deployments")
		return
	}
	writeJSON(w, 200, result)
}
