package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/codegraph"
	"github.com/enact-ai/enact/server/internal/testutil"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

// The code graph tests drive the real queue and the real routes against a
// fake container, so the contract in docs/architecture/code-graph-contracts.md
// is exercised end to end without a Python process anywhere.

// fakeCodeGraphContainer records what the server sent and answers with a
// scripted verdict.
type fakeCodeGraphContainer struct {
	srv         *httptest.Server
	buildStatus int
	buildBody   map[string]any
	readStatus  int
	readBody    map[string]any

	builds     []codegraph.BuildRequest
	buildKeys  []string
	deleted    []string
	readPaths  []string
	serviceKey string
}

func newFakeCodeGraphContainer(t *testing.T) *fakeCodeGraphContainer {
	t.Helper()
	f := &fakeCodeGraphContainer{
		buildStatus: http.StatusOK,
		buildBody: map[string]any{
			"state": "ready", "commit": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
			"stats":     map[string]any{"files": 12, "nodes": 40, "edges": 90, "communities": 3, "graphify_version": "0.9.61"},
			"report_md": "# Knowledge Graph Report\n\nthree subsystems\n",
		},
		readStatus: http.StatusOK,
		readBody:   map[string]any{"communities": []any{map[string]any{"id": 0, "label": "handler", "size": 12}}},
	}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.serviceKey = r.Header.Get("X-Codegraph-Service-Key")
		switch {
		case r.URL.Path == "/healthz":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "graphify_version": "0.9.61"})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/build"):
			var req codegraph.BuildRequest
			_ = json.NewDecoder(r.Body).Decode(&req)
			f.builds = append(f.builds, req)
			f.buildKeys = append(f.buildKeys, projectKeyFromPath(r.URL.Path))
			w.WriteHeader(f.buildStatus)
			_ = json.NewEncoder(w).Encode(f.buildBody)
		case r.Method == http.MethodDelete:
			f.deleted = append(f.deleted, projectKeyFromPath(r.URL.Path))
			w.WriteHeader(http.StatusNoContent)
		default:
			f.readPaths = append(f.readPaths, r.URL.Path+"?"+r.URL.RawQuery)
			w.WriteHeader(f.readStatus)
			_ = json.NewEncoder(w).Encode(f.readBody)
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

// projectKeyFromPath pulls the key out of /v1/projects/{key}/...
func projectKeyFromPath(path string) string {
	const prefix = "/v1/projects/"
	if len(path) <= len(prefix) {
		return ""
	}
	rest := path[len(prefix):]
	for i := 0; i < len(rest); i++ {
		if rest[i] == '/' {
			return rest[:i]
		}
	}
	return rest
}

// useCodeGraphContainer points the handler at the fake for one test.
func useCodeGraphContainer(t *testing.T, f *fakeCodeGraphContainer) {
	t.Helper()
	previous := testHandler.CodeGraph
	url := ""
	if f != nil {
		url = f.srv.URL
	}
	testHandler.CodeGraph = codegraph.New(url, "test-service-key")
	t.Cleanup(func() { testHandler.CodeGraph = previous })
}

// createCodeGraphRepo attaches a github_repo with the opt-in set as given and
// clears its builds when the test ends.
func createCodeGraphRepo(t *testing.T, url string, enabled bool) WorkspaceResourceResponse {
	t.Helper()
	ref := map[string]any{"url": url}
	if enabled {
		ref["code_graph"] = true
	}
	created := createWorkspaceResourceForTest(t, map[string]any{
		"resource_type": "github_repo",
		"resource_ref":  ref,
	})
	dbfx.Cleanup(t, `DELETE FROM code_graph_build WHERE resource_id = $1`, created.ID)
	return created
}

func codeGraphRequest(method, suffix string, resourceID string, body any) *http.Request {
	req := newRequest(method, "/api/code-graph/resources/"+resourceID+"/"+suffix, body)
	return testutil.WithURLParams(req, "resourceId", resourceID)
}

func latestBuildRow(t *testing.T, resourceID string) db.CodeGraphBuild {
	t.Helper()
	row, err := testHandler.Queries.GetLatestCodeGraphBuild(context.Background(), db.GetLatestCodeGraphBuildParams{
		WorkspaceID: parseUUID(testWorkspaceID), ResourceID: parseUUID(resourceID),
	})
	if err != nil {
		t.Fatalf("latest build for %s: %v", resourceID, err)
	}
	return row
}

// TestCodeGraphFlagValidation pins where the opt-in may live. The builder
// clones over the network, so a local directory can never have one, and a
// knowledge base is documents rather than code.
func TestCodeGraphFlagValidation(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	enabled := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-flag", true)
	var ref map[string]any
	if err := json.Unmarshal(enabled.ResourceRef, &ref); err != nil {
		t.Fatalf("decode ref: %v", err)
	}
	if on, _ := ref["code_graph"].(bool); !on {
		t.Fatalf("resource_ref did not keep code_graph: %s", enabled.ResourceRef)
	}

	for _, tc := range []struct {
		name string
		body map[string]any
	}{
		{"local_directory", map[string]any{
			"resource_type": "local_directory",
			"resource_ref":  map[string]any{"local_path": "/tmp/cg", "daemon_id": "cg-daemon", "code_graph": true},
		}},
		{"knowledge_repo", map[string]any{
			"resource_type": "knowledge_repo",
			"resource_ref":  map[string]any{"url": "https://github.com/enact-ai/kb", "code_graph": true},
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := testutil.Call(t, testHandler.CreateWorkspaceResource, newRequest("POST", resourcesPath, tc.body)).
				Want(http.StatusBadRequest)
			if body := resp.Text(); !strings.Contains(body, "code graph needs a remote repository") {
				t.Errorf("error body = %s", body)
			}
		})
	}
}

// TestCodeGraphEnqueueOnFlagTransitions covers the switch: on queues a build,
// off deletes the history and releases the container's copy.
func TestCodeGraphEnqueueOnFlagTransitions(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	fake := newFakeCodeGraphContainer(t)
	useCodeGraphContainer(t, fake)

	resource := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-toggle", false)
	if _, err := testHandler.Queries.GetLatestCodeGraphBuild(context.Background(), db.GetLatestCodeGraphBuildParams{
		WorkspaceID: parseUUID(testWorkspaceID), ResourceID: parseUUID(resource.ID),
	}); err == nil {
		t.Fatal("a repository added with the graph off must not queue a build")
	}

	updateWorkspaceResourceForTest(t, resource.ID, map[string]any{
		"resource_ref": map[string]any{"url": "https://github.com/enact-ai/code-graph-toggle", "code_graph": true},
	}).Want(http.StatusOK)
	row := latestBuildRow(t, resource.ID)
	if row.State != codegraph.StateQueued {
		t.Fatalf("state = %q, want queued", row.State)
	}
	wantKey := testWorkspaceID + "--" + resource.ID
	if row.ProjectKey != wantKey {
		t.Errorf("project_key = %q, want %q", row.ProjectKey, wantKey)
	}

	// A second flip to true must not stack a second pending build.
	updateWorkspaceResourceForTest(t, resource.ID, map[string]any{
		"resource_ref": map[string]any{"url": "https://github.com/enact-ai/code-graph-toggle", "code_graph": true},
	}).Want(http.StatusOK)
	if n := dbfx.Count(t, `SELECT count(*) FROM code_graph_build WHERE resource_id = $1`, resource.ID); n != 1 {
		t.Fatalf("pending builds = %d, want 1", n)
	}

	updateWorkspaceResourceForTest(t, resource.ID, map[string]any{
		"resource_ref": map[string]any{"url": "https://github.com/enact-ai/code-graph-toggle"},
	}).Want(http.StatusOK)
	if n := dbfx.Count(t, `SELECT count(*) FROM code_graph_build WHERE resource_id = $1`, resource.ID); n != 0 {
		t.Fatalf("builds after opt-out = %d, want 0", n)
	}
	if len(fake.deleted) == 0 || fake.deleted[0] != wantKey {
		t.Errorf("container delete = %v, want %q", fake.deleted, wantKey)
	}
}

// TestCodeGraphDeleteResourceClearsBuilds is the no-foreign-key contract:
// the rows go with the resource, in the resource's own transaction.
func TestCodeGraphDeleteResourceClearsBuilds(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	useCodeGraphContainer(t, newFakeCodeGraphContainer(t))

	resource := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-delete", true)
	if n := dbfx.Count(t, `SELECT count(*) FROM code_graph_build WHERE resource_id = $1`, resource.ID); n != 1 {
		t.Fatalf("builds after create = %d, want 1", n)
	}
	req := testutil.WithURLParams(newRequest("DELETE", resourcesPath+"/"+resource.ID, nil), "resourceId", resource.ID)
	testutil.Call(t, testHandler.DeleteWorkspaceResource, req).Want(http.StatusNoContent)
	if n := dbfx.Count(t, `SELECT count(*) FROM code_graph_build WHERE resource_id = $1`, resource.ID); n != 0 {
		t.Fatalf("builds after delete = %d, want 0", n)
	}
}

// TestCodeGraphWorkerRecordsContainerVerdict walks the three outcomes the
// container reports with HTTP 200, and the busy answer it reports with 409.
func TestCodeGraphWorkerRecordsContainerVerdict(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	fake := newFakeCodeGraphContainer(t)
	useCodeGraphContainer(t, fake)
	worker := NewCodeGraphBuildWorker(testHandler)

	resource := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-worker", true)

	t.Run("ready", func(t *testing.T) {
		worked, err := worker.ProcessNext(context.Background())
		if err != nil || !worked {
			t.Fatalf("ProcessNext = %v, %v", worked, err)
		}
		row := latestBuildRow(t, resource.ID)
		if row.State != codegraph.StateReady {
			t.Fatalf("state = %q, want ready", row.State)
		}
		if !row.Commit.Valid || row.Commit.String == "" {
			t.Error("a ready build must record its commit")
		}
		if row.GraphifyVersion.String != "0.9.61" {
			t.Errorf("graphify_version = %q", row.GraphifyVersion.String)
		}
		if !row.ReportMd.Valid || row.ReportMd.String == "" {
			t.Error("a ready build must store its report")
		}
		if len(fake.builds) == 0 || fake.builds[0].CloneURL != "https://github.com/enact-ai/code-graph-worker" {
			t.Errorf("build request = %+v", fake.builds)
		}
		if fake.serviceKey != "test-service-key" {
			t.Errorf("service key = %q", fake.serviceKey)
		}
	})

	t.Run("skipped", func(t *testing.T) {
		fake.buildBody = map[string]any{"state": "skipped", "skipped_reason": "too_large"}
		queueCodeGraphBuildForTest(t, resource.ID)
		if _, err := worker.ProcessNext(context.Background()); err != nil {
			t.Fatalf("ProcessNext: %v", err)
		}
		row := latestBuildRow(t, resource.ID)
		if row.State != codegraph.StateSkipped || row.SkippedReason.String != "too_large" {
			t.Fatalf("row = %q / %q", row.State, row.SkippedReason.String)
		}
	})

	t.Run("failed", func(t *testing.T) {
		fake.buildBody = map[string]any{"state": "failed", "error": "clone_failed: authentication required"}
		queueCodeGraphBuildForTest(t, resource.ID)
		if _, err := worker.ProcessNext(context.Background()); err != nil {
			t.Fatalf("ProcessNext: %v", err)
		}
		row := latestBuildRow(t, resource.ID)
		if row.State != codegraph.StateFailed || row.Error.String == "" {
			t.Fatalf("row = %q / %q", row.State, row.Error.String)
		}
	})

	t.Run("busy is retried, not failed", func(t *testing.T) {
		fake.buildStatus = http.StatusConflict
		fake.buildBody = map[string]any{"error": "busy"}
		queueCodeGraphBuildForTest(t, resource.ID)
		if _, err := worker.ProcessNext(context.Background()); err != nil {
			t.Fatalf("ProcessNext: %v", err)
		}
		row := latestBuildRow(t, resource.ID)
		if row.State != codegraph.StateQueued {
			t.Fatalf("state = %q, want queued (busy is transient)", row.State)
		}
		if !row.LeaseUntil.Valid || !row.LeaseUntil.Time.After(time.Now()) {
			t.Error("a deferred build must be scheduled into the future")
		}
	})
}

// queueCodeGraphBuildForTest puts one build back on the queue, available now.
func queueCodeGraphBuildForTest(t *testing.T, resourceID string) {
	t.Helper()
	dbfx.Exec(t, `DELETE FROM code_graph_build WHERE resource_id = $1`, resourceID)
	resource, err := testHandler.Queries.GetWorkspaceResourceInWorkspace(context.Background(), db.GetWorkspaceResourceInWorkspaceParams{
		ID: parseUUID(resourceID), WorkspaceID: parseUUID(testWorkspaceID),
	})
	if err != nil {
		t.Fatalf("load resource: %v", err)
	}
	if _, _, err := testHandler.enqueueCodeGraphBuildRow(context.Background(), resource, "", time.Time{}); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
}

// TestCodeGraphWorkerAttemptsCap stops a permanently unreachable container
// from holding a queue slot forever.
func TestCodeGraphWorkerAttemptsCap(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	// A closed server is unreachable: every call is a transport failure.
	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	dead.Close()
	previous := testHandler.CodeGraph
	testHandler.CodeGraph = codegraph.New(dead.URL, "k")
	t.Cleanup(func() { testHandler.CodeGraph = previous })

	resource := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-attempts", true)
	worker := NewCodeGraphBuildWorker(testHandler)
	for attempt := 1; attempt <= codeGraphMaxAttempts; attempt++ {
		dbfx.Exec(t, `UPDATE code_graph_build SET lease_until = now() - interval '1 minute' WHERE resource_id = $1`, resource.ID)
		if _, err := worker.ProcessNext(context.Background()); err != nil {
			t.Fatalf("attempt %d: %v", attempt, err)
		}
	}
	row := latestBuildRow(t, resource.ID)
	if row.State != codegraph.StateFailed {
		t.Fatalf("state after %d attempts = %q, want failed", codeGraphMaxAttempts, row.State)
	}
	if row.Error.String == "" {
		t.Error("the capped failure must say why")
	}
}

// TestCodeGraphWorkerReclaimsExpiredLease is the crash-recovery contract.
func TestCodeGraphWorkerReclaimsExpiredLease(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	useCodeGraphContainer(t, newFakeCodeGraphContainer(t))
	resource := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-lease", true)

	// Simulate a worker that claimed the row and died.
	dbfx.Exec(t, `UPDATE code_graph_build SET state = 'building', lease_until = now() - interval '1 hour' WHERE resource_id = $1`, resource.ID)
	worker := NewCodeGraphBuildWorker(testHandler)
	worked, err := worker.ProcessNext(context.Background())
	if err != nil || !worked {
		t.Fatalf("ProcessNext = %v, %v", worked, err)
	}
	if row := latestBuildRow(t, resource.ID); row.State != codegraph.StateReady {
		t.Fatalf("state = %q, want ready", row.State)
	}
}

// TestCodeGraphStatusAndReportRoutes covers the read surface a UI chip and an
// agent use, including the deliberate absence of report_md from status.
func TestCodeGraphStatusAndReportRoutes(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	useCodeGraphContainer(t, newFakeCodeGraphContainer(t))
	resource := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-status", true)

	var queued CodeGraphStatusResponse
	testutil.Call(t, testHandler.codeGraphStatus, codeGraphRequest("GET", "status", resource.ID, nil)).
		Want(http.StatusOK).JSON(&queued)
	if !queued.Enabled || !queued.Queued || queued.Build == nil || queued.Build.State != codegraph.StateQueued {
		t.Fatalf("queued status = %+v", queued)
	}

	// Report before the first build is a refusal the CLI turns into "not
	// built yet", not a 500 and not an empty string.
	testutil.Call(t, testHandler.codeGraphReport, codeGraphRequest("GET", "report", resource.ID, nil)).
		Want(http.StatusConflict)

	worker := NewCodeGraphBuildWorker(testHandler)
	if _, err := worker.ProcessNext(context.Background()); err != nil {
		t.Fatalf("build: %v", err)
	}

	raw := testutil.Call(t, testHandler.codeGraphStatus, codeGraphRequest("GET", "status", resource.ID, nil)).
		Want(http.StatusOK)
	if body := raw.Text(); strings.Contains(body, "report_md") {
		t.Errorf("status must not embed report_md (a monorepo report is hundreds of KB): %s", body)
	}
	var ready CodeGraphStatusResponse
	raw.JSON(&ready)
	if ready.Build == nil || ready.Build.State != codegraph.StateReady || ready.Queued || ready.Stale {
		t.Fatalf("ready status = %+v", ready)
	}
	if len(ready.Build.Stats) == 0 || string(ready.Build.Stats) == "null" {
		t.Error("a ready build must carry its stats")
	}

	var report struct {
		ReportMD string `json:"report_md"`
	}
	testutil.Call(t, testHandler.codeGraphReport, codeGraphRequest("GET", "report", resource.ID, nil)).
		Want(http.StatusOK).JSON(&report)
	if !strings.Contains(report.ReportMD, "Knowledge Graph Report") {
		t.Errorf("report_md = %q", report.ReportMD)
	}
}

// TestCodeGraphStaleRequeues covers the fourth trigger: a status read that
// notices the graph is behind the head the server knows about.
func TestCodeGraphStaleRequeues(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	useCodeGraphContainer(t, newFakeCodeGraphContainer(t))
	resource := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-stale", true)
	worker := NewCodeGraphBuildWorker(testHandler)
	if _, err := worker.ProcessNext(context.Background()); err != nil {
		t.Fatalf("build: %v", err)
	}
	dbfx.Exec(t, `UPDATE code_graph_build SET head_commit = 'ffffffffffffffffffffffffffffffffffffffff' WHERE resource_id = $1`, resource.ID)

	var status CodeGraphStatusResponse
	testutil.Call(t, testHandler.codeGraphStatus, codeGraphRequest("GET", "status", resource.ID, nil)).
		Want(http.StatusOK).JSON(&status)
	if !status.Stale {
		t.Fatal("a ready build behind the known head must report stale")
	}
	if !status.Queued {
		t.Error("a stale graph must queue a rebuild")
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM code_graph_build WHERE resource_id = $1 AND state = 'queued'`, resource.ID); n != 1 {
		t.Fatalf("queued rebuilds = %d, want exactly 1", n)
	}
	// A second read must not stack another one.
	testutil.Call(t, testHandler.codeGraphStatus, codeGraphRequest("GET", "status", resource.ID, nil)).Want(http.StatusOK)
	if n := dbfx.Count(t, `SELECT count(*) FROM code_graph_build WHERE resource_id = $1 AND state = 'queued'`, resource.ID); n != 1 {
		t.Fatalf("queued rebuilds after a second read = %d, want 1", n)
	}
}

// TestCodeGraphBulkStatus backs the resource list's chips: one call, one
// entry per opted-in repository, disabled repositories absent.
func TestCodeGraphBulkStatus(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	useCodeGraphContainer(t, newFakeCodeGraphContainer(t))
	on := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-bulk-on", true)
	off := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-bulk-off", false)

	var out struct {
		Statuses map[string]CodeGraphStatusResponse `json:"statuses"`
	}
	testutil.Call(t, testHandler.codeGraphBulkStatus, newRequest("GET", "/api/code-graph/status", nil)).
		Want(http.StatusOK).JSON(&out)
	if _, ok := out.Statuses[on.ID]; !ok {
		t.Errorf("enabled repository missing from bulk status: %v", out.Statuses)
	}
	if _, ok := out.Statuses[off.ID]; ok {
		t.Error("a repository without the opt-in must not appear")
	}
}

// TestCodeGraphDisabledResourceIsNotFound keeps a caller from telling a
// foreign resource apart from one whose graph is off.
func TestCodeGraphDisabledResourceIsNotFound(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	useCodeGraphContainer(t, newFakeCodeGraphContainer(t))
	off := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-disabled", false)
	for _, route := range []struct {
		name    string
		handler http.HandlerFunc
	}{
		{"report", testHandler.codeGraphReport},
		{"communities", testHandler.codeGraphForwardGet("communities")},
		{"query", testHandler.codeGraphForwardPost("query")},
	} {
		t.Run(route.name, func(t *testing.T) {
			testutil.Call(t, route.handler, codeGraphRequest("POST", route.name, off.ID, map[string]any{})).
				Want(http.StatusNotFound)
		})
	}
}

// TestCodeGraphForwardPassesThroughContainerStatus proves the proxy is a
// proxy: the container's status and body reach the caller unchanged, and a
// container-side 404 stays a 404 rather than becoming a server error.
func TestCodeGraphForwardPassesThroughContainerStatus(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	fake := newFakeCodeGraphContainer(t)
	useCodeGraphContainer(t, fake)
	resource := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-forward", true)

	resp := testutil.Call(t, testHandler.codeGraphForwardGet("communities"),
		codeGraphRequest("GET", "communities", resource.ID, nil)).Want(http.StatusOK)
	if !strings.Contains(resp.Text(), `"handler"`) {
		t.Errorf("body = %s", resp.Text())
	}
	if len(fake.readPaths) == 0 {
		t.Fatal("the read never reached the container")
	}
	wantPath := "/v1/projects/" + testWorkspaceID + "--" + resource.ID + "/communities"
	if got := fake.readPaths[0]; !strings.Contains(got, wantPath) {
		t.Errorf("container path = %q, want %q", got, wantPath)
	}

	fake.readStatus = http.StatusNotFound
	fake.readBody = map[string]any{"error": "unknown_community"}
	resp = testutil.Call(t, testHandler.codeGraphForwardGet("graph"),
		codeGraphRequest("GET", "graph", resource.ID, nil)).Want(http.StatusNotFound)
	if !strings.Contains(resp.Text(), "unknown_community") {
		t.Errorf("container error was not passed through: %s", resp.Text())
	}
}

// TestCodeGraphUnconfiguredDeploymentReports503 is the degradation contract:
// no container means the feature is off, not broken.
func TestCodeGraphUnconfiguredDeploymentReports503(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	useCodeGraphContainer(t, nil)
	resource := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-unconfigured", true)

	testutil.Call(t, testHandler.codeGraphForwardGet("stats"),
		codeGraphRequest("GET", "stats", resource.ID, nil)).Want(http.StatusServiceUnavailable)
	testutil.Call(t, testHandler.codeGraphRebuild,
		codeGraphRequest("POST", "rebuild", resource.ID, nil)).Want(http.StatusServiceUnavailable)

	var capability map[string]any
	testutil.Call(t, testHandler.codeGraphCapability, newRequest("GET", "/api/code-graph/capability", nil)).
		Want(http.StatusOK).JSON(&capability)
	if enabled, _ := capability["enabled"].(bool); enabled {
		t.Errorf("capability = %v, want enabled false", capability)
	}
}

// TestCodeGraphRebuildRequiresHumanAdmin: reads are open to agents, managing
// the graph is not.
func TestCodeGraphRebuildRequiresHumanAdmin(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	useCodeGraphContainer(t, newFakeCodeGraphContainer(t))
	resource := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-rebuild", true)
	// Clear the create-time build so rebuild has a clean queue.
	dbfx.Exec(t, `DELETE FROM code_graph_build WHERE resource_id = $1`, resource.ID)

	agentReq := testutil.WithHeaders(
		codeGraphRequest("POST", "rebuild", resource.ID, nil),
		"X-Actor-Source", "task_token", "X-Agent-ID", parseUUIDString(testWorkspaceID), "X-Task-ID", parseUUIDString(testWorkspaceID))
	testutil.Call(t, testHandler.codeGraphRebuild, agentReq).Want(http.StatusForbidden)

	var accepted map[string]any
	testutil.Call(t, testHandler.codeGraphRebuild, codeGraphRequest("POST", "rebuild", resource.ID, nil)).
		Want(http.StatusAccepted).JSON(&accepted)
	if accepted["build_id"] == nil {
		t.Errorf("rebuild response = %v", accepted)
	}
	// Agents may still read.
	testutil.Call(t, testHandler.codeGraphStatus,
		testutil.WithHeaders(codeGraphRequest("GET", "status", resource.ID, nil),
			"X-Actor-Source", "task_token", "X-Agent-ID", parseUUIDString(testWorkspaceID), "X-Task-ID", parseUUIDString(testWorkspaceID))).
		Want(http.StatusOK)
}

// parseUUIDString is a readability shim: these tests only need a syntactically
// valid UUID for headers whose value is rejected before it is dereferenced.
func parseUUIDString(s string) string { return s }

// TestCodeGraphCrossWorkspaceResourceIsNotFound keeps one workspace's graph
// out of another's reach.
func TestCodeGraphCrossWorkspaceResourceIsNotFound(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	useCodeGraphContainer(t, newFakeCodeGraphContainer(t))

	otherWS := dbfx.Workspace(t, "Code graph other", fmt.Sprintf("cg-other-%d", time.Now().UnixNano()))
	otherResource := dbfx.Insert(t, "workspace_resource", testutil.Cols{
		"workspace_id":  otherWS,
		"resource_type": "github_repo",
		"resource_ref":  `{"url":"https://github.com/enact-ai/elsewhere","code_graph":true}`,
		"position":      0,
	})
	testutil.Call(t, testHandler.codeGraphStatus, codeGraphRequest("GET", "status", otherResource, nil)).
		Want(http.StatusNotFound)
}

// TestCodeGraphPushEventQueuesBuild covers the webhook trigger, including the
// debounce that keeps a burst of commits to one build.
func TestCodeGraphPushEventQueuesBuild(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	useCodeGraphContainer(t, newFakeCodeGraphContainer(t))
	resource := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-push", true)
	dbfx.Exec(t, `DELETE FROM code_graph_build WHERE resource_id = $1`, resource.ID)

	installationID := time.Now().UnixNano() % 1_000_000_000
	dbfx.Insert(t, "github_installation", testutil.Cols{
		"workspace_id":    testWorkspaceID,
		"installation_id": installationID,
		"account_login":   "enact-ai",
		"account_type":    "Organization",
	})

	push := func(ref, after string) {
		body, _ := json.Marshal(map[string]any{
			"ref":   ref,
			"after": after,
			"repository": map[string]any{
				"name":           "code-graph-push",
				"default_branch": "main",
				"owner":          map[string]any{"login": "enact-ai"},
			},
			"installation": map[string]any{"id": installationID},
		})
		testHandler.handlePushEvent(context.Background(), body)
	}

	push("refs/tags/v1", "1111111111111111111111111111111111111111")
	if n := dbfx.Count(t, `SELECT count(*) FROM code_graph_build WHERE resource_id = $1`, resource.ID); n != 0 {
		t.Fatalf("a tag push queued %d builds, want 0", n)
	}

	push("refs/heads/feature", "2222222222222222222222222222222222222222")
	if n := dbfx.Count(t, `SELECT count(*) FROM code_graph_build WHERE resource_id = $1`, resource.ID); n != 0 {
		t.Fatalf("a non-default branch queued %d builds, want 0", n)
	}

	push("refs/heads/main", "3333333333333333333333333333333333333333")
	push("refs/heads/main", "4444444444444444444444444444444444444444")
	if n := dbfx.Count(t, `SELECT count(*) FROM code_graph_build WHERE resource_id = $1`, resource.ID); n != 1 {
		t.Fatalf("two pushes queued %d builds, want 1 (debounced)", n)
	}
	row := latestBuildRow(t, resource.ID)
	if !row.LeaseUntil.Valid || !row.LeaseUntil.Time.After(time.Now().Add(time.Minute)) {
		t.Error("a push-queued build must be delayed by the debounce window")
	}
	if row.HeadCommit.String != "4444444444444444444444444444444444444444" {
		t.Errorf("head_commit = %q, want the newest push", row.HeadCommit.String)
	}
}

// TestCodeGraphProjectKeyShape pins the container's address format.
func TestCodeGraphProjectKeyShape(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	resource := createCodeGraphRepo(t, "https://github.com/enact-ai/code-graph-key", true)
	row := latestBuildRow(t, resource.ID)
	want := testWorkspaceID + "--" + resource.ID
	if row.ProjectKey != want {
		t.Fatalf("project_key = %q, want %q", row.ProjectKey, want)
	}
	if _, err := codegraph.ProjectKey(testWorkspaceID, resource.ID); err != nil {
		t.Fatalf("ProjectKey rejected a real pair: %v", err)
	}
	_ = pgtype.Text{}
}
