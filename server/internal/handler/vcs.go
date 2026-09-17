package handler

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/integrations/vcs"
	"github.com/enact-ai/enact/server/internal/middleware"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/protocol"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ── Response shapes ─────────────────────────────────────────────────────────

// VCSConnectionResponse is the JSON shape for a stored Git provider connection.
// Secrets are never included; the webhook secret is returned exactly once at
// create time via VCSConnectResponse.
type VCSConnectionResponse struct {
	ID                  string   `json:"id"`
	WorkspaceID         string   `json:"workspace_id"`
	Provider            string   `json:"provider"`
	InstanceURL         string   `json:"instance_url"`
	AccountLogin        string   `json:"account_login"`
	WebhookURL          string   `json:"webhook_url"`
	WebhookPath         string   `json:"webhook_path"`
	CreatedAt           string   `json:"created_at"`
	TokenType           string   `json:"token_type"`
	TokenScopes         []string `json:"token_scopes"`
	TokenExpiresAt      *string  `json:"token_expires_at"`
	CloneHost           string   `json:"clone_host"`
	HasCustomCA         bool     `json:"has_custom_ca"`
	LastValidatedAt     *string  `json:"last_validated_at"`
	APIStatus           string   `json:"api_status"`
	WebhookStatus       string   `json:"webhook_status"`
	GitReadStatus       string   `json:"git_read_status"`
	GitWriteStatus      string   `json:"git_write_status"`
	ChangeRequestStatus string   `json:"change_request_status"`
}

// VCSConnectResponse embeds the stored connection plus the one-time plaintext
// webhook secret the user must paste into the provider (the HMAC secret for
// Forgejo/Gitea, the X-Gitlab-Token value for GitLab). Not retrievable after.
type VCSConnectResponse struct {
	VCSConnectionResponse
	WebhookSecret string `json:"webhook_secret"`
}

const vcsWebhookPathPrefix = "/api/webhooks/vcs/"

// isVCSConfigured reports whether at-rest encryption for provider credentials
// is available. It is the only gate on code-hosting connections: every
// deployment offers them, but none may store a token without a key to seal it
// with, so connect/rotate reject with an operator-actionable message and the UI
// renders the section with setup guidance instead of hiding it.
func (h *Handler) isVCSConfigured() bool { return h.VCSSecretBox != nil }

func (h *Handler) vcsWebhookPath(connID string) string { return vcsWebhookPathPrefix + connID }

func (h *Handler) vcsWebhookURL(connID string) string {
	base := strings.TrimRight(h.cfg.PublicURL, "/")
	if base == "" {
		return ""
	}
	return base + h.vcsWebhookPath(connID)
}

func (h *Handler) vcsConnectionToResponse(c db.VcsConnection) VCSConnectionResponse {
	id := uuidToString(c.ID)
	return VCSConnectionResponse{
		ID:                  id,
		WorkspaceID:         uuidToString(c.WorkspaceID),
		Provider:            c.Provider,
		InstanceURL:         c.InstanceUrl,
		AccountLogin:        c.AccountLogin,
		WebhookURL:          h.vcsWebhookURL(id),
		WebhookPath:         h.vcsWebhookPath(id),
		CreatedAt:           timestampToString(c.CreatedAt),
		TokenType:           c.TokenType,
		TokenScopes:         c.TokenScopes,
		TokenExpiresAt:      timestampToPtr(c.TokenExpiresAt),
		CloneHost:           c.CloneHost,
		HasCustomCA:         c.CaPemEncrypted != "",
		LastValidatedAt:     timestampToPtr(c.LastValidatedAt),
		APIStatus:           c.ApiStatus,
		WebhookStatus:       c.WebhookStatus,
		GitReadStatus:       c.GitReadStatus,
		GitWriteStatus:      c.GitWriteStatus,
		ChangeRequestStatus: c.ChangeRequestStatus,
	}
}

// errVCSSecretKeyUnset is returned instead of dereferencing a missing box.
// Handlers gate on isVCSConfigured, but the daemon-facing paths are reached by
// a machine rather than a browser and can arrive at a deployment whose key was
// removed after connections already existed; without this they panicked.
var errVCSSecretKeyUnset = errors.New("vcs: ENACT_VCS_SECRET_KEY is not configured")

func (h *Handler) sealVCSSecret(plaintext string) (string, error) {
	if h.VCSSecretBox == nil {
		return "", errVCSSecretKeyUnset
	}
	sealed, err := h.VCSSecretBox.Seal([]byte(plaintext))
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func (h *Handler) openVCSSecret(enc string) (string, error) {
	if enc == "" {
		return "", nil
	}
	if h.VCSSecretBox == nil {
		return "", errVCSSecretKeyUnset
	}
	ciphertext, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return "", err
	}
	plaintext, err := h.VCSSecretBox.Open(ciphertext)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

// ── Handlers ────────────────────────────────────────────────────────────────

// ListVCSConnections (GET /workspaces/{id}/vcs/connections) is member-visible;
// connect/disconnect are admin-gated by the router. No secrets returned.
func (h *Handler) ListVCSConnections(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	member, _ := middleware.MemberFromContext(r.Context())
	canManage := roleAllowed(member.Role, "owner", "admin")

	rows, err := h.Queries.ListVCSConnectionsByWorkspace(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list connections")
		return
	}
	out := make([]VCSConnectionResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, h.vcsConnectionToResponse(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"connections": out,
		"configured":  h.isVCSConfigured(),
		"can_manage":  canManage,
		"requirements": map[string]any{
			"gitlab": map[string]any{
				"api_token_scope":      "api",
				"git_token_scope":      "write_repository",
				"preferred_token_type": "service_account",
				"webhook_events":       []string{"Merge Request Hook", "Pipeline Hook"},
			},
			"github": map[string]any{
				"fine_grained_permissions": []string{
					"Contents: Read and write",
					"Pull requests: Read and write",
					"Webhooks: Read and write",
					"Checks: Read-only",
					"Commit statuses: Read-only",
					"Metadata: Read-only",
				},
				"classic_scopes":       []string{"repo", "admin:repo_hook"},
				"preferred_token_type": "fine_grained",
				"webhook_events":       []string{"pull_request", "check_run", "status"},
			},
		},
	})
}

type connectVCSRequest struct {
	Provider       string   `json:"provider"`
	InstanceURL    string   `json:"instance_url"`
	AccessToken    string   `json:"access_token"`
	APIToken       string   `json:"api_token"`
	GitToken       string   `json:"git_token"`
	TokenType      string   `json:"token_type"`
	TokenScopes    []string `json:"token_scopes"`
	TokenExpiresAt string   `json:"token_expires_at"`
	CloneHost      string   `json:"clone_host"`
	CAPEM          string   `json:"ca_pem"`
}

// ConnectVCS (POST /workspaces/{id}/vcs/connections) validates the supplied
// instance URL + token against the live instance for the chosen provider, mints a
// webhook secret, stores both secrets encrypted, and returns the connection
// plus the one-time webhook secret. Reconnecting the same instance rotates it.
func (h *Handler) ConnectVCS(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	if !h.isVCSConfigured() {
		writeError(w, http.StatusServiceUnavailable, "vcs integration not configured (ENACT_VCS_SECRET_KEY unset)")
		return
	}

	var req connectVCSRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	provider, ok := vcs.For(req.Provider)
	if !ok {
		writeError(w, http.StatusBadRequest, "unsupported provider")
		return
	}
	instanceURL := vcs.NormalizeInstanceURL(req.InstanceURL)
	token := strings.TrimSpace(req.APIToken)
	if token == "" {
		token = strings.TrimSpace(req.AccessToken)
	}
	gitToken := strings.TrimSpace(req.GitToken)
	if gitToken == "" {
		gitToken = strings.TrimSpace(req.AccessToken)
	}
	if instanceURL == "" || token == "" {
		writeError(w, http.StatusBadRequest, "instance_url and api_token are required")
		return
	}
	parsed, err := url.Parse(instanceURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		writeError(w, http.StatusBadRequest, "instance_url must be an absolute http(s) URL")
		return
	}

	if provider.Kind() == vcs.KindGitLab && gitToken == "" {
		writeError(w, http.StatusBadRequest, "git_token with write_repository scope is required for GitLab")
		return
	}
	if provider.Kind() == vcs.KindGitHub && gitToken == "" {
		// One GitHub token authenticates both the REST API and HTTPS Git, so
		// asking for a second one would only invite an operator to paste the
		// same value twice. GitLab is the exception, not the rule: it scopes
		// `api` and `write_repository` onto separate credentials.
		gitToken = token
	}
	client, err := vcsHTTPClient(strings.TrimSpace(req.CAPEM))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var verifiedGitHubScopes []string
	var account vcs.Account
	switch provider.Kind() {
	case vcs.KindGitLab:
		account, err = vcs.ValidateGitLabToken(r.Context(), client, instanceURL, token)
	case vcs.KindGitHub:
		var metadata vcs.GitHubTokenMetadata
		metadata, err = vcs.InspectGitHubToken(r.Context(), client, instanceURL, token)
		account = vcs.Account{Login: metadata.Login}
		if err == nil {
			verifiedGitHubScopes = metadata.Scopes
		}
	default:
		account, err = provider.ValidateToken(r.Context(), instanceURL, token)
	}
	if err != nil {
		if errors.Is(err, vcs.ErrUnauthorized) {
			writeError(w, http.StatusBadRequest, "the provider rejected the access token")
			return
		}
		if errors.Is(err, vcs.ErrForbidden) {
			writeError(w, http.StatusBadRequest, vcsForbiddenDetail(provider.Kind()))
			return
		}
		writeError(w, http.StatusBadGateway, "could not reach the provider instance")
		return
	}
	verifiedScopes := append([]string(nil), req.TokenScopes...)
	verifiedExpiry := strings.TrimSpace(req.TokenExpiresAt)
	if provider.Kind() == vcs.KindGitLab && strings.TrimSpace(req.AccessToken) == "" {
		scopes, expiry, inspectErr := inspectGitLabManagedTokens(r.Context(), client, instanceURL, token, gitToken)
		if errors.Is(inspectErr, errVCSScopeMissing) {
			writeError(w, http.StatusBadRequest, inspectErr.Error())
			return
		}
		if inspectErr != nil {
			// Introspection is a convenience, not the authorization: the token
			// already authenticated above, and a GitLab that will not describe
			// it (an older instance, a token type without `self`, a restricted
			// network path) is not a reason to refuse a working credential.
			// Record what the operator declared and let the capability probes
			// report the truth.
			slog.Warn("vcs: GitLab token introspection unavailable; keeping declared metadata",
				"instance_url", instanceURL, "error", inspectErr)
		} else {
			verifiedScopes, verifiedExpiry = scopes, expiry
		}
	}
	if provider.Kind() == vcs.KindGitHub {
		// A classic token announces its scopes in a response header; a
		// fine-grained one carries per-repository permissions that no endpoint
		// enumerates. Recording an empty list for the latter is honest — the
		// capability probes on each repository are what actually answer it.
		verifiedScopes = verifiedGitHubScopes
	}
	if len(verifiedScopes) == 0 && provider.Kind() == vcs.KindGitLab {
		verifiedScopes = []string{"api", "write_repository"}
	}
	if verifiedScopes == nil {
		verifiedScopes = []string{}
	}

	webhookSecret, err := newVCSWebhookSecret()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to mint webhook secret")
		return
	}
	tokenEnc, err := h.sealVCSSecret(token)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to encrypt token")
		return
	}
	gitTokenEnc, err := h.sealVCSSecret(gitToken)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to encrypt git token")
		return
	}
	caEnc := ""
	if strings.TrimSpace(req.CAPEM) != "" {
		caEnc, err = h.sealVCSSecret(strings.TrimSpace(req.CAPEM))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to encrypt CA certificate")
			return
		}
	}
	secretEnc, err := h.sealVCSSecret(webhookSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to encrypt webhook secret")
		return
	}

	var connectedBy pgtype.UUID
	if member, ok := middleware.MemberFromContext(r.Context()); ok {
		connectedBy = member.UserID
	}

	tokenType := strings.TrimSpace(req.TokenType)
	if tokenType == "" {
		tokenType = "personal"
	}
	if !validVCSTokenTypes[tokenType] {
		writeError(w, http.StatusBadRequest, "unsupported token_type")
		return
	}
	cloneHost := strings.TrimSpace(req.CloneHost)
	if cloneHost == "" {
		cloneHost = parsed.Host
	}
	expiresAt, expiryErr := parseVCSTokenExpiry(verifiedExpiry)
	if expiryErr != nil {
		writeError(w, http.StatusBadRequest, expiryErr.Error())
		return
	}
	conn, err := h.Queries.UpsertVCSConnection(r.Context(), db.UpsertVCSConnectionParams{
		WorkspaceID:            wsUUID,
		Provider:               string(provider.Kind()),
		InstanceUrl:            instanceURL,
		AccountLogin:           account.Login,
		AccessTokenEncrypted:   tokenEnc,
		GitTokenEncrypted:      gitTokenEnc,
		WebhookSecretEncrypted: secretEnc,
		TokenType:              tokenType,
		TokenScopes:            verifiedScopes,
		TokenExpiresAt:         expiresAt,
		CloneHost:              cloneHost,
		CaPemEncrypted:         caEnc,
		ConnectedByID:          connectedBy,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save connection")
		return
	}

	resp := h.vcsConnectionToResponse(conn)
	h.publish(protocol.EventVCSConnectionCreated, workspaceID, "system", "", map[string]any{"id": resp.ID})
	writeJSON(w, http.StatusOK, VCSConnectResponse{
		VCSConnectionResponse: resp,
		WebhookSecret:         webhookSecret,
	})
}

// RotateVCSConnectionCredentials replaces the GitLab API/Git credentials and
// optional CA without changing the connection identity or webhook secret.
// Secrets remain write-only: the response contains only the sanitized summary.
func (h *Handler) RotateVCSConnectionCredentials(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	connUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "connectionId"), "connection id")
	if !ok {
		return
	}
	conn, err := h.Queries.GetVCSConnectionByID(r.Context(), connUUID)
	if err != nil || uuidToString(conn.WorkspaceID) != uuidToString(wsUUID) {
		writeError(w, http.StatusNotFound, "vcs connection not found")
		return
	}
	isGitHub := conn.Provider == string(vcs.KindGitHub)
	if conn.Provider != string(vcs.KindGitLab) && !isGitHub {
		writeError(w, http.StatusBadRequest, "managed credential rotation is available for GitHub and GitLab connections")
		return
	}

	var req connectVCSRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	apiToken := strings.TrimSpace(req.APIToken)
	gitToken := strings.TrimSpace(req.GitToken)
	if isGitHub && gitToken == "" {
		gitToken = apiToken
	}
	if apiToken == "" || gitToken == "" {
		writeError(w, http.StatusBadRequest, "api_token and git_token are required")
		return
	}
	client, err := vcsHTTPClient(strings.TrimSpace(req.CAPEM))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var account vcs.Account
	var verifiedScopes []string
	var verifiedExpiry string
	if isGitHub {
		metadata, inspectErr := vcs.InspectGitHubToken(r.Context(), client, conn.InstanceUrl, apiToken)
		if inspectErr != nil {
			writeVCSCredentialError(w, conn.Provider, inspectErr)
			return
		}
		account = vcs.Account{Login: metadata.Login}
		verifiedScopes = metadata.Scopes
		verifiedExpiry = strings.TrimSpace(req.TokenExpiresAt)
	} else {
		account, err = vcs.ValidateGitLabToken(r.Context(), client, conn.InstanceUrl, apiToken)
		if err != nil {
			writeVCSCredentialError(w, conn.Provider, err)
			return
		}
		scopes, expiry, inspectErr := inspectGitLabManagedTokens(r.Context(), client, conn.InstanceUrl, apiToken, gitToken)
		if errors.Is(inspectErr, errVCSScopeMissing) {
			writeError(w, http.StatusBadRequest, inspectErr.Error())
			return
		}
		if inspectErr != nil {
			slog.Warn("vcs: GitLab token introspection unavailable; keeping declared metadata",
				"instance_url", conn.InstanceUrl, "error", inspectErr)
			verifiedScopes = append([]string(nil), req.TokenScopes...)
			verifiedExpiry = strings.TrimSpace(req.TokenExpiresAt)
		} else {
			verifiedScopes, verifiedExpiry = scopes, expiry
		}
		if len(verifiedScopes) == 0 {
			verifiedScopes = []string{"api", "write_repository"}
		}
	}
	if verifiedScopes == nil {
		verifiedScopes = []string{}
	}
	tokenType := strings.TrimSpace(req.TokenType)
	if tokenType == "" {
		tokenType = conn.TokenType
	}
	if !validVCSTokenTypes[tokenType] {
		writeError(w, http.StatusBadRequest, "unsupported token_type")
		return
	}
	expiresAt, expiryErr := parseVCSTokenExpiry(verifiedExpiry)
	if expiryErr != nil {
		writeError(w, http.StatusBadRequest, expiryErr.Error())
		return
	}

	apiEncrypted, err := h.sealVCSSecret(apiToken)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to encrypt API token")
		return
	}
	gitEncrypted, err := h.sealVCSSecret(gitToken)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to encrypt Git token")
		return
	}
	caEncrypted := ""
	if strings.TrimSpace(req.CAPEM) != "" {
		caEncrypted, err = h.sealVCSSecret(strings.TrimSpace(req.CAPEM))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to encrypt CA certificate")
			return
		}
	}
	cloneHost := strings.TrimSpace(req.CloneHost)
	if cloneHost == "" {
		cloneHost = conn.CloneHost
	}
	updated, err := h.Queries.UpdateVCSConnectionCredentials(r.Context(), db.UpdateVCSConnectionCredentialsParams{
		ID:                   conn.ID,
		WorkspaceID:          wsUUID,
		AccountLogin:         account.Login,
		AccessTokenEncrypted: apiEncrypted,
		GitTokenEncrypted:    gitEncrypted,
		TokenType:            tokenType,
		TokenScopes:          verifiedScopes,
		TokenExpiresAt:       expiresAt,
		CloneHost:            cloneHost,
		CaPemEncrypted:       caEncrypted,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to rotate credentials")
		return
	}
	h.publish(protocol.EventVCSConnectionCreated, workspaceID, "system", "", map[string]any{"id": uuidToString(updated.ID), "credentials_rotated": true})
	writeJSON(w, http.StatusOK, h.vcsConnectionToResponse(updated))
}

// validVCSTokenTypes is the union across providers: GitLab names the bearer
// (a service account, a project, a group), GitHub names the token format
// (fine-grained or classic personal). Both are stored verbatim so the UI can
// show an operator which kind of credential a connection actually holds.
var validVCSTokenTypes = map[string]bool{
	"service_account": true,
	"project":         true,
	"group":           true,
	"personal":        true,
	"fine_grained":    true,
}

// vcsForbiddenDetail explains an authenticated-but-refused credential in the
// provider's own terms, because the fix differs: GitLab means the token lacks
// a scope, while GitHub most often means the organization requires the token
// to be SAML-authorized before it may see anything.
func vcsForbiddenDetail(kind vcs.Kind) string {
	if kind == vcs.KindGitHub {
		return "GitHub accepted the token but refused the request; authorize it for the organization (SAML SSO) or grant the missing repository permission"
	}
	return "the API token lacks the required scope or account access"
}

// writeVCSCredentialError turns a provider rejection into the response the
// operator can act on: a bad token, an authenticated token the provider still
// refuses, or an instance that could not be reached at all.
func writeVCSCredentialError(w http.ResponseWriter, provider string, err error) {
	if errors.Is(err, vcs.ErrUnauthorized) {
		writeError(w, http.StatusBadRequest, "the provider rejected the API token")
		return
	}
	if errors.Is(err, vcs.ErrForbidden) {
		writeError(w, http.StatusBadRequest, vcsForbiddenDetail(vcs.Kind(provider)))
		return
	}
	writeError(w, http.StatusBadGateway, "could not reach the provider instance")
}

func vcsContainsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

// errVCSScopeMissing marks the one introspection outcome that must block a
// connect: the provider answered, and its answer was that the credential lacks
// a scope the integration needs. Every other failure means introspection did
// not happen, which is not evidence against the token — see the callers.
var errVCSScopeMissing = errors.New("vcs: provider reports a missing token scope")

// parseVCSTokenExpiry accepts a date, an RFC3339 timestamp, or nothing. Nothing
// is a legitimate answer: a non-expiring token is a valid, if less desirable,
// credential, and refusing it would push operators toward pasting a fake date.
// The UI surfaces an unset expiry so the tradeoff stays visible.
func parseVCSTokenExpiry(value string) (pgtype.Timestamptz, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return pgtype.Timestamptz{}, nil
	}
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		parsed, err = time.Parse(time.RFC3339, value)
	}
	if err != nil {
		return pgtype.Timestamptz{}, errors.New("token_expires_at must be YYYY-MM-DD or RFC3339")
	}
	if parsed.Before(time.Now()) {
		return pgtype.Timestamptz{}, errors.New("token_expires_at must be in the future")
	}
	return pgtype.Timestamptz{Time: parsed, Valid: true}, nil
}

// inspectGitLabManagedTokens asks GitLab what the two credentials actually are,
// so a caller cannot claim scopes it does not hold. A missing scope is
// definitive and wraps errVCSScopeMissing; an unreachable or unsupported
// introspection endpoint returns a plain error the caller may degrade past.
// An empty expiry is returned as empty rather than as a failure — GitLab
// permits non-expiring tokens and reports them that way.
func inspectGitLabManagedTokens(ctx context.Context, client *http.Client, instanceURL, apiToken, gitToken string) ([]string, string, error) {
	apiMetadata, err := vcs.InspectGitLabToken(ctx, client, instanceURL, apiToken)
	if err != nil {
		return nil, "", fmt.Errorf("could not inspect GitLab API token: %w", err)
	}
	if !vcsContainsString(apiMetadata.Scopes, "api") {
		return nil, "", fmt.Errorf("%w: the API token does not have api scope", errVCSScopeMissing)
	}
	gitMetadata, err := vcs.InspectGitLabToken(ctx, client, instanceURL, gitToken)
	if err != nil {
		return nil, "", fmt.Errorf("could not inspect GitLab Git token: %w", err)
	}
	if !vcsContainsString(gitMetadata.Scopes, "write_repository") {
		return nil, "", fmt.Errorf("%w: the Git token does not have write_repository scope", errVCSScopeMissing)
	}
	return []string{"api", "write_repository"}, earliestGitLabTokenExpiry(apiMetadata.ExpiresAt, gitMetadata.ExpiresAt), nil
}

// earliestGitLabTokenExpiry returns the soonest expiry among the tokens, which
// is when the connection starts failing. A token with no expiry contributes
// nothing rather than voiding the answer, so a pairing of one expiring and one
// permanent token still reports the date that matters.
func earliestGitLabTokenExpiry(values ...string) string {
	var earliest time.Time
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		parsed, err := time.Parse("2006-01-02", value)
		if err != nil {
			parsed, err = time.Parse(time.RFC3339, value)
		}
		if err != nil {
			return ""
		}
		if earliest.IsZero() || parsed.Before(earliest) {
			earliest = parsed
		}
	}
	if earliest.IsZero() {
		return ""
	}
	return earliest.UTC().Format(time.RFC3339)
}

// VCSRepositoryResponse is the repository picker row, normalized across
// providers. The previous shape leaked GitLab's own field names and its
// numeric access levels, which forced the picker UI to know that 30 means
// "may push" — a provider rule that belongs on this side of the API. One shape
// here means one picker for GitHub and GitLab alike.
type VCSRepositoryResponse struct {
	ID            string `json:"id"`
	FullName      string `json:"full_name"`
	WebURL        string `json:"web_url"`
	CloneURL      string `json:"clone_url"`
	Description   string `json:"description"`
	Visibility    string `json:"visibility"`
	Archived      bool   `json:"archived"`
	DefaultBranch string `json:"default_branch"`
	// CanPush decides whether the row is selectable: a repository the
	// credential cannot push to can never receive an agent's branch.
	CanPush bool `json:"can_push"`
}

// gitLabCanPush is the access level at which GitLab grants push. Developer is
// 30; Reporter (20) and below are read-only.
const gitLabDeveloperAccessLevel = 30

// ListVCSConnectionRepositories returns one page of repositories the
// connection's credential can reach. Forgejo and Gitea stay connection and
// webhook-only and report a clear capability error rather than an empty list.
func (h *Handler) ListVCSConnectionRepositories(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	connUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "connectionId"), "connection id")
	if !ok {
		return
	}
	conn, err := h.Queries.GetVCSConnectionByID(r.Context(), connUUID)
	if err != nil || uuidToString(conn.WorkspaceID) != uuidToString(wsUUID) {
		writeError(w, http.StatusNotFound, "vcs connection not found")
		return
	}
	if conn.Provider != string(vcs.KindGitLab) && conn.Provider != string(vcs.KindGitHub) {
		writeError(w, http.StatusNotImplemented, "repository browsing is available for GitHub and GitLab connections")
		return
	}
	token, err := h.openVCSSecret(conn.AccessTokenEncrypted)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "secret error")
		return
	}
	client, err := h.vcsConnectionHTTPClient(conn)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "invalid stored CA certificate")
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	search := r.URL.Query().Get("search")

	var repositories []VCSRepositoryResponse
	var nextPage *int
	var total int64
	if conn.Provider == string(vcs.KindGitHub) {
		result, listErr := vcs.ListGitHubRepositories(r.Context(), client, conn.InstanceUrl, token, search, page, 50)
		if listErr != nil {
			writeVCSRepositoryListError(w, conn.Provider, listErr)
			return
		}
		nextPage = result.NextPage
		for _, repository := range result.Repositories {
			visibility := "public"
			if repository.Private {
				visibility = "private"
			}
			repositories = append(repositories, VCSRepositoryResponse{
				ID:            strconv.FormatInt(repository.ID, 10),
				FullName:      repository.FullName,
				WebURL:        repository.HTMLURL,
				CloneURL:      repository.CloneURL,
				Description:   repository.Description,
				Visibility:    visibility,
				Archived:      repository.Archived,
				DefaultBranch: repository.DefaultBranch,
				CanPush:       repository.Permissions.Push,
			})
		}
	} else {
		result, listErr := vcs.ListGitLabProjects(r.Context(), client, conn.InstanceUrl, token, search, page, 50)
		if listErr != nil {
			writeVCSRepositoryListError(w, conn.Provider, listErr)
			return
		}
		nextPage, total = result.NextPage, result.Total
		for _, project := range result.Projects {
			access := 0
			if project.Permissions.ProjectAccess != nil {
				access = project.Permissions.ProjectAccess.AccessLevel
			}
			if project.Permissions.GroupAccess != nil && project.Permissions.GroupAccess.AccessLevel > access {
				access = project.Permissions.GroupAccess.AccessLevel
			}
			repositories = append(repositories, VCSRepositoryResponse{
				ID:            strconv.FormatInt(project.ID, 10),
				FullName:      project.PathWithNamespace,
				WebURL:        project.WebURL,
				CloneURL:      project.HTTPURLToRepo,
				Description:   project.Description,
				Visibility:    project.Visibility,
				Archived:      project.Archived,
				DefaultBranch: project.DefaultBranch,
				CanPush:       access >= gitLabDeveloperAccessLevel,
			})
		}
	}
	if repositories == nil {
		repositories = []VCSRepositoryResponse{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"repositories": repositories, "total_count": total, "next_page": nextPage})
}

func writeVCSRepositoryListError(w http.ResponseWriter, provider string, err error) {
	label := "GitLab"
	if provider == string(vcs.KindGitHub) {
		label = "GitHub"
	}
	if errors.Is(err, vcs.ErrUnauthorized) {
		writeError(w, http.StatusForbidden, label+" rejected the stored token; rotate the connection credentials")
		return
	}
	if errors.Is(err, vcs.ErrForbidden) {
		writeError(w, http.StatusForbidden, vcsForbiddenDetail(vcs.Kind(provider)))
		return
	}
	writeError(w, http.StatusBadGateway, "could not list "+label+" repositories: "+err.Error())
}

// TestVCSConnection independently reports the server API leg. Git read/write
// remain untested until a daemon reports its repository probe.
func (h *Handler) TestVCSConnection(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	connUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "connectionId"), "connection id")
	if !ok {
		return
	}
	conn, err := h.Queries.GetVCSConnectionByID(r.Context(), connUUID)
	if err != nil || uuidToString(conn.WorkspaceID) != uuidToString(wsUUID) {
		writeError(w, http.StatusNotFound, "vcs connection not found")
		return
	}
	token, err := h.openVCSSecret(conn.AccessTokenEncrypted)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "secret error")
		return
	}
	client, clientErr := h.vcsConnectionHTTPClient(conn)
	status := "ok"
	detail := "API authenticated successfully"
	if err != nil || clientErr != nil {
		status, detail = "tls_error", "Stored enterprise CA is invalid"
	} else if conn.Provider == string(vcs.KindGitLab) {
		_, err = vcs.ValidateGitLabToken(r.Context(), client, conn.InstanceUrl, token)
	} else if conn.Provider == string(vcs.KindGitHub) {
		// Dispatched explicitly rather than through Provider.ValidateToken so
		// the connection's enterprise CA is actually used. The interface
		// method has no client parameter and falls back to the package
		// default, which trusts only the system store — on an Enterprise
		// Server behind a private chain that turns every test into a TLS
		// failure the operator cannot explain.
		_, err = vcs.InspectGitHubToken(r.Context(), client, conn.InstanceUrl, token)
	} else if provider, exists := vcs.For(conn.Provider); exists {
		_, err = provider.ValidateToken(r.Context(), conn.InstanceUrl, token)
	} else {
		err = errors.New("unsupported provider")
	}
	if err != nil {
		status, detail = classifyVCSTestError(err), err.Error()
	}
	updated, updateErr := h.Queries.UpdateVCSConnectionValidation(r.Context(), db.UpdateVCSConnectionValidationParams{ID: conn.ID, WorkspaceID: wsUUID, ApiStatus: status, GitReadStatus: conn.GitReadStatus, GitWriteStatus: conn.GitWriteStatus, ChangeRequestStatus: conn.ChangeRequestStatus})
	if updateErr != nil {
		writeError(w, http.StatusInternalServerError, "failed to save validation result")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"connection": h.vcsConnectionToResponse(updated), "api": map[string]string{"status": status, "detail": detail}, "webhook": map[string]string{"status": updated.WebhookStatus, "detail": "Send a test delivery from GitLab to verify this leg"}, "git": map[string]string{"read_status": updated.GitReadStatus, "write_status": updated.GitWriteStatus, "detail": "Git capability is verified per repository by each daemon"}})
}

func classifyVCSTestError(err error) string {
	if errors.Is(err, vcs.ErrUnauthorized) {
		return "unauthorized"
	}
	if errors.Is(err, vcs.ErrForbidden) {
		return "forbidden"
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "x509") || strings.Contains(msg, "certificate"):
		return "tls_error"
	case strings.Contains(msg, "no such host"):
		return "dns_error"
	case strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline"):
		return "timeout"
	default:
		return "unreachable"
	}
}

// vcsConnectionHTTPClient builds the outbound API client for one connection,
// decrypting its enterprise CA first. Both steps fail as one because a CA that
// cannot be decrypted must not silently degrade to the system trust store: on
// an enterprise instance that turns a TLS misconfiguration into a connection
// that appears to work until the day the private chain is the only one that
// validates.
func (h *Handler) vcsConnectionHTTPClient(conn db.VcsConnection) (*http.Client, error) {
	caPEM := ""
	if conn.CaPemEncrypted != "" {
		decrypted, err := h.openVCSSecret(conn.CaPemEncrypted)
		if err != nil {
			return nil, fmt.Errorf("decrypt stored enterprise CA: %w", err)
		}
		caPEM = decrypted
	}
	return vcsHTTPClient(caPEM)
}

func vcsHTTPClient(caPEM string) (*http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}
	if strings.TrimSpace(caPEM) != "" {
		pool, err := x509.SystemCertPool()
		if err != nil {
			return nil, fmt.Errorf("load system trust store: %w", err)
		}
		if !pool.AppendCertsFromPEM([]byte(caPEM)) {
			return nil, errors.New("ca_pem must contain at least one valid PEM certificate")
		}
		tlsConfig.RootCAs = pool
	}
	transport.TLSClientConfig = tlsConfig
	return &http.Client{Transport: transport, Timeout: 15 * time.Second}, nil
}

// DeleteVCSConnection (DELETE /workspaces/{id}/vcs/connections/{connectionId}).
func (h *Handler) DeleteVCSConnection(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	idUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "connectionId"), "connection id")
	if !ok {
		return
	}
	count, err := h.Queries.CountWorkspaceResourcesUsingConnection(r.Context(), db.CountWorkspaceResourcesUsingConnectionParams{WorkspaceID: wsUUID, ProviderConnectionID: chi.URLParam(r, "connectionId")})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check repository bindings")
		return
	}
	if count > 0 {
		rows, _ := h.Queries.ListWorkspaceResourcesUsingConnection(r.Context(), db.ListWorkspaceResourcesUsingConnectionParams{WorkspaceID: wsUUID, ProviderConnectionID: chi.URLParam(r, "connectionId")})
		names := make([]string, 0, len(rows))
		for _, row := range rows {
			if row.Label.Valid {
				names = append(names, row.Label.String)
			} else {
				names = append(names, uuidToString(row.ID))
			}
		}
		writeJSON(w, http.StatusConflict, map[string]any{"error": "connection is still used by code repositories", "repositories": names})
		return
	}
	if err := h.Queries.DeleteVCSConnection(r.Context(), db.DeleteVCSConnectionParams{
		ID:          idUUID,
		WorkspaceID: wsUUID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove connection")
		return
	}
	h.publish(protocol.EventVCSConnectionDeleted, workspaceID, "system", "", map[string]any{
		"id": chi.URLParam(r, "connectionId"),
	})
	w.WriteHeader(http.StatusNoContent)
}

// RotateVCSConnectionWebhook (POST /workspaces/{id}/vcs/connections/{connectionId}/rotate-webhook)
// generates a fresh webhook secret for an existing VCS connection, stores it encrypted,
// and returns the connection plus the one-time plaintext secret.
func (h *Handler) RotateVCSConnectionWebhook(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	connID := chi.URLParam(r, "connectionId")
	connUUID, ok := parseUUIDOrBadRequest(w, connID, "connection id")
	if !ok {
		return
	}
	if !h.isVCSConfigured() {
		writeError(w, http.StatusServiceUnavailable, "vcs integration not configured (ENACT_VCS_SECRET_KEY unset)")
		return
	}

	conn, err := h.Queries.GetVCSConnectionByID(r.Context(), connUUID)
	if err != nil || uuidToString(conn.WorkspaceID) != uuidToString(wsUUID) {
		writeError(w, http.StatusNotFound, "vcs connection not found")
		return
	}

	webhookSecret, err := newVCSWebhookSecret()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to mint webhook secret")
		return
	}
	secretEnc, err := h.sealVCSSecret(webhookSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to encrypt webhook secret")
		return
	}

	updated, err := h.Queries.RotateVCSConnectionWebhookSecret(r.Context(), db.RotateVCSConnectionWebhookSecretParams{
		ID:                     connUUID,
		WorkspaceID:            wsUUID,
		WebhookSecretEncrypted: secretEnc,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to rotate webhook secret")
		return
	}

	resp := h.vcsConnectionToResponse(updated)
	h.publish(protocol.EventVCSConnectionCreated, workspaceID, "system", "", map[string]any{"id": resp.ID})
	writeJSON(w, http.StatusOK, VCSConnectResponse{
		VCSConnectionResponse: resp,
		WebhookSecret:         webhookSecret,
	})
}

// newVCSWebhookSecret returns a 32-byte random secret as hex (64 chars).
func newVCSWebhookSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
