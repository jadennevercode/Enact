package vcs

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// GitHub.com serves its API from a separate hostname while Enterprise Server
// mounts it under /api/v3 on the instance itself. Getting this wrong points
// every enterprise call at a path that does not exist.
func TestGitHubAPIBaseSeparatesDotComFromEnterprise(t *testing.T) {
	cases := []struct {
		instance string
		want     string
	}{
		{"https://github.com", "https://api.github.com"},
		{"https://github.com/", "https://api.github.com"},
		{"https://www.github.com", "https://api.github.com"},
		{"https://api.github.com", "https://api.github.com"},
		{"", "https://api.github.com"},
		{"https://ghe.corp.example", "https://ghe.corp.example/api/v3"},
		{"https://ghe.corp.example/", "https://ghe.corp.example/api/v3"},
		{"https://git.corp.example:8443", "https://git.corp.example:8443/api/v3"},
	}
	for _, tc := range cases {
		if got := GitHubAPIBase(tc.instance); got != tc.want {
			t.Errorf("GitHubAPIBase(%q) = %q, want %q", tc.instance, got, tc.want)
		}
	}
}

func TestIsGitHubDotCom(t *testing.T) {
	for _, instance := range []string{"https://github.com", "https://www.github.com/", "https://api.github.com"} {
		if !IsGitHubDotCom(instance) {
			t.Errorf("IsGitHubDotCom(%q) = false, want true", instance)
		}
	}
	for _, instance := range []string{"https://ghe.corp.example", "https://github.com.evil.example", ""} {
		if IsGitHubDotCom(instance) {
			t.Errorf("IsGitHubDotCom(%q) = true, want false", instance)
		}
	}
}

// A classic token announces its scopes in a header. A fine-grained one does
// not, and reporting that as "no scopes" would make a perfectly good
// credential look unusable — the distinction is what FineGrained records.
func TestInspectGitHubTokenSeparatesFineGrainedFromClassic(t *testing.T) {
	withScopes := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v3/user" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer classic-token" {
			t.Errorf("authorization = %q", got)
		}
		w.Header().Set("X-OAuth-Scopes", "repo, admin:repo_hook, read:org")
		_, _ = w.Write([]byte(`{"login":"octo-admin"}`))
	}))
	defer withScopes.Close()

	metadata, err := InspectGitHubToken(context.Background(), withScopes.Client(), withScopes.URL, "classic-token")
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Login != "octo-admin" {
		t.Fatalf("login = %q", metadata.Login)
	}
	if metadata.FineGrained {
		t.Fatal("a token that reports scopes must not be classified fine-grained")
	}
	if strings.Join(metadata.Scopes, "|") != "repo|admin:repo_hook|read:org" {
		t.Fatalf("scopes = %#v", metadata.Scopes)
	}

	noScopes := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"login":"octo-fg"}`))
	}))
	defer noScopes.Close()

	metadata, err = InspectGitHubToken(context.Background(), noScopes.Client(), noScopes.URL, "fg-token")
	if err != nil {
		t.Fatal(err)
	}
	if !metadata.FineGrained || len(metadata.Scopes) != 0 {
		t.Fatalf("fine-grained token metadata = %#v", metadata)
	}
}

// 401 and 403 need different remedies: replace the token versus authorize the
// one you have (SAML SSO, or a missing repository permission).
func TestInspectGitHubTokenClassifiesRejectionFromRefusal(t *testing.T) {
	for status, want := range map[int]error{
		http.StatusUnauthorized: ErrUnauthorized,
		http.StatusForbidden:    ErrForbidden,
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(status) }))
		_, err := InspectGitHubToken(context.Background(), server.Client(), server.URL, "token")
		if !errors.Is(err, want) {
			t.Errorf("status %d: err = %v, want %v", status, err, want)
		}
		server.Close()
	}
}

func TestListGitHubRepositoriesNormalizesPushPermissionAndPaging(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v3/user/repos" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("affiliation"); got != "owner,collaborator,organization_member" {
			t.Errorf("affiliation = %q", got)
		}
		_, _ = w.Write([]byte(`[
			{"id":1,"full_name":"acme/widget","clone_url":"https://github.com/acme/widget.git","private":true,"default_branch":"main","permissions":{"push":true}},
			{"id":2,"full_name":"acme/readonly","clone_url":"https://github.com/acme/readonly.git","private":false,"default_branch":"main","permissions":{"push":false}}
		]`))
	}))
	defer server.Close()

	page, err := ListGitHubRepositories(context.Background(), server.Client(), server.URL, "token", "", 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Repositories) != 2 {
		t.Fatalf("repositories = %#v", page.Repositories)
	}
	if !page.Repositories[0].Permissions.Push || page.Repositories[1].Permissions.Push {
		t.Fatalf("push permissions = %#v", page.Repositories)
	}
	// A full page implies another may follow.
	if page.NextPage == nil || *page.NextPage != 2 {
		t.Fatalf("next page = %#v", page.NextPage)
	}
}

func TestListGitHubRepositoriesFiltersBySearchTerm(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`[
			{"id":1,"full_name":"acme/payments-service"},
			{"id":2,"full_name":"acme/billing"}
		]`))
	}))
	defer server.Close()

	page, err := ListGitHubRepositories(context.Background(), server.Client(), server.URL, "token", "PAYMENTS", 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Repositories) != 1 || page.Repositories[0].FullName != "acme/payments-service" {
		t.Fatalf("filtered repositories = %#v", page.Repositories)
	}
}

// GitHub hides a repository the credential cannot see behind 404 rather than
// 403, so both must read as "no access" and neither as a transport failure.
func TestProbeGitHubRepositoryAccessTreatsHiddenRepositoryAsForbidden(t *testing.T) {
	for _, status := range []int{http.StatusForbidden, http.StatusNotFound} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(status) }))
		read, push, err := ProbeGitHubRepositoryAccess(context.Background(), server.Client(), server.URL, "token", "acme/secret")
		if !errors.Is(err, ErrForbidden) || read || push {
			t.Errorf("status %d: read=%v push=%v err=%v", status, read, push, err)
		}
		server.Close()
	}
}

func TestProbeGitHubRepositoryAccessReportsPushSeparatelyFromRead(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v3/repos/acme/widget" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"id":1,"full_name":"acme/widget","permissions":{"push":false,"admin":false}}`))
	}))
	defer server.Close()

	read, push, err := ProbeGitHubRepositoryAccess(context.Background(), server.Client(), server.URL, "token", "acme/widget")
	if err != nil {
		t.Fatal(err)
	}
	if !read || push {
		t.Fatalf("read=%v push=%v; a readable repository the token cannot push to must report exactly that", read, push)
	}
}

func TestGitHubVerifySignature(t *testing.T) {
	body := []byte(`{"action":"opened"}`)
	provider := githubProvider{}

	header := http.Header{}
	header.Set("X-Hub-Signature-256", "sha256=6b3a0fc42a3ac8a9d0ca1e4fdcbd0b4e4d5cda7d36ad3b2e14b1b9c8f0d25ba0")
	if provider.VerifySignature("", header, body) {
		t.Fatal("an empty stored secret must never validate")
	}

	// Round-trip through the real registration path: sign with the same
	// algorithm GitHub uses and confirm acceptance, then confirm a body edit
	// breaks it.
	signed := gitHubTestSignature(t, "hook-secret", body)
	header.Set("X-Hub-Signature-256", signed)
	if !provider.VerifySignature("hook-secret", header, body) {
		t.Fatal("a correctly signed body must validate")
	}
	if provider.VerifySignature("hook-secret", header, append(body, ' ')) {
		t.Fatal("a modified body must not validate")
	}
	header.Set("X-Hub-Signature-256", strings.TrimPrefix(signed, "sha256="))
	if provider.VerifySignature("hook-secret", header, body) {
		t.Fatal("a signature without the sha256= prefix must not validate")
	}
}

func TestGitHubEventKindIgnoresCheckSuite(t *testing.T) {
	provider := githubProvider{}
	cases := map[string]EventKind{
		"pull_request": EventPullRequest,
		"check_run":    EventCIStatus,
		"status":       EventCIStatus,
		// A suite carries no conclusion until its runs finish; recording it
		// would write a pending status the matching check_run supersedes.
		"check_suite": EventOther,
		"push":        EventOther,
	}
	for event, want := range cases {
		header := http.Header{}
		header.Set("X-GitHub-Event", event)
		if got := provider.EventKind(header); got != want {
			t.Errorf("EventKind(%s) = %v, want %v", event, got, want)
		}
	}
}

func TestGitHubParsePullRequestDerivesMergedFromTimestamp(t *testing.T) {
	// A closed-then-merged redelivery can carry merged_at without merged:true.
	body := []byte(`{
		"action":"closed",
		"repository":{"full_name":"acme/widget"},
		"pull_request":{
			"number":7,"title":"ENA-1 ship it","state":"closed",
			"merged_at":"2026-05-01T10:00:00Z",
			"html_url":"https://github.com/acme/widget/pull/7",
			"head":{"ref":"feat","sha":"cafebabe"},
			"user":{"login":"octo"},
			"created_at":"2026-04-30T10:00:00Z","updated_at":"2026-05-01T10:00:00Z"
		}
	}`)
	event, err := githubProvider{}.ParsePullRequest(body)
	if err != nil {
		t.Fatal(err)
	}
	if event.State != "merged" {
		t.Fatalf("state = %q, want merged", event.State)
	}
	if event.RepoOwner != "acme" || event.RepoName != "widget" || event.Number != 7 {
		t.Fatalf("identity = %s/%s#%d", event.RepoOwner, event.RepoName, event.Number)
	}
	if event.HeadSHA != "cafebabe" || event.Branch != "feat" {
		t.Fatalf("head = %s@%s", event.Branch, event.HeadSHA)
	}
	if !event.Terminal() {
		t.Fatal("a closed action must be terminal")
	}
}

func TestGitHubParseCIStatusHandlesBothPayloadShapes(t *testing.T) {
	checkRun := []byte(`{
		"repository":{"full_name":"acme/widget"},
		"check_run":{"name":"build","head_sha":"deadbeef","status":"completed","conclusion":"success",
			"html_url":"https://github.com/acme/widget/runs/1","completed_at":"2026-05-01T10:00:00Z"}
	}`)
	event, err := githubProvider{}.ParseCIStatus(checkRun)
	if err != nil {
		t.Fatal(err)
	}
	if event.SHA != "deadbeef" || event.Context != "build" || event.State != "passed" {
		t.Fatalf("check_run event = %#v", event)
	}

	commitStatus := []byte(`{
		"repository":{"full_name":"acme/widget"},
		"sha":"feedface","context":"ci/lint","state":"failure",
		"target_url":"https://ci.example/1","updated_at":"2026-05-01T11:00:00Z"
	}`)
	event, err = githubProvider{}.ParseCIStatus(commitStatus)
	if err != nil {
		t.Fatal(err)
	}
	if event.SHA != "feedface" || event.Context != "ci/lint" || event.State != "failed" {
		t.Fatalf("status event = %#v", event)
	}
}

func TestNormalizeGitHubCheckRunState(t *testing.T) {
	cases := []struct {
		status, conclusion, want string
	}{
		{"in_progress", "", "pending"},
		{"queued", "", "pending"},
		{"completed", "success", "passed"},
		// GitHub's own merge gate counts these as satisfied.
		{"completed", "neutral", "passed"},
		{"completed", "skipped", "passed"},
		// Each of these leaves the commit unverified.
		{"completed", "failure", "failed"},
		{"completed", "cancelled", "failed"},
		{"completed", "timed_out", "failed"},
		{"completed", "action_required", "failed"},
	}
	for _, tc := range cases {
		if got := normalizeGitHubCheckRunState(tc.status, tc.conclusion); got != tc.want {
			t.Errorf("normalizeGitHubCheckRunState(%q,%q) = %q, want %q", tc.status, tc.conclusion, got, tc.want)
		}
	}
}

// Attaching a repository twice, or rotating the webhook secret, must not leave
// the repository fanning out duplicate deliveries.
func TestEnsureGitHubRepositoryWebhookUpdatesTheExistingHook(t *testing.T) {
	var method, path string
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`[{"id":99,"config":{"url":"https://enact.example/api/webhooks/vcs/c1"}}]`))
			return
		}
		method, path = r.Method, r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &payload)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":99}`))
	}))
	defer server.Close()

	err := EnsureGitHubRepositoryWebhook(context.Background(), server.Client(), server.URL,
		"token", "acme/widget", "https://enact.example/api/webhooks/vcs/c1", "hook-secret")
	if err != nil {
		t.Fatal(err)
	}
	if method != http.MethodPatch || path != "/api/v3/repos/acme/widget/hooks/99" {
		t.Fatalf("expected a PATCH of the existing hook, got %s %s", method, path)
	}
	config, _ := payload["config"].(map[string]any)
	if config["secret"] != "hook-secret" || config["content_type"] != "json" {
		t.Fatalf("hook config = %#v", config)
	}
}

func TestEnsureGitHubRepositoryWebhookCreatesWhenAbsent(t *testing.T) {
	var method string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`[{"id":1,"config":{"url":"https://other.example/hook"}}]`))
			return
		}
		method = r.Method
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":5}`))
	}))
	defer server.Close()

	if err := EnsureGitHubRepositoryWebhook(context.Background(), server.Client(), server.URL,
		"token", "acme/widget", "https://enact.example/api/webhooks/vcs/c1", "s"); err != nil {
		t.Fatal(err)
	}
	if method != http.MethodPost {
		t.Fatalf("expected POST to create a hook, got %s", method)
	}
}

// A token deliberately scoped without webhook permission is still a usable
// credential. Registration must say so distinctly so the caller can fall back
// to asking the operator instead of failing the connection.
func TestEnsureRepositoryWebhookReportsForbiddenDistinctly(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()

	err := EnsureGitHubRepositoryWebhook(context.Background(), server.Client(), server.URL, "t", "acme/widget", "https://e/x", "s")
	if !errors.Is(err, ErrWebhookRegistrationForbidden) {
		t.Fatalf("github err = %v, want ErrWebhookRegistrationForbidden", err)
	}
	err = EnsureGitLabProjectWebhook(context.Background(), server.Client(), server.URL, "t", "42", "https://e/x", "s")
	if !errors.Is(err, ErrWebhookRegistrationForbidden) {
		t.Fatalf("gitlab err = %v, want ErrWebhookRegistrationForbidden", err)
	}
}

func TestEnsureGitLabProjectWebhookSubscribesToTheEventsEnactConsumes(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`[]`))
			return
		}
		if r.URL.Path != "/api/v4/projects/42/hooks" {
			t.Errorf("path = %s", r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &payload)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":7}`))
	}))
	defer server.Close()

	if err := EnsureGitLabProjectWebhook(context.Background(), server.Client(), server.URL,
		"token", "42", "https://enact.example/api/webhooks/vcs/c1", "hook-secret"); err != nil {
		t.Fatal(err)
	}
	if payload["merge_requests_events"] != true || payload["pipeline_events"] != true {
		t.Fatalf("hook must subscribe to merge request and pipeline events, got %#v", payload)
	}
	if payload["push_events"] != false {
		t.Fatal("hook must not subscribe to push events, which the mirror discards")
	}
	if payload["token"] != "hook-secret" || payload["enable_ssl_verification"] != true {
		t.Fatalf("hook auth/TLS = %#v", payload)
	}
}

// gitHubTestSignature signs a body the way GitHub does, so the verification
// test exercises the real algorithm rather than a hand-copied constant.
func gitHubTestSignature(t *testing.T, secret string, body []byte) string {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}
