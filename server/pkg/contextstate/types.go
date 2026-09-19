// Package contextstate defines the wire contract shared by the API and daemon.
package contextstate

import (
	"time"

	"github.com/enact-ai/enact/server/pkg/agent"
)

type Session struct {
	FinalDelivery bool                      `json:"final_delivery,omitempty"`
	ProducerID    string                    `json:"producer_id,omitempty"`
	Envelope      *Envelope                 `json:"envelope,omitempty"`
	ID            string                    `json:"id"`
	WorkspaceID   string                    `json:"workspace_id"`
	AgentID       string                    `json:"agent_id"`
	ScopeType     string                    `json:"scope_type"`
	ScopeID       string                    `json:"scope_id"`
	RuntimeID     string                    `json:"runtime_id"`
	Provider      string                    `json:"provider"`
	NativeID      string                    `json:"native_id,omitempty"`
	Generation    int64                     `json:"generation"`
	Epoch         int64                     `json:"epoch"`
	EventSeq      int64                     `json:"event_seq"`
	TaskID        string                    `json:"task_id,omitempty"`
	Capabilities  agent.ContextCapabilities `json:"capabilities"`
	Snapshot      *agent.ContextSnapshot    `json:"snapshot"`
	PeakTokens    int64                     `json:"peak_tokens"`
	UpdatedAt     time.Time                 `json:"updated_at"`
	LeaseToken    string                    `json:"lease_token,omitempty"`
	Operations    []Operation               `json:"operations,omitempty"`
	Operation     *Operation                `json:"operation,omitempty"`
}

type Operation struct {
	StartedAt  *time.Time                  `json:"started_at,omitempty"`
	FinishedAt *time.Time                  `json:"finished_at,omitempty"`
	DurationMs *int64                      `json:"duration_ms,omitempty"`
	ID         string                      `json:"id"`
	SessionID  string                      `json:"session_id"`
	Generation int64                       `json:"generation"`
	ActorID    string                      `json:"actor_id"`
	Status     string                      `json:"status"`
	Reason     string                      `json:"reason,omitempty"`
	CreatedAt  time.Time                   `json:"created_at"`
	UpdatedAt  time.Time                   `json:"updated_at"`
	Before     *agent.ContextSnapshot      `json:"before"`
	After      *agent.ContextSnapshot      `json:"after"`
	Usage      map[string]agent.TokenUsage `json:"usage,omitempty"`
}

type TurnRequest struct {
	ProducerID    string                    `json:"producer_id"`
	FinalDelivery bool                      `json:"final_delivery"`
	Provider      string                    `json:"provider"`
	Capabilities  agent.ContextCapabilities `json:"capabilities"`
}

type Update struct {
	DurationMs    *int64                      `json:"duration_ms,omitempty"`
	FirstSnapshot *agent.ContextSnapshot      `json:"first_snapshot,omitempty"`
	LeaseToken    string                      `json:"lease_token"`
	Epoch         int64                       `json:"epoch"`
	EventSeq      int64                       `json:"event_seq"`
	NativeID      string                      `json:"native_id,omitempty"`
	Snapshot      *agent.ContextSnapshot      `json:"snapshot,omitempty"`
	PeakTokens    int64                       `json:"peak_tokens"`
	Release       bool                        `json:"release,omitempty"`
	Status        string                      `json:"status,omitempty"`
	Reason        string                      `json:"reason,omitempty"`
	Usage         map[string]agent.TokenUsage `json:"usage,omitempty"`
}

func Terminal(status string) bool {
	switch status {
	case "succeeded", "skipped", "failed", "cancelled", "stale_target", "closed_unknown":
		return true
	default:
		return false
	}
}
