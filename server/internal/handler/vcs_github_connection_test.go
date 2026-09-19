package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/enact-ai/enact/server/internal/middleware"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
)

// githubStub stands in for a GitHub Enterprise Server. Everything it serves is
// under /api/v3, which is what a non-github.com instance URL must resolve to.
type githubStub struct {
	server     *httptest.Server
	userCalls  atomic.Int32
	hookWrites atomic.Int32
	scopes     string
	forbidHook bool
}

func newGitHubStub(t *testing.T) *githubStub {
	t.Helper()
	stub := &githubStub{scopes: "repo, admin:repo_hook"}
	stub.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/v3")
		switch {
		case path == "/user":
			stub.userCalls.Add(1)
			if stub.scopes != "" {
				w.Header().Set("X-OAuth-Scopes", stub.scopes)
			}
			_, _ = w.Write([]byte(`{"login":"acme-bot"}`))
		case path == "/user/repos":
			_, _ = w.Write([]byte(`[{"id":77,"full_name":"acme/widget","clone_url":"https://ghe.corp/acme/widget.git","private":true,"default_branch":"main","permissions":{"push":true}}]`))
		case strings.HasSuffix(path, "/hooks"):
			if stub.forbidHook {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			if r.Method == http.MethodGet {
				_, _ = w.Write([]byte(`[]`))
				return
			}
			stub.hookWrites.Add(1)
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":1}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(stub.server.Close)
	return stub
}

func connectGitHubForTest(t *testing.T, stub *githubStub, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	req := vcsHandlerRequest(http.MethodPost, "/api/workspaces/"+testWorkspaceID+"/vcs/connections", body, "")
	w := httptest.NewRecorder()
	testHandler.ConnectVCS(w, req)
	return w
}

// A GitHub token authenticates both the REST API and HTTPS Git, so requiring a
// second one would only make an operator paste the same value twice. The
// stored git credential must still be populated, or the daemon has nothing to
// clone with.
func TestConnectVCSGitHubReusesTheSingleTokenForGit(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	withVCSBox(t)
	stub := newGitHubStub(t)
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })

	w := connectGitHubForTest(t, stub, map[string]any{
		"provider":     "github",
		"instance_url": stub.server.URL,
		"api_token":    "ghp_test",
		"token_type":   "personal",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("ConnectVCS: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp VCSConnectResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Provider != "github" || resp.AccountLogin != "acme-bot" {
		t.Fatalf("connection = %+v", resp.VCSConnectionResponse)
	}
	if resp.WebhookSecret == "" {
		t.Fatal("connect must return the one-time webhook secret")
	}

	conn, err := testHandler.Queries.GetVCSConnectionByID(context.Background(), parseUUID(resp.ID))
	if err != nil {
		t.Fatalf("GetVCSConnectionByID: %v", err)
	}
	gitToken, err := testHandler.openVCSSecret(conn.GitTokenEncrypted)
	if err != nil || gitToken != "ghp_test" {
		t.Fatalf("stored git token = %q (err %v); it must default to the API token", gitToken, err)
	}
	// Without a clone host the instance's own host is the remote.
	if !strings.Contains(conn.CloneHost, "127.0.0.1") {
		t.Fatalf("clone host = %q, want the instance host", conn.CloneHost)
	}
}

// A classic token announces its scopes; a fine-grained one does not. Recording
// a fabricated list for the latter would tell an operator their credential
// holds permissions nobody verified.
func TestConnectVCSGitHubStoresOnlyScopesGitHubReported(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	withVCSBox(t)
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })

	classic := newGitHubStub(t)
	w := connectGitHubForTest(t, classic, map[string]any{
		"provider": "github", "instance_url": classic.server.URL, "api_token": "ghp_classic",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("classic connect: %d %s", w.Code, w.Body.String())
	}
	var classicResp VCSConnectResponse
	_ = json.Unmarshal(w.Body.Bytes(), &classicResp)
	if strings.Join(classicResp.TokenScopes, "|") != "repo|admin:repo_hook" {
		t.Fatalf("classic scopes = %#v", classicResp.TokenScopes)
	}

	fineGrained := newGitHubStub(t)
	fineGrained.scopes = ""
	w = connectGitHubForTest(t, fineGrained, map[string]any{
		"provider": "github", "instance_url": fineGrained.server.URL, "api_token": "github_pat_x",
		"token_type": "fine_grained",
		// A client may claim anything; the server records what it verified.
		"token_scopes": []string{"contents:write", "pull_requests:write"},
	})
	if w.Code != http.StatusOK {
		t.Fatalf("fine-grained connect: %d %s", w.Code, w.Body.String())
	}
	var fgResp VCSConnectResponse
	_ = json.Unmarshal(w.Body.Bytes(), &fgResp)
	if len(fgResp.TokenScopes) != 0 {
		t.Fatalf("fine-grained scopes = %#v; GitHub reported none, so none may be stored", fgResp.TokenScopes)
	}
	if fgResp.TokenType != "fine_grained" {
		t.Fatalf("token_type = %q", fgResp.TokenType)
	}
}

// A non-expiring token is a valid, if weaker, credential. Refusing it only
// pushes an operator toward pasting a fabricated date.
func TestConnectVCSAcceptsAnAbsentTokenExpiry(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	withVCSBox(t)
	stub := newGitHubStub(t)
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })

	w := connectGitHubForTest(t, stub, map[string]any{
		"provider": "github", "instance_url": stub.server.URL, "api_token": "ghp_test",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 without token_expires_at, got %d: %s", w.Code, w.Body.String())
	}
	var resp VCSConnectResponse
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.TokenExpiresAt != nil {
		t.Fatalf("token_expires_at = %v, want null", *resp.TokenExpiresAt)
	}
}

func TestConnectVCSRejectsAnExpiryInThePast(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	withVCSBox(t)
	stub := newGitHubStub(t)
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })

	w := connectGitHubForTest(t, stub, map[string]any{
		"provider": "github", "instance_url": stub.server.URL, "api_token": "ghp_test",
		"token_expires_at": "2020-01-01",
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a past expiry, got %d: %s", w.Code, w.Body.String())
	}
}

// The picker is provider-neutral: one shape, with GitLab's numeric access
// levels and GitHub's permission booleans both resolved to can_push here
// rather than in the UI.
func TestListVCSConnectionRepositoriesNormalizesGitHubRows(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	withVCSBox(t)
	stub := newGitHubStub(t)
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })

	w := connectGitHubForTest(t, stub, map[string]any{
		"provider": "github", "instance_url": stub.server.URL, "api_token": "ghp_test",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("connect: %d %s", w.Code, w.Body.String())
	}
	var conn VCSConnectResponse
	_ = json.Unmarshal(w.Body.Bytes(), &conn)

	req := vcsHandlerRequest(http.MethodGet,
		"/api/workspaces/"+testWorkspaceID+"/vcs/connections/"+conn.ID+"/repositories", nil, conn.ID)
	list := httptest.NewRecorder()
	testHandler.ListVCSConnectionRepositories(list, req)
	if list.Code != http.StatusOK {
		t.Fatalf("list repositories: %d %s", list.Code, list.Body.String())
	}
	var out struct {
		Repositories []VCSRepositoryResponse `json:"repositories"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(out.Repositories) != 1 {
		t.Fatalf("repositories = %#v", out.Repositories)
	}
	row := out.Repositories[0]
	if row.ID != "77" || row.FullName != "acme/widget" || row.DefaultBranch != "main" {
		t.Fatalf("row = %+v", row)
	}
	if !row.CanPush || row.Visibility != "private" {
		t.Fatalf("row permissions/visibility = %+v", row)
	}
}

// seedGitHubConnection stores a connection directly so binding tests do not
// depend on the connect path.
func seedGitHubConnection(t *testing.T, instanceURL, cloneHost string) string {
	t.Helper()
	apiEnc, err := testHandler.sealVCSSecret("api-token")
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	secretEnc, _ := testHandler.sealVCSSecret("hook-secret")
	conn, err := testHandler.Queries.UpsertVCSConnection(context.Background(), db.UpsertVCSConnectionParams{
		WorkspaceID:            parseUUID(testWorkspaceID),
		Provider:               "github",
		InstanceUrl:            instanceURL,
		AccountLogin:           "acme-bot",
		AccessTokenEncrypted:   apiEnc,
		GitTokenEncrypted:      apiEnc,
		WebhookSecretEncrypted: secretEnc,
		TokenType:              "fine_grained",
		TokenScopes:            []string{},
		CloneHost:              cloneHost,
	})
	if err != nil {
		t.Fatalf("UpsertVCSConnection: %v", err)
	}
	return uuidToString(conn.ID)
}

func adminResourceRequest(t *testing.T, method, path string, body any) *http.Request {
	t.Helper()
	req := newRequest(method, path, body)
	member, err := testHandler.Queries.GetMemberByUserAndWorkspace(req.Context(), db.GetMemberByUserAndWorkspaceParams{
		UserID: parseUUID(testUserID), WorkspaceID: parseUUID(testWorkspaceID),
	})
	if err != nil {
		t.Fatalf("GetMemberByUserAndWorkspace: %v", err)
	}
	return req.WithContext(middleware.SetMemberContext(req.Context(), testWorkspaceID, member))
}

// The repository URL always arrives as the provider API reported it. On a
// deployment whose Git traffic is fronted by a different hostname than its
// API — the only reason clone_host exists — the binding step must rewrite the
// remote rather than reject it, or the field is unusable for its one purpose.
func TestCodeRepositoryBindingRewritesTheRemoteToTheCloneHost(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	withVCSBox(t)
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })
	connID := seedGitHubConnection(t, "https://ghe-api.corp.example", "git.corp.example")

	ref, _ := json.Marshal(codeRepositoryRef{
		Provider: "github", ProviderConnectionID: connID, ProviderRepositoryID: "77",
		FullName: "acme/widget", URL: "https://ghe-api.corp.example/acme/widget.git",
		DefaultBranchHint: "main", Enabled: true,
	})
	req := adminResourceRequest(t, "POST", resourcesPath, nil)
	w := httptest.NewRecorder()
	bound, ok := testHandler.normalizeCodeRepositoryBinding(w, req, parseUUID(testWorkspaceID), ref)
	if !ok {
		t.Fatalf("binding rejected: %d %s", w.Code, w.Body.String())
	}
	var out codeRepositoryRef
	if err := json.Unmarshal(bound, &out); err != nil {
		t.Fatalf("decode bound ref: %v", err)
	}
	if out.URL != "https://git.corp.example/acme/widget.git" {
		t.Fatalf("rewritten URL = %q, want the clone host", out.URL)
	}
	// Everything else must survive the rewrite untouched.
	if out.ProviderRepositoryID != "77" || out.FullName != "acme/widget" || !out.Enabled {
		t.Fatalf("rewrite lost ref fields: %+v", out)
	}
}

func TestCodeRepositoryBindingLeavesAMatchingHostAlone(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	withVCSBox(t)
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })
	connID := seedGitHubConnection(t, "https://ghe.corp.example", "ghe.corp.example")

	ref, _ := json.Marshal(codeRepositoryRef{
		Provider: "github", ProviderConnectionID: connID, ProviderRepositoryID: "77",
		FullName: "acme/widget", URL: "https://ghe.corp.example/acme/widget.git", Enabled: true,
	})
	req := adminResourceRequest(t, "POST", resourcesPath, nil)
	w := httptest.NewRecorder()
	bound, ok := testHandler.normalizeCodeRepositoryBinding(w, req, parseUUID(testWorkspaceID), ref)
	if !ok {
		t.Fatalf("binding rejected: %d %s", w.Code, w.Body.String())
	}
	var out codeRepositoryRef
	_ = json.Unmarshal(bound, &out)
	if out.URL != "https://ghe.corp.example/acme/widget.git" {
		t.Fatalf("URL = %q, want it unchanged", out.URL)
	}
}

// A ref naming a connection in another workspace must not bind, whichever
// table the id belongs to.
func TestCodeRepositoryBindingRejectsAForeignConnection(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	withVCSBox(t)
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })

	ref, _ := json.Marshal(codeRepositoryRef{
		Provider: "github", ProviderConnectionID: "00000000-0000-0000-0000-0000000000ff",
		FullName: "acme/widget", URL: "https://ghe.corp.example/acme/widget.git", Enabled: true,
	})
	req := adminResourceRequest(t, "POST", resourcesPath, nil)
	w := httptest.NewRecorder()
	if _, ok := testHandler.normalizeCodeRepositoryBinding(w, req, parseUUID(testWorkspaceID), ref); ok {
		t.Fatal("a connection id from no workspace must not bind")
	}
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

// A pending row is stored disabled on purpose so an upgrade never drops data;
// it must not be held to the binding rules an enabled row is.
func TestCodeRepositoryBindingAcceptsPendingRowsUnchanged(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ref, _ := json.Marshal(codeRepositoryRef{
		Provider: "github", FullName: "legacy/repo", URL: "https://github.com/legacy/repo.git", Enabled: false,
	})
	req := adminResourceRequest(t, "POST", resourcesPath, nil)
	w := httptest.NewRecorder()
	bound, ok := testHandler.normalizeCodeRepositoryBinding(w, req, parseUUID(testWorkspaceID), ref)
	if !ok {
		t.Fatalf("a disabled row must bind: %d %s", w.Code, w.Body.String())
	}
	if string(bound) != string(ref) {
		t.Fatalf("a disabled row must pass through unchanged, got %s", bound)
	}
}
