//go:build agentintegration

package agent

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/modeloperation"
)

// This test uses the user's authenticated CLI only with explicit smoke-test
// authorization. Normal tests never discover or execute installed agents.
func TestModelOperationRealRuntime(t *testing.T) {
	if os.Getenv("ENACT_RUN_REAL_AGENT_SMOKE") != "1" {
		t.Skip("set ENACT_RUN_REAL_AGENT_SMOKE=1 to authorize a real CLI model operation")
	}
	for _, provider := range []string{"codex", "claude"} {
		t.Run(provider, func(t *testing.T) {
			path, err := exec.LookPath(provider)
			if err != nil {
				t.Skip("runtime executable unavailable")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
			defer cancel()
			result, err := ExecuteModelOperation(ctx, provider, Config{ExecutablePath: path, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}, "Return the answer 42 as a JSON object, with no tools.", ExecOptions{ResponseSchema: json.RawMessage(`{"type":"object","properties":{"answer":{"type":"integer"}},"required":["answer"],"additionalProperties":false}`), Timeout: 180 * time.Second})
			if err != nil {
				t.Fatal(err)
			}
			if result.Status != "completed" {
				t.Fatalf("status=%s error=%s", result.Status, result.Error)
			}
			var out struct {
				Answer int `json:"answer"`
			}
			if json.Unmarshal([]byte(result.Output), &out) != nil || out.Answer != 42 {
				t.Fatalf("invalid structured response: %q", result.Output)
			}
		})
	}
}

func TestModelOperationRealRuntimePydanticExtractionSchema(t *testing.T) {
	if os.Getenv("ENACT_RUN_REAL_AGENT_SMOKE") != "1" {
		t.Skip("set ENACT_RUN_REAL_AGENT_SMOKE=1 to authorize a real CLI model operation")
	}
	path, err := exec.LookPath("codex")
	if err != nil {
		t.Skip("runtime executable unavailable")
	}
	// Semantica EntityOut/EntitiesResponse shape: nested definitions, optional
	// defaulted fields, open metadata, and no strict-output transport annotations.
	schema := json.RawMessage(`{"$defs":{"EntityOut":{"properties":{"text":{"type":"string"},"label":{"type":"string"},"start_char":{"default":0,"type":"integer"},"end_char":{"default":0,"type":"integer"},"confidence":{"default":0.9,"type":"number"},"metadata":{"additionalProperties":true,"type":"object"}},"required":["text","label"],"type":"object"}},"properties":{"entities":{"items":{"$ref":"#/$defs/EntityOut"},"type":"array"}},"type":"object"}`)
	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()
	result, err := ExecuteModelOperation(ctx, "codex", Config{ExecutablePath: path, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}, "Extract the person from this source text: Alice works at a factory. Return exactly one entity, text Alice, label PERSON, start_char 0, end_char 5, confidence 1.0, metadata {source: fixture, language: en}. No tools.", ExecOptions{ResponseSchema: schema, Timeout: 180 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" {
		t.Fatalf("status=%s error=%s", result.Status, result.Error)
	}
	if err := modeloperation.ValidateResult(schema, json.RawMessage(result.Output)); err != nil {
		t.Fatal(err)
	}
	var out struct {
		Entities []struct {
			Text     string
			Label    string
			Metadata map[string]any
		}
	}
	if err := json.Unmarshal([]byte(result.Output), &out); err != nil || len(out.Entities) != 1 || out.Entities[0].Text != "Alice" || out.Entities[0].Label != "PERSON" || out.Entities[0].Metadata["source"] != "fixture" || out.Entities[0].Metadata["language"] != "en" {
		t.Fatalf("open metadata extraction contract failed: %s %v", result.Output, err)
	}
}
