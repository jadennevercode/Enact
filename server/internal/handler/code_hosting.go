package handler

import (
	"net/http"

	"github.com/enact-ai/enact/server/internal/middleware"
	"github.com/go-chi/chi/v5"
)

// ListCodeHostingConnections is the provider-neutral facade consumed by new
// clients. It projects the existing GitHub installation and VCS connection
// records without introducing a second source of connection truth.
func (h *Handler) ListCodeHostingConnections(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	workspaceUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	member, _ := middleware.MemberFromContext(r.Context())
	canManage := roleAllowed(member.Role, "owner", "admin")
	connections := make([]map[string]any, 0)
	githubRows, err := h.Queries.ListGitHubInstallationsByWorkspace(r.Context(), workspaceUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list GitHub installations")
		return
	}
	for _, row := range githubRows {
		connections = append(connections, map[string]any{
			"id": uuidToString(row.ID), "provider": "github", "instance_url": "https://github.com",
			"account_login": row.AccountLogin, "token_type": "installation", "token_scopes": []string{"contents:write", "pull_requests:write", "checks:read", "statuses:read"},
			"api_status": "ok", "webhook_status": "unknown", "git_read_status": "untested", "git_write_status": "untested", "change_request_status": "ready",
			"created_at": timestampToString(row.CreatedAt),
		})
	}
	if h.isVCSAvailable() {
		rows, err := h.Queries.ListVCSConnectionsByWorkspace(r.Context(), workspaceUUID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list VCS connections")
			return
		}
		for _, row := range rows {
			resp := h.vcsConnectionToResponse(row)
			connections = append(connections, map[string]any{
				"id": resp.ID, "provider": resp.Provider, "instance_url": resp.InstanceURL, "account_login": resp.AccountLogin,
				"token_type": resp.TokenType, "token_scopes": resp.TokenScopes, "token_expires_at": resp.TokenExpiresAt,
				"clone_host": resp.CloneHost, "has_custom_ca": resp.HasCustomCA, "last_validated_at": resp.LastValidatedAt,
				"api_status": resp.APIStatus, "webhook_status": resp.WebhookStatus, "git_read_status": resp.GitReadStatus,
				"git_write_status": resp.GitWriteStatus, "change_request_status": resp.ChangeRequestStatus,
				"webhook_url": resp.WebhookURL, "created_at": resp.CreatedAt,
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"connections": connections, "can_manage": canManage,
		"requirements": map[string]any{
			"github": map[string]any{"host": "github.com", "transport": "https", "credential": "short-lived repository installation token"},
			"gitlab": map[string]any{"transport": "https", "api_token_scope": "api", "git_token_scope": "write_repository", "preferred_token_type": "service_account", "custom_ca_supported": true},
		},
	})
}
