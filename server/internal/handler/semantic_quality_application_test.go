package handler

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/enact-ai/enact/server/internal/semanticapp"
	"github.com/enact-ai/enact/server/internal/testutil"
)

// Optional application package is produced by the real application build helper.
// It is repinned to the freshly published test release and reviewed under its new digest.
func (g *qualityGateway) installApplication(releaseID string) {
	filename := os.Getenv("ENACT_QUALITY_APPLICATION_BUNDLE")
	if filename == "" {
		return
	}
	raw, err := os.ReadFile(filename)
	if err != nil {
		g.t.Fatal(err)
	}
	var source semanticapp.Build
	if err = json.Unmarshal(raw, &source); err != nil {
		g.t.Fatal(err)
	}
	source.Manifest.OntologyReleaseID = releaseID
	for _, table := range []string{"semantic_application", "semantic_application_build", "semantic_application_deployment"} {
		dbfx.Cleanup(g.t, "DELETE FROM "+table+" WHERE workspace_id=$1", g.workspace)
	}
	request := func(body any) *http.Request {
		return testutil.WithURLParams(g.request("POST", "", "engineer", body), "appID", g.applicationID)
	}
	var app semanticApplication
	testutil.Call(g.t, testHandler.createSemanticApplication, request(qualityObject{"name": "Generated Quality Operations", "ontology_release_id": releaseID})).Want(201).JSON(&app)
	g.applicationID = app.ID
	var build semanticApplicationBuild
	testutil.Call(g.t, testHandler.createSemanticApplicationBuild, request(source)).Want(201).JSON(&build)
	g.buildID = build.ID
	testutil.Call(g.t, testHandler.publishSemanticApplication, request(qualityObject{"build_id": build.ID, "digest": build.Digest})).Want(200)
	var restored semanticApplicationBuild
	testutil.Call(g.t, testHandler.getSemanticApplicationBuild, testutil.WithURLParams(request(nil), "appID", app.ID, "buildID", build.ID)).Want(200).JSON(&restored)
	if len(restored.SourceFiles) == 0 || restored.SourceRevision != source.SourceRevision {
		g.t.Fatal("application source revision was not persisted")
	}
	for principal := range g.users {
		context := g.invokeApplication(principal, "context", nil, 200)
		if context["user_id"] != g.users[principal] {
			g.t.Fatal("application did not resolve the signed-in source principal")
		}
		run := g.invokeApplication(principal, "run.create", qualityObject{"question": "Investigate and contain the critical quality case"}, 201)
		g.runs[principal] = run["id"].(string)
	}
	g.t.Logf("Generated application source %s uploaded, restored and published; business flow will use its scoped SDK", build.SourceRevision)
}
func (g *qualityGateway) invokeApplication(principal, operation string, input any, status int) qualityObject {
	g.t.Helper()
	body := qualityObject{"build_id": g.buildID, "operation": operation, "input": input}
	request := testutil.WithURLParams(g.request("POST", "", principal, body), "appID", g.applicationID)
	var response qualityObject
	testutil.Call(g.t, testHandler.invokeSemanticApplication, request).Want(status).JSON(&response)
	return response
}
