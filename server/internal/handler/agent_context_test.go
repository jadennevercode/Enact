package handler

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/service"
	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/enact-ai/enact/server/pkg/agent"
	"github.com/enact-ai/enact/server/pkg/contextstate"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func contextFixture(t *testing.T) (*service.AgentContextService, contextstate.Session) {
	t.Helper()
	if testHandler == nil {
		t.Fatal("context contract tests require the isolated PostgreSQL fixture")
	}
	runtime := dbfx.Runtime(t, "context test runtime")
	a := dbfx.Agent(t, "context test agent "+uuid.NewString(), runtime)
	issue := dbfx.Issue(t, "context test issue")
	task := dbfx.Task(t, a, testutil.Cols{"issue_id": issue, "runtime_id": runtime, "status": "running"})
	svc := testHandler.contextService()
	s, err := svc.BeginTurn(context.Background(), contextstate.Session{
		WorkspaceID: testWorkspaceID, AgentID: a, ScopeType: "issue", ScopeID: issue, RuntimeID: runtime, Provider: "codex", TaskID: task,
		Capabilities: agent.NativeContextCapabilities("codex", true),
	})
	if err != nil {
		t.Fatal(err)
	}
	dbfx.Cleanup(t, "DELETE FROM agent_context_session WHERE id=$1", s.ID)
	dbfx.Cleanup(t, "DELETE FROM agent_context_operation WHERE session_id=$1", s.ID)
	dbfx.Cleanup(t, "DELETE FROM agent_context_request WHERE session_id=$1", s.ID)
	return svc, s
}

func TestContextLeaseQueuesMaintenanceWithoutInterruptingTurn(t *testing.T) {
	svc, s := contextFixture(t)
	ctx := context.Background()
	used, window := int64(80000), int64(200000)
	update := contextstate.Update{LeaseToken: s.LeaseToken, Epoch: s.Epoch, EventSeq: 1, NativeID: "native-a",
		Snapshot: &agent.ContextSnapshot{SessionID: "native-a", UsedTokens: &used, WindowTokens: &window, ObservedAt: time.Now()}, PeakTokens: used}
	s, err := svc.Update(ctx, s.ID, update)
	if err != nil {
		t.Fatal(err)
	}
	op, err := svc.CreateOperation(ctx, s.ID, testUserID, "request-0001", s.Generation)
	if err != nil {
		t.Fatal(err)
	}
	coalesced, err := svc.CreateOperation(ctx, s.ID, testUserID, "request-0002", s.Generation)
	if err != nil || coalesced.ID != op.ID {
		t.Fatalf("not coalesced: %+v %v", coalesced, err)
	}
	again, err := svc.CreateOperation(ctx, s.ID, testUserID, "request-0001", s.Generation)
	if err != nil || again.ID != op.ID {
		t.Fatalf("request not idempotent: %+v %v", again, err)
	}
	if _, err = svc.ClaimMaintenance(ctx, s.RuntimeID); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("active turn interrupted: %v", err)
	}
	update.Release = true
	update.EventSeq = 2
	if _, err = svc.Update(ctx, s.ID, update); err != nil {
		t.Fatal(err)
	}
	next := s
	next.TaskID = uuid.NewString()
	if _, err = svc.BeginTurn(ctx, next); !errors.Is(err, service.ErrContextBusy) {
		t.Fatalf("queued compact lost priority: %v", err)
	}
	maintenance, err := svc.ClaimMaintenance(ctx, s.RuntimeID)
	if err != nil {
		t.Fatal(err)
	}
	if maintenance.Operation.ID != op.ID || maintenance.Operation.Status != "running" {
		t.Fatalf("wrong operation: %+v", maintenance)
	}
	if _, err = svc.Update(ctx, s.ID, update); !errors.Is(err, service.ErrContextStale) {
		t.Fatalf("old turn can overwrite maintenance: %v", err)
	}
	_, err = svc.Update(ctx, s.ID, contextstate.Update{LeaseToken: maintenance.LeaseToken, Epoch: maintenance.Epoch, EventSeq: 1, Status: "succeeded", Release: true})
	if err != nil {
		t.Fatal(err)
	}
	final, err := svc.Operation(ctx, op.ID)
	if err != nil || final.Status != "succeeded" || final.After != nil {
		t.Fatalf("missing telemetry must remain unknown: %+v %v", final, err)
	}
	retry, err := svc.CreateOperation(ctx, s.ID, testUserID, "request-0002", s.Generation)
	if err != nil || retry.ID != op.ID {
		t.Fatalf("coalesced retry created a second operation: %+v %v", retry, err)
	}
	current, err := svc.Session(ctx, s.ID)
	if err != nil || current.Snapshot != nil {
		t.Fatalf("pre-compaction readout was presented as current: %+v %v", current, err)
	}
}

func TestContextRejectsOldSnapshotAndChangedGeneration(t *testing.T) {
	svc, s := contextFixture(t)
	ctx := context.Background()
	s, err := svc.Update(ctx, s.ID, contextstate.Update{LeaseToken: s.LeaseToken, Epoch: s.Epoch, EventSeq: 5, NativeID: "new-session"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.Update(ctx, s.ID, contextstate.Update{LeaseToken: s.LeaseToken, Epoch: s.Epoch, EventSeq: 4, NativeID: "old-session"})
	if !errors.Is(err, service.ErrContextStale) {
		t.Fatalf("old native ID overwrote current binding: %v", err)
	}
	_, err = svc.CreateOperation(ctx, s.ID, testUserID, "request-stale", s.Generation+1)
	if !errors.Is(err, service.ErrContextStale) {
		t.Fatalf("stale generation accepted: %v", err)
	}
}

func TestContextExpiredMaintenanceRequiresReconciliationThenCanCloseUnknown(t *testing.T) {
	svc, s := contextFixture(t)
	ctx := context.Background()
	s, err := svc.Update(ctx, s.ID, contextstate.Update{LeaseToken: s.LeaseToken, Epoch: s.Epoch, EventSeq: 1, NativeID: "native", Release: true})
	if err != nil {
		t.Fatal(err)
	}
	op, err := svc.CreateOperation(ctx, s.ID, testUserID, "request-recovery", s.Generation)
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.ClaimMaintenance(ctx, s.RuntimeID)
	if err != nil {
		t.Fatal(err)
	}
	dbfx.Exec(t, "UPDATE agent_context_session SET lease_expires_at=now()-interval '1 minute' WHERE id=$1", s.ID)
	second, err := svc.ClaimMaintenance(ctx, s.RuntimeID)
	if err != nil {
		t.Fatal(err)
	}
	if second.Operation.Status != "reconciliation_required" || second.LeaseToken == first.LeaseToken {
		t.Fatal("expired call was blindly retried")
	}
	_, err = svc.Update(ctx, s.ID, contextstate.Update{LeaseToken: second.LeaseToken, Epoch: second.Epoch, Status: "closed_unknown", Release: true})
	if err != nil {
		t.Fatal(err)
	}
	same, err := svc.CreateOperation(ctx, s.ID, testUserID, "request-recovery", s.Generation)
	if err != nil || same.ID != op.ID || same.Status != "closed_unknown" {
		t.Fatalf("retry changed historical outcome: %+v %v", same, err)
	}
	fresh, err := svc.CreateOperation(ctx, s.ID, testUserID, "explicit-new-request", s.Generation)
	if err != nil || fresh.ID == op.ID {
		t.Fatalf("unknown operation permanently occupied session: %v", err)
	}
}

func TestContextRejectsCompetingProducerForSameTask(t *testing.T) {
	svc, s := contextFixture(t)
	duplicate := s
	duplicate.ProducerID = uuid.NewString()
	if _, err := svc.BeginTurn(context.Background(), duplicate); !errors.Is(err, service.ErrContextBusy) {
		t.Fatalf("competing producer received lease: %v", err)
	}
}

func TestContextRejectsAgentInitiatedCompaction(t *testing.T) {
	req := newRequest("POST", "/api/context-sessions/unused/compactions", nil)
	req.Header.Set("X-Task-ID", uuid.NewString())
	response := httptest.NewRecorder()
	testHandler.CreateContextCompaction(response, req)
	if response.Code != 403 {
		t.Fatalf("agent maintenance request returned %d", response.Code)
	}
}
