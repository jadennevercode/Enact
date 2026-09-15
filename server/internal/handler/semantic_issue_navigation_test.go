package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

func TestSemanticApplicationCanNavigateToOwnedPriorInvestigationWithoutImportingItsCapabilities(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{}`)) }))
	defer upstream.Close()
	_, currentRelease, _ := semanticFixture(t, upstream.URL, "confirm")
	_, _, priorRun := semanticFixture(t, upstream.URL, "confirm")
	issue := dbfx.Issue(t, "Previous quality investigation")
	dbfx.Exec(t, `UPDATE semantic_run SET issue_id=$2 WHERE id=$1`, priorRun, issue)
	app := applicationFixture(t, currentRelease)
	var saved semanticApplicationBuild
	testutil.Call(t, testHandler.createSemanticApplicationBuild, applicationRequest("POST", app.ID, applicationBuildFixture(t, currentRelease))).Want(201).JSON(&saved)
	invoke := func(operation string) *http.Request {
		return applicationRequest("POST", app.ID, map[string]any{"build_id": saved.ID, "operation": operation, "input": map[string]any{"run_id": priorRun, "binding_id": "case"}})
	}
	var target map[string]any
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("issue.open")).Want(200).JSON(&target)
	if target["issue_id"] != issue || target["run_id"] != priorRun {
		t.Fatalf("incorrect navigation target: %v", target)
	}
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("run.get")).Want(404)
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("query")).Want(404)
	other := dbfx.User(t, "Other investigator", uuid.NewString()+"@example.com")
	dbfx.Exec(t, `UPDATE semantic_run SET requested_by=$2 WHERE id=$1`, priorRun, other)
	testutil.Call(t, testHandler.invokeSemanticApplication, invoke("issue.open")).Want(404)
}
