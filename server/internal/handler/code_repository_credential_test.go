package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/enact-ai/enact/server/internal/middleware"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/go-chi/chi/v5"
)

// daemonCredentialRequest addresses the daemon-only endpoint the way its route
// does: workspace and resource in the path, daemon identity from the token
// rather than from anything the caller sends.
func daemonCredentialRequest(t *testing.T, daemonID, workspaceID, resourceID string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet,
		"/api/daemon/workspaces/"+workspaceID+"/resources/"+resourceID+"/git-credential", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("workspaceId", workspaceID)
	rctx.URLParams.Add("resourceId", resourceID)
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	if daemonID != "" {
		// Both ids come from the token in production; WithDaemonContext is the
		// supported way to stand in for that.
		ctx = middleware.WithDaemonContext(ctx, workspaceID, daemonID)
	}
	return req.WithContext(ctx)
}

func seedCodeRepositoryResource(t *testing.T, ref codeRepositoryRef) string {
	t.Helper()
	raw, err := json.Marshal(ref)
	if err != nil {
		t.Fatalf("marshal ref: %v", err)
	}
	resource, err := testHandler.Queries.CreateWorkspaceResource(context.Background(), db.CreateWorkspaceResourceParams{
		WorkspaceID:  parseUUID(testWorkspaceID),
		ResourceType: "github_repo",
		ResourceRef:  raw,
		Position:     998,
	})
	if err != nil {
		t.Fatalf("CreateWorkspaceResource: %v", err)
	}
	id := uuidToString(resource.ID)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM workspace_resource WHERE id = $1`, id)
	})
	return id
}

// The endpoint hands out a live credential. Anything without a daemon identity
// must be refused before the resource is even looked up.
func TestResolveCodeRepositoryCredentialRequiresDaemonIdentity(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	withVCSBox(t)
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })
	connID := seedGitHubConnection(t, "https://ghe.corp.example", "ghe.corp.example")
	resourceID := seedCodeRepositoryResource(t, codeRepositoryRef{
		Provider: "github", ProviderConnectionID: connID, ProviderRepositoryID: "77",
		FullName: "acme/widget", URL: "https://ghe.corp.example/acme/widget.git", Enabled: true,
	})

	w := httptest.NewRecorder()
	testHandler.ResolveCodeRepositoryCredential(w, daemonCredentialRequest(t, "", testWorkspaceID, resourceID))
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 without a daemon credential, got %d: %s", w.Code, w.Body.String())
	}
	if len(w.Body.String()) > 0 && containsSecret(w.Body.String(), "api-token") {
		t.Fatal("the refusal must not leak the stored token")
	}
}

// A GitHub token connection returns the operator's stored credential under
// GitHub's documented username for token-over-HTTPS.
func TestResolveCodeRepositoryCredentialReturnsTheStoredGitHubToken(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	withVCSBox(t)
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })
	const daemonID = "daemon-credential-test"
	connID := seedGitHubConnection(t, "https://ghe.corp.example", "ghe.corp.example")
	resourceID := seedCodeRepositoryResource(t, codeRepositoryRef{
		Provider: "github", ProviderConnectionID: connID, ProviderRepositoryID: "77",
		FullName: "acme/widget", URL: "https://ghe.corp.example/acme/widget.git", Enabled: true,
	})

	w := httptest.NewRecorder()
	testHandler.ResolveCodeRepositoryCredential(w, daemonCredentialRequest(t, daemonID, testWorkspaceID, resourceID))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var out struct {
		RepositoryURL string `json:"repository_url"`
		Username      string `json:"username"`
		Password      string `json:"password"`
		Provider      string `json:"provider"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Provider != "github" || out.Username != "x-access-token" {
		t.Fatalf("credential shape = %+v", out)
	}
	if out.Password != "api-token" {
		t.Fatalf("password = %q, want the stored token", out.Password)
	}
	// The daemon clones exactly what the ref stores, which the binding step
	// already rewrote to the connection's clone host.
	if out.RepositoryURL != "https://ghe.corp.example/acme/widget.git" {
		t.Fatalf("repository_url = %q", out.RepositoryURL)
	}
}

// A row still pending configuration has no verified binding, so it must not
// yield a credential even to an authorized daemon.
func TestResolveCodeRepositoryCredentialRefusesADisabledRepository(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	withVCSBox(t)
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })
	const daemonID = "daemon-credential-test"
	connID := seedGitHubConnection(t, "https://ghe.corp.example", "ghe.corp.example")
	resourceID := seedCodeRepositoryResource(t, codeRepositoryRef{
		Provider: "github", ProviderConnectionID: connID, FullName: "acme/widget",
		URL: "https://ghe.corp.example/acme/widget.git", Enabled: false,
	})

	w := httptest.NewRecorder()
	testHandler.ResolveCodeRepositoryCredential(w, daemonCredentialRequest(t, daemonID, testWorkspaceID, resourceID))
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for a pending repository, got %d: %s", w.Code, w.Body.String())
	}
}

// Losing the encryption key must fail closed rather than hand back an empty
// password the daemon would try to clone with.
func TestResolveCodeRepositoryCredentialFailsClosedWithoutTheKey(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	box := withVCSBox(t)
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })
	const daemonID = "daemon-credential-test"
	connID := seedGitHubConnection(t, "https://ghe.corp.example", "ghe.corp.example")
	resourceID := seedCodeRepositoryResource(t, codeRepositoryRef{
		Provider: "github", ProviderConnectionID: connID, ProviderRepositoryID: "77",
		FullName: "acme/widget", URL: "https://ghe.corp.example/acme/widget.git", Enabled: true,
	})
	_ = box
	testHandler.VCSSecretBox = nil

	w := httptest.NewRecorder()
	testHandler.ResolveCodeRepositoryCredential(w, daemonCredentialRequest(t, daemonID, testWorkspaceID, resourceID))
	if w.Code == http.StatusOK {
		t.Fatalf("expected a failure without the encryption key, got 200: %s", w.Body.String())
	}
}

func containsSecret(body, secret string) bool {
	return len(secret) > 0 && len(body) > 0 && json.Valid([]byte(body)) && bodyContains(body, secret)
}

func bodyContains(body, needle string) bool {
	for i := 0; i+len(needle) <= len(body); i++ {
		if body[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
