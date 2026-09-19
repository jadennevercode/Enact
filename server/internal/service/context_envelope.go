package service

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sort"
	"strconv"

	"github.com/enact-ai/enact/server/pkg/contextstate"
	"github.com/jackc/pgx/v5"
)

// BuildContextEnvelope uses one MVCC snapshot for content and its watermark.
// No incomplete bundle can authorize skipping the normal bounded reads.
func (s *AgentContextService) BuildContextEnvelope(ctx context.Context, session contextstate.Session, finalDelivery bool) (*contextstate.Envelope, error) {
	if session.ScopeType != "issue" && session.ScopeType != "chat" {
		return nil, nil
	}
	tx, err := s.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"); err != nil {
		return nil, err
	}
	if err = lockContextScopeParents(ctx, tx, session); err != nil {
		return nil, err
	}
	var old contextstate.Envelope
	if err = contextJSON(tx.QueryRow(ctx, "SELECT COALESCE(delivered_envelope,envelope) FROM agent_context_turn WHERE task_id=$1", session.TaskID), &old); err == nil {
		if session.ScopeType == "chat" && old.Checkpoint == nil {
			return nil, nil
		}
		return &old, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	envelope := contextstate.Envelope{ScopeType: session.ScopeType, Protocol: "v1", Comments: []contextstate.Input{}, Complete: true}
	var revision int64
	if session.ScopeType == "issue" {
		err = tx.QueryRow(ctx, `SELECT revision,to_jsonb(i) FROM issue i WHERE id=$1 AND workspace_id=$2`, session.ScopeID, session.WorkspaceID).Scan(&revision, &envelope.Issue)
		if err != nil {
			return nil, err
		}
		envelope.SourceRevision = strconv.FormatInt(revision, 10)
		err = contextJSON(tx.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.created_at,c.id),'[]') FROM
 (SELECT id,revision,parent_id,author_type,content,created_at FROM comment WHERE issue_id=$1 AND workspace_id=$2 ORDER BY created_at,id LIMIT 201) c`, session.ScopeID, session.WorkspaceID), &envelope.Comments)
		if err != nil {
			return nil, err
		}
	} else {
		err = tx.QueryRow(ctx, `SELECT 0,jsonb_build_object('id',id,'title',title,'agent_id',agent_id) FROM chat_session WHERE id=$1 AND workspace_id=$2`, session.ScopeID, session.WorkspaceID).Scan(&revision, &envelope.Chat)
		if err != nil {
			return nil, err
		}
		envelope.SourceRevision = strconv.FormatInt(revision, 10)
		err = contextJSON(tx.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.created_at,c.id),'[]') FROM
	 (SELECT id,context_revision AS revision,role AS author_type,content,created_at FROM chat_message WHERE chat_session_id=$1 AND EXISTS(SELECT 1 FROM chat_session WHERE id=$1 AND workspace_id=$2) AND message_kind NOT IN ('channel_command','no_response') ORDER BY created_at,id LIMIT 201) c`, session.ScopeID, session.WorkspaceID), &envelope.Comments)
		if err != nil {
			return nil, err
		}
	}
	if session.ScopeType == "chat" {
		// A content-derived watermark avoids taking the chat session write lock
		// when messages arrive during claim/completion transactions.
		envelope.SourceRevision = fmt.Sprintf("%x", sha256.Sum256(contextEncode(envelope)))
	}
	if len(envelope.Comments) > 200 {
		envelope.Complete = false
		envelope.Gap = "history exceeds the 200-comment envelope budget; read bounded threads"
	}
	raw := contextEncode(envelope)
	if len(raw) > 48000 {
		envelope.Complete = false
		envelope.Gap = "source content exceeds the envelope byte budget; read the issue and bounded threads"
	}
	// Never inject truncated user constraints under a completeness assertion.
	if !envelope.Complete {
		envelope.Issue = nil
		envelope.Chat = nil
		envelope.Comments = []contextstate.Input{}
	}
	_, err = tx.Exec(ctx, `INSERT INTO agent_context_turn(task_id,workspace_id,agent_id,scope_type,scope_id,source_revision,envelope,final_delivery)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(task_id) DO NOTHING`, session.TaskID, session.WorkspaceID, session.AgentID, session.ScopeType, session.ScopeID, envelope.SourceRevision, contextEncode(envelope), finalDelivery)
	if err != nil {
		return nil, err
	}
	// A checkpoint is only an optimization when its source was acknowledged in
	// full. Every edited/new input and every deletion remains explicit.
	if envelope.Complete {
		var candidates []struct {
			AgentID    string                  `json:"agent_id"`
			Checkpoint contextstate.Checkpoint `json:"checkpoint"`
			Envelope   contextstate.Envelope   `json:"envelope"`
		}
		err = contextJSON(tx.QueryRow(ctx, `SELECT COALESCE(jsonb_agg(x.value),'[]') FROM (SELECT jsonb_build_object('agent_id',c.agent_id,'checkpoint',c.body,'envelope',t.envelope) AS value
		 FROM agent_context_checkpoint c JOIN agent_context_turn t ON t.task_id=c.source_task_id
		 WHERE c.workspace_id=$1 AND c.scope_type=$2 AND c.scope_id=$3 AND t.processed
		 ORDER BY c.created_at DESC LIMIT 20) x`, session.WorkspaceID, session.ScopeType, session.ScopeID), &candidates)
		if err != nil {
			return nil, err
		}
		for _, candidate := range candidates {
			if !candidate.Envelope.Complete || (candidate.AgentID != session.AgentID && (s.CanReadCheckpoint == nil || !s.CanReadCheckpoint(ctx, candidate.AgentID))) {
				continue
			}
			envelope.Checkpoint = &candidate.Checkpoint
			versions := map[string]int64{}
			for _, v := range candidate.Envelope.Comments {
				versions[v.ID] = v.Revision
			}
			delta := []contextstate.Input{}
			for _, input := range envelope.Comments {
				if versions[input.ID] != input.Revision {
					delta = append(delta, input)
				}
				delete(versions, input.ID)
			}
			for id := range versions {
				envelope.Deleted = append(envelope.Deleted, id)
			}
			sort.Strings(envelope.Deleted)
			envelope.Comments = delta
			break
		}

	}
	// Persist the exact injected delta as well as its full source manifest.
	// Retries return the same input; measurement distinguishes source from wire bytes.
	if session.ScopeType != "chat" || envelope.Checkpoint != nil {
		if _, err = tx.Exec(ctx, "UPDATE agent_context_turn SET delivered_envelope=$2 WHERE task_id=$1", session.TaskID, contextEncode(envelope)); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	// Ordinary Chat already resumes native history. Avoid reinjecting the full
	// transcript when no completed checkpoint exists; the CLI can still read
	// the stored versioned manifest explicitly.
	if session.ScopeType == "chat" && envelope.Checkpoint == nil {
		return nil, nil
	}
	return &envelope, nil
}

func (s *AgentContextService) SaveCheckpoint(ctx context.Context, session contextstate.Session, checkpoint contextstate.Checkpoint) (contextstate.Checkpoint, error) {
	tx, err := s.Begin(ctx)
	if err != nil {
		return checkpoint, err
	}
	defer tx.Rollback(ctx)
	var envelope contextstate.Envelope
	err = contextJSON(tx.QueryRow(ctx, "SELECT envelope FROM agent_context_turn WHERE task_id=$1 AND workspace_id=$2 AND agent_id=$3 FOR UPDATE", session.TaskID, session.WorkspaceID, session.AgentID), &envelope)
	if err != nil {
		return checkpoint, err
	}
	if !envelope.Complete || checkpoint.SourceRevision != envelope.SourceRevision {
		return checkpoint, ErrContextStale
	}
	if checkpoint.Summary == "" || len(contextEncode(checkpoint)) > 16000 {
		return checkpoint, fmt.Errorf("checkpoint requires a summary within 16KB")
	}
	expected := map[string]int64{}
	for _, input := range envelope.Comments {
		expected[input.ID] = input.Revision
	}
	for _, input := range checkpoint.Processed {
		if expected[input.ID] != input.Revision {
			return checkpoint, ErrContextStale
		}
		delete(expected, input.ID)
	}
	if len(expected) != 0 {
		return checkpoint, fmt.Errorf("checkpoint must acknowledge every delivered input version")
	}
	checkpoint.SourceTaskID = session.TaskID
	// First checkpoint wins for a source execution; retries return that receipt.
	var existing contextstate.Checkpoint
	err = contextJSON(tx.QueryRow(ctx, "SELECT body FROM agent_context_checkpoint WHERE source_task_id=$1 AND revision=1", session.TaskID), &existing)
	if err == nil {
		return existing, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return checkpoint, err
	}
	err = tx.QueryRow(ctx, `INSERT INTO agent_context_checkpoint(workspace_id,agent_id,scope_type,scope_id,source_task_id,source_revision,body)
 VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, session.WorkspaceID, session.AgentID, session.ScopeType, session.ScopeID, session.TaskID, checkpoint.SourceRevision, contextEncode(checkpoint)).Scan(&checkpoint.ID)
	if err != nil {
		return checkpoint, err
	}
	_, err = tx.Exec(ctx, "UPDATE agent_context_checkpoint SET body=$2 WHERE id=$1", checkpoint.ID, contextEncode(checkpoint))
	if err != nil {
		return checkpoint, err
	}
	return checkpoint, tx.Commit(ctx)
}
