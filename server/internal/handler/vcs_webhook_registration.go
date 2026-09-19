package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/enact-ai/enact/server/internal/integrations/vcs"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Webhook registration states stored on vcs_connection.webhook_status. They
// answer "will deliveries arrive", which is separate from whether one already
// has: MarkVCSConnectionWebhookVerified sets "ok" when a signed delivery is
// actually received.
const (
	// webhookStatusRegistered means the hook exists at the provider. It is not
	// yet proof of delivery — an outbound firewall can still drop it.
	webhookStatusRegistered = "registered"
	// webhookStatusManual means the credential cannot manage hooks, so an
	// operator must add one. This is a normal outcome for a token deliberately
	// scoped without webhook permission, not an error.
	webhookStatusManual = "manual"
	webhookStatusFailed = "failed"
)

// registerRepositoryWebhook points one repository at this workspace's webhook
// endpoint. It never fails the caller: attaching a repository is the user's
// action, and a hook we could not create is a degraded state to report, not a
// reason to refuse the attachment. The returned status is what the connection
// records.
func (h *Handler) registerRepositoryWebhook(ctx context.Context, conn db.VcsConnection, repo codeRepositoryRef) string {
	webhookURL := h.vcsWebhookURL(uuidToString(conn.ID))
	if webhookURL == "" {
		// Without ENACT_PUBLIC_URL there is no address to register, and a
		// provider cannot reach this deployment anyway.
		return webhookStatusManual
	}
	secret, err := h.openVCSSecret(conn.WebhookSecretEncrypted)
	if err != nil || secret == "" {
		slog.Warn("vcs: webhook secret unavailable for registration", "connection_id", uuidToString(conn.ID), "error", err)
		return webhookStatusFailed
	}
	token, err := h.openVCSSecret(conn.AccessTokenEncrypted)
	if err != nil || token == "" {
		slog.Warn("vcs: api token unavailable for webhook registration", "connection_id", uuidToString(conn.ID), "error", err)
		return webhookStatusFailed
	}
	client, err := h.vcsConnectionHTTPClient(conn)
	if err != nil {
		slog.Warn("vcs: enterprise CA invalid during webhook registration", "connection_id", uuidToString(conn.ID), "error", err)
		return webhookStatusFailed
	}

	switch conn.Provider {
	case string(vcs.KindGitHub):
		err = vcs.EnsureGitHubRepositoryWebhook(ctx, client, conn.InstanceUrl, token, repo.FullName, webhookURL, secret)
	case string(vcs.KindGitLab):
		err = vcs.EnsureGitLabProjectWebhook(ctx, client, conn.InstanceUrl, token, repo.ProviderRepositoryID, webhookURL, secret)
	default:
		// Forgejo and Gitea are connection-scoped: one hook on the instance
		// covers every repository, so there is nothing per-repository to do.
		return conn.WebhookStatus
	}
	if errors.Is(err, vcs.ErrWebhookRegistrationForbidden) {
		slog.Info("vcs: token may not manage webhooks; operator must register manually",
			"connection_id", uuidToString(conn.ID), "repository", repo.FullName)
		return webhookStatusManual
	}
	if err != nil {
		slog.Warn("vcs: webhook registration failed", "connection_id", uuidToString(conn.ID), "repository", repo.FullName, "error", err)
		return webhookStatusFailed
	}
	return webhookStatusRegistered
}

// webhookRegistrationTimeout bounds the detached registration attempt. It is
// generous enough for an enterprise instance on a slow internal link and short
// enough that a black-holed host releases the goroutine promptly.
const webhookRegistrationTimeout = 30 * time.Second

// syncCodeRepositoryWebhook is the attach-time hook, and it runs detached from
// the request on purpose. Registration is a round trip to the provider; making
// the user wait for it would put an external service on the critical path of
// "attach this repository", and a provider that hangs would hold the request
// open for as long as the client allowed. The attachment is already durable by
// the time this starts, so the only thing in flight is the status it records.
//
// The connection lookup happens here, on the caller's context, so the common
// case of a ref that names no vcs_connection — a GitHub App installation,
// which registers its own webhook at install time — costs one query and
// spawns nothing.
func (h *Handler) syncCodeRepositoryWebhook(ctx context.Context, workspaceID pgtype.UUID, raw json.RawMessage) {
	var repo codeRepositoryRef
	if json.Unmarshal(raw, &repo) != nil || !repo.Enabled {
		return
	}
	if repo.Provider != string(vcs.KindGitHub) && repo.Provider != string(vcs.KindGitLab) {
		return
	}
	connectionID, err := parseUUIDLoose(repo.ProviderConnectionID)
	if err != nil {
		return
	}
	conn, err := h.Queries.GetVCSConnectionByID(ctx, connectionID)
	if err != nil || conn.WorkspaceID != workspaceID {
		return
	}
	go h.registerAndStoreWebhookStatus(conn, repo)
}

// registerAndStoreWebhookStatus performs the detached attempt. It builds its
// own context because the request's is cancelled as soon as the response is
// written, and recovers so a provider-shaped surprise cannot take the process
// down from a background goroutine.
func (h *Handler) registerAndStoreWebhookStatus(conn db.VcsConnection, repo codeRepositoryRef) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("vcs: webhook registration panicked", "connection_id", uuidToString(conn.ID), "panic", r)
		}
	}()
	ctx, cancel := context.WithTimeout(context.WithoutCancel(context.Background()), webhookRegistrationTimeout)
	defer cancel()

	status := h.registerRepositoryWebhook(ctx, conn, repo)
	if status == conn.WebhookStatus {
		return
	}
	if err := h.Queries.SetVCSConnectionWebhookStatus(ctx, db.SetVCSConnectionWebhookStatusParams{
		ID: conn.ID, WorkspaceID: conn.WorkspaceID, WebhookStatus: status,
	}); err != nil {
		slog.Warn("vcs: could not store webhook status", "connection_id", uuidToString(conn.ID), "error", err)
	}
}

// RegisterVCSConnectionWebhooks re-runs registration across every repository
// bound to the connection. Attach-time registration is automatic, so this
// exists for the cases it cannot cover: a token that gained webhook permission
// after the fact, a rotated secret, a deployment that only just learned its
// public URL, or a hook someone deleted at the provider.
func (h *Handler) RegisterVCSConnectionWebhooks(w http.ResponseWriter, r *http.Request) {
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
	if err != nil || conn.WorkspaceID != wsUUID {
		writeError(w, http.StatusNotFound, "vcs connection not found")
		return
	}
	if !h.isVCSConfigured() {
		writeError(w, http.StatusServiceUnavailable, "vcs integration not configured (ENACT_VCS_SECRET_KEY unset)")
		return
	}
	rows, err := h.Queries.ListWorkspaceResourcesUsingConnection(r.Context(), db.ListWorkspaceResourcesUsingConnectionParams{
		WorkspaceID: wsUUID, ProviderConnectionID: uuidToString(conn.ID),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list bound repositories")
		return
	}

	results := make([]map[string]string, 0, len(rows))
	// The connection reports the weakest result across its repositories, since
	// one repository that cannot deliver is the thing an operator must act on.
	worst := ""
	rank := map[string]int{webhookStatusRegistered: 0, webhookStatusManual: 1, webhookStatusFailed: 2}
	for _, row := range rows {
		var repo codeRepositoryRef
		if json.Unmarshal(row.ResourceRef, &repo) != nil || !repo.Enabled {
			continue
		}
		status := h.registerRepositoryWebhook(r.Context(), conn, repo)
		results = append(results, map[string]string{"repository": repo.FullName, "status": status})
		if worst == "" || rank[status] > rank[worst] {
			worst = status
		}
	}
	if worst != "" && worst != conn.WebhookStatus {
		if err := h.Queries.SetVCSConnectionWebhookStatus(r.Context(), db.SetVCSConnectionWebhookStatusParams{
			ID: conn.ID, WorkspaceID: wsUUID, WebhookStatus: worst,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to store webhook status")
			return
		}
	}
	refreshed, err := h.Queries.GetVCSConnectionByID(r.Context(), connUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to reload connection")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"connection":   h.vcsConnectionToResponse(refreshed),
		"repositories": results,
	})
}
