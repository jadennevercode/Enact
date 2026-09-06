package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"
)

func newRepoRegistryTestCmd(serverURL string) *cobra.Command {
	cmd := &cobra.Command{Use: "repo-test"}
	cmd.Flags().String("server-url", "", "")
	cmd.Flags().String("workspace-id", "", "")
	cmd.Flags().String("profile", "", "")
	cmd.Flags().StringArray("url", nil, "")
	cmd.Flags().String("description", "", "")
	cmd.Flags().String("output", "json", "")
	_ = cmd.Flags().Set("server-url", serverURL)
	_ = cmd.Flags().Set("workspace-id", "ws-1")
	// The repo commands reach the API through cmd.Context(); cobra only fills
	// it in during Execute, which these tests bypass.
	cmd.SetContext(context.Background())
	return cmd
}

// resourceRow is the shape `GET /api/resources` returns for one row; the repo
// commands are a view over those, so the fake server speaks resources.
func resourceRow(id, url, label string) map[string]any {
	row := map[string]any{
		"id":            id,
		"resource_type": "github_repo",
		"resource_ref":  map[string]any{"url": url},
	}
	if label != "" {
		row["label"] = label
	}
	return row
}

// repoResourceServer serves a mutable resource list and records the writes the
// command makes against it.
type repoResourceServer struct {
	rows    []map[string]any
	posted  []map[string]any
	puts    map[string]map[string]any
	deleted []string
}

func newRepoResourceServer(t *testing.T, rows ...map[string]any) (*httptest.Server, *repoResourceServer) {
	t.Helper()
	state := &repoResourceServer{rows: rows, puts: map[string]map[string]any{}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		decode := func() map[string]any {
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode %s %s: %v", r.Method, r.URL.Path, err)
			}
			return body
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/resources":
			json.NewEncoder(w).Encode(map[string]any{"resources": state.rows})
		case r.Method == http.MethodPost && r.URL.Path == "/api/resources":
			body := decode()
			state.posted = append(state.posted, body)
			json.NewEncoder(w).Encode(map[string]any{"id": "new-resource"})
		case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/resources/"):
			state.puts[strings.TrimPrefix(r.URL.Path, "/api/resources/")] = decode()
			json.NewEncoder(w).Encode(map[string]any{"id": "updated"})
		case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/api/resources/"):
			state.deleted = append(state.deleted, strings.TrimPrefix(r.URL.Path, "/api/resources/"))
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, state
}

func TestRunRepoAddAttachesOnlyTheRepositoriesNotAlreadyThere(t *testing.T) {
	srv, state := newRepoResourceServer(t,
		resourceRow("r-web", "https://git.example.com/web.git", ""))

	cmd := newRepoRegistryTestCmd(srv.URL)
	// Already attached, so it must not be posted again.
	if err := cmd.Flags().Set("url", "https://git.example.com/web.git"); err != nil {
		t.Fatal(err)
	}
	// The same new URL twice: the command de-duplicates its own input.
	if err := runRepoAdd(cmd, []string{
		"https://git.example.com/api.git",
		"https://git.example.com/api.git",
	}); err != nil {
		t.Fatalf("runRepoAdd: %v", err)
	}

	if len(state.posted) != 1 {
		t.Fatalf("expected exactly one POST, got %d: %v", len(state.posted), state.posted)
	}
	ref, _ := state.posted[0]["resource_ref"].(map[string]any)
	if got := ref["url"]; got != "https://git.example.com/api.git" {
		t.Errorf("posted url = %v, want the new repository", got)
	}
	if got := state.posted[0]["resource_type"]; got != "github_repo" {
		t.Errorf("resource_type = %v, want github_repo", got)
	}
}

func TestRunRepoAddSetsTheDescriptionOfAnAlreadyAttachedRepository(t *testing.T) {
	srv, state := newRepoResourceServer(t,
		resourceRow("r-web", "https://git.example.com/web.git", "old"))

	cmd := newRepoRegistryTestCmd(srv.URL)
	if err := cmd.Flags().Set("description", "new"); err != nil {
		t.Fatal(err)
	}
	if err := runRepoAdd(cmd, []string{"https://git.example.com/web.git"}); err != nil {
		t.Fatalf("runRepoAdd: %v", err)
	}

	if len(state.posted) != 0 {
		t.Fatalf("an attached repository must not be re-posted: %v", state.posted)
	}
	// The description lives in the resource's label.
	if got := state.puts["r-web"]["label"]; got != "new" {
		t.Errorf("PUT label = %v, want the new description", got)
	}
}

func TestRunRepoAddRejectsOneDescriptionForSeveralRepositories(t *testing.T) {
	srv, state := newRepoResourceServer(t)

	cmd := newRepoRegistryTestCmd(srv.URL)
	if err := cmd.Flags().Set("description", "shared"); err != nil {
		t.Fatal(err)
	}
	err := runRepoAdd(cmd, []string{
		"https://git.example.com/api.git",
		"https://git.example.com/web.git",
	})
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
	if !strings.Contains(err.Error(), "single repository") {
		t.Errorf("error = %v, want it to explain the single-repository rule", err)
	}
	if len(state.posted) != 0 {
		t.Errorf("nothing may be written when the request is rejected: %v", state.posted)
	}
}

func TestRunRepoRemoveDeletesTheResourceBehindTheURL(t *testing.T) {
	srv, state := newRepoResourceServer(t,
		resourceRow("r-web", "https://git.example.com/web.git", ""),
		resourceRow("r-api", "https://git.example.com/api.git", ""))

	cmd := newRepoRegistryTestCmd(srv.URL)
	if err := runRepoRemove(cmd, []string{"https://git.example.com/api.git"}); err != nil {
		t.Fatalf("runRepoRemove: %v", err)
	}

	if len(state.deleted) != 1 || state.deleted[0] != "r-api" {
		t.Fatalf("deleted = %v, want just the api repository's resource id", state.deleted)
	}
}

func TestRunRepoRemoveReportsAnUnattachedURLAndTouchesNothing(t *testing.T) {
	srv, state := newRepoResourceServer(t,
		resourceRow("r-web", "https://git.example.com/web.git", ""))

	cmd := newRepoRegistryTestCmd(srv.URL)
	err := runRepoRemove(cmd, []string{"https://git.example.com/missing.git"})
	if err == nil {
		t.Fatal("expected an error naming the URL that is not attached")
	}
	if !strings.Contains(err.Error(), "missing.git") {
		t.Errorf("error = %v, want it to name the missing repository", err)
	}
	if len(state.deleted) != 0 {
		t.Errorf("nothing may be deleted: %v", state.deleted)
	}
}

// Only github_repo resources are repositories; a local directory sharing the
// workspace must not show up in `enact repo list` or be removable through it.
func TestRepoCommandsIgnoreNonRepositoryResources(t *testing.T) {
	srv, state := newRepoResourceServer(t,
		map[string]any{
			"id":            "r-dir",
			"resource_type": "local_directory",
			"resource_ref":  map[string]any{"daemon_id": "d1", "path": "/tmp/x"},
		},
		resourceRow("r-web", "https://git.example.com/web.git", ""))

	client, err := newAPIClient(newRepoRegistryTestCmd(srv.URL))
	if err != nil {
		t.Fatal(err)
	}
	repos, err := listRepoResources(t.Context(), client)
	if err != nil {
		t.Fatalf("listRepoResources: %v", err)
	}
	if len(repos) != 1 || repos[0].URL != "https://git.example.com/web.git" {
		t.Fatalf("repos = %+v, want only the github_repo row", repos)
	}
	if len(state.deleted) != 0 {
		t.Errorf("listing must not write: %v", state.deleted)
	}
}

func TestRunRepoCheckoutForwardsManagedCheckoutMode(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/repo/checkout" {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode checkout body: %v", err)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer mat_repo_checkout_test" {
			t.Fatalf("Authorization = %q, want task-scoped bearer", got)
		}
		json.NewEncoder(w).Encode(map[string]string{
			"path":        "/work/repo",
			"branch_name": "agent/test/task",
		})
	}))
	defer srv.Close()

	t.Setenv("ENACT_DAEMON_PORT", strings.TrimPrefix(srv.URL, "http://127.0.0.1:"))
	t.Setenv("ENACT_WORKSPACE_ID", "ws-1")
	t.Setenv("ENACT_AGENT_NAME", "Test Agent")
	t.Setenv("ENACT_TASK_ID", "task-1")
	t.Setenv("ENACT_TOKEN", "mat_repo_checkout_test")
	t.Setenv("ENACT_REPO_CHECKOUT_MODE", "isolated")

	previousRef := repoCheckoutRef
	repoCheckoutRef = "release/v2"
	defer func() { repoCheckoutRef = previousRef }()

	if err := runRepoCheckout(&cobra.Command{}, []string{"https://github.com/org/repo.git"}); err != nil {
		t.Fatalf("runRepoCheckout: %v", err)
	}
	if got := body["checkout_mode"]; got != "isolated" {
		t.Fatalf("checkout_mode = %q, want isolated", got)
	}
	if got := body["ref"]; got != "release/v2" {
		t.Fatalf("ref = %q, want release/v2", got)
	}
	if got := body["retry_busy"]; got != true {
		t.Fatalf("retry_busy = %v, want true", got)
	}
}

func TestRunRepoCheckoutRequiresTaskCredential(t *testing.T) {
	t.Setenv("ENACT_DAEMON_PORT", "12345")
	t.Setenv("ENACT_TOKEN", "")

	err := runRepoCheckout(&cobra.Command{}, []string{"https://github.com/org/repo.git"})
	if err == nil || !strings.Contains(err.Error(), "ENACT_TOKEN not set") {
		t.Fatalf("runRepoCheckout error = %v, want missing task credential", err)
	}
}

func TestRunRepoCheckoutRetriesServiceUnavailable(t *testing.T) {
	attempts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts == 1 {
			w.Header().Set("X-Enact-Retryable", "repo-busy")
			w.Header().Set("Retry-After", "0")
			http.Error(w, "repository busy", http.StatusServiceUnavailable)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{
			"path":        "/work/repo",
			"branch_name": "agent/test/task",
		})
	}))
	defer srv.Close()

	t.Setenv("ENACT_DAEMON_PORT", strings.TrimPrefix(srv.URL, "http://127.0.0.1:"))
	t.Setenv("ENACT_WORKSPACE_ID", "ws-1")
	t.Setenv("ENACT_AGENT_NAME", "Test Agent")
	t.Setenv("ENACT_TASK_ID", "task-1")
	t.Setenv("ENACT_TOKEN", "mat_repo_checkout_test")

	if err := runRepoCheckout(&cobra.Command{}, []string{"https://github.com/org/repo.git"}); err != nil {
		t.Fatalf("runRepoCheckout: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("checkout attempts = %d, want 2", attempts)
	}
}

func TestRunRepoCheckoutDoesNotRetryUnmarkedServiceUnavailable(t *testing.T) {
	attempts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		http.Error(w, "daemon unavailable", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	t.Setenv("ENACT_DAEMON_PORT", strings.TrimPrefix(srv.URL, "http://127.0.0.1:"))
	t.Setenv("ENACT_TOKEN", "mat_repo_checkout_test")
	if err := runRepoCheckout(&cobra.Command{}, []string{"https://github.com/org/repo.git"}); err == nil {
		t.Fatal("runRepoCheckout unexpectedly succeeded")
	}
	if attempts != 1 {
		t.Fatalf("checkout attempts = %d, want 1", attempts)
	}
}

func TestRepoCheckoutRetryDelay(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 12, 0, 0, 0, 0, time.UTC)
	if got := repoCheckoutRetryDelay("7", now); got != 7*time.Second {
		t.Fatalf("seconds delay = %s, want 7s", got)
	}
	if got := repoCheckoutRetryDelay(now.Add(time.Minute).Format(http.TimeFormat), now); got != 30*time.Second {
		t.Fatalf("capped date delay = %s, want 30s", got)
	}
	if got := repoCheckoutRetryDelay("invalid", now); got != time.Second {
		t.Fatalf("default delay = %s, want 1s", got)
	}
}
