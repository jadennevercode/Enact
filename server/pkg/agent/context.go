package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"runtime"
	"time"
)

// NativeCompactor is optional; ordinary backends need only implement Execute.
type NativeCompactor interface {
	Compact(context.Context, ExecOptions) (*Session, error)
}

func (b *codexBackend) Compact(ctx context.Context, opts ExecOptions) (*Session, error) {
	if !b.cfg.BuiltinRuntime || opts.ResumeSessionID == "" {
		return nil, fmt.Errorf("native compaction requires a supported existing session")
	}
	opts.NativeCompaction = true
	return b.Execute(ctx, "", opts)
}

func (b *claudeBackend) Compact(ctx context.Context, opts ExecOptions) (*Session, error) {
	if !b.cfg.BuiltinRuntime || opts.ResumeSessionID == "" {
		return nil, fmt.Errorf("native compaction requires a supported existing session")
	}
	opts.NativeCompaction = true
	return b.Execute(ctx, "/compact", opts)
}

// ContextSnapshot describes the current native window, never cumulative billing.
type ContextSnapshot struct {
	SessionID    string    `json:"session_id"`
	Model        string    `json:"model,omitempty"`
	UsedTokens   *int64    `json:"used_tokens"`
	WindowTokens *int64    `json:"window_tokens"`
	Basis        string    `json:"basis"`
	IsEstimate   bool      `json:"is_estimate"`
	ObservedAt   time.Time `json:"observed_at"`
}

func (s ContextSnapshot) Percent() *float64 {
	if s.UsedTokens == nil || s.WindowTokens == nil || *s.WindowTokens <= 0 || *s.UsedTokens < 0 {
		return nil
	}
	p := math.Min(100, math.Max(0, float64(*s.UsedTokens)/float64(*s.WindowTokens)*100))
	return &p
}

// ContextCapabilities are independent of basic execution support. Custom
// protocol-family wrappers do not inherit the vendor's maintenance contract.
type ContextCapabilities struct {
	RuntimeVersion   string `json:"runtime_version,omitempty"`
	Protocol         string `json:"protocol,omitempty"`
	Telemetry        bool   `json:"context_telemetry"`
	NativeCompact    bool   `json:"native_compact"`
	CompletionSignal bool   `json:"compact_completion_signal"`
}

func NativeContextCapabilities(provider string, builtin bool) ContextCapabilities {
	switch provider {
	case "codex", "claude":
		return ContextCapabilities{Telemetry: true, NativeCompact: builtin && runtime.GOOS != "windows", CompletionSignal: builtin}
	default:
		return ContextCapabilities{}
	}
}

// RuntimeContextCapabilities gates optional maintenance on a detected vendor
// version as well as the adapter contract. Unknown versions remain runnable.
func RuntimeContextCapabilities(provider string, builtin bool, version string) ContextCapabilities {
	caps := NativeContextCapabilities(provider, builtin)
	caps.RuntimeVersion = version
	parsed, err := parseSemver(version)
	supported := err == nil && CheckMinVersion(provider, version) == nil
	if provider == "codex" {
		supported = supported && parsed.Major == 0
		caps.Protocol = "codex-app-server-v2"
	}
	if provider == "claude" {
		supported = supported && parsed.Major == 2
		caps.Protocol = "claude-stream-json-v2"
	}
	caps.NativeCompact = caps.NativeCompact && supported
	caps.CompletionSignal = caps.CompletionSignal && supported
	return caps
}

func codexContextSnapshot(params map[string]any) *ContextSnapshot {
	encoded, err := json.Marshal(params)
	if err != nil {
		return nil
	}
	var event struct {
		ThreadID string `json:"threadId"`
		Usage    struct {
			Last struct {
				Total *int64 `json:"totalTokens"`
			} `json:"last"`
			Window *int64 `json:"modelContextWindow"`
		} `json:"tokenUsage"`
	}
	if json.Unmarshal(encoded, &event) != nil || event.ThreadID == "" || event.Usage.Last.Total == nil || *event.Usage.Last.Total < 0 {
		return nil
	}
	if event.Usage.Window != nil && *event.Usage.Window <= 0 {
		event.Usage.Window = nil
	}
	return &ContextSnapshot{
		SessionID: event.ThreadID, UsedTokens: event.Usage.Last.Total,
		WindowTokens: event.Usage.Window, Basis: "codex_effective_window",
		IsEstimate: true, ObservedAt: time.Now().UTC(),
	}
}
