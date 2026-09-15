package agent

import (
	"encoding/json"
	"testing"
)

func TestCodexContextUsesLastTotalIncludingPostCompactionEstimate(t *testing.T) {
	for _, raw := range []string{
		`{"threadId":"s","tokenUsage":{"total":{"totalTokens":1000000},"last":{"totalTokens":40000},"modelContextWindow":200000}}`,
		`{"threadId":"s","tokenUsage":{"total":{"totalTokens":2000000},"last":{"totalTokens":40000,"inputTokens":0,"outputTokens":0},"modelContextWindow":200000}}`,
	} {
		var params map[string]any
		if err := json.Unmarshal([]byte(raw), &params); err != nil {
			t.Fatal(err)
		}
		s := codexContextSnapshot(params)
		if s == nil || s.Percent() == nil || *s.Percent() != 20 {
			t.Fatalf("current context must be 20%%, got %+v", s)
		}
	}
}

func TestCodexContextMissingWindowIsUnknown(t *testing.T) {
	var params map[string]any
	_ = json.Unmarshal([]byte(`{"threadId":"s","tokenUsage":{"last":{"totalTokens":40000}}}`), &params)
	s := codexContextSnapshot(params)
	if s == nil || s.Percent() != nil {
		t.Fatalf("unknown window: %+v", s)
	}
}

func TestUnknownRuntimeDoesNotAcquireNativeMaintenance(t *testing.T) {
	for _, provider := range []string{"unknown", "codex", "claude"} {
		if NativeContextCapabilities(provider, false).NativeCompact {
			t.Fatalf("custom runtime %s must not inherit vendor maintenance", provider)
		}
	}
}

func TestContextTelemetryDoesNotAcceptOtherThreadOrOpenTurnGate(t *testing.T) {
	gate := &codexTurnNotificationGate{}
	client := &codexClient{threadID: "main", acceptNotification: gate.accept}
	for _, id := range []string{"child", "main"} {
		raw := map[string]json.RawMessage{
			"method": json.RawMessage(`"thread/tokenUsage/updated"`),
			"params": json.RawMessage(`{"threadId":"` + id + `","tokenUsage":{"last":{"totalTokens":40},"modelContextWindow":200}}`),
		}
		client.handleNotification(raw)
		if id == "child" && client.contextSnapshot != nil {
			t.Fatal("child context leaked into parent")
		}
	}
	if client.contextSnapshot == nil || gate.started || gate.armed.Load() {
		t.Fatal("resume telemetry must update snapshot without opening the turn gate")
	}
}

func TestContextMaintenanceUnknownVersionDegradesOnlyOptionalCapability(t *testing.T) {
	for _, version := range []string{"", "unidentified", "99.0.0"} {
		for _, provider := range []string{"claude", "codex"} {
			caps := RuntimeContextCapabilities(provider, true, version)
			if caps.NativeCompact || caps.CompletionSignal {
				t.Fatalf("unknown version enabled control: %+v", caps)
			}
			if !caps.Telemetry {
				t.Fatal("version gate disabled read-only telemetry")
			}
		}
	}
}
