package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/integrations/vcs"
	"github.com/enact-ai/enact/server/internal/middleware"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const codeRepositoryOperationResponseLimit = 2 << 20

// ResolveCodeRepositoryCredential is daemon-only. It resolves one enabled
// workspace resource to an HTTPS credential without exposing provider secrets
// through any browser-facing API.
func (h *Handler) ResolveCodeRepositoryCredential(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	if middleware.DaemonIDFromContext(r.Context()) == "" {
		writeError(w, http.StatusForbidden, "daemon credential required")
		return
	}
	if !h.requireDaemonWorkspaceAccess(w, r, workspaceID) {
		return
	}
	workspaceUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	resourceUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "resourceId"), "resource id")
	if !ok {
		return
	}
	resource, err := h.Queries.GetWorkspaceResourceInWorkspace(r.Context(), db.GetWorkspaceResourceInWorkspaceParams{ID: resourceUUID, WorkspaceID: workspaceUUID})
	if err != nil || resource.ResourceType != "github_repo" {
		writeError(w, http.StatusNotFound, "code repository not found")
		return
	}
	var repo codeRepositoryRef
	if json.Unmarshal(resource.ResourceRef, &repo) != nil || !repo.Enabled {
		writeError(w, http.StatusConflict, "code repository is pending configuration or disabled")
		return
	}
	connectionUUID, ok := parseUUIDOrBadRequest(w, repo.ProviderConnectionID, "provider connection id")
	if !ok {
		return
	}
	switch repo.Provider {
	case "gitlab":
		connection, err := h.Queries.GetVCSConnectionByID(r.Context(), connectionUUID)
		if err != nil || uuidToString(connection.WorkspaceID) != workspaceID || connection.Provider != "gitlab" {
			writeError(w, http.StatusNotFound, "GitLab connection not found")
			return
		}
		token, err := h.openVCSSecret(connection.GitTokenEncrypted)
		if err != nil || token == "" {
			writeError(w, http.StatusServiceUnavailable, "GitLab Git credential is unavailable")
			return
		}
		caPEM := ""
		if connection.CaPemEncrypted != "" {
			caPEM, err = h.openVCSSecret(connection.CaPemEncrypted)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "CA secret error")
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"repository_url": repo.URL, "username": "oauth2", "password": token, "ca_pem": caPEM, "provider": "gitlab"})
	case "github":
		binding, ok := h.resolveGitHubBinding(r.Context(), connectionUUID, workspaceID)
		if !ok {
			writeError(w, http.StatusNotFound, "GitHub connection not found")
			return
		}
		if !binding.isApp {
			token, err := h.openVCSSecret(binding.connection.GitTokenEncrypted)
			if err != nil || token == "" {
				writeError(w, http.StatusServiceUnavailable, "GitHub Git credential is unavailable")
				return
			}
			caPEM := ""
			if binding.connection.CaPemEncrypted != "" {
				caPEM, err = h.openVCSSecret(binding.connection.CaPemEncrypted)
				if err != nil {
					writeError(w, http.StatusInternalServerError, "CA secret error")
					return
				}
			}
			// x-access-token is GitHub's documented username for token-over-
			// HTTPS on both github.com and Enterprise Server; the token is the
			// password. No expiry is reported because the credential is the
			// operator's own and lives until they rotate it.
			writeJSON(w, http.StatusOK, map[string]any{"repository_url": repo.URL, "username": "x-access-token", "password": token, "ca_pem": caPEM, "provider": "github"})
			return
		}
		repositoryID, err := strconv.ParseInt(strings.TrimSpace(repo.ProviderRepositoryID), 10, 64)
		if err != nil {
			writeError(w, http.StatusConflict, "GitHub repository identity is invalid")
			return
		}
		token, expiresAt, err := mintGitHubRepositoryToken(r.Context(), binding.installation.InstallationID, repositoryID)
		if err != nil {
			writeError(w, http.StatusBadGateway, "could not mint GitHub repository credential")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"repository_url": repo.URL, "username": "x-access-token", "password": token, "expires_at": expiresAt, "provider": "github"})
	default:
		writeError(w, http.StatusConflict, "unsupported code repository provider")
	}
}

// gitHubBinding is how a github repository ref reaches a credential. Both
// shapes are legitimate and a workspace may hold one of each: a GitHub App
// installation, which mints a short-lived token scoped to the single
// repository, and a token connection, which stores one credential an admin
// entered — the only option for GitHub Enterprise Server or for a deployment
// that cannot register an App.
//
// The ref records only a connection id, so the id itself decides which table
// it names. Resolving it in one place keeps the credential path, the pull
// request path and the binding check from drifting into different answers.
type gitHubBinding struct {
	installation db.GithubInstallation
	connection   db.VcsConnection
	isApp        bool
}

func (h *Handler) resolveGitHubBinding(ctx context.Context, connectionID pgtype.UUID, workspaceID string) (gitHubBinding, bool) {
	if installation, err := h.Queries.GetGitHubInstallationByID(ctx, connectionID); err == nil {
		if uuidToString(installation.WorkspaceID) != workspaceID {
			return gitHubBinding{}, false
		}
		return gitHubBinding{installation: installation, isApp: true}, true
	}
	connection, err := h.Queries.GetVCSConnectionByID(ctx, connectionID)
	if err != nil || uuidToString(connection.WorkspaceID) != workspaceID || connection.Provider != string(vcs.KindGitHub) {
		return gitHubBinding{}, false
	}
	return gitHubBinding{connection: connection, isApp: false}, true
}

type reportRepositoryValidationRequest struct {
	ReadStatus   string `json:"read_status"`
	WriteStatus  string `json:"write_status"`
	ErrorCode    string `json:"error_code"`
	ErrorMessage string `json:"error_message"`
}

// ReportCodeRepositoryValidation stores the actual daemon-specific result.
// The daemon identity comes from its token, never from the request body.
func (h *Handler) ReportCodeRepositoryValidation(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "workspaceId")
	daemonID := middleware.DaemonIDFromContext(r.Context())
	if daemonID == "" {
		writeError(w, http.StatusForbidden, "daemon credential required")
		return
	}
	if !h.requireDaemonWorkspaceAccess(w, r, workspaceID) {
		return
	}
	workspaceUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	resourceUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "resourceId"), "resource id")
	if !ok {
		return
	}
	resource, err := h.Queries.GetWorkspaceResourceInWorkspace(r.Context(), db.GetWorkspaceResourceInWorkspaceParams{ID: resourceUUID, WorkspaceID: workspaceUUID})
	if err != nil || resource.ResourceType != "github_repo" {
		writeError(w, http.StatusNotFound, "code repository not found")
		return
	}
	var req reportRepositoryValidationRequest
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	valid := map[string]bool{"ok": true, "denied": true, "unreachable": true, "dns_error": true, "timeout": true, "tls_error": true, "unknown": true}
	if !valid[req.ReadStatus] || !valid[req.WriteStatus] {
		writeError(w, http.StatusBadRequest, "invalid validation status")
		return
	}
	row, err := h.Queries.UpsertDaemonRepositoryValidation(r.Context(), db.UpsertDaemonRepositoryValidationParams{WorkspaceID: workspaceUUID, ResourceID: resourceUUID, DaemonID: daemonID, ReadStatus: req.ReadStatus, WriteStatus: req.WriteStatus, ErrorCode: strings.TrimSpace(req.ErrorCode), ErrorMessage: strings.TrimSpace(req.ErrorMessage)})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store repository validation")
		return
	}
	var repo codeRepositoryRef
	if json.Unmarshal(resource.ResourceRef, &repo) == nil {
		if connectionUUID, parseErr := parseUUIDLoose(repo.ProviderConnectionID); parseErr == nil {
			if connection, getErr := h.Queries.GetVCSConnectionByID(r.Context(), connectionUUID); getErr == nil && uuidToString(connection.WorkspaceID) == workspaceID {
				_, _ = h.Queries.UpdateVCSConnectionValidation(r.Context(), db.UpdateVCSConnectionValidationParams{
					ID: connection.ID, WorkspaceID: workspaceUUID, ApiStatus: connection.ApiStatus,
					GitReadStatus: req.ReadStatus, GitWriteStatus: req.WriteStatus, ChangeRequestStatus: connection.ChangeRequestStatus,
				})
			}
		}
	}
	writeJSON(w, http.StatusOK, DaemonRepositoryValidationResponse{DaemonID: row.DaemonID, ReadStatus: row.ReadStatus, WriteStatus: row.WriteStatus, ErrorCode: row.ErrorCode, ErrorMessage: row.ErrorMessage, CheckedAt: timestampToString(row.CheckedAt)})
}

type createChangeRequestRequest struct {
	ResourceID string `json:"resource_id"`
	Head       string `json:"head"`
	Base       string `json:"base"`
	Title      string `json:"title"`
	Body       string `json:"body"`
	Draft      bool   `json:"draft"`
}

// CreateCodeRepositoryChangeRequest keeps provider API tokens in the server.
// A daemon may invoke it only for an active task and an enabled repository in
// that task's workspace.
func (h *Handler) CreateCodeRepositoryChangeRequest(w http.ResponseWriter, r *http.Request) {
	if middleware.DaemonIDFromContext(r.Context()) == "" {
		writeError(w, http.StatusForbidden, "daemon credential required")
		return
	}
	_, workspaceID, ok := h.requireDaemonTaskAccessWithWorkspace(w, r, chi.URLParam(r, "taskId"))
	if !ok {
		return
	}
	var req createChangeRequestRequest
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Head, req.Base, req.Title = strings.TrimSpace(req.Head), strings.TrimSpace(req.Base), strings.TrimSpace(req.Title)
	if req.ResourceID == "" || req.Head == "" || req.Title == "" {
		writeError(w, http.StatusBadRequest, "resource_id, head and title are required")
		return
	}
	workspaceUUID, _ := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	resourceUUID, ok := parseUUIDOrBadRequest(w, req.ResourceID, "resource id")
	if !ok {
		return
	}
	resource, err := h.Queries.GetWorkspaceResourceInWorkspace(r.Context(), db.GetWorkspaceResourceInWorkspaceParams{ID: resourceUUID, WorkspaceID: workspaceUUID})
	if err != nil || resource.ResourceType != "github_repo" {
		writeError(w, http.StatusNotFound, "code repository not found")
		return
	}
	var repo codeRepositoryRef
	if json.Unmarshal(resource.ResourceRef, &repo) != nil || !repo.Enabled {
		writeError(w, http.StatusConflict, "code repository is pending configuration or disabled")
		return
	}
	if req.Base == "" {
		req.Base = repo.DefaultBranchHint
	}
	if req.Base == "" {
		writeError(w, http.StatusBadRequest, "base is required because the repository has no default branch hint")
		return
	}
	connectionUUID, ok := parseUUIDOrBadRequest(w, repo.ProviderConnectionID, "provider connection id")
	if !ok {
		return
	}
	if repo.Provider == "gitlab" {
		connection, err := h.Queries.GetVCSConnectionByID(r.Context(), connectionUUID)
		if err != nil || uuidToString(connection.WorkspaceID) != workspaceID {
			writeError(w, http.StatusNotFound, "GitLab connection not found")
			return
		}
		token, err := h.openVCSSecret(connection.AccessTokenEncrypted)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "secret error")
			return
		}
		client, err := h.vcsConnectionHTTPClient(connection)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "invalid enterprise CA")
			return
		}
		payload := map[string]any{"source_branch": req.Head, "target_branch": req.Base, "title": req.Title, "description": req.Body, "remove_source_branch": false}
		if req.Draft && !strings.HasPrefix(strings.ToLower(req.Title), "draft:") {
			payload["title"] = "Draft: " + req.Title
		}
		body, _ := json.Marshal(payload)
		endpoint := strings.TrimRight(connection.InstanceUrl, "/") + "/api/v4/projects/" + url.PathEscape(repo.ProviderRepositoryID) + "/merge_requests"
		upstream, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to build GitLab request")
			return
		}
		upstream.Header.Set("PRIVATE-TOKEN", token)
		upstream.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(upstream)
		if err != nil {
			writeError(w, http.StatusBadGateway, "could not reach GitLab")
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
			writeError(w, http.StatusBadGateway, fmt.Sprintf("GitLab rejected merge request (%d): %s", resp.StatusCode, strings.TrimSpace(string(snippet))))
			return
		}
		var out struct {
			IID    int64  `json:"iid"`
			WebURL string `json:"web_url"`
		}
		if json.NewDecoder(io.LimitReader(resp.Body, codeRepositoryOperationResponseLimit)).Decode(&out) != nil {
			writeError(w, http.StatusBadGateway, "invalid GitLab response")
			return
		}
		_, _ = h.Queries.UpdateVCSConnectionValidation(r.Context(), db.UpdateVCSConnectionValidationParams{ID: connection.ID, WorkspaceID: workspaceUUID, ApiStatus: connection.ApiStatus, GitReadStatus: connection.GitReadStatus, GitWriteStatus: connection.GitWriteStatus, ChangeRequestStatus: "ok"})
		writeJSON(w, http.StatusCreated, map[string]any{"provider": "gitlab", "number": out.IID, "url": out.WebURL})
		return
	}
	if repo.Provider == "github" {
		binding, ok := h.resolveGitHubBinding(r.Context(), connectionUUID, workspaceID)
		if !ok {
			writeError(w, http.StatusNotFound, "GitHub connection not found")
			return
		}
		// An App mints a fresh repository-scoped token per call; a token
		// connection uses the stored credential and, on Enterprise Server, its
		// own API base and enterprise CA.
		token, apiBase := "", strings.TrimRight(githubAPIBase, "/")
		client := &http.Client{Timeout: 15 * time.Second}
		if binding.isApp {
			repositoryID, parseErr := strconv.ParseInt(repo.ProviderRepositoryID, 10, 64)
			if parseErr != nil {
				writeError(w, http.StatusConflict, "GitHub repository identity is invalid")
				return
			}
			minted, _, mintErr := mintGitHubRepositoryToken(r.Context(), binding.installation.InstallationID, repositoryID)
			if mintErr != nil {
				writeError(w, http.StatusBadGateway, "could not mint GitHub repository credential")
				return
			}
			token = minted
		} else {
			stored, secretErr := h.openVCSSecret(binding.connection.AccessTokenEncrypted)
			if secretErr != nil || stored == "" {
				writeError(w, http.StatusInternalServerError, "secret error")
				return
			}
			enterpriseClient, clientErr := h.vcsConnectionHTTPClient(binding.connection)
			if clientErr != nil {
				writeError(w, http.StatusInternalServerError, "invalid enterprise CA")
				return
			}
			token, apiBase, client = stored, vcs.GitHubAPIBase(binding.connection.InstanceUrl), enterpriseClient
		}
		body, _ := json.Marshal(map[string]any{"title": req.Title, "head": req.Head, "base": req.Base, "body": req.Body, "draft": req.Draft})
		endpoint := apiBase + "/repos/" + strings.Trim(repo.FullName, "/") + "/pulls"
		upstream, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to build GitHub request")
			return
		}
		setGitHubAPIHeaders(upstream, token)
		upstream.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(upstream)
		if err != nil {
			writeError(w, http.StatusBadGateway, "could not reach GitHub")
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
			writeError(w, http.StatusBadGateway, fmt.Sprintf("GitHub rejected pull request (%d): %s", resp.StatusCode, strings.TrimSpace(string(snippet))))
			return
		}
		var out struct {
			Number  int64  `json:"number"`
			HTMLURL string `json:"html_url"`
		}
		if json.NewDecoder(io.LimitReader(resp.Body, codeRepositoryOperationResponseLimit)).Decode(&out) != nil {
			writeError(w, http.StatusBadGateway, "invalid GitHub response")
			return
		}
		if !binding.isApp {
			conn := binding.connection
			_, _ = h.Queries.UpdateVCSConnectionValidation(r.Context(), db.UpdateVCSConnectionValidationParams{ID: conn.ID, WorkspaceID: workspaceUUID, ApiStatus: conn.ApiStatus, GitReadStatus: conn.GitReadStatus, GitWriteStatus: conn.GitWriteStatus, ChangeRequestStatus: "ok"})
		}
		writeJSON(w, http.StatusCreated, map[string]any{"provider": "github", "number": out.Number, "url": out.HTMLURL})
		return
	}
	writeError(w, http.StatusConflict, "unsupported code repository provider")
}
