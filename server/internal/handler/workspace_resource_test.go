package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/testutil"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

// resourcesPath is the whole address of the collection: the workspace comes
// from the X-Workspace-ID header the router already authorized, so there is no
// parent id in the path any more.
const resourcesPath = "/api/resources"

func listWorkspaceResourcesForTest(t *testing.T) []WorkspaceResourceResponse {
	t.Helper()
	var out struct {
		Resources []WorkspaceResourceResponse `json:"resources"`
		Total     int                         `json:"total"`
	}
	testutil.Call(t, testHandler.ListWorkspaceResources, newRequest("GET", resourcesPath, nil)).
		Want(http.StatusOK).JSON(&out)
	if out.Total != len(out.Resources) {
		t.Fatalf("total = %d but %d resources came back", out.Total, len(out.Resources))
	}
	return out.Resources
}

func createWorkspaceResourceForTest(t *testing.T, body map[string]any) WorkspaceResourceResponse {
	t.Helper()
	var created WorkspaceResourceResponse
	testutil.Call(t, testHandler.CreateWorkspaceResource, newRequest("POST", resourcesPath, body)).
		Want(http.StatusCreated).JSON(&created)
	dbfx.Cleanup(t, `DELETE FROM workspace_resource WHERE id = $1`, created.ID)
	return created
}

func updateWorkspaceResourceForTest(t *testing.T, id string, body map[string]any) *testutil.Response {
	t.Helper()
	req := testutil.WithURLParams(newRequest("PUT", resourcesPath+"/"+id, body), "resourceId", id)
	return testutil.Call(t, testHandler.UpdateWorkspaceResource, req)
}

func resourceRefField(t *testing.T, raw json.RawMessage, key string) string {
	t.Helper()
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatalf("decode resource_ref %s: %v", raw, err)
	}
	value, _ := fields[key].(string)
	return value
}

// TestWorkspaceResourceLifecycle walks the CRUD surface the resource endpoints
// promise: create, list, reject the payloads the validator owns, and delete.
func TestWorkspaceResourceLifecycle(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	before := len(listWorkspaceResourcesForTest(t))

	created := createWorkspaceResourceForTest(t, map[string]any{
		"resource_type": "github_repo",
		"resource_ref": map[string]any{
			"url": "https://github.com/enact-ai/enact",
			"ref": "release/v2",
		},
	})
	if created.ResourceType != "github_repo" {
		t.Errorf("ResourceType = %q, want github_repo", created.ResourceType)
	}
	if got := resourceRefField(t, created.ResourceRef, "url"); got != "https://github.com/enact-ai/enact" {
		t.Errorf("resource_ref.url = %q", got)
	}
	if got := resourceRefField(t, created.ResourceRef, "ref"); got != "release/v2" {
		t.Errorf("resource_ref.ref = %q, want release/v2", got)
	}

	resources := listWorkspaceResourcesForTest(t)
	if len(resources) != before+1 {
		t.Fatalf("list returned %d resources, want %d", len(resources), before+1)
	}
	found := false
	for _, r := range resources {
		if r.ID == created.ID {
			found = true
		}
	}
	if !found {
		t.Errorf("the new resource is missing from the workspace listing")
	}

	// Re-attaching the identical ref hits UNIQUE(workspace_id, type, ref).
	testutil.Call(t, testHandler.CreateWorkspaceResource, newRequest("POST", resourcesPath, map[string]any{
		"resource_type": "github_repo",
		"resource_ref": map[string]any{
			"url": "https://github.com/enact-ai/enact",
			"ref": "release/v2",
		},
	})).Want(http.StatusConflict)

	testutil.Call(t, testHandler.CreateWorkspaceResource, newRequest("POST", resourcesPath, map[string]any{
		"resource_type": "github_repo",
		"resource_ref":  map[string]any{"url": "not-a-url"},
	})).Want(http.StatusBadRequest)

	testutil.Call(t, testHandler.CreateWorkspaceResource, newRequest("POST", resourcesPath, map[string]any{
		"resource_type": "unknown_type",
		"resource_ref":  map[string]any{"foo": "bar"},
	})).Want(http.StatusBadRequest)

	deleteReq := testutil.WithURLParams(newRequest("DELETE", resourcesPath+"/"+created.ID, nil), "resourceId", created.ID)
	testutil.Call(t, testHandler.DeleteWorkspaceResource, deleteReq).Want(http.StatusNoContent)

	if got := len(listWorkspaceResourcesForTest(t)); got != before {
		t.Errorf("post-delete listing has %d resources, want %d", got, before)
	}
}

// SSH and scp-like git remotes are valid repo URLs (#2484): a workspace whose
// repos are configured over SSH must be able to attach them.
func TestWorkspaceResourceAcceptsSSHRepoURLs(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	for _, tc := range []struct{ name, url string }{
		{"scp-like", "git@github.com:enact-ai/enact.git"},
		{"ssh-scheme", "ssh://git@github.com/enact-ai/enact.git"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			created := createWorkspaceResourceForTest(t, map[string]any{
				"resource_type": "github_repo",
				"resource_ref":  map[string]any{"url": tc.url},
			})
			if got := resourceRefField(t, created.ResourceRef, "url"); got != tc.url {
				t.Errorf("resource_ref.url = %q, want %q", got, tc.url)
			}
		})
	}
}

// TestWorkspaceResourceLocalDirectoryValidation freezes the client-visible
// rejection surface for local_directory. These are the only errors an agent
// hits, so pinning them stops the validator being loosened by accident.
func TestWorkspaceResourceLocalDirectoryValidation(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	for _, tc := range []struct {
		name string
		ref  any
	}{
		{"missing local_path", map[string]any{"daemon_id": "d1"}},
		{"blank local_path", map[string]any{"local_path": "   ", "daemon_id": "d1"}},
		{"relative local_path", map[string]any{"local_path": "work/my-game", "daemon_id": "d1"}},
		{"home-shorthand path", map[string]any{"local_path": "~/work/my-game", "daemon_id": "d1"}},
		{"missing daemon_id", map[string]any{"local_path": "/Users/foo/work"}},
		{"blank daemon_id", map[string]any{"local_path": "/Users/foo/work", "daemon_id": ""}},
		{"wrong type in payload", map[string]any{"local_path": 42, "daemon_id": "d1"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			testutil.Call(t, testHandler.CreateWorkspaceResource, newRequest("POST", resourcesPath, map[string]any{
				"resource_type": "local_directory",
				"resource_ref":  tc.ref,
			})).Want(http.StatusBadRequest)
		})
	}
}

// TestWorkspaceResourceLocalDirectoryDaemonScopedConflict pins the invariant
// the daemon-side resolver depends on: at most ONE local_directory per
// (workspace, daemon). The daemon picks the first row matching its daemon_id,
// so a second row would mean the agent silently writes into whichever came
// back first — on the user's real working directory.
//
// Ported from the project-scoped version of this test; the scope moved from
// (project, daemon) to (workspace, daemon) with the project concept's removal.
func TestWorkspaceResourceLocalDirectoryDaemonScopedConflict(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	suffix := time.Now().UnixNano()
	daemonID := fmt.Sprintf("d-scoped-%d", suffix)
	otherDaemon := fmt.Sprintf("d-other-%d", suffix)
	localPath := fmt.Sprintf("/Users/foo/work/scoped-%d", suffix)

	first := createWorkspaceResourceForTest(t, map[string]any{
		"resource_type": "local_directory",
		"resource_ref": map[string]any{
			"local_path": localPath,
			"daemon_id":  daemonID,
			"label":      "first",
		},
	})

	// Same daemon, same path, different label: the embedded label is human
	// metadata, not a discriminator.
	testutil.Call(t, testHandler.CreateWorkspaceResource, newRequest("POST", resourcesPath, map[string]any{
		"resource_type": "local_directory",
		"resource_ref": map[string]any{
			"local_path": localPath,
			"daemon_id":  daemonID,
			"label":      "different label",
		},
	})).Want(http.StatusConflict)

	// Same daemon, DIFFERENT path: still one per daemon.
	testutil.Call(t, testHandler.CreateWorkspaceResource, newRequest("POST", resourcesPath, map[string]any{
		"resource_type": "local_directory",
		"resource_ref": map[string]any{
			"local_path": localPath + "-other",
			"daemon_id":  daemonID,
			"label":      "other path",
		},
	})).Want(http.StatusConflict)

	// The same path on ANOTHER daemon is a different machine, so it is allowed.
	second := createWorkspaceResourceForTest(t, map[string]any{
		"resource_type": "local_directory",
		"resource_ref": map[string]any{
			"local_path": localPath,
			"daemon_id":  otherDaemon,
			"label":      "other-machine",
		},
	})

	// An update that drives the other-daemon row onto the first daemon must
	// conflict too — the check is not create-only.
	updateWorkspaceResourceForTest(t, second.ID, map[string]any{
		"resource_ref": map[string]any{
			"local_path": localPath,
			"daemon_id":  daemonID,
			"label":      "fresh",
		},
	}).Want(http.StatusConflict)

	// Editing the row in place must still work: the conflict check skips the
	// row being updated.
	updateWorkspaceResourceForTest(t, first.ID, map[string]any{
		"resource_ref": map[string]any{
			"local_path": localPath,
			"daemon_id":  daemonID,
			"label":      "renamed inline",
		},
	}).Want(http.StatusOK)
}

// TestWorkspaceResourceGatesWorktreeLocalDirectory covers the save-time half of
// the worktree gate: a daemon that has never advertised `local-worktree-v1`
// cannot have a worktree resource saved against it, because an old daemon
// json-skips execution_mode and would run the task IN PLACE — editing the very
// working copy the user asked to isolate.
func TestWorkspaceResourceGatesWorktreeLocalDirectory(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	body := map[string]any{
		"resource_type": "local_directory",
		"resource_ref": map[string]any{
			"local_path":     "/Users/dev/work/game-client",
			"daemon_id":      fmt.Sprintf("daemon-with-no-runtime-row-%d", time.Now().UnixNano()),
			"execution_mode": "worktree",
		},
	}
	resp := testutil.Call(t, testHandler.CreateWorkspaceResource, newRequest("POST", resourcesPath, body)).
		Want(http.StatusUnprocessableEntity).Map()
	if resp["code"] != "daemon_version_unsupported" {
		t.Fatalf("expected the shared gate's error code, got %#v", resp["code"])
	}

	// The gate runs before the insert, so the refusal leaves no row behind.
	for _, r := range listWorkspaceResourcesForTest(t) {
		if resourceRefField(t, r.ResourceRef, "local_path") == "/Users/dev/work/game-client" {
			t.Fatalf("refused create left a resource behind: %+v", r)
		}
	}
}

// A resource's execution-mode dialog snapshots the whole ref when it OPENS and
// sends it back on save. If someone renames the directory from another device
// in between, that snapshot arrives carrying a name the row no longer has —
// and reading "the ref label differs" as "an old client renamed it" would undo
// the rename from a dialog that has nothing to do with the name.
//
// The other half of the same classification: a genuine ≤ v0.4.28 rename resends
// the ref but changes no execution semantics, so it must still reach the label
// column and must NOT be refused by the worktree capability gate.
func TestWorkspaceResourceStaleRefSnapshotDoesNotRollBackARename(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	suffix := time.Now().UnixNano()
	daemonID := fmt.Sprintf("daemon-stale-snapshot-%d", suffix)
	localPath := fmt.Sprintf("/Users/dev/work/game-client-%d", suffix)

	created := createWorkspaceResourceForTest(t, map[string]any{
		"resource_type": "local_directory",
		"resource_ref": map[string]any{
			"local_path": localPath,
			"daemon_id":  daemonID,
			"label":      "Game Client",
		},
	})

	update := func(body map[string]any) WorkspaceResourceResponse {
		t.Helper()
		var out WorkspaceResourceResponse
		updateWorkspaceResourceForTest(t, created.ID, body).Want(http.StatusOK).JSON(&out)
		return out
	}

	// Device B renames it. Both homes of the name now say "Renamed Client".
	renamed := update(map[string]any{"label": "Renamed Client"})
	if got := resourceRefField(t, renamed.ResourceRef, "label"); got != "Renamed Client" {
		t.Fatalf("setup: the ref copy did not follow the rename: %s", renamed.ResourceRef)
	}

	// Device A, whose dialog opened before that, saves in_place -> in_place
	// carrying its stale snapshot. The mode is what it came to change; the
	// name is not.
	after := update(map[string]any{
		"resource_ref": map[string]any{
			"local_path":     localPath,
			"daemon_id":      daemonID,
			"label":          "Game Client",
			"execution_mode": "in_place",
		},
	})
	if after.Label == nil || *after.Label != "Renamed Client" {
		t.Fatalf("a stale mode snapshot rolled back the rename: column = %v", after.Label)
	}
	if got := resourceRefField(t, after.ResourceRef, "label"); got != "Renamed Client" {
		t.Errorf("the stale ref label should be healed to the current name, got %q", got)
	}

	// A genuine legacy rename — ref resent, ONLY the label different — still
	// counts, and still reaches the column.
	legacy := update(map[string]any{
		"resource_ref": map[string]any{
			"local_path":     localPath,
			"daemon_id":      daemonID,
			"label":          "Renamed On Old Desktop",
			"execution_mode": "in_place",
		},
	})
	if legacy.Label == nil || *legacy.Label != "Renamed On Old Desktop" {
		t.Fatalf("a legacy rename should still reach the column, got %v", legacy.Label)
	}
}

// An old client renames by resending the ref, so the worktree capability gate
// would see "the ref was provided" and refuse the rename on a machine whose
// runtime registration no longer advertises the capability — failing an edit
// that changes nothing about what runs. The row already says worktree; the
// claim gate is what keeps it from running somewhere that cannot.
func TestWorkspaceResourceLegacyRenameSkipsWorktreeGate(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	suffix := time.Now().UnixNano()
	daemonID := fmt.Sprintf("daemon-no-runtime-row-for-rename-%d", suffix)
	localPath := fmt.Sprintf("/Users/dev/work/legacy-rename-%d", suffix)

	created := createWorkspaceResourceForTest(t, map[string]any{
		"resource_type": "local_directory",
		"resource_ref": map[string]any{
			"local_path": localPath,
			"daemon_id":  daemonID,
			"label":      "Game Client",
		},
	})
	// Plant the worktree mode directly: saving it through the API would
	// (correctly) be refused for a daemon with no capable runtime row.
	if _, err := testHandler.Queries.UpdateWorkspaceResource(context.Background(), db.UpdateWorkspaceResourceParams{
		ID: parseUUID(created.ID),
		ResourceRef: json.RawMessage(
			`{"local_path":"` + localPath + `","daemon_id":"` + daemonID + `","label":"Game Client","execution_mode":"worktree"}`),
		Label:    pgtype.Text{String: "Game Client", Valid: true},
		Position: 0,
	}); err != nil {
		t.Fatalf("plant worktree row: %v", err)
	}

	// A rename that changes no execution semantics must not hit the gate.
	updateWorkspaceResourceForTest(t, created.ID, map[string]any{
		"resource_ref": map[string]any{
			"local_path":     localPath,
			"daemon_id":      daemonID,
			"label":          "Renamed On Old Desktop",
			"execution_mode": "worktree",
		},
	}).Want(http.StatusOK)

	// Switching to in_place needs no capability either.
	updateWorkspaceResourceForTest(t, created.ID, map[string]any{
		"resource_ref": map[string]any{
			"local_path":     localPath,
			"daemon_id":      daemonID,
			"label":          "Renamed On Old Desktop",
			"execution_mode": "in_place",
		},
	}).Want(http.StatusOK)
}

func TestValidateLocalDirectoryRefExecutionMode(t *testing.T) {
	for _, tc := range []struct{ name, mode, want string }{
		{"absent means in_place", "", ""},
		{"explicit in_place", "in_place", "in_place"},
		{"worktree", "worktree", "worktree"},
		{"surrounding whitespace is trimmed", "  worktree  ", "worktree"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ref := map[string]any{"local_path": "/Users/foo/work", "daemon_id": "d1"}
			if tc.mode != "" {
				ref["execution_mode"] = tc.mode
			}
			raw, err := json.Marshal(ref)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			out, err := validateLocalDirectoryRef(raw)
			if err != nil {
				t.Fatalf("validateLocalDirectoryRef: %v", err)
			}
			var got localDirectoryRef
			if err := json.Unmarshal(out, &got); err != nil {
				t.Fatalf("unmarshal normalized ref: %v", err)
			}
			if got.ExecutionMode != tc.want {
				t.Errorf("ExecutionMode = %q, want %q", got.ExecutionMode, tc.want)
			}
		})
	}

	for _, mode := range []string{"snapshot", "WORKTREE", "in-place", "true"} {
		t.Run("rejects "+mode, func(t *testing.T) {
			raw, err := json.Marshal(map[string]any{
				"local_path":     "/Users/foo/work",
				"daemon_id":      "d1",
				"execution_mode": mode,
			})
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if _, err := validateLocalDirectoryRef(raw); err == nil {
				t.Errorf("execution_mode %q was accepted, want a validation error", mode)
			}
		})
	}
}

func TestIsValidGitRepoURL(t *testing.T) {
	for _, s := range []string{
		"https://github.com/enact-ai/enact",
		"https://github.com/enact-ai/enact.git",
		"http://github.example.com/x/y",
		"ssh://git@github.com/enact-ai/enact.git",
		"ssh://git@github.com:22/enact-ai/enact.git",
		"git@github.com:enact-ai/enact.git",
		"git@gitlab.example.com:group/sub/repo.git",
	} {
		if !isValidGitRepoURL(s) {
			t.Errorf("isValidGitRepoURL(%q) = false, want true", s)
		}
	}
	for _, s := range []string{
		"",
		"not-a-url",
		"github.com/enact-ai/enact", // no scheme, no scp-style colon
		"https://",                  // empty host
		"git@github.com",            // missing :path
		"git@:foo/bar",              // missing host
		"git@github.com:",           // missing path
		"ftp://example.com/repo",    // unsupported scheme
		"file:///tmp/repo",          // unsupported scheme
		"some random text with spaces",
		"github.com:org/repo@branch", // '@' after ':' belongs to the path, not user
		"foo:bar@baz",                // '@' after ':' with no scheme
		":foo/bar",                   // leading ':' with no host
	} {
		if isValidGitRepoURL(s) {
			t.Errorf("isValidGitRepoURL(%q) = true, want false", s)
		}
	}
}

func TestIsAbsoluteLocalPath(t *testing.T) {
	for _, s := range []string{
		"/Users/foo/work",
		"/",
		"/a",
		`C:\Users\foo`,
		`C:/Users/foo`,
		`d:\code\repo`,
		`\\server\share\path`,
	} {
		if !isAbsoluteLocalPath(s) {
			t.Errorf("isAbsoluteLocalPath(%q) = false, want true", s)
		}
	}
	for _, s := range []string{
		"",
		"work/my-game",
		"./relative",
		"../relative",
		"~/work",
		"C:relative",
		"C:",
		`\foo`,
		"file:///tmp",
	} {
		if isAbsoluteLocalPath(s) {
			t.Errorf("isAbsoluteLocalPath(%q) = true, want false", s)
		}
	}
}

// latestDaemonCLIVersion feeds only the message the save gate shows the user;
// nothing branches on it. It still has to name the binary actually running on
// that machine — the freshest version-bearing row for the daemon, never a
// stale sibling.
func TestLatestDaemonCLIVersion(t *testing.T) {
	row := func(daemonID, version string, seen time.Time) db.AgentRuntime {
		rt := db.AgentRuntime{
			DaemonID:   pgtype.Text{String: daemonID, Valid: daemonID != ""},
			LastSeenAt: pgtype.Timestamptz{Time: seen, Valid: !seen.IsZero()},
		}
		if version != "" {
			rt.Metadata = []byte(`{"cli_version":"` + version + `"}`)
		}
		return rt
	}
	base := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)

	for _, tc := range []struct {
		name     string
		runtimes []db.AgentRuntime
		daemonID string
		want     string
	}{
		{"no rows at all", nil, "d1", ""},
		{"only other daemons", []db.AgentRuntime{row("d2", "0.9.9", base)}, "d1", ""},
		{"single match", []db.AgentRuntime{row("d1", "0.4.24", base)}, "d1", "0.4.24"},
		{
			name: "freshest row wins regardless of order",
			runtimes: []db.AgentRuntime{
				row("d1", "0.4.30", base.Add(2*time.Hour)),
				row("d1", "0.4.20", base),
			},
			daemonID: "d1",
			want:     "0.4.30",
		},
		{
			name: "a fresher row without a version does not mask an older versioned row",
			runtimes: []db.AgentRuntime{
				row("d1", "", base.Add(2*time.Hour)),
				row("d1", "0.4.24", base),
			},
			daemonID: "d1",
			want:     "0.4.24",
		},
		{"match with no version anywhere", []db.AgentRuntime{row("d1", "", base)}, "d1", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := latestDaemonCLIVersion(tc.runtimes, tc.daemonID); got != tc.want {
				t.Errorf("latestDaemonCLIVersion = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestClaimTask_WorkspaceGithubReposOverrideWorkspaceRepoRegistry pins the
// override the claim response carries: when the workspace has `github_repo`
// resources, those become resp.Repos and the workspace repo registry is
// hidden. Without it the agent sees two repo lists in the meta skill and no
// signal about which one this run is meant to work in.
//
// Ported from the project-scoped version; the resources moved from the
// issue's project to the workspace itself.
func TestClaimTask_WorkspaceGithubReposOverrideWorkspaceRepoRegistry(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	setHandlerTestWorkspaceRepos(t, []map[string]string{
		{"url": "https://github.com/example/workspace-repo-a", "description": "ws a"},
		{"url": "https://github.com/example/workspace-repo-b", "description": "ws b"},
	})

	const resourceRepoURL = "https://github.com/example/resource-only-repo"
	const resourceRepoRef = "release/v2"
	created := createWorkspaceResourceForTest(t, map[string]any{
		"resource_type": "github_repo",
		"resource_ref":  map[string]any{"url": resourceRepoURL, "ref": resourceRepoRef},
	})

	var agentID, runtimeID string
	dbfx.QueryRow(t,
		`SELECT id, runtime_id FROM agent WHERE workspace_id = $1 LIMIT 1`,
		testWorkspaceID,
	).Scan(&agentID, &runtimeID)

	issueID := dbfx.Issue(t, "workspace repo override", testutil.Cols{
		"priority": "medium",
		"number":   88001,
	})
	dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": issueID})

	req := newDaemonTokenRequest("POST", "/api/daemon/runtimes/"+runtimeID+"/claim", nil, testWorkspaceID, "test-claim-workspace-repos")
	req = withURLParam(req, "runtimeId", runtimeID)
	w := testutil.Call(t, testHandler.ClaimTaskByRuntime, req).Want(http.StatusOK)

	var resp struct {
		Task *struct {
			Repos []RepoData `json:"repos"`
			// The wire name stays `project_resources` so installed daemons
			// keep receiving the list; this test is what says so.
			WorkspaceResources []WorkspaceResourceData `json:"project_resources"`
		} `json:"task"`
	}
	w.JSON(&resp)
	if resp.Task == nil {
		t.Fatal("expected a task in the response")
	}
	if len(resp.Task.Repos) != 1 || resp.Task.Repos[0].URL != resourceRepoURL {
		t.Fatalf("expected resp.Repos to carry only the resource repo, got %+v", resp.Task.Repos)
	}
	if resp.Task.Repos[0].Ref != resourceRepoRef {
		t.Fatalf("resource repo ref = %q, want %q", resp.Task.Repos[0].Ref, resourceRepoRef)
	}
	for _, r := range resp.Task.Repos {
		if strings.HasSuffix(r.URL, "workspace-repo-a") || strings.HasSuffix(r.URL, "workspace-repo-b") {
			t.Errorf("registry repo %q leaked into resp.Repos despite the resource override", r.URL)
		}
	}
	if len(resp.Task.WorkspaceResources) != 1 || resp.Task.WorkspaceResources[0].ID != created.ID {
		t.Errorf("expected the one workspace resource on the claim, got %+v", resp.Task.WorkspaceResources)
	}
}

// With no github_repo resources attached, the claim must fall back to the
// workspace repo registry — the behavior before any resource exists.
func TestClaimTask_NoWorkspaceResources_FallsBackToWorkspaceRepos(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	if existing := listWorkspaceResourcesForTest(t); len(existing) != 0 {
		t.Skipf("fixture workspace already carries %d resources", len(existing))
	}
	setHandlerTestWorkspaceRepos(t, []map[string]string{
		{"url": "https://github.com/example/workspace-fallback", "description": "ws"},
	})

	var agentID, runtimeID string
	dbfx.QueryRow(t,
		`SELECT id, runtime_id FROM agent WHERE workspace_id = $1 LIMIT 1`,
		testWorkspaceID,
	).Scan(&agentID, &runtimeID)

	issueID := dbfx.Issue(t, "no workspace resources", testutil.Cols{
		"priority": "medium",
		"number":   88002,
	})
	dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": issueID})

	req := newDaemonTokenRequest("POST", "/api/daemon/runtimes/"+runtimeID+"/claim", nil, testWorkspaceID, "test-claim-fallback")
	req = withURLParam(req, "runtimeId", runtimeID)
	w := testutil.Call(t, testHandler.ClaimTaskByRuntime, req).Want(http.StatusOK)

	var resp struct {
		Task *struct {
			Repos []RepoData `json:"repos"`
		} `json:"task"`
	}
	w.JSON(&resp)
	if resp.Task == nil {
		t.Fatal("expected a task in the response")
	}
	if len(resp.Task.Repos) != 1 || !strings.HasSuffix(resp.Task.Repos[0].URL, "workspace-fallback") {
		t.Fatalf("expected the workspace fallback repo, got %+v", resp.Task.Repos)
	}
}
