package handler

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"strings"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/service"
	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/enact-ai/enact/server/pkg/contextstate"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/dbid"
)

func cleanupContextDelivery(t *testing.T, s contextstate.Session) {
	t.Helper()
	dbfx.Cleanup(t, "DELETE FROM agent_context_turn WHERE scope_id=$1", s.ScopeID)
	dbfx.Cleanup(t, "DELETE FROM agent_context_checkpoint WHERE scope_id=$1", s.ScopeID)
	dbfx.Cleanup(t, "DELETE FROM agent_final_delivery WHERE issue_id=$1", s.ScopeID)
	dbfx.Cleanup(t, "DELETE FROM agent_delivery_outbox WHERE issue_id=$1", s.ScopeID)
	dbfx.Cleanup(t, "DELETE FROM comment WHERE issue_id=$1", s.ScopeID)
}
func TestContextEnvelopePreservesEditsDeletesAndUnprocessedFailure(t *testing.T) {
	svc, s := contextFixture(t)
	cleanupContextDelivery(t, s)
	ctx := context.Background()
	first := dbfx.Comment(t, s.ScopeID, "Keep the original constraint")
	second := dbfx.Comment(t, s.ScopeID, "An old decision")
	envelope, err := svc.BuildContextEnvelope(ctx, s, true)
	if err != nil {
		t.Fatal(err)
	}
	if !envelope.Complete || len(envelope.Comments) != 2 {
		t.Fatalf("envelope: %+v", envelope)
	}
	checkpoint := contextstate.Checkpoint{SourceRevision: envelope.SourceRevision, Summary: "Work so far", Pending: []string{"human acceptance"}}
	for _, input := range envelope.Comments {
		checkpoint.Processed = append(checkpoint.Processed, contextstate.InputVersion{ID: input.ID, Revision: input.Revision})
	}
	if _, err = svc.SaveCheckpoint(ctx, s, checkpoint); err != nil {
		t.Fatal(err)
	}
	next := s
	next.TaskID = dbfx.Task(t, s.AgentID, testutil.Cols{"issue_id": s.ScopeID, "runtime_id": s.RuntimeID, "status": "running"})
	before, err := svc.BuildContextEnvelope(ctx, next, true)
	if err != nil {
		t.Fatal(err)
	}
	if before.Checkpoint != nil {
		t.Fatal("uncompleted source consumed its inputs")
	}
	if err = testHandler.Queries.MarkContextProcessed(ctx, parseUUID(s.TaskID)); err != nil {
		t.Fatal(err)
	}
	if _, err = testPool.Exec(ctx, "UPDATE comment SET content='Updated constraint',revision=revision+1 WHERE id=$1", first); err != nil {
		t.Fatal(err)
	}
	if _, err = testPool.Exec(ctx, "DELETE FROM comment WHERE id=$1", second); err != nil {
		t.Fatal(err)
	}
	if _, err = testPool.Exec(ctx, "UPDATE issue SET revision=revision+1 WHERE id=$1", s.ScopeID); err != nil {
		t.Fatal(err)
	}
	next.TaskID = dbfx.Task(t, s.AgentID, testutil.Cols{"issue_id": s.ScopeID, "runtime_id": s.RuntimeID, "status": "running"})
	after, err := svc.BuildContextEnvelope(ctx, next, true)
	if err != nil {
		t.Fatal(err)
	}
	if after.Checkpoint == nil || len(after.Comments) != 1 || after.Comments[0].Content != "Updated constraint" || len(after.Deleted) != 1 || after.Deleted[0] != second {
		t.Fatalf("lost a source change: %+v", after)
	}
}
func TestContextEnvelopeOversizeNeverClaimsCompleteness(t *testing.T) {
	svc, s := contextFixture(t)
	cleanupContextDelivery(t, s)
	dbfx.Comment(t, s.ScopeID, strings.Repeat("constraint", 7000))
	envelope, err := svc.BuildContextEnvelope(context.Background(), s, true)
	if err != nil {
		t.Fatal(err)
	}
	if envelope.Complete || envelope.Gap == "" || len(envelope.Comments) != 0 {
		t.Fatalf("oversize claims complete: %+v", envelope)
	}
}
func TestContextFinalDeliveryProgressDoesNotSuppressResult(t *testing.T) {
	svc, s := contextFixture(t)
	cleanupContextDelivery(t, s)
	ctx := context.Background()
	if _, err := svc.BuildContextEnvelope(ctx, s, true); err != nil {
		t.Fatal(err)
	}
	dbfx.Comment(t, s.ScopeID, "Still investigating", testutil.Cols{"author_type": "agent", "author_id": s.AgentID, "source_task_id": s.TaskID})
	payload := []byte(`{"output":"The final result with supporting evidence"}`)
	for i := 0; i < 2; i++ {
		if _, err := testHandler.TaskService.CompleteTask(ctx, parseUUID(s.TaskID), payload, "", "", "", false, "", ""); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := testPool.QueryRow(ctx, "SELECT count(*) FROM agent_final_delivery WHERE task_id=$1", s.TaskID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("want one final receipt, got %d", count)
	}
}
func TestContextFinalDeliveryAtomicRetryAndOriginalRoute(t *testing.T) {
	_, s := contextFixture(t)
	cleanupContextDelivery(t, s)
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, "UPDATE agent_task_queue SET originator_user_id=$2,accountable_user_id=$2,originator_source='direct_human' WHERE id=$1", s.TaskID, testUserID); err != nil {
		t.Fatal(err)
	}
	runtime := dbfx.Runtime(t, "delivery target runtime")
	target := dbfx.Agent(t, "delivery target", runtime)
	params := db.CreateCommentParams{ID: dbid.NewV7(), IssueID: parseUUID(s.ScopeID), WorkspaceID: parseUUID(s.WorkspaceID), AuthorType: "agent", AuthorID: parseUUID(s.AgentID), SourceTaskID: parseUUID(s.TaskID), Type: "comment", Content: "[@Target](mention://agent/" + target + ") final handoff"}
	var firstID string
	for i := 0; i < 2; i++ {
		tx, err := testPool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		comment, _, fresh, err := service.CreateFinalComment(ctx, testHandler.Queries.WithTx(tx), params, 1)
		if err != nil {
			tx.Rollback(ctx)
			t.Fatal(err)
		}
		if i == 0 {
			firstID = uuidToString(comment.ID)
			if !fresh {
				t.Fatal("initial delivery was not fresh")
			}
		} else if fresh || uuidToString(comment.ID) != firstID {
			t.Fatal("retry created a second result")
		}
		if fresh {
			if err = testHandler.planFinalDelivery(ctx, testHandler.Queries.WithTx(tx), comment); err != nil {
				tx.Rollback(ctx)
				t.Fatal(err)
			}
		}
		if err = tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	// Inspect the durable route; serialized native configuration/credentials
	// must never become part of the handoff record.
	var raw []byte
	if err := testPool.QueryRow(ctx, "SELECT route FROM agent_delivery_outbox WHERE comment_id=$1 AND target_id=$2", firstID, target).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var route map[string]any
	if err := json.Unmarshal(raw, &route); err != nil {
		t.Fatal(err)
	}
	if _, ok := route["Agent"]; ok {
		t.Fatal("outbox stored an agent configuration")
	}
	testHandler.DrainFinalDeliveries(ctx)
	testHandler.DrainFinalDeliveries(ctx)
	var count int
	if err := testPool.QueryRow(ctx, "SELECT count(*) FROM agent_task_queue WHERE trigger_comment_id=$1 AND agent_id=$2", firstID, target).Scan(&count); err != nil {
		t.Fatal(err)
	}
	dbfx.Cleanup(t, "DELETE FROM agent_task_queue WHERE trigger_comment_id=$1", firstID)
	if count != 1 {
		t.Fatalf("want one handoff task, got %d", count)
	}
}

func TestContextWarmEnvelopeReducesRepeatedSourceBytes(t *testing.T) {
	svc, s := contextFixture(t)
	cleanupContextDelivery(t, s)
	ctx := context.Background()
	for i := 0; i < 30; i++ {
		dbfx.Comment(t, s.ScopeID, strings.Repeat("Verified evidence with a retained source reference. ", 12))
	}
	cold, err := svc.BuildContextEnvelope(ctx, s, true)
	if err != nil {
		t.Fatal(err)
	}
	cp := contextstate.Checkpoint{SourceRevision: cold.SourceRevision, Summary: "Thirty source records reviewed; original constraints still apply.", Pending: []string{"Human acceptance"}}
	for _, v := range cold.Comments {
		cp.Processed = append(cp.Processed, contextstate.InputVersion{ID: v.ID, Revision: v.Revision})
	}
	if _, err = svc.SaveCheckpoint(ctx, s, cp); err != nil {
		t.Fatal(err)
	}
	if err = testHandler.Queries.MarkContextProcessed(ctx, parseUUID(s.TaskID)); err != nil {
		t.Fatal(err)
	}
	dbfx.Comment(t, s.ScopeID, "New instruction: preserve the human acceptance step.")
	next := s
	next.TaskID = dbfx.Task(t, s.AgentID, testutil.Cols{"issue_id": s.ScopeID, "runtime_id": s.RuntimeID, "status": "running"})
	warm, err := svc.BuildContextEnvelope(ctx, next, true)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(cold)
	b, _ := json.Marshal(warm)
	if warm.Checkpoint == nil || len(warm.Comments) != 1 || !warm.Complete || len(b) >= len(a) {
		t.Fatalf("warm manifest failed: cold=%d warm=%d", len(a), len(b))
	}
	replayed, err := svc.BuildContextEnvelope(ctx, next, true)
	if err != nil {
		t.Fatal(err)
	}
	replayBytes, _ := json.Marshal(replayed)
	if string(b) != string(replayBytes) {
		t.Fatal("begin retry changed the delivered delta")
	}
	t.Logf("deterministic source envelope bytes: cold=%d warm=%d; no claim about billed tokens or model latency", len(a), len(b))
}

func TestContextChatWatermarkTracksMessageEditsAndTitle(t *testing.T) {
	svc, s := contextFixture(t)
	s.ScopeType = "chat"
	s.ScopeID = dbfx.ChatSession(t, s.AgentID)
	s.TaskID = dbfx.Task(t, s.AgentID, testutil.Cols{"chat_session_id": s.ScopeID, "runtime_id": s.RuntimeID, "status": "running"})
	cleanupContextDelivery(t, s)
	message := dbfx.Insert(t, "chat_message", testutil.Cols{"chat_session_id": s.ScopeID, "role": "user", "content": "Keep this instruction"})
	ctx := context.Background()
	if envelope, err := svc.BuildContextEnvelope(ctx, s, false); err != nil || envelope != nil {
		t.Fatalf("cold native chat duplicated its transcript: %+v %v", envelope, err)
	}
	var raw []byte
	if err := testPool.QueryRow(ctx, "SELECT envelope FROM agent_context_turn WHERE task_id=$1", s.TaskID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var original contextstate.Envelope
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatal(err)
	}
	cp := contextstate.Checkpoint{SourceRevision: original.SourceRevision, Summary: "Pending user instruction", Processed: []contextstate.InputVersion{{ID: message, Revision: 1}}}
	if _, err := svc.SaveCheckpoint(ctx, s, cp); err != nil {
		t.Fatal(err)
	}
	if err := testHandler.Queries.MarkContextProcessed(ctx, parseUUID(s.TaskID)); err != nil {
		t.Fatal(err)
	}
	dbfx.Exec(t, "UPDATE chat_message SET content='Revised instruction' WHERE id=$1", message)
	dbfx.Exec(t, "UPDATE chat_session SET title='Revised title' WHERE id=$1", s.ScopeID)
	s.TaskID = dbfx.Task(t, s.AgentID, testutil.Cols{"chat_session_id": s.ScopeID, "runtime_id": s.RuntimeID, "status": "running"})
	next, err := svc.BuildContextEnvelope(ctx, s, false)
	if err != nil {
		t.Fatal(err)
	}
	if next == nil || next.SourceRevision == original.SourceRevision || len(next.Comments) != 1 || next.Comments[0].Revision != 2 {
		t.Fatalf("chat edits lost: %+v", next)
	}
}

func TestContextFinalFallbackRespectsDeletedExplicitRevision(t *testing.T) {
	svc, s := contextFixture(t)
	cleanupContextDelivery(t, s)
	ctx := context.Background()
	if _, err := svc.BuildContextEnvelope(ctx, s, true); err != nil {
		t.Fatal(err)
	}
	tx, err := testPool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	c, _, _, err := service.CreateFinalComment(ctx, testHandler.Queries.WithTx(tx), db.CreateCommentParams{ID: dbid.NewV7(), IssueID: parseUUID(s.ScopeID), WorkspaceID: parseUUID(s.WorkspaceID), AuthorType: "agent", AuthorID: parseUUID(s.AgentID), SourceTaskID: parseUUID(s.TaskID), Type: "comment", Content: "Explicit revised delivery"}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	dbfx.Exec(t, "DELETE FROM comment WHERE id=$1", c.ID)
	result := []byte(`{"output":"Final delivery already supplied"}`)
	if _, err = testHandler.TaskService.CompleteTask(ctx, parseUUID(s.TaskID), result, "", "", "", false, "", ""); err != nil {
		t.Fatal(err)
	}
	var count int
	dbfx.QueryRow(t, "SELECT count(*) FROM comment WHERE issue_id=$1", s.ScopeID).Scan(&count)
	if count != 0 {
		t.Fatal("completion recreated a deleted final result")
	}
	dbfx.QueryRow(t, "SELECT count(*) FROM agent_final_delivery WHERE task_id=$1", s.TaskID).Scan(&count)
	if count != 1 {
		t.Fatalf("final receipt count=%d", count)
	}
}

func TestContextEnvelopeCannotOutliveConcurrentScopeDeletion(t *testing.T) {
	svc, s := contextFixture(t)
	cleanupContextDelivery(t, s)
	ctx := context.Background()
	tx, err := testPool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	q := testHandler.Queries.WithTx(tx)
	if _, err = q.LockIssueForDelete(ctx, db.LockIssueForDeleteParams{ID: parseUUID(s.ScopeID), WorkspaceID: parseUUID(s.WorkspaceID)}); err != nil {
		t.Fatal(err)
	}
	if err = q.DeleteContextScope(ctx, db.DeleteContextScopeParams{WorkspaceID: parseUUID(s.WorkspaceID), ScopeType: "issue", ScopeID: parseUUID(s.ScopeID)}); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	begin := svc.Begin
	svc.Begin = func(ctx context.Context) (pgx.Tx, error) { tx, err := begin(ctx); close(started); return tx, err }
	done := make(chan error, 1)
	go func() { _, err := svc.BuildContextEnvelope(ctx, s, true); done <- err }()
	<-started
	select {
	case err := <-done:
		t.Fatalf("envelope bypassed deletion fence: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	if err = q.DeleteIssue(ctx, db.DeleteIssueParams{ID: parseUUID(s.ScopeID), WorkspaceID: parseUUID(s.WorkspaceID)}); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("deleted scope accepted an envelope")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("envelope did not release after deletion")
	}
	var count int
	dbfx.QueryRow(t, "SELECT count(*) FROM agent_context_turn WHERE scope_id=$1", s.ScopeID).Scan(&count)
	if count != 0 {
		t.Fatal("scope deletion left an orphan manifest")
	}
}
