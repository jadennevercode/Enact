package handler

import (
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/enact-ai/enact/server/internal/testutil"
)

func TestSemanticBusinessTargetIdentityIsExplicitAndIndependentOfExplanation(t *testing.T) {
	release := semanticRelease{Artifact: json.RawMessage(`{"definition":{"actions":[{"id":"draft","identity_parameters":["caseId","plant"]}]}}`)}
	binding := semantic.Binding{ID: "draft-operation", ActionID: "draft", ConnectionID: "reference"}
	first, err := semanticActionBusinessKey(release, binding, map[string]any{"caseId": "case-1", "plant": "plant-1", "reason": "first analysis"})
	if err != nil {
		t.Fatal(err)
	}
	again, err := semanticActionBusinessKey(release, binding, map[string]any{"caseId": "case-1", "plant": "plant-1", "reason": "a second evaluation"})
	if err != nil || again != first {
		t.Fatal("explanation changed the business target identity")
	}
	other, _ := semanticActionBusinessKey(release, binding, map[string]any{"caseId": "case-1", "plant": "plant-2"})
	if other == first {
		t.Fatal("different plants shared a draft identity")
	}
	if _, err := semanticActionBusinessKey(release, binding, map[string]any{"caseId": "case-1"}); err == nil {
		t.Fatal("missing target identity was accepted")
	}
}

func TestSemanticActionPreparationResumesOneDraftAcrossConcurrentEvaluations(t *testing.T) {
	_, release, run := semanticFixture(t, "https://quality.example.test", "confirm")
	input := map[string]any{"binding_id": "freeze", "parameters": map[string]any{"target": "batch-1"}}
	type result struct {
		status int
		id     string
	}
	results := make(chan result, 8)
	var workers sync.WaitGroup
	for i := 0; i < 8; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			var record map[string]any
			r := testutil.Call(t, testHandler.semanticPrepareAction, semanticRequest("POST", run, input))
			r.WantOneOf(200, 201).JSON(&record)
			results <- result{r.Code, record["id"].(string)}
		}()
	}
	workers.Wait()
	close(results)
	created := 0
	id := ""
	for r := range results {
		if r.status == 201 {
			created++
		}
		if id != "" && id != r.id {
			t.Fatal("concurrent evaluations prepared different drafts")
		}
		id = r.id
	}
	if created != 1 {
		t.Fatalf("created %d drafts, want exactly one", created)
	}
	otherRun := dbfx.Insert(t, "semantic_run", testutil.Cols{"workspace_id": testWorkspaceID, "release_id": release, "requested_by": testUserID, "actor_type": "member"})
	testutil.Call(t, testHandler.semanticPrepareAction, semanticRequest("POST", otherRun, input)).Want(409)
	repeat := map[string]any{"binding_id": "freeze", "parameters": map[string]any{"target": "batch-1"}, "create_another": true}
	testutil.Call(t, testHandler.semanticPrepareAction, semanticRequest("POST", run, repeat)).Want(400)
	repeat["repeat_reason"] = "A separately reviewed alternative plan is required"
	var second map[string]any
	testutil.Call(t, testHandler.semanticPrepareAction, semanticRequest("POST", run, repeat)).Want(201).JSON(&second)
	if second["id"] == id || second["repeat_reason"] != repeat["repeat_reason"] || second["status"] != "pending" {
		t.Fatal("explicit alternative lost its separate identity, reason or human review")
	}
}

func TestSemanticExpiredDraftRefreshIsConcurrentAndPreservesUnknownReceipt(t *testing.T) {
	_, _, run := semanticFixture(t, "https://quality.example.test", "confirm")
	input := map[string]any{"binding_id": "freeze", "parameters": map[string]any{"target": "batch-expired"}}
	var original map[string]any
	testutil.Call(t, testHandler.semanticPrepareAction, semanticRequest("POST", run, input)).Want(201).JSON(&original)
	oldID := original["id"].(string)
	testutil.Call(t, testHandler.semanticDecide, semanticRequest("POST", oldID, map[string]any{"approve": true, "reason": "Reviewed original proposal"})).Want(200)
	dbfx.Exec(t, "UPDATE semantic_approval SET expires_at=$2 WHERE id=$1", oldID, time.Now().Add(-time.Minute))
	type result struct {
		code int
		id   string
	}
	results := make(chan result, 4)
	var workers sync.WaitGroup
	for i := 0; i < 4; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			var record map[string]any
			r := testutil.Call(t, testHandler.semanticPrepareAction, semanticRequest("POST", run, input))
			r.WantOneOf(200, 201).JSON(&record)
			results <- result{r.Code, record["id"].(string)}
		}()
	}
	workers.Wait()
	close(results)
	freshID := ""
	created := 0
	for r := range results {
		if r.code == 201 {
			created++
		}
		if freshID != "" && freshID != r.id {
			t.Fatal("concurrent expiry recovery forked the review")
		}
		freshID = r.id
	}
	if created != 1 || freshID == oldID {
		t.Fatal("expiry recovery did not create exactly one review version")
	}
	var status, reason string
	var prior *string
	dbfx.QueryRow(t, "SELECT status,reason,supersedes_approval_id::text FROM semantic_approval WHERE id=$1", freshID).Scan(&status, &reason, &prior)
	if status != "pending" || prior == nil || *prior != oldID {
		t.Fatal("expired review was reused or history lost")
	}
	dbfx.QueryRow(t, "SELECT status,reason FROM semantic_approval WHERE id=$1", oldID).Scan(&status, &reason)
	if status != "approved" || reason != "Reviewed original proposal" {
		t.Fatal("old decision was overwritten")
	}
	// An unknown dispatch must only reconcile, even when its review has expired.
	dbfx.Insert(t, "semantic_receipt", testutil.Cols{"workspace_id": testWorkspaceID, "run_id": run, "approval_id": freshID, "binding_id": "freeze", "idempotency_key": "expired-review-unknown-" + freshID, "request_digest": "fixture", "status": "unknown", "executed_by": testUserID})
	dbfx.Exec(t, "UPDATE semantic_approval SET expires_at=$2 WHERE id=$1", freshID, time.Now().Add(-time.Minute))
	var existing map[string]any
	testutil.Call(t, testHandler.semanticPrepareAction, semanticRequest("POST", run, input)).Want(200).JSON(&existing)
	if existing["id"] != freshID || existing["receipt"] == nil {
		t.Fatal("unknown operation was replaced instead of reconciled")
	}
}
