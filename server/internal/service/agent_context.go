package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/enact-ai/enact/server/pkg/contextstate"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrContextBusy        = errors.New("context session is busy")
	ErrContextStale       = errors.New("context session changed")
	ErrContextUnsupported = errors.New("native compaction is not supported")
)

type ContextDB interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type AgentContextService struct {
	CanReadCheckpoint func(context.Context, string) bool
	DB                ContextDB
	Begin             func(context.Context) (pgx.Tx, error)
}

type contextSessionRow struct {
	contextstate.Session
	LeaseKind      string     `json:"lease_kind"`
	LeaseOwner     string     `json:"lease_owner"`
	LeaseExpiresAt *time.Time `json:"lease_expires_at"`
}

func contextJSON(row pgx.Row, target any) error {
	var raw []byte
	if err := row.Scan(&raw); err != nil {
		return err
	}
	return json.Unmarshal(raw, target)
}

func contextEncode(value any) []byte {
	raw, _ := json.Marshal(value)
	return raw
}

func (s *AgentContextService) Session(ctx context.Context, id string) (contextstate.Session, error) {
	var row contextstate.Session
	err := contextJSON(s.DB.QueryRow(ctx, "SELECT to_jsonb(s) FROM agent_context_session s WHERE id=$1", id), &row)
	return row, err
}

func (s *AgentContextService) List(ctx context.Context, workspaceID, scopeType, scopeID string) ([]contextstate.Session, error) {
	var out []contextstate.Session
	err := contextJSON(s.DB.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY updated_at DESC), '[]')
		FROM agent_context_session s WHERE workspace_id=$1 AND scope_type=$2 AND scope_id=$3`, workspaceID, scopeType, scopeID), &out)
	if err != nil {
		return nil, err
	}
	for i := range out {
		var operations []contextstate.Operation
		err = contextJSON(s.DB.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(value),'[]') FROM (SELECT `+operationJSON+` AS value FROM agent_context_operation o WHERE session_id=$1 ORDER BY created_at DESC LIMIT 20) x`, out[i].ID), &operations)
		if err != nil {
			return nil, err
		}
		out[i].Operations = operations
		if len(operations) > 0 {
			out[i].Operation = &operations[0]
		}

		out[i].LeaseToken = ""
		out[i].NativeID = ""
		out[i].ProducerID = ""
	}
	return out, nil
}

const operationJSON = `to_jsonb(o) || jsonb_build_object('before',o.before_snapshot,'after',o.after_snapshot)`

func (s *AgentContextService) LatestOperation(ctx context.Context, sessionID string) (contextstate.Operation, error) {
	var op contextstate.Operation
	err := contextJSON(s.DB.QueryRow(ctx, "SELECT "+operationJSON+" FROM agent_context_operation o WHERE session_id=$1 ORDER BY created_at DESC LIMIT 1", sessionID), &op)
	return op, err
}

func (s *AgentContextService) Operation(ctx context.Context, id string) (contextstate.Operation, error) {
	var op contextstate.Operation
	err := contextJSON(s.DB.QueryRow(ctx, "SELECT "+operationJSON+" FROM agent_context_operation o WHERE id=$1", id), &op)
	return op, err
}

// BeginTurn grants a fenced lease before environment preparation. A queued
// maintenance request wins the next slot without interrupting the current run.
func (s *AgentContextService) BeginTurn(ctx context.Context, input contextstate.Session) (contextstate.Session, error) {
	tx, err := s.Begin(ctx)
	if err != nil {
		return contextstate.Session{}, err
	}
	defer tx.Rollback(ctx)
	if err = lockContextScopeParents(ctx, tx, input); err != nil {
		return input, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO agent_context_session(workspace_id,agent_id,scope_type,scope_id,runtime_id,provider)
		VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,agent_id,scope_type,scope_id) DO NOTHING`,
		input.WorkspaceID, input.AgentID, input.ScopeType, input.ScopeID, input.RuntimeID, input.Provider)
	if err != nil {
		return contextstate.Session{}, err
	}
	var current contextSessionRow
	err = contextJSON(tx.QueryRow(ctx, `SELECT to_jsonb(s) FROM agent_context_session s
		WHERE workspace_id=$1 AND agent_id=$2 AND scope_type=$3 AND scope_id=$4 FOR UPDATE`,
		input.WorkspaceID, input.AgentID, input.ScopeType, input.ScopeID), &current)
	if err != nil {
		return contextstate.Session{}, err
	}
	if current.LeaseToken != "" && current.LeaseOwner == input.TaskID && current.LeaseKind == "turn" && current.ProducerID == input.ProducerID {
		return current.Session, nil
	}
	if current.LeaseToken != "" {
		var active bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM agent_task_queue WHERE id=$1 AND status IN ('dispatched','running','waiting_local_directory'))`, current.LeaseOwner).Scan(&active)
		if err != nil {
			return contextstate.Session{}, err
		}
		if active || current.LeaseKind == "maintenance" || (current.LeaseExpiresAt != nil && current.LeaseExpiresAt.After(time.Now())) {
			return contextstate.Session{}, ErrContextBusy
		}
	}
	var pending bool
	err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM agent_context_operation WHERE session_id=$1 AND status IN ('queued','running','reconciliation_required'))", current.ID).Scan(&pending)
	if err != nil {
		return contextstate.Session{}, err
	}
	if pending {
		return contextstate.Session{}, ErrContextBusy
	}
	var result contextstate.Session
	err = contextJSON(tx.QueryRow(ctx, `UPDATE agent_context_session s SET
		generation=generation+CASE WHEN runtime_id<>$2 OR provider<>$3 THEN 1 ELSE 0 END,
		native_id=CASE WHEN runtime_id<>$2 OR provider<>$3 THEN '' ELSE native_id END,
		snapshot=CASE WHEN runtime_id<>$2 OR provider<>$3 THEN NULL ELSE snapshot END,
		runtime_id=$2,provider=$3,task_id=$4,capabilities=$5,epoch=epoch+1,event_seq=0,peak_tokens=0,
		producer_id=$6,lease_token=gen_random_uuid(),lease_kind='turn',lease_owner=$4,lease_expires_at=now()+interval '60 seconds',updated_at=now()
		WHERE id=$1 RETURNING to_jsonb(s)`, current.ID, input.RuntimeID, input.Provider, input.TaskID, contextEncode(input.Capabilities), input.ProducerID), &result)
	if err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}

func (s *AgentContextService) Update(ctx context.Context, id string, update contextstate.Update) (contextstate.Session, error) {
	tx, err := s.Begin(ctx)
	if err != nil {
		return contextstate.Session{}, err
	}
	defer tx.Rollback(ctx)
	var current contextSessionRow
	err = contextJSON(tx.QueryRow(ctx, "SELECT to_jsonb(s) FROM agent_context_session s WHERE id=$1 FOR UPDATE", id), &current)
	if err != nil {
		return contextstate.Session{}, err
	}
	if current.LeaseToken == "" && current.Epoch == update.Epoch && update.Release {
		// Terminal replay acknowledges an already closed epoch, without writes.
		return current.Session, nil
	}
	if current.LeaseToken != update.LeaseToken || current.Epoch != update.Epoch {
		return current.Session, ErrContextStale
	}
	if update.EventSeq < current.EventSeq && (update.Snapshot != nil || update.NativeID != "") {
		return current.Session, ErrContextStale
	}
	if update.Snapshot != nil && (update.Snapshot.SessionID == "" || (update.NativeID != "" && update.Snapshot.SessionID != update.NativeID) || (update.NativeID == "" && update.Snapshot.SessionID != current.NativeID)) {
		return current.Session, fmt.Errorf("snapshot session does not match target")
	}
	var result contextstate.Session
	err = contextJSON(tx.QueryRow(ctx, `UPDATE agent_context_session s SET
		generation=generation+CASE WHEN $4<>'' AND native_id<>'' AND native_id<>$4 THEN 1 ELSE 0 END,
		snapshot=CASE WHEN $8 THEN NULL WHEN $3>event_seq AND $5::jsonb IS NOT NULL THEN $5::jsonb
			WHEN $4<>'' AND native_id<>$4 THEN NULL ELSE snapshot END,
		native_id=CASE WHEN $4<>'' THEN $4 ELSE native_id END,
		event_seq=GREATEST(event_seq,$3),peak_tokens=CASE WHEN $4<>'' AND native_id<>$4 THEN $6 ELSE GREATEST(peak_tokens,$6) END,
		lease_token=CASE WHEN $7 THEN NULL ELSE lease_token END,
		lease_kind=CASE WHEN $7 THEN NULL ELSE lease_kind END,
		lease_owner=CASE WHEN $7 THEN NULL ELSE lease_owner END,
		lease_expires_at=CASE WHEN $7 THEN NULL ELSE now()+interval '60 seconds' END,updated_at=now()
		WHERE id=$1 AND epoch=$2 RETURNING to_jsonb(s)`, id, update.Epoch, update.EventSeq, update.NativeID,
		contextSnapshotJSON(update), update.PeakTokens, update.Release,
		current.LeaseKind == "maintenance" && update.Status == "succeeded" && update.Snapshot == nil), &result)
	if err != nil {
		return result, err
	}
	if current.LeaseKind == "turn" && (update.Snapshot != nil || update.Release) {
		var first []byte
		if update.FirstSnapshot != nil {
			first = contextEncode(update.FirstSnapshot)
		}
		_, err = tx.Exec(ctx, `UPDATE agent_context_turn SET first_snapshot=COALESCE(first_snapshot,$2::jsonb),last_snapshot=COALESCE($3::jsonb,last_snapshot),peak_tokens=GREATEST(peak_tokens,$4) WHERE task_id=$1`, current.TaskID, first, contextSnapshotJSON(update), update.PeakTokens)
		if err != nil {
			return result, err
		}
	}
	if current.LeaseKind == "maintenance" && update.Release && update.Status == "" {
		return result, fmt.Errorf("maintenance release requires a terminal result")
	}
	if current.LeaseKind == "maintenance" && update.Status != "" {
		if !contextstate.Terminal(update.Status) && update.Status != "reconciliation_required" {
			return result, fmt.Errorf("invalid maintenance status")
		}
		if contextstate.Terminal(update.Status) != update.Release {
			return result, fmt.Errorf("terminal maintenance must release lease")
		}
		_, err = tx.Exec(ctx, `UPDATE agent_context_operation SET status=$2,reason=$3,after_snapshot=$4,usage=COALESCE(NULLIF($5::jsonb,'null'::jsonb),usage),duration_ms=COALESCE($6,duration_ms),finished_at=CASE WHEN $7 THEN now() ELSE finished_at END,updated_at=now() WHERE id=$1`,
			current.LeaseOwner, update.Status, update.Reason, contextSnapshotJSON(update), contextEncode(update.Usage), update.DurationMs, update.Release)
		if err != nil {
			return result, err
		}
	}
	return result, tx.Commit(ctx)
}

func contextSnapshotJSON(update contextstate.Update) []byte {
	if update.Snapshot == nil {
		return nil
	}
	return contextEncode(update.Snapshot)
}

func (s *AgentContextService) CreateOperation(ctx context.Context, id, actor, key string, generation int64) (contextstate.Operation, error) {
	tx, err := s.Begin(ctx)
	if err != nil {
		return contextstate.Operation{}, err
	}
	defer tx.Rollback(ctx)
	var session contextstate.Session
	if err = contextJSON(tx.QueryRow(ctx, "SELECT to_jsonb(s) FROM agent_context_session s WHERE id=$1 FOR UPDATE", id), &session); err != nil {
		return contextstate.Operation{}, err
	}
	var existing contextstate.Operation
	err = contextJSON(tx.QueryRow(ctx, "SELECT "+operationJSON+" FROM agent_context_operation o JOIN agent_context_request r ON r.operation_id=o.id WHERE r.workspace_id=$1 AND r.actor_id=$2 AND r.idempotency_key=$3", session.WorkspaceID, actor, key), &existing)
	if err == nil {
		if existing.SessionID != id || existing.Generation != generation {
			return existing, ErrContextStale
		}
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return existing, err
	}
	if session.Generation != generation {
		return existing, ErrContextStale
	}
	if session.NativeID == "" || !session.Capabilities.NativeCompact || !session.Capabilities.CompletionSignal {
		return existing, ErrContextUnsupported
	}
	err = contextJSON(tx.QueryRow(ctx, "SELECT "+operationJSON+" FROM agent_context_operation o WHERE session_id=$1 AND status IN ('queued','running','reconciliation_required')", id), &existing)
	if err == nil {
		if err = saveContextRequest(ctx, tx, session, actor, key, existing.ID); err != nil {
			return existing, err
		}
		return existing, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return existing, err
	}
	err = contextJSON(tx.QueryRow(ctx, `INSERT INTO agent_context_operation AS o(session_id,workspace_id,generation,actor_id,idempotency_key,before_snapshot)
		VALUES($1,$2,$3,$4,$5,$6) RETURNING `+operationJSON, id, session.WorkspaceID, generation, actor, key, contextEncode(session.Snapshot)), &existing)
	if err != nil {
		return existing, err
	}
	if err = saveContextRequest(ctx, tx, session, actor, key, existing.ID); err != nil {
		return existing, err
	}
	return existing, tx.Commit(ctx)
}

func saveContextRequest(ctx context.Context, tx pgx.Tx, session contextstate.Session, actor, key, operationID string) error {
	_, err := tx.Exec(ctx, `INSERT INTO agent_context_request(workspace_id,actor_id,idempotency_key,session_id,operation_id) VALUES($1,$2,$3,$4,$5)`, session.WorkspaceID, actor, key, session.ID, operationID)
	return err
}

// ClaimMaintenance also returns expired operations for reconciliation. The
// daemon must acquire the native session's process lock before resolving them.
func (s *AgentContextService) ClaimMaintenance(ctx context.Context, runtimeID string) (contextstate.Session, error) {
	tx, err := s.Begin(ctx)
	if err != nil {
		return contextstate.Session{}, err
	}
	defer tx.Rollback(ctx)
	var session contextSessionRow
	err = contextJSON(tx.QueryRow(ctx, `SELECT to_jsonb(s) FROM agent_context_session s
		WHERE runtime_id=$1 AND EXISTS(SELECT 1 FROM agent_context_operation o WHERE o.session_id=s.id AND o.status IN ('queued','running','reconciliation_required'))
		AND (lease_token IS NULL OR (lease_expires_at<now() AND (lease_kind='maintenance' OR NOT EXISTS
			(SELECT 1 FROM agent_task_queue t WHERE t.id=s.lease_owner AND t.status IN ('dispatched','running','waiting_local_directory')))))
		ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1`, runtimeID), &session)
	if err != nil {
		return contextstate.Session{}, err
	}
	var op contextstate.Operation
	err = contextJSON(tx.QueryRow(ctx, "SELECT "+operationJSON+" FROM agent_context_operation o WHERE session_id=$1 AND status IN ('queued','running','reconciliation_required')", session.ID), &op)
	if err != nil {
		return session.Session, err
	}
	if op.Generation != session.Generation {
		_, err = tx.Exec(ctx, "UPDATE agent_context_operation SET status='stale_target',reason='session changed',finished_at=now(),updated_at=now() WHERE id=$1", op.ID)
		if err != nil {
			return session.Session, err
		}
		return contextstate.Session{}, tx.Commit(ctx)
	}
	status := "running"
	if op.Status != "queued" {
		status = "reconciliation_required"
	}
	_, err = tx.Exec(ctx, "UPDATE agent_context_operation SET status=$2,started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1", op.ID, status)
	if err != nil {
		return session.Session, err
	}
	var result contextstate.Session
	err = contextJSON(tx.QueryRow(ctx, `UPDATE agent_context_session s SET epoch=epoch+1,event_seq=0,lease_token=gen_random_uuid(),
		lease_owner=$2,lease_kind='maintenance',lease_expires_at=now()+interval '60 seconds',updated_at=now()
		WHERE id=$1 RETURNING to_jsonb(s)`, session.ID, op.ID), &result)
	if err != nil {
		return result, err
	}
	op.Status = status
	result.Operation = &op
	return result, tx.Commit(ctx)
}

func (s *AgentContextService) CancelOperation(ctx context.Context, id string) (contextstate.Operation, error) {
	var op contextstate.Operation
	err := contextJSON(s.DB.QueryRow(ctx, `UPDATE agent_context_operation o SET status='cancelled',reason='cancelled by user',finished_at=now(),updated_at=now()
		WHERE id=$1 AND status='queued' RETURNING `+operationJSON, id), &op)
	if errors.Is(err, pgx.ErrNoRows) {
		return s.Operation(ctx, id)
	}
	return op, err
}

func lockContextScopeParents(ctx context.Context, tx pgx.Tx, input contextstate.Session) error {
	// Parent locks fence application-owned cleanup without adding foreign keys.
	var parent string
	var err error
	if err = tx.QueryRow(ctx, "SELECT id FROM workspace WHERE id=$1 FOR KEY SHARE", input.WorkspaceID).Scan(&parent); err != nil {
		return err
	}
	if input.ScopeType == "issue" {
		err = tx.QueryRow(ctx, "SELECT id FROM issue WHERE id=$1 AND workspace_id=$2 FOR KEY SHARE", input.ScopeID, input.WorkspaceID).Scan(&parent)
	} else if input.ScopeType == "chat" {
		err = tx.QueryRow(ctx, "SELECT id FROM chat_session WHERE id=$1 AND workspace_id=$2 FOR KEY SHARE", input.ScopeID, input.WorkspaceID).Scan(&parent)
	} else {
		return ErrContextUnsupported
	}
	if err != nil {
		return err
	}

	return nil
}
