package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

func TestSemanticFamilyModelUsesRuntimeCatalogAndPreservesExplicitChoice(t *testing.T) {
	ctx := context.Background()
	runtimeID := dbfx.Runtime(t, "catalog family runtime", testutil.Cols{"provider": "codex"})
	blank := dbfx.Agent(t, "blank family model", runtimeID, testutil.Cols{"system_key": "ontology:test-blank"})
	explicit := dbfx.Agent(t, "explicit family model", runtimeID, testutil.Cols{"system_key": "ontology:test-explicit", "model": "chosen-model", "thinking_level": "high"})
	squadID := dbfx.Squad(t, "catalog family", blank)
	dbfx.Insert(t, "squad_member", testutil.Cols{"squad_id": squadID, "member_type": "agent", "member_id": blank, "role": "leader"})
	dbfx.Insert(t, "squad_member", testutil.Cols{"squad_id": squadID, "member_type": "agent", "member_id": explicit, "role": "member"})
	cache := NewInMemoryModelCatalogCache()
	h := &Handler{ModelCatalogCache: cache, ModelListStore: NewInMemoryModelListStore()}
	tx, err := testHandler.TxStarter.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if status, _ := h.semanticConfigureFamilyModel(ctx, tx, testWorkspaceID, squadID, runtimeID); status != 409 {
		t.Fatalf("cold catalog must trigger discovery before dispatch, status=%d", status)
	}
	if err := cache.Put(ctx, runtimeID, []ModelEntry{{ID: "first"}, {ID: "supported-default", Default: true}}, true); err != nil {
		t.Fatal(err)
	}
	if status, message := h.semanticConfigureFamilyModel(ctx, tx, testWorkspaceID, squadID, runtimeID); status != 0 {
		t.Fatalf("configure model: %d %s", status, message)
	}
	var model, thinking string
	if err := tx.QueryRow(ctx, `SELECT model FROM agent WHERE id=$1`, blank).Scan(&model); err != nil || model != "supported-default" {
		t.Fatalf("blank Family must use actual catalog default: %q %v", model, err)
	}
	if err := tx.QueryRow(ctx, `SELECT model,thinking_level FROM agent WHERE id=$1`, explicit).Scan(&model, &thinking); err != nil || model != "chosen-model" || thinking != "high" {
		t.Fatalf("explicit choice changed: %q %q %v", model, thinking, err)
	}
}

func TestSemanticDefaultFamilyModel(t *testing.T) {
	if got := semanticDefaultFamilyModel(nil); got != "" {
		t.Fatal(got)
	}
	if got := semanticDefaultFamilyModel(&ModelCatalogSnapshot{Supported: true, Models: []ModelEntry{{ID: " "}, {ID: "first"}, {ID: "second"}}}); got != "first" {
		t.Fatal(got)
	}
	if got := semanticDefaultFamilyModel(&ModelCatalogSnapshot{Supported: false, Models: []ModelEntry{{ID: "ignored", Default: true}}}); got != "" {
		t.Fatal(got)
	}
}

func TestSemanticConstructionTracksActualFamilyAndRejectsOutsideTask(t *testing.T) {
	runtimeID := dbfx.Runtime(t, "construction runtime", testutil.Cols{"provider": "codex"})
	agentID := dbfx.Agent(t, "construction reviewer", runtimeID)
	squadID := dbfx.Squad(t, "construction family", agentID)
	issueID := dbfx.Issue(t, "native construction")
	childID := dbfx.Issue(t, "review native candidate", testutil.Cols{"parent_issue_id": issueID})
	taskID := dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": childID, "status": "running", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	ontologyID := dbfx.Insert(t, "semantic_ontology", testutil.Cols{"workspace_id": testWorkspaceID, "name": "construction test", "bundle": []byte(`{}`), "created_by": testUserID})
	id := dbfx.Insert(t, "semantic_construction", testutil.Cols{"id": uuid.NewString(), "workspace_id": testWorkspaceID, "ontology_id": ontologyID, "issue_id": issueID, "squad_id": squadID, "created_by": testUserID})
	dbfx.Cleanup(t, `DELETE FROM semantic_construction_event WHERE construction_id=$1`, id)
	taskReq := func(input any) *http.Request {
		return testutil.WithHeaders(semanticRequest("POST", id, input), "X-Actor-Source", "task_token", "X-Agent-ID", agentID, "X-Task-ID", taskID)
	}
	testutil.Call(t, testHandler.semanticConstructionEvent, taskReq(map[string]any{"stage": "review", "kind": "validation", "message": "Native SHACL report inspected", "data": map[string]any{"conforms": false}})).Want(201)
	var state struct {
		Tasks  []map[string]any `json:"tasks"`
		Events []map[string]any `json:"events"`
		Issue  map[string]any   `json:"issue"`
	}
	testutil.Call(t, testHandler.semanticGetConstruction, semanticRequest("GET", id, nil)).Want(200).JSON(&state)
	if len(state.Tasks) != 1 || state.Tasks[0]["id"] != taskID || len(state.Events) != 1 || state.Issue["id"] != issueID {
		t.Fatalf("construction lost actual Issue/task/event links: %+v", state)
	}
	testutil.Call(t, testHandler.semanticReviseConstruction, taskReq(map[string]any{"message": "approve myself", "decision": "accept"})).Want(403)
	outsideIssue := dbfx.Issue(t, "unrelated issue")
	outsideTask := dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": outsideIssue, "status": "running", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	testutil.Call(t, testHandler.semanticConstructionEvent, testutil.WithHeaders(taskReq(map[string]any{"stage": "review", "kind": "validation", "message": "forged"}), "X-Task-ID", outsideTask)).Want(403)
	testutil.Call(t, testHandler.semanticGetConstruction, semanticRequest("GET", uuid.NewString(), nil)).Want(404)
}
