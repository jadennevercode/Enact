package handler

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/enact-ai/enact/server/internal/semanticapp"
	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

func applicationRequest(method, appID string, body any) *http.Request {
	return testutil.WithURLParams(newRequest(method, "/api/semantic/apps", body), "appID", appID)
}
func applicationFixture(t *testing.T, release string) semanticApplication {
	t.Helper()
	var app semanticApplication
	testutil.Call(t, testHandler.createSemanticApplication, applicationRequest("POST", "", map[string]any{"name": "Quality operations", "ontology_release_id": release})).Want(201).JSON(&app)
	dbfx.Cleanup(t, "DELETE FROM semantic_application WHERE id=$1", app.ID)
	dbfx.Cleanup(t, "DELETE FROM semantic_application_build WHERE application_id=$1", app.ID)
	dbfx.Cleanup(t, "DELETE FROM semantic_application_deployment WHERE application_id=$1", app.ID)
	dbfx.Cleanup(t, "DELETE FROM semantic_run WHERE application_id=$1", app.ID)
	return app
}
func applicationBuildFixture(t *testing.T, release string) semanticapp.Build {
	t.Helper()
	encode := func(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }
	source := map[string]string{"package.json": encode(`{"name":"quality-test","scripts":{"build":"node build.js"}}`), "src/质量.ts": encode(`export const title = "Quality"`)}
	revision, err := semanticapp.SourceDigest(source)
	if err != nil {
		t.Fatal(err)
	}
	return semanticapp.Build{SourceFiles: source, SourceRevision: revision, Manifest: semanticapp.Manifest{Version: 1, Entry: "index.html", OntologyReleaseID: release, Queries: []string{"case"}, Actions: []string{"freeze"}}, Files: map[string]semanticapp.File{"index.html": {Content: encode("<!doctype html><html><body>Quality</body></html>"), MediaType: "text/html"}}}
}
func TestSemanticApplicationVersionPublicationAndSourceRecovery(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"id":"case-1"}`)) }))
	defer upstream.Close()
	_, release, _ := semanticFixture(t, upstream.URL, "confirm")
	app := applicationFixture(t, release)
	build := applicationBuildFixture(t, release)
	invalid := build
	invalid.Manifest.Actions = []string{"unpublished-action"}
	testutil.Call(t, testHandler.createSemanticApplicationBuild, applicationRequest("POST", app.ID, invalid)).Want(400)
	var saved semanticApplicationBuild
	testutil.Call(t, testHandler.createSemanticApplicationBuild, applicationRequest("POST", app.ID, build)).Want(201).JSON(&saved)
	var restored semanticApplicationBuild
	request := testutil.WithURLParams(newRequest("GET", "/api/semantic/apps", nil), "appID", app.ID, "buildID", saved.ID)
	testutil.Call(t, testHandler.getSemanticApplicationBuild, request).Want(200).JSON(&restored)
	if len(restored.SourceFiles) == 0 || restored.SourceRevision != build.SourceRevision || len(restored.Files) == 0 {
		t.Fatal("saved revision cannot be recovered")
	}
	testutil.Call(t, testHandler.publishSemanticApplication, applicationRequest("POST", app.ID, map[string]any{"build_id": saved.ID, "digest": "unreviewed"})).Want(409)
	other := dbfx.User(t, "Application reader", uuid.NewString()+"@example.com")
	dbfx.Member(t, testWorkspaceID, other, "member")
	publication := map[string]any{"build_id": saved.ID, "digest": saved.Digest}
	testutil.Call(t, testHandler.publishSemanticApplication, testutil.WithHeaders(applicationRequest("POST", app.ID, publication), "X-User-ID", other)).Want(403)
	testutil.Call(t, testHandler.publishSemanticApplication, applicationRequest("POST", app.ID, publication)).Want(200)
	var published semanticApplication
	testutil.Call(t, testHandler.getSemanticApplication, applicationRequest("GET", app.ID, nil)).Want(200).JSON(&published)
	if published.PublishedBuildID == nil || *published.PublishedBuildID != saved.ID {
		t.Fatal("publication did not pin build")
	}
	// Saving another revision leaves the published application on its reviewed build.
	build.Files["index.html"] = semanticapp.File{Content: base64.StdEncoding.EncodeToString([]byte("<html>revision two</html>")), MediaType: "text/html"}
	testutil.Call(t, testHandler.createSemanticApplicationBuild, applicationRequest("POST", app.ID, build)).Want(201)
	testutil.Call(t, testHandler.getSemanticApplication, applicationRequest("GET", app.ID, nil)).Want(200).JSON(&published)
	if *published.PublishedBuildID != saved.ID {
		t.Fatal("draft upload changed the published version")
	}
}
func TestSemanticApplicationBridgeEnforcesAppReleaseUserAndCapabilities(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"id":"case-1"}`)) }))
	defer upstream.Close()
	_, release, foreignRun := semanticFixture(t, upstream.URL, "confirm")
	app := applicationFixture(t, release)
	var saved semanticApplicationBuild
	testutil.Call(t, testHandler.createSemanticApplicationBuild, applicationRequest("POST", app.ID, applicationBuildFixture(t, release))).Want(201).JSON(&saved)
	invoke := func(operation string, input any) *http.Request {
		return applicationRequest("POST", app.ID, map[string]any{"build_id": saved.ID, "operation": operation, "input": input})
	}
	var run map[string]any
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("run.create", map[string]any{"question": "Trace the lot"})).Want(201).JSON(&run)
	runID := run["id"].(string)
	dbfx.Cleanup(t, "DELETE FROM semantic_step WHERE run_id=$1", runID)
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("run.get", map[string]any{"run_id": foreignRun})).Want(404)
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("query", map[string]any{"run_id": runID, "binding_id": "case"})).Want(200)
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("query", map[string]any{"run_id": runID, "binding_id": "@ontology", "query": "SELECT * WHERE {?s ?p ?o}"})).Want(403)
	// The direct agent/API path cannot enrich this run outside its manifest and
	// subsequently leak those extra results through the application's run.get.
	testutil.Call(t, testHandler.semanticQuery, semanticRequest("POST", runID, map[string]any{"query": "SELECT * WHERE {?s ?p ?o}"})).Want(403)
	var alternate semanticApplicationBuild
	testutil.Call(t, testHandler.createSemanticApplicationBuild, applicationRequest("POST", app.ID, applicationBuildFixture(t, release))).Want(201).JSON(&alternate)
	testutil.Call(t, testHandler.invokeSemanticApplication, applicationRequest("POST", app.ID, map[string]any{"build_id": alternate.ID, "operation": "run.get", "input": map[string]any{"run_id": runID}})).Want(404)
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("action.prepare", map[string]any{"run_id": runID, "binding_id": "outside-scope"})).Want(403)
	other := dbfx.User(t, "Application reader", uuid.NewString()+"@example.com")
	dbfx.Member(t, testWorkspaceID, other, "member")
	testutil.Call(t, testHandler.invokeSemanticApplication, testutil.WithHeaders(invoke("context", nil), "X-User-ID", other)).Want(403)
	testutil.Call(t, testHandler.publishSemanticApplication, applicationRequest("POST", app.ID, map[string]any{"build_id": saved.ID, "digest": saved.Digest})).Want(200)
	testutil.Call(t, testHandler.invokeSemanticApplication, testutil.WithHeaders(invoke("context", nil), "X-User-ID", other)).Want(200)
	testutil.Call(t, testHandler.invokeSemanticApplication, testutil.WithHeaders(invoke("run.get", map[string]any{"run_id": runID}), "X-User-ID", other)).Want(404)
	testutil.Call(t, testHandler.semanticRetireRelease, semanticRequest("POST", release, map[string]any{"reason": "Superseded"})).Want(200)
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("run.create", nil)).Want(409)
	// Historical execution records remain readable after retirement.
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("run.get", map[string]any{"run_id": runID})).Want(200)
}
