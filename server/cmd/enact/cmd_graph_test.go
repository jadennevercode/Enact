package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/cli"
)

// newGraphTestCmd builds a command carrying the flags the graph helpers read,
// pointed at a fake server. Execute() is bypassed, so the context is set here.
func newGraphTestCmd(serverURL string) *cobra.Command {
	cmd := &cobra.Command{Use: "graph-test"}
	cmd.Flags().String("server-url", "", "")
	cmd.Flags().String("workspace-id", "", "")
	cmd.Flags().String("profile", "", "")
	_ = cmd.Flags().Set("server-url", serverURL)
	_ = cmd.Flags().Set("workspace-id", "ws-1")
	cmd.SetContext(context.Background())
	return cmd
}

// graphResourceServer serves a resource list so the repository resolver has
// something to match against.
func graphResourceServer(t *testing.T, resources ...map[string]any) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/resources" {
			_ = json.NewEncoder(w).Encode(map[string]any{"resources": resources})
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func graphRepoResource(id, url string, codeGraph bool) map[string]any {
	ref := map[string]any{"url": url}
	if codeGraph {
		ref["code_graph"] = true
	}
	return map[string]any{"id": id, "resource_type": "github_repo", "resource_ref": ref}
}

// TestResolveGraphResourceMatchesNormalizedURL: the three ways to write a
// GitHub remote all resolve to the same workspace resource.
func TestResolveGraphResourceMatchesNormalizedURL(t *testing.T) {
	srv := graphResourceServer(t, graphRepoResource("res-1", "https://github.com/acme/backend.git", true))
	client := cli.NewAPIClient(srv.URL, "ws-1", "token")

	for _, spelling := range []string{
		"https://github.com/acme/backend",
		"https://github.com/acme/backend.git",
		"git@github.com:acme/backend.git",
		"ssh://git@github.com/acme/backend",
	} {
		t.Run(spelling, func(t *testing.T) {
			graphRepoFlag = spelling
			t.Cleanup(func() { graphRepoFlag = "" })
			id, err := resolveGraphResource(context.Background(), client)
			if err != nil {
				t.Fatalf("resolve %s: %v", spelling, err)
			}
			if id != "res-1" {
				t.Errorf("id = %q, want res-1", id)
			}
		})
	}
}

// TestResolveGraphResourceRefusals: each refusal names what the caller can do
// about it, and all of them are the soft outcome rather than a hard error.
func TestResolveGraphResourceRefusals(t *testing.T) {
	srv := graphResourceServer(t,
		graphRepoResource("res-off", "https://github.com/acme/off", false),
		graphRepoResource("res-on", "https://github.com/acme/on", true),
	)
	client := cli.NewAPIClient(srv.URL, "ws-1", "token")

	cases := map[string]struct{ repo, want string }{
		"opted out":    {"https://github.com/acme/off", "code graph is not enabled"},
		"not a member": {"https://github.com/acme/elsewhere", "not a repository of this workspace"},
		"not a URL":    {"nonsense", "is not a repository URL"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			graphRepoFlag = tc.repo
			t.Cleanup(func() { graphRepoFlag = "" })
			_, err := resolveGraphResource(context.Background(), client)
			var soft *errGraphUnavailable
			if !errors.As(err, &soft) {
				t.Fatalf("err = %v, want errGraphUnavailable", err)
			}
			if !strings.Contains(soft.Error(), tc.want) {
				t.Errorf("reason = %q, want it to mention %q", soft.Error(), tc.want)
			}
		})
	}
}

// TestGraphUnavailableIfExpected maps the API's three "no graph" answers onto
// the soft outcome, and leaves everything else alone.
func TestGraphUnavailableIfExpected(t *testing.T) {
	soft := map[int]string{
		404: "no code graph",
		409: "not built yet",
		503: "no code graph service",
	}
	for status, want := range soft {
		err := graphUnavailableIfExpected(&cli.HTTPError{StatusCode: status, Method: "GET", Path: "/x"})
		var unavailable *errGraphUnavailable
		if !errors.As(err, &unavailable) {
			t.Fatalf("status %d: err = %v, want errGraphUnavailable", status, err)
		}
		if !strings.Contains(unavailable.Error(), want) {
			t.Errorf("status %d: reason = %q, want %q", status, unavailable.Error(), want)
		}
	}

	hard := &cli.HTTPError{StatusCode: 500, Method: "GET", Path: "/x"}
	var unavailable *errGraphUnavailable
	if errors.As(graphUnavailableIfExpected(hard), &unavailable) {
		t.Error("a 500 must stay a hard error")
	}
	if graphUnavailableIfExpected(nil) != nil {
		t.Error("nil must stay nil")
	}
}

// TestFormatGraphStatus pins the one line an agent branches on. The queued
// and building lines carry the instruction not to wait, because waiting is
// the failure this wording exists to prevent.
func TestFormatGraphStatus(t *testing.T) {
	cases := []struct {
		name   string
		status map[string]any
		want   []string
	}{
		{"disabled", map[string]any{"enabled": false}, []string{"not enabled"}},
		{"no build yet", map[string]any{"enabled": true}, []string{"queued"}},
		{"building", map[string]any{
			"enabled": true, "build": map[string]any{"state": "building"},
		}, []string{"building", "do not wait"}},
		{"ready", map[string]any{
			"enabled": true,
			"build": map[string]any{
				"state": "ready", "commit": "a1b2c3d4e5f6",
				"stats": map[string]any{"files": 12.0, "nodes": 40.0, "edges": 90.0, "communities": 3.0},
			},
		}, []string{"ready at a1b2c3d4", "12 files", "3 subsystems"}},
		{"stale", map[string]any{
			"enabled": true, "stale": true,
			"build": map[string]any{"state": "ready", "commit": "abcdef1234"},
		}, []string{"ready", "stale"}},
		{"skipped", map[string]any{
			"enabled": true,
			"build":   map[string]any{"state": "skipped", "skipped_reason": "too_large"},
		}, []string{"skipped", "too_large"}},
		{"failed", map[string]any{
			"enabled": true,
			"build":   map[string]any{"state": "failed", "error": "clone_failed"},
		}, []string{"failed", "clone_failed"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := formatGraphStatus(tc.status)
			for _, want := range tc.want {
				if !strings.Contains(got, want) {
					t.Errorf("status line = %q, want it to mention %q", got, want)
				}
			}
		})
	}
}

// TestGraphCommandsExitTwoWhenUnavailable: the soft outcome must reach main
// through RunE, so the process exits 2 instead of printing a stack.
func TestGraphCommandsExitTwoWhenUnavailable(t *testing.T) {
	srv := graphResourceServer(t)
	cmd := newGraphTestCmd(srv.URL)
	cmd.Flags().Bool("json", false, "")

	graphRepoFlag = "https://github.com/acme/absent"
	t.Cleanup(func() { graphRepoFlag = "" })

	var soft *errGraphUnavailable
	if err := runGraphStatus(cmd, nil); !errors.As(err, &soft) {
		t.Fatalf("runGraphStatus err = %v, want errGraphUnavailable", err)
	}
	if graphUnavailableExitCode != 2 {
		t.Errorf("exit code = %d, want 2", graphUnavailableExitCode)
	}
}

// TestGraphNoRepositoryAnywhere: with no flag and no origin remote the
// message names both ways out.
func TestGraphNoRepositoryAnywhere(t *testing.T) {
	srv := graphResourceServer(t)
	client := cli.NewAPIClient(srv.URL, "ws-1", "token")
	graphRepoFlag = ""
	// A directory that is not a repository: `git config` there finds no
	// origin, which is the same signal as having no git at all.
	t.Chdir(t.TempDir())

	_, err := resolveGraphResource(context.Background(), client)
	var soft *errGraphUnavailable
	if !errors.As(err, &soft) {
		t.Fatalf("err = %v, want errGraphUnavailable", err)
	}
	if !strings.Contains(soft.Error(), "--repo") {
		t.Errorf("reason = %q, want it to name --repo", soft.Error())
	}
}
