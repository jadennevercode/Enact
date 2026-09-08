package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

const publicationArtifact = `{"manifest":{"source_kind":"semantica-native","artifact_digest":"sha256:compiled-release-artifact"}}`

func publicationOntology(t *testing.T, validate func(http.ResponseWriter, *http.Request)) string {
	t.Helper()
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/compile":
			writeJSON(w, 200, map[string]any{"artifact": json.RawMessage(publicationArtifact)})
		case "/v1/validate":
			if validate != nil {
				validate(w, r)
			} else {
				writeJSON(w, 200, map[string]any{"valid": true, "conforms": true})
			}
		default:
			t.Errorf("unexpected publication service request: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(service.Close)
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)
	id := dbfx.Insert(t, "semantic_ontology", testutil.Cols{"workspace_id": testWorkspaceID, "name": "publication construction", "bundle": []byte(`{"native_artifact":{"manifest":{"source_kind":"semantica-native","artifact_digest":"sha256:draft-artifact"}}}`), "created_by": testUserID})
	dbfx.Cleanup(t, `DELETE FROM semantic_release WHERE ontology_id=$1`, id)
	return id
}

func publicationConstruction(t *testing.T, ws, ontology, issue, squad, creator string, created time.Time) string {
	t.Helper()
	id := dbfx.Insert(t, "semantic_construction", testutil.Cols{"id": uuid.NewString(), "workspace_id": ws, "ontology_id": ontology, "issue_id": issue, "squad_id": squad, "created_by": creator, "stage": "review", "status": "awaiting_review", "created_at": created})
	dbfx.Cleanup(t, `DELETE FROM semantic_construction_event WHERE construction_id=$1`, id)
	return id
}

func TestSemanticPublicationCompletesOnlyLatestConstructionAndPreservesIssue(t *testing.T) {
	ontology := publicationOntology(t, nil)
	runtime := dbfx.Runtime(t, "publication runtime", testutil.Cols{"provider": "codex"})
	agent := dbfx.Agent(t, "publication reviewer", runtime)
	squad := dbfx.Squad(t, "publication family", agent)
	issue := dbfx.Issue(t, "review publication", testutil.Cols{"status": "in_progress"})
	creator := dbfx.User(t, "construction author", uuid.NewString()+"@example.com")
	otherWS := dbfx.Workspace(t, "other publication workspace", uuid.NewString())
	older := publicationConstruction(t, testWorkspaceID, ontology, issue, squad, creator, time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC))
	latest := publicationConstruction(t, testWorkspaceID, ontology, issue, squad, creator, time.Date(2021, 1, 1, 0, 0, 0, 0, time.UTC))
	unrelated := publicationConstruction(t, otherWS, ontology, issue, squad, creator, time.Date(2022, 1, 1, 0, 0, 0, 0, time.UTC))
	var release map[string]any
	testutil.Call(t, testHandler.semanticPublishRelease, semanticRequest("POST", ontology, map[string]any{"version": "v1"})).Want(201).JSON(&release)
	var stage, status string
	dbfx.QueryRow(t, `SELECT stage,status FROM semantic_construction WHERE id=$1`, latest).Scan(&stage, &status)
	if stage != "release" || status != "completed" {
		t.Fatalf("published construction still pending: %s/%s", stage, status)
	}
	var actorType, actorID, kind string
	var taskID *string
	var data json.RawMessage
	dbfx.QueryRow(t, `SELECT actor_type,actor_id::text,task_id::text,kind,stage,data FROM semantic_construction_event WHERE construction_id=$1`, latest).Scan(&actorType, &actorID, &taskID, &kind, &stage, &data)
	var recorded map[string]any
	if err := json.Unmarshal(data, &recorded); err != nil {
		t.Fatal(err)
	}
	expected := map[string]any{"release_id": release["id"], "version": release["version"], "digest": release["digest"], "artifact_digest": "sha256:compiled-release-artifact"}
	if actorType != "member" || actorID != testUserID || taskID != nil || kind != "published" || stage != "release" || semantic.Digest(recorded) != semantic.Digest(expected) {
		t.Fatalf("publication event lost its real publisher or release contract: actor=%s/%s kind=%s data=%s", actorType, actorID, kind, data)
	}
	for _, id := range []string{older, unrelated} {
		var events int
		dbfx.QueryRow(t, `SELECT stage,status,(SELECT count(*) FROM semantic_construction_event WHERE construction_id=c.id) FROM semantic_construction c WHERE id=$1`, id).Scan(&stage, &status, &events)
		if stage != "review" || status != "awaiting_review" || events != 0 {
			t.Fatal("publication changed another construction session")
		}
	}
	task := dbfx.Task(t, agent, testutil.Cols{"runtime_id": runtime, "issue_id": issue, "status": "running", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	for _, kind := range []string{"handoff", "review_requested"} {
		request := testutil.WithHeaders(semanticRequest("POST", latest, map[string]any{"stage": "review", "kind": kind, "message": "late Family progress"}), "X-Actor-Source", "task_token", "X-Agent-ID", agent, "X-Task-ID", task)
		testutil.Call(t, testHandler.semanticConstructionEvent, request).Want(201)
	}
	var events int
	dbfx.QueryRow(t, `SELECT stage,status,(SELECT count(*) FROM semantic_construction_event WHERE construction_id=c.id) FROM semantic_construction c WHERE id=$1`, latest).Scan(&stage, &status, &events)
	if stage != "release" || status != "completed" || events != 3 {
		t.Fatal("late Family events reopened a published construction or disappeared")
	}
	dbfx.QueryRow(t, `SELECT status FROM issue WHERE id=$1`, issue).Scan(&status)
	if status != "in_progress" {
		t.Fatal("release publication completed the business Issue")
	}
}

func TestSemanticPublicationFailureLeavesConstructionAndEventsUnchanged(t *testing.T) {
	for _, failure := range []string{"validation", "duplicate", "concurrent draft"} {
		t.Run(failure, func(t *testing.T) {
			var ontology string
			ontology = publicationOntology(t, func(w http.ResponseWriter, r *http.Request) {
				if failure == "concurrent draft" {
					if _, err := testHandler.DB.Exec(r.Context(), `UPDATE semantic_ontology SET bundle=bundle||'{"changed":true}'::jsonb WHERE id=$1`, ontology); err != nil {
						t.Error(err)
						w.WriteHeader(500)
						return
					}
				}
				writeJSON(w, 200, map[string]any{"valid": failure != "validation", "conforms": failure != "validation"})
			})
			issue := dbfx.Issue(t, "publication failure")
			construction := publicationConstruction(t, testWorkspaceID, ontology, issue, uuid.NewString(), testUserID, time.Now())
			wantStatus, wantReleases := 409, 0
			if failure == "validation" {
				wantStatus = 422
			}
			if failure == "duplicate" {
				dbfx.Insert(t, "semantic_release", testutil.Cols{"workspace_id": testWorkspaceID, "ontology_id": ontology, "version": "v1", "digest": "existing", "artifact": []byte(publicationArtifact), "binding_config": []byte(`{}`), "published_by": testUserID, "validation": []byte(`{"valid":true,"conforms":true}`)})
				wantReleases = 1
			}
			var before, after json.RawMessage
			dbfx.QueryRow(t, `SELECT to_jsonb(c) FROM semantic_construction c WHERE id=$1`, construction).Scan(&before)
			testutil.Call(t, testHandler.semanticPublishRelease, semanticRequest("POST", ontology, map[string]any{"version": "v1"})).Want(wantStatus)
			dbfx.QueryRow(t, `SELECT to_jsonb(c) FROM semantic_construction c WHERE id=$1`, construction).Scan(&after)
			var events, releases int
			dbfx.QueryRow(t, `SELECT (SELECT count(*) FROM semantic_construction_event WHERE construction_id=$1),(SELECT count(*) FROM semantic_release WHERE ontology_id=$2)`, construction, ontology).Scan(&events, &releases)
			if semantic.Digest(before) != semantic.Digest(after) || events != 0 || releases != wantReleases {
				t.Fatal("failed publication changed construction state or recorded a publication")
			}
		})
	}
}

func TestSemanticPublicationWithoutConstructionRemainsSupported(t *testing.T) {
	ontology := publicationOntology(t, nil)
	testutil.Call(t, testHandler.semanticPublishRelease, semanticRequest("POST", ontology, map[string]any{"version": "v1"})).Want(201)
	var events int
	dbfx.QueryRow(t, `SELECT count(*) FROM semantic_construction_event e JOIN semantic_construction c ON c.id=e.construction_id WHERE c.ontology_id=$1`, ontology).Scan(&events)
	if events != 0 {
		t.Fatal("publication created a construction that did not exist")
	}
}
